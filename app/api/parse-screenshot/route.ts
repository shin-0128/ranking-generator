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
// Keep this LEAN. A verbose prompt — especially spelling out the coordinate
// frame ("0 = top/left … 1000 = bottom/right of the image") — makes some models
// (e.g. 2.5-flash-lite) emit boxes on a 1000×1000 SQUARE grid instead of the
// image's true aspect, which then maps to the wrong pixels and drifts the crop.
// Concise instructions keep every model's grounding aspect-correct. Measured,
// not guessed: see scripts/probe-models.mjs.
const SYSTEM_PROMPT = `You read TikTok contribution-ranking screenshots. Return one record per visible user row in the ranking list, top-to-bottom.

For each row:
- rank: the position number at the far left (e.g. 1, 13, 14).
- name: the display name. Keep decorative emoji as-is. Exclude the "奇想天外" badge, roman-numeral tier markers (Ⅰ–Ⅻ / I–XII), the coin line (e.g. "コイン949.4 K枚"), and UI labels.
- a tight bounding box (ymin, xmin, ymax, xmax, normalized 0–1000) around the user's round profile avatar — the circular photo between the rank number and the name. Box only the photo, not the rank number, badge, name, or any VIP/VVIP pill overlapping its bottom.

Return every visible ranked row in order; do not omit rows. Ignore the status bar, the page header and any avatars in it, filter tabs, and the bottom navigation. If it is not a ranking screen, return an empty list.`;

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

interface BoxEntry {
  rank: number;
  name: string;
  ymin: number;
  xmin: number;
  ymax: number;
  xmax: number;
}

/**
 * Detect a "square-grid" response: boxes normalized to a 1000×1000 square rather
 * than the image's true aspect. For a square avatar the box w/h should match the
 * image aspect (H/W); square-grid responses come back ≈1 and map to the wrong
 * pixels (drifted crops). When the median box ratio is closer to 1 than to the
 * image aspect, the response is unusable → caller falls to another model.
 */
function looksSquareGrid(entries: BoxEntry[], W: number, H: number): boolean {
  if (!W || !H || entries.length === 0) return false;
  const aspect = H / W;
  if (Math.abs(aspect - 1) < 0.25) return false; // near-square image: can't tell
  const ratios = entries
    .map((e) => (e.xmax - e.xmin) / Math.max(1, e.ymax - e.ymin))
    .sort((a, b) => a - b);
  const med = ratios[Math.floor(ratios.length / 2)];
  return Math.abs(med - 1) < Math.abs(med - aspect);
}

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
  let imgW = 0;
  let imgH = 0;
  try {
    const formData = await req.formData();
    const candidate = formData.get("file");
    if (candidate instanceof Blob) file = candidate;
    imgW = Number(formData.get("width")) || 0;
    imgH = Number(formData.get("height")) || 0;
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

    // Model fallback chain, ONE shot per model. A slow/hung model (network
    // timeout) or an overloaded one (503/429) is abandoned immediately for a
    // capacity-diverse alternative rather than retried in place — retrying the
    // same stalled endpoint is what ballooned latency to 60–160s on flaky
    // connections. A whole pass through the chain (each capped at `timeout`,
    // and the lot capped at OVERALL_BUDGET) bounds the user's wait.
    //
    // Gemini 3.x flash models ONLY. The 2.5 family is prompt-fragile on box
    // coordinates — it intermittently emits square-grid boxes that drift the
    // crop (measured: scripts/probe-models.mjs), so it's excluded despite being
    // available. 3.5-flash grounds best; the lite 3.x models are the reliable
    // always-aspect-correct workhorses when the bigger ones are congested.
    const MODELS = [
      "gemini-3.5-flash",
      "gemini-3-flash-preview",
      "gemini-3.1-flash-lite",
      "gemini-flash-lite-latest",
      "gemini-flash-latest",
    ];
    const PER_ATTEMPT_TIMEOUT = 30000;
    const OVERALL_BUDGET = 50000;
    const startedAt = Date.now();
    let parsed: { entries: BoxEntry[] } | null = null;
    let usedModel = "";
    let lastErr: unknown;
    let sawTransient = false;
    for (const modelName of MODELS) {
      if (Date.now() - startedAt > OVERALL_BUDGET) break;
      const model = client.getGenerativeModel(
        {
          model: modelName,
          systemInstruction: SYSTEM_PROMPT,
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: SCHEMA,
            temperature: 0,
          },
        },
        { timeout: PER_ATTEMPT_TIMEOUT },
      );
      try {
        const result = await model.generateContent(prompt);
        const text = result.response.text();
        if (!text) throw new Error("empty response");
        const candidate = JSON.parse(text) as { entries: BoxEntry[] };
        // Guard: reject square-grid coordinates and fall to another model.
        if (looksSquareGrid(candidate.entries ?? [], imgW, imgH)) {
          lastErr = new Error("square-grid coordinates");
          console.warn(
            `[parse-screenshot] ${modelName} returned square-grid coords → next`,
          );
          continue;
        }
        parsed = candidate;
        usedModel = modelName;
        break;
      } catch (err) {
        lastErr = err;
        const transient = isTransient(err);
        sawTransient = sawTransient || transient;
        console.warn(
          `[parse-screenshot] ${modelName} ${transient ? "transient" : "error"} → next: ${err instanceof Error ? err.message.slice(0, 80) : err}`,
        );
      }
    }
    if (!parsed) {
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
