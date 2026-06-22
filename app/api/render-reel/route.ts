import { NextResponse } from "next/server";
import { buildReelEdit, submitRender, getRender, type ReelEntry } from "@/lib/shotstack";

export const runtime = "nodejs";
export const maxDuration = 30;

// POST: submit a render. Body: { entries: [{rank,name,url}], title? } → { id }
export async function POST(req: Request) {
  let body: { entries?: ReelEntry[]; title?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const entries = (body.entries ?? []).filter(
    (e) => e && typeof e.rank === "number" && e.url,
  );
  if (entries.length === 0) {
    return NextResponse.json({ error: "no entries with avatars" }, { status: 400 });
  }
  try {
    const edit = buildReelEdit(entries, body.title || "ランキング");
    const id = await submitRender(edit);
    return NextResponse.json({ id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    console.error("[render-reel] submit:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// GET ?id=...: poll render status → { status, url? }
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });
  try {
    const r = await getRender(id);
    return NextResponse.json(r);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
