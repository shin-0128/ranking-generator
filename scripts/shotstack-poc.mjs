/**
 * Shotstack proof-of-concept: render a ranking-reveal reel from real avatar
 * URLs + names, to judge quality/cost/latency before committing.
 *
 * Each rank is an HTML/CSS card (circular avatar + ring + 第N位 + name) over a
 * gradient background, with Shotstack handling pro transitions + encoding. The
 * point is to compare this against the hand-canvas reel we abandoned.
 *
 * Setup: put SHOTSTACK_API_KEY=<sandbox key> in .env.local
 * Run:   node scripts/shotstack-poc.mjs
 * Output: prints the rendered MP4 URL when done.
 */
import { readFileSync } from "node:fs";

const KEY = (() => {
  const m = readFileSync(".env.local", "utf8").match(/^SHOTSTACK_API_KEY=(.*)$/m);
  return m ? m[1].trim() : "";
})();
if (!KEY) {
  console.error("SHOTSTACK_API_KEY not in .env.local");
  process.exit(1);
}

const HOST = "https://api.shotstack.io/edit/stage"; // stage = sandbox
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Circular gold-ringed avatars hosted on our own Vercel deploy (the real app
// will produce these client-side per user and upload them).
const BASE = "https://ranking-generator-neqv.vercel.app/video";
const ENTRIES = [
  { rank: 1, name: "だんちょお♪", url: `${BASE}/poc/av1.png` },
  { rank: 2, name: "進撃のハム", url: `${BASE}/poc/av2.png` },
  { rank: 3, name: "ぽてクマ", url: `${BASE}/poc/av3.png` },
  { rank: 4, name: "ちゃんみず", url: `${BASE}/poc/av4.png` },
  { rank: 5, name: "美川こん", url: `${BASE}/poc/av5.png` },
];

const medal = (r) => (r === 1 ? "🥇" : r === 2 ? "🥈" : r === 3 ? "🥉" : "");
const ENTRANCES = ["slideRight", "slideLeft", "carouselLeft", "slideUp", "carouselRight"];

// Text as standalone HTML clips (Japanese renders fine that way); avatar as a
// native image asset (reliable URL fetch + circular crop via CSS-free shape).
function rankHtml(rank) {
  const m = medal(rank);
  return {
    type: "html",
    html: `<p class="r">${m ? m + " " : ""}第 ${rank} 位</p>`,
    css: `.r{font-family:'Noto Sans JP',sans-serif;font-size:96px;font-weight:800;color:#FFD24D;text-align:center;text-shadow:0 4px 16px rgba(0,0,0,.6);margin:0}`,
    width: 720,
    height: 200,
  };
}
function nameHtml(name) {
  return {
    type: "html",
    html: `<p class="n">${name}</p>`,
    css: `.n{font-family:'Noto Sans JP',sans-serif;font-size:74px;font-weight:800;color:#fff;text-align:center;text-shadow:0 4px 16px rgba(0,0,0,.7);margin:0}`,
    width: 720,
    height: 160,
  };
}

function buildEdit() {
  const order = [...ENTRIES].sort((a, b) => b.rank - a.rank); // 10→1 reveal
  const dur = 2.4;
  const trans = (i) => ({ in: ENTRANCES[i % ENTRANCES.length], out: "fade" });

  const total = order.length * dur;

  // circular avatars are pre-ringed PNGs with alpha → just place, no crop
  const avatarClips = order.map((e, i) => ({
    asset: { type: "image", src: e.url },
    start: i * dur,
    length: dur,
    fit: "none",
    scale: 0.82,
    offset: { y: -0.02 },
    transition: trans(i),
  }));
  const rankClips = order.map((e, i) => ({
    asset: rankHtml(e.rank),
    start: i * dur,
    length: dur,
    position: "top",
    offset: { y: -0.14 },
    transition: { in: "slideDown", out: "fade" },
  }));
  const nameClips = order.map((e, i) => ({
    asset: nameHtml(e.name),
    start: i * dur,
    length: dur,
    position: "bottom",
    offset: { y: 0.16 },
    transition: { in: "slideUp", out: "fade" },
  }));
  const bgClip = {
    asset: { type: "image", src: `${BASE}/bg.png` },
    start: 0,
    length: total,
    fit: "cover",
  };

  return {
    timeline: {
      fonts: [{ src: `${BASE}/NotoSansJP-Bold.otf` }],
      background: "#08080e",
      tracks: [
        { clips: rankClips },
        { clips: nameClips },
        { clips: avatarClips },
        { clips: [bgClip] },
      ],
    },
    output: { format: "mp4", aspectRatio: "9:16", resolution: "hd", fps: 30 },
  };
}

async function run() {
  console.log("submitting render…");
  const res = await fetch(`${HOST}/render`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": KEY },
    body: JSON.stringify(buildEdit()),
  });
  const json = await res.json();
  if (!res.ok || !json.success) {
    console.error("render submit failed:", JSON.stringify(json, null, 2));
    process.exit(1);
  }
  const id = json.response.id;
  console.log("render id:", id, "— polling…");
  for (let i = 0; i < 60; i++) {
    await sleep(4000);
    const st = await fetch(`${HOST}/render/${id}`, { headers: { "x-api-key": KEY } });
    const sj = await st.json();
    const status = sj.response?.status;
    process.stdout.write(`  ${status}\n`);
    if (status === "done") {
      console.log("\n✅ MP4:", sj.response.url);
      return;
    }
    if (status === "failed") {
      console.error("render failed:", JSON.stringify(sj.response, null, 2));
      return;
    }
  }
  console.error("timed out");
}
run();
