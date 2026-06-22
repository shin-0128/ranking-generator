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
import { getEffect } from "./reelEffects";

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

// Opening hook (first ~2.5s). TikTok retention lives or dies in the first 3
// seconds, so we don't just title-card — we pose a suspense question ("who's
// #1?") and tell the viewer to stay, over the already-moving background. The
// countdown then pays the question off at the end.
function hookHtml(title: string, color: string) {
  return {
    type: "html" as const,
    html: `<div class="h"><p class="ey">${escapeHtml(title)}</p><p class="q">第 1 位 は…？</p><p class="cta">最後まで観てね</p></div>`,
    css:
      `.h{display:flex;flex-direction:column;align-items:center;gap:28px}` +
      `.ey{font-family:'Noto Sans JP',sans-serif;font-size:82px;font-weight:700;color:#fff;letter-spacing:.06em;text-shadow:0 4px 18px rgba(0,0,0,.75);margin:0}` +
      `.q{font-family:'Noto Sans JP',sans-serif;font-size:152px;font-weight:700;color:${color};text-shadow:0 8px 32px rgba(0,0,0,.7);margin:0}` +
      `.cta{font-family:'Noto Sans JP',sans-serif;font-size:62px;font-weight:700;color:#fff;letter-spacing:.12em;text-shadow:0 4px 18px rgba(0,0,0,.85);margin:0}`,
    width: 1080,
    height: 660,
  };
}

// Closing CTA — mirrors the hook ("#1 is…?" → "what's YOUR rank?") so the end
// rhymes with the start (semantic loop: invites a replay) and drives comments.
function ctaHtml(color: string) {
  return {
    type: "html" as const,
    html: `<div class="h"><p class="q">あなたは何位？</p><p class="cta">コメントで教えてね</p></div>`,
    css:
      `.h{display:flex;flex-direction:column;align-items:center;gap:28px}` +
      `.q{font-family:'Noto Sans JP',sans-serif;font-size:140px;font-weight:700;color:${color};text-shadow:0 8px 32px rgba(0,0,0,.7);margin:0}` +
      `.cta{font-family:'Noto Sans JP',sans-serif;font-size:64px;font-weight:700;color:#fff;letter-spacing:.12em;text-shadow:0 4px 18px rgba(0,0,0,.85);margin:0}`,
    width: 1080,
    height: 520,
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
  effectId?: string,
  // off by default: most livers add their own trending TikTok sound on top, so
  // we ship a clean (silent) canvas unless a self-contained version is wanted.
  sound = false,
) {
  const genre = getGenre(genreId);
  const effect = getEffect(effectId);
  const genreBase = `${ASSET_BASE}/genres/${genre.id}`;
  const order = [...entries].sort((a, b) => b.rank - a.rank); // reveal high→low
  const intro = 2.4; // a touch longer so the hook reads, still snappy
  // Faster low ranks, big climactic hold on #1 (the payoff). TikTok rewards
  // constant change + a strong finish, not even pacing.
  const durOf = (rank: number) => (rank === 1 ? 3.4 : rank <= 3 ? 2.4 : 1.8);
  const starts: number[] = [];
  let t = intro;
  for (const e of order) {
    starts.push(t);
    t += durOf(e.rank);
  }
  const contentEnd = t;
  const outro = 1.2; // closing CTA — turns the end into a loop/comment prompt
  const total = contentEnd + outro;

  const titleClip = {
    asset: hookHtml(title, genre.rankColor),
    start: 0,
    length: intro,
    transition: { in: "zoom", out: "fade" },
    // slow downward drift so the hook is never a static hold
    offset: { y: [{ from: -0.04, to: 0.03, start: 0, length: intro, ...ease("easeOutSine") }] },
  };
  const ctaClip = {
    asset: ctaHtml(genre.rankColor),
    start: contentEnd,
    length: outro,
    transition: { in: "zoom", out: "fade" },
    offset: { y: [{ from: 0.03, to: -0.03, start: 0, length: outro, ...ease("easeInOutSine") }] },
  };
  // Avatar enters per the chosen effect, then holds STILL (the subject stays
  // stable). The "always moving" energy comes from the background, not the icon.
  const avatarClips = order.map((e, i) => ({
    asset: { type: "image", src: e.url },
    start: starts[i],
    length: durOf(e.rank),
    fit: "none",
    scale: 0.78,
    ...effect.avatarAnim(i),
  }));
  const flashClips = order.flatMap((e, i) => {
    const peak = effect.flashPeak(e.rank);
    if (peak <= 0) return [];
    return [{
      asset: { type: "image", src: `${ASSET_BASE}/flash.png` },
      start: starts[i],
      length: 0.3,
      fit: "none",
      scale: e.rank === 1 ? 1.8 : 1.4,
      offset: { y: -0.02 },
      opacity: [{ from: peak, to: 0, start: 0, length: 0.26, ...ease("easeOutQuad") }],
    }];
  });
  const speedlineClips = effect.speedlines
    ? order.map((e, i) => ({
        asset: { type: "image", src: `${genreBase}/speedlines.png` },
        start: starts[i],
        length: 0.55,
        fit: "none",
        // grow the burst outward via offset so it reads as expanding energy
        scale: 1.05,
        offset: {
          y: [{ from: 0.02, to: -0.02, start: 0, length: 0.5, ...ease("easeOutQuad") }],
        },
        opacity: [{ from: 0.85, to: 0, start: 0, length: 0.42, ...ease("easeOutQuad") }],
      }))
    : [];
  const rankClips = order.map((e, i) => ({
    asset: rankHtml(e.rank, genre.rankColor),
    start: starts[i],
    length: durOf(e.rank),
    position: "top",
    offset: { y: -0.14 },
    transition: { in: "slideDown", out: "fade" },
  }));
  const nameClips = order.map((e, i) => ({
    asset: nameHtml(e.name, genre.nameColor),
    start: starts[i],
    length: durOf(e.rank),
    position: "bottom",
    offset: { y: 0.16 },
    transition: { in: "slideUp", out: "fade" },
  }));
  // CC0 sound design (self-synthesized, no licensing): a whoosh as each avatar
  // flies in, an impact thud on landing, and for #1 a tension riser into a big
  // stab. Baked low so a liver's own trending TikTok sound still sits on top.
  const SFX = `${ASSET_BASE}/sfx`;
  const audio = (src: string, start: number, length: number, volume: number) => ({
    asset: { type: "audio", src: `${SFX}/${src}`, volume },
    start: Math.max(0, start),
    length,
  });
  const audioClips: object[] = [];
  if (sound) {
    order.forEach((e, i) => {
      audioClips.push(audio("whoosh.mp3", starts[i] - 0.08, 0.45, 0.55));
      if (e.rank === 1) {
        audioClips.push(audio("riser.mp3", starts[i] - 1.05, 1.2, 0.5));
        audioClips.push(audio("boom1.mp3", starts[i] + 0.1, 1.0, 0.85));
      } else {
        audioClips.push(audio("impact.mp3", starts[i] + 0.1, 0.5, 0.7));
      }
    });
  }

  // Cinematic Veo-generated video background per genre — this is the real motion
  // in the frame while the avatar holds still (replaces the old procedural
  // particle/pan layers). Shotstack has no loop flag, so the ~8s clip is tiled
  // back-to-back across the whole timeline. scale 1.1 hides any edge wobble.
  const BG_SRC = 8;
  const bgClips: object[] = [];
  for (let s = 0; s < total; s += BG_SRC) {
    bgClips.push({
      asset: { type: "video", src: `${genreBase}/bg.mp4`, volume: 0 },
      start: s,
      length: Math.min(BG_SRC, total - s),
      fit: "cover",
      scale: 1.1,
    });
  }

  return {
    timeline: {
      fonts: [{ src: `${ASSET_BASE}/NotoSansJP-Bold.otf` }],
      background: "#08080e",
      // drop empty tracks — Shotstack rejects a track with zero clips (e.g. when
      // the chosen effect has no speed-lines).
      tracks: [
        { clips: [titleClip, ctaClip] },
        { clips: flashClips },
        { clips: rankClips },
        { clips: nameClips },
        { clips: avatarClips },
        { clips: speedlineClips },
        { clips: bgClips },
        { clips: audioClips },
      ].filter((tr) => tr.clips.length > 0),
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
