import { NextResponse } from "next/server";
import { ingestPng } from "@/lib/shotstack";

export const runtime = "nodejs";
export const maxDuration = 30;

// POST a PNG body (image/png) → host it on Shotstack → { url }.
export async function POST(req: Request) {
  try {
    const buf = new Uint8Array(await req.arrayBuffer());
    if (buf.byteLength < 100) {
      return NextResponse.json({ error: "empty image" }, { status: 400 });
    }
    const url = await ingestPng(buf);
    return NextResponse.json({ url });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    console.error("[ingest]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
