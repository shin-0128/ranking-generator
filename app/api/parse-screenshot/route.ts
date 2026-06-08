import { GoogleGenerativeAI, SchemaType, type Schema } from "@google/generative-ai";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Single-pass grounded extraction.
 *
 * One Gemini 2.5 Flash call returns, per visible user row, the rank + name +
 * a coarse avatar bounding box — all bound together in one object so the
 * label can never be zipped onto the wrong avatar (the failure mode of the
 * old two-model Claude+Gemini + nearest-Y pipeline).
 *
 * Coordinates are NORMALIZED [0,1000] (Gemini's native grounding space), so
 * the response is resolution-independent. The client maps boxes back to the
 * full-resolution canvas and refines them with local CV before cropping —
 * VLM boxes are coarse on small circular avatars and must not be trusted as
 * pixel-tight (see GroundingME / ScreenSpot-Pro: small-object grounding is
 * the systemic weak point of every current VLM).
 */
const SYSTEM_PROMPT = `You read TikTok contribution-ranking screenshots and return one record per visible user row, top-to-bottom.

For EACH user row in the ranking list return:
- rank: the integer position number at the far left of the row (e.g. 1, 2, 13, 14).
- name: the user's display name. KEEP decorative emoji and symbols as-is (the caller cleans them). EXCLUDE: the badge text "奇想天外", roman-numeral tier markers (Ⅰ–Ⅻ / I–XII), the coin amount line (e.g. "コイン949.4 K枚"), and any UI labels.
- box: a TIGHT bounding box around the user's circular profile avatar — the round photo (face / character / object) that sits between the rank number (left) and the name/badge (right). Return NORMALIZED integers in [0,1000] where 0 = top/left edge and 1000 = bottom/right edge of the image:
    ymin, xmin = top-left corner
    ymax, xmax = bottom-right corner

Rules for box:
1. Enclose ONLY the circular profile photo. Do NOT include the rank number, the "奇想天外" badge, tier markers, the name, or coin text.
2. The avatar is roughly square (width ≈ height) and visually the same size across all rows of one screenshot. If your box sizes vary wildly between rows, you are targeting the wrong things — re-check.
3. If a "VIP" / "VVIP" / level badge or pill overlaps or hangs off the BOTTOM edge of the avatar, do NOT extend the box to include it. The box bottom is the circular photo's own bottom edge.
4. Err slightly LARGE (a few pixels of surrounding background) rather than too small (cutting the photo).

IGNORE entirely: the status bar (time/battery), the page header/title bar and any avatars inside it, filter dropdowns/tabs, and the bottom navigation bar. Only rows in the ranked list count.

Return EVERY visible ranked row in order, even if a row is partially clipped at the top or bottom — as long as its rank number and avatar are visible. Do NOT omit rows. If the image is not a TikTok ranking screen, return an empty list.`;

const SCHEMA: Schema = {
  type: SchemaType.OBJECT,
  properties: {
    entries: {
      type: SchemaType.ARRAY,
      description: "Every ranked user row, ordered top-to-bottom",
      items: {
        type: SchemaType.OBJECT,
        properties: {
          rank: { type: SchemaType.INTEGER, description: "position number" },
          name: { type: SchemaType.STRING, description: "display name, emoji kept" },
          ymin: { type: SchemaType.INTEGER, description: "avatar top edge (0-1000)" },
          xmin: { type: SchemaType.INTEGER, description: "avatar left edge (0-1000)" },
          ymax: { type: SchemaType.INTEGER, description: "avatar bottom edge (0-1000)" },
          xmax: { type: SchemaType.INTEGER, description: "avatar right edge (0-1000)" },
        },
        required: ["rank", "name", "ymin", "xmin", "ymax", "xmax"],
      },
    },
  },
  required: ["entries"],
};

/** Transient server-side failures worth retrying (overload, rate limit, 5xx). */
function isTransient(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    /\b(429|500|502|503|504)\b/.test(msg) ||
    /high demand|overloaded|unavailable|try again|fetch failed|ECONNRESET|ETIMEDOUT/i.test(
      msg,
    )
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type ImageMime = "image/png" | "image/jpeg" | "image/gif" | "image/webp";

function pickMime(mime: string): ImageMime {
  if (mime === "image/jpeg" || mime === "image/jpg") return "image/jpeg";
  if (mime === "image/gif") return "image/gif";
  if (mime === "image/webp") return "image/webp";
  return "image/png";
}

export async function POST(req: Request) {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "GOOGLE_API_KEY not configured" },
      { status: 500 },
    );
  }

  let file: Blob | null = null;
  try {
    const formData = await req.formData();
    const candidate = formData.get("file");
    if (candidate instanceof Blob) file = candidate;
  } catch {
    return NextResponse.json({ error: "invalid form data" }, { status: 400 });
  }
  if (!file) {
    return NextResponse.json({ error: "missing file" }, { status: 400 });
  }

  const mime = pickMime(file.type || "image/png");
  const buffer = Buffer.from(await file.arrayBuffer());
  const base64 = buffer.toString("base64");

  try {
    const client = new GoogleGenerativeAI(apiKey);
    const prompt = [
      { inlineData: { mimeType: mime, data: base64 } },
      "Extract every ranked user row: rank, name, and the avatar bounding box.",
    ];

    // Model fallback chain. A 503 ("high demand") is the model's server-side
    // capacity, not our key's quota — so when one model is overloaded we fall
    // to a capacity-diverse alternative. Each model gets a couple of backed-off
    // retries; a non-transient error (e.g. a 404 model name) just skips to the
    // next model rather than killing the chain.
    // Ordered newest-capable-first, then capacity-diverse fallbacks. Live probe
    // (2026-06) showed 2.5-flash 503ing and the 2.0/2.5-pro family 429 rate-
    // limited, while the Gemini 3.x flash models had capacity — and being a
    // newer generation they also tend to ground boxes better, which is our core
    // problem. A 429/503/404 on any model just rolls to the next.
    const MODELS = [
      "gemini-3.5-flash",
      "gemini-2.5-flash",
      "gemini-3-flash-preview",
      "gemini-2.5-flash-lite",
      "gemini-flash-latest",
    ];
    const ATTEMPTS_PER_MODEL = 2;
    let result;
    let usedModel = "";
    let lastErr: unknown;
    let sawTransient = false;
    outer: for (const modelName of MODELS) {
      const model = client.getGenerativeModel({
        model: modelName,
        systemInstruction: SYSTEM_PROMPT,
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: SCHEMA,
          temperature: 0,
        },
      });
      for (let attempt = 1; attempt <= ATTEMPTS_PER_MODEL; attempt++) {
        try {
          result = await model.generateContent(prompt);
          usedModel = modelName;
          break outer;
        } catch (err) {
          lastErr = err;
          const transient = isTransient(err);
          sawTransient = sawTransient || transient;
          console.warn(
            `[parse-screenshot] ${modelName} ${transient ? "transient" : "error"} (attempt ${attempt}/${ATTEMPTS_PER_MODEL}): ${err instanceof Error ? err.message.slice(0, 80) : err}`,
          );
          if (!transient) break; // bad model/request → try next model immediately
          if (attempt < ATTEMPTS_PER_MODEL) {
            await sleep(700 * 2 ** (attempt - 1) + Math.floor(Math.random() * 400));
          }
        }
      }
    }
    if (!result) {
      console.error("[parse-screenshot] all models failed");
      if (sawTransient) {
        return NextResponse.json(
          { error: "Gemini が一時的に混雑しています。少し待って再アップロードしてください。" },
          { status: 503 },
        );
      }
      throw lastErr ?? new Error("all models failed");
    }
    if (usedModel !== MODELS[0]) {
      console.warn(`[parse-screenshot] fell back to ${usedModel}`);
    }

    const text = result.response.text();
    if (!text) {
      return NextResponse.json({ error: "empty response" }, { status: 502 });
    }
    const parsed = JSON.parse(text) as {
      entries: Array<{
        rank: number;
        name: string;
        ymin: number;
        xmin: number;
        ymax: number;
        xmax: number;
      }>;
    };
    console.log(
      `[parse-screenshot] ${usedModel} returned ${parsed.entries?.length ?? 0} entries`,
    );
    return NextResponse.json({ ...parsed, _model: usedModel });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    console.error("[parse-screenshot] error:", msg);
    if (isTransient(e)) {
      return NextResponse.json(
        { error: "Gemini が一時的に混雑しています。少し待って再アップロードしてください。" },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
