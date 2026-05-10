import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let payload: { password?: string };
  try {
    payload = (await req.json()) as { password?: string };
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const expected = process.env.APP_PASSWORD;
  if (!expected) {
    return NextResponse.json(
      { ok: false, message: "APP_PASSWORD not configured" },
      { status: 500 },
    );
  }

  if (payload.password === expected) {
    const res = NextResponse.json({ ok: true });
    res.cookies.set("auth", expected, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 30,
      path: "/",
    });
    return res;
  }

  return NextResponse.json({ ok: false }, { status: 401 });
}
