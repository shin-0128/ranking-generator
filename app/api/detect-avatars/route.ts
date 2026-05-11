import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;

const SYSTEM_PROMPT = `You are a precise visual detector for TikTok ranking-screen screenshots.

Task: identify every user's circular profile avatar (the small round photo on the LEFT side of each user row, between the rank number and the user's badge/name).

Return a tight bounding box for each avatar. The box must:
- TIGHTLY enclose the visible profile photo (the circular image itself)
- NOT include the rank number, badge labels (e.g. "奇想天外"), or the user name
- NOT include header thumbnails, navigation icons, or any UI not in the user-row list
- Be returned in NORMALIZED coordinates: each value is in [0, 1000] where 0 = top/left edge of the image and 1000 = bottom/right edge

Order: top-to-bottom (the avatar at the highest position first).

If the image is not a TikTok ranking screen or no avatars are visible, return an empty list.`;

const SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    avatars: {
      type: SchemaType.ARRAY,
      description: "All user profile avatars detected, top-to-bottom",
      items: {
        type: SchemaType.OBJECT,
        properties: {
          ymin: { type: SchemaType.INTEGER, description: "top edge (0-1000)" },
          xmin: { type: SchemaType.INTEGER, description: "left edge (0-1000)" },
          ymax: { type: SchemaType.INTEGER, description: "bottom edge (0-1000)" },
          xmax: { type: SchemaType.INTEGER, description: "right edge (0-1000)" },
        },
        required: ["ymin", "xmin", "ymax", "xmax"],
      },
    },
  },
  required: ["avatars"],
};

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
    const model = client.getGenerativeModel({
      model: "gemini-2.0-flash",
      systemInstruction: SYSTEM_PROMPT,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: SCHEMA,
      },
    });

    const result = await model.generateContent([
      { inlineData: { mimeType: mime, data: base64 } },
      "Return bounding boxes for every user profile avatar visible in this screenshot.",
    ]);

    const text = result.response.text();
    if (!text) {
      return NextResponse.json({ error: "empty response" }, { status: 502 });
    }
    const parsed = JSON.parse(text) as {
      avatars: Array<{ ymin: number; xmin: number; ymax: number; xmax: number }>;
    };
    return NextResponse.json(parsed);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "unknown error" },
      { status: 500 },
    );
  }
}
