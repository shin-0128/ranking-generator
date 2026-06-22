/**
 * Shotstack render integration (server-side).
 *
 * Builds the ranking-reveal edit JSON from real avatar URLs + names + ranks and
 * submits it to Shotstack. Avatars are pre-baked circular PNGs (with the gold
 * ring) produced client-side; the static assets (background, JP font) are served
 * from our own deploy so Shotstack can fetch them by URL.
 *
 * Validated shape: see scripts/shotstack-poc.mjs. JP text REQUIRES the hosted
 * font (timeline.fonts) — Shotstack's HTML fallback renders tofu without it.
 */
import { getGenre } from "./reelGenres";

const ENV = "stage"; // sandbox; switch to "v1" on a paid plan (drops watermark)
const HOST = `https://api.shotstack.io/edit/${ENV}`;
const INGEST = `https://api.shotstack.io/ingest/${ENV}`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Host a PNG on Shotstack (Ingest API) and return its public URL — used so the
 * render can reference user avatars without any extra storage provider. Flow:
 * request a signed upload URL → PUT the bytes → poll until the source is ready.
 */
export async function ingestPng(buf: Uint8Array): Promise<string> {
  const key = process.env.SHOTSTACK_API_KEY;
  if (!key) throw new Error("SHOTSTACK_API_KEY not configured");

  const up = await fetch(`${INGEST}/upload`, {
    method: "POST",
    headers: { "x-api-key": key },
  });
  const upj = await up.json();
  const url: string | undefined = upj.data?.attributes?.url;
  const id: string | undefined = upj.data?.id;
  if (!url || !id) throw new Error(`ingest upload-request failed: ${JSON.stringify(upj)}`);

  const put = await fetch(url, {
    method: "PUT",
    // Node's fetch (undici) accepts a Uint8Array body at runtime; the DOM
    // BodyInit type doesn't list it, so cast.
    body: buf as unknown as BodyInit,
    headers: { "Content-Type": "image/png" },
  });
  if (!put.ok) throw new Error(`ingest PUT failed: ${put.status}`);

  for (let i = 0; i < 25; i++) {
    await sleep(2000);
    const s = await (
      await fetch(`${INGEST}/sources/${id}`, { headers: { "x-api-key": key } })
    ).json();
    const status = s.data?.attributes?.status;
    if (status === "ready") return s.data.attributes.source as string;
    if (status === "failed") throw new Error("ingest source failed");
  }
  throw new Error("ingest timeout");
}

// Where our static reel assets live (background + JP font). Override per env.
const ASSET_BASE =
  process.env.REEL_ASSET_BASE ??
  "https://ranking-generator-neqv.vercel.app/video";

export interface ReelEntry {
  rank: number;
  name: string;
  /** public URL of the pre-baked circular avatar PNG */
  url: string;
}

const medal = (r: number) => (r === 1 ? "🥇" : r === 2 ? "🥈" : r === 3 ? "🥉" : "");

// HTML assets authored at the 1080-wide output res so text stays crisp
// (a smaller asset gets upscaled by Shotstack and looks soft).
function rankHtml(rank: number, color: string) {
  const m = medal(rank);
  return {
    type: "html" as const,
    html: `<p class="r">${m ? m + " " : ""}第 ${rank} 位</p>`,
    css: `.r{font-family:'Noto Sans JP',sans-serif;font-size:144px;font-weight:700;color:${color};text-align:center;text-shadow:0 6px 24px rgba(0,0,0,.6);margin:0}`,
    width: 1080,
    height: 300,
  };
}
function nameHtml(name: string, color: string) {
  return {
    type: "html" as const,
    html: `<p class="n">${escapeHtml(name)}</p>`,
    css: `.n{font-family:'Noto Sans JP',sans-serif;font-size:112px;font-weight:700;color:${color};text-align:center;text-shadow:0 6px 24px rgba(0,0,0,.7);margin:0}`,
    width: 1080,
    height: 240,
  };
}
function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

function titleHtml(title: string, color: string) {
  return {
    type: "html" as const,
    html: `<div class="t"><p class="big">${escapeHtml(title)}</p><p class="sub">発 表</p></div>`,
    css: `.t{display:flex;flex-direction:column;align-items:center;gap:24px}.big{font-family:'Noto Sans JP',sans-serif;font-size:156px;font-weight:700;color:${color};text-shadow:0 8px 32px rgba(0,0,0,.6);margin:0}.sub{font-family:'Noto Sans JP',sans-serif;font-size:72px;font-weight:700;color:#fff;letter-spacing:.3em;margin:0}`,
    width: 1080,
    height: 540,
  };
}

// Fighting-game-style impact. Shotstack stage doesn't animate scale, but offset
// + opacity keyframes do: the avatar slams in from alternating sides with an
// easeOutBack overshoot, under a white impact flash and a radial speed-line
// burst that fades on landing.
const ease = (easing: string) => ({ interpolation: "bezier", easing });

export function buildReelEdit(
  entries: ReelEntry[],
  title = "ランキング",
  genreId?: string,
) {
  const genre = getGenre(genreId);
  const genreBase = `${ASSET_BASE}/genres/${genre.id}`;
  const order = [...entries].sort((a, b) => b.rank - a.rank); // reveal high→low
  const intro = 1.6;
  const dur = 2.4;
  const total = intro + order.length * dur;
  const at = (i: number) => intro + i * dur;

  const titleClip = {
    asset: titleHtml(title, genre.rankColor),
    start: 0,
    length: intro,
    transition: { in: "zoom", out: "fade" },
  };
  const avatarClips = order.map((e, i) => {
    const side = i % 2 === 0 ? 0.6 : -0.6; // slam in from alternating sides
    return {
      asset: { type: "image", src: e.url },
      start: at(i),
      length: dur,
      fit: "none",
      scale: 0.78,
      offset: {
        x: [{ from: side, to: 0, start: 0, length: 0.4, ...ease("easeOutBack") }],
        y: [{ from: -0.02, to: -0.02, start: 0, length: 0.45 }],
      },
    };
  });
  const flashClips = order.map((e, i) => ({
    asset: { type: "image", src: `${ASSET_BASE}/flash.png` },
    start: at(i),
    length: 0.3,
    fit: "none",
    scale: 1.4,
    offset: { y: -0.02 },
    opacity: [{ from: 0.85, to: 0, start: 0, length: 0.26, ...ease("easeOutQuad") }],
  }));
  const speedlineClips = order.map((e, i) => ({
    asset: { type: "image", src: `${genreBase}/speedlines.png` },
    start: at(i),
    length: 0.55,
    fit: "none",
    scale: 1.05,
    offset: { y: -0.02 },
    opacity: [{ from: 0.85, to: 0, start: 0, length: 0.42, ...ease("easeOutQuad") }],
  }));
  const rankClips = order.map((e, i) => ({
    asset: rankHtml(e.rank, genre.rankColor),
    start: at(i),
    length: dur,
    position: "top",
    offset: { y: -0.14 },
    transition: { in: "slideDown", out: "fade" },
  }));
  const nameClips = order.map((e, i) => ({
    asset: nameHtml(e.name, genre.nameColor),
    start: at(i),
    length: dur,
    position: "bottom",
    offset: { y: 0.16 },
    transition: { in: "slideUp", out: "fade" },
  }));
  const bgClip = {
    asset: { type: "image", src: `${genreBase}/bg.png` },
    start: 0,
    length: total,
    fit: "cover",
  };

  return {
    timeline: {
      fonts: [{ src: `${ASSET_BASE}/NotoSansJP-Bold.otf` }],
      background: "#08080e",
      tracks: [
        { clips: [titleClip] },
        { clips: flashClips },
        { clips: rankClips },
        { clips: nameClips },
        { clips: avatarClips },
        { clips: speedlineClips },
        { clips: [bgClip] },
      ],
    },
    output: { format: "mp4", aspectRatio: "9:16", resolution: "1080", fps: 30 },
  };
}

export async function submitRender(edit: object): Promise<string> {
  const key = process.env.SHOTSTACK_API_KEY;
  if (!key) throw new Error("SHOTSTACK_API_KEY not configured");
  const res = await fetch(`${HOST}/render`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": key },
    body: JSON.stringify(edit),
  });
  const json = await res.json();
  if (!res.ok || !json.success) {
    throw new Error(`shotstack submit failed: ${JSON.stringify(json)}`);
  }
  return json.response.id as string;
}

export async function getRender(
  id: string,
): Promise<{ status: string; url?: string }> {
  const key = process.env.SHOTSTACK_API_KEY;
  if (!key) throw new Error("SHOTSTACK_API_KEY not configured");
  const res = await fetch(`${HOST}/render/${id}`, {
    headers: { "x-api-key": key },
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`shotstack status failed: ${JSON.stringify(json)}`);
  return { status: json.response?.status, url: json.response?.url };
}
