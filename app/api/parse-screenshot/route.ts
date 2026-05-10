import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const client = new Anthropic();

const SYSTEM_PROMPT = `You analyze TikTok contribution-ranking screenshots and extract one record per visible user row.

The image you receive is exactly the size you see. All pixel coordinates you return MUST be in this image's pixel coordinate system, where (0, 0) is the top-left corner.

For each user row return:
- rank: integer at the far left of the row (the position number, e.g. 13, 14, 15)
- name: the user's display name. EXCLUDE the badge text "奇想天外", roman-numeral tier markers (Ⅰ–Ⅻ / I–XII), the coin amount line (e.g. "コイン949.4 K枚"), and any UI labels. KEEP decorative emoji and symbols in the name as-is (the caller will clean them).
- iconCircle: integer pixel coordinates of the user's circular profile photo. Return three values:
    cx = horizontal pixel center of the visible profile photo
    cy = vertical pixel center of the visible profile photo
    r  = radius of the photo in pixels (half its visible diameter)

CRITICAL rules for iconCircle:
1. The profile photo is the round avatar IMAGE itself (a face / character / object photo inside a circular frame). It is NOT the rank number, NOT the "奇想天外" badge, NOT any tab label, NOT any header text.
2. In each row, the avatar sits between the rank number (left) and the user name / badge (right). Visually it is the largest CIRCULAR PHOTO in that row.
3. The avatar is roughly square in proportions and visually consistent in size across all rows in one screenshot. If your detected r varies wildly between rows, you are likely targeting different things — re-check.
4. cx must point to the geometric center of the photo. NOT slightly above. NOT slightly to the side. Look at the actual photo edge, find the leftmost-rightmost extents, average them.
5. r must describe the photo itself: the square (cx-r, cy-r) to (cx+r, cy+r) must tightly contain the photo with minimal surrounding background. Err on the side of slightly TOO BIG (capturing a few pixels of background) rather than too small (cutting off the photo).
6. Avatar y position: avatars are centered vertically in their row. Avatars in the same screenshot share the same row height. If you have rank N at row Y, ranks N+1, N+2, etc. are at evenly-spaced Y positions below.

IGNORE entirely:
- The status bar (time, battery, signal at top)
- The page header / title bar (e.g. "ライブランキング", profile thumbnails at top of header, tabs like "ギフト数最多 / 視聴時間最長", filter dropdowns like "合計 / 28日")
- Any user thumbnails that appear in the HEADER (not in the row list)
- Bottom navigation bar / tab bar

If a user row is partially clipped at the top or bottom of the screenshot, still include it as long as the rank number and name are visible.

If you cannot confidently locate the avatar for a row, OMIT that entry entirely rather than guessing — a wrong icon coordinate is worse than no entry.`;

const SCHEMA = {
  type: "object",
  properties: {
    entries: {
      type: "array",
      items: {
        type: "object",
        properties: {
          rank: { type: "integer" },
          name: { type: "string" },
          iconCircle: {
            type: "object",
            properties: {
              cx: { type: "integer" },
              cy: { type: "integer" },
              r: { type: "integer" },
            },
            required: ["cx", "cy", "r"],
            additionalProperties: false,
          },
        },
        required: ["rank", "name", "iconCircle"],
        additionalProperties: false,
      },
    },
  },
  required: ["entries"],
  additionalProperties: false,
};

type ImageMediaType = "image/png" | "image/jpeg" | "image/gif" | "image/webp";

function pickMediaType(mime: string): ImageMediaType {
  if (mime === "image/jpeg" || mime === "image/jpg") return "image/jpeg";
  if (mime === "image/gif") return "image/gif";
  if (mime === "image/webp") return "image/webp";
  return "image/png";
}

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY not configured" },
      { status: 500 },
    );
  }

  let file: Blob | null = null;
  let widthHint: number | null = null;
  let heightHint: number | null = null;
  try {
    const formData = await req.formData();
    const candidate = formData.get("file");
    if (candidate instanceof Blob) file = candidate;
    const w = Number(formData.get("width"));
    const h = Number(formData.get("height"));
    if (Number.isFinite(w) && w > 0) widthHint = Math.round(w);
    if (Number.isFinite(h) && h > 0) heightHint = Math.round(h);
  } catch {
    return NextResponse.json({ error: "invalid form data" }, { status: 400 });
  }
  if (!file) {
    return NextResponse.json({ error: "missing file" }, { status: 400 });
  }

  const mime = file.type || "image/png";
  const mediaType = pickMediaType(mime);
  const buffer = Buffer.from(await file.arrayBuffer());
  const base64 = buffer.toString("base64");

  const sizeNote =
    widthHint && heightHint
      ? `The attached screenshot is exactly ${widthHint} × ${heightHint} pixels. All cx, cy must be integers within [0, ${widthHint}] and [0, ${heightHint}] respectively.`
      : "";

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      output_config: {
        format: { type: "json_schema", schema: SCHEMA },
      },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType, data: base64 },
            },
            {
              type: "text",
              text: `${sizeNote}\n\nExtract every user row visible in this screenshot.`.trim(),
            },
          ],
        },
      ],
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    if (!text) {
      return NextResponse.json(
        { error: "empty model response" },
        { status: 502 },
      );
    }

    const parsed = JSON.parse(text);
    return NextResponse.json(parsed);
  } catch (e) {
    if (e instanceof Anthropic.APIError) {
      return NextResponse.json(
        { error: `Anthropic ${e.status}: ${e.message}` },
        { status: e.status ?? 502 },
      );
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "unknown error" },
      { status: 500 },
    );
  }
}
