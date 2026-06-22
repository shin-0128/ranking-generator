// Composite test: Veo video background under the real reel cards/avatars.
import { readFileSync } from "node:fs";
const KEY = readFileSync(".env.local", "utf8").match(/^SHOTSTACK_API_KEY=(.*)$/m)[1].trim();
const ENV = "stage";
const HOST = `https://api.shotstack.io/edit/${ENV}`;
const INGEST = `https://api.shotstack.io/ingest/${ENV}`;
const ASSET = "https://ranking-generator-neqv.vercel.app/video";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1) ingest the local Veo mp4 → hosted URL
async function ingestFile(path, mime) {
  const up = await (await fetch(`${INGEST}/upload`, { method: "POST", headers: { "x-api-key": KEY } })).json();
  const url = up.data?.attributes?.url, id = up.data?.id;
  await fetch(url, { method: "PUT", body: readFileSync(path), headers: { "Content-Type": mime } });
  for (let i = 0; i < 30; i++) {
    await sleep(2000);
    const s = await (await fetch(`${INGEST}/sources/${id}`, { headers: { "x-api-key": KEY } })).json();
    if (s.data?.attributes?.status === "ready") return s.data.attributes.source;
    if (s.data?.attributes?.status === "failed") throw new Error("ingest failed");
  }
  throw new Error("ingest timeout");
}

console.log("ingesting Veo mp4…");
const bgUrl = await ingestFile("scripts/veo.mp4", "video/mp4");
console.log("bg:", bgUrl);

// test data: 5 deployed poc circular avatars
const order = [5, 4, 3, 2, 1].map((rank, i) => ({
  rank,
  name: ["夜空のティア", "進撃のハム", "ルナ・モチ", "黒猫オーナー", "皇帝ガレット"][i],
  url: `${ASSET}/poc/av${i + 1}.png`,
}));
const ease = (easing) => ({ interpolation: "bezier", easing });
const medal = (r) => (r === 1 ? "🥇" : r === 2 ? "🥈" : r === 3 ? "🥉" : "");
const GOLD = "#ffd86b";
const rankHtml = (rank) => ({ type: "html", html: `<p class="r">${medal(rank) ? medal(rank) + " " : ""}第 ${rank} 位</p>`, css: `.r{font-family:'Noto Sans JP',sans-serif;font-size:144px;font-weight:700;color:${GOLD};text-align:center;text-shadow:0 6px 24px rgba(0,0,0,.8);margin:0}`, width: 1080, height: 300 });
const nameHtml = (name) => ({ type: "html", html: `<p class="n">${name}</p>`, css: `.n{font-family:'Noto Sans JP',sans-serif;font-size:112px;font-weight:700;color:#fff;text-align:center;text-shadow:0 6px 24px rgba(0,0,0,.85);margin:0}`, width: 1080, height: 240 });

const intro = 1.6;
const durOf = (r) => (r === 1 ? 3.4 : r <= 3 ? 2.4 : 1.8);
const starts = []; let t = intro;
for (const e of order) { starts.push(t); t += durOf(e.rank); }
const total = t;

const avatarClips = order.map((e, i) => ({
  asset: { type: "image", src: e.url }, start: starts[i], length: durOf(e.rank), fit: "none", scale: 0.78,
  offset: { x: [{ from: i % 2 === 0 ? 0.6 : -0.6, to: 0, start: 0, length: 0.42, ...ease("easeOutBack") }], y: -0.02 },
}));
const flashClips = order.map((e, i) => ({
  asset: { type: "image", src: `${ASSET}/flash.png` }, start: starts[i], length: 0.3, fit: "none",
  scale: e.rank === 1 ? 1.8 : 1.4, offset: { y: -0.02 },
  opacity: [{ from: e.rank === 1 ? 1 : 0.85, to: 0, start: 0, length: 0.26, ...ease("easeOutQuad") }],
}));
const rankClips = order.map((e, i) => ({ asset: rankHtml(e.rank), start: starts[i], length: durOf(e.rank), position: "top", offset: { y: -0.14 }, transition: { in: "slideDown", out: "fade" } }));
const nameClips = order.map((e, i) => ({ asset: nameHtml(e.name), start: starts[i], length: durOf(e.rank), position: "bottom", offset: { y: 0.16 }, transition: { in: "slideUp", out: "fade" } }));

// video bg: loop the 8s Veo clip across the whole timeline by tiling clips
const SRC = 8;
const bgClips = [];
for (let s = 0; s < total; s += SRC) {
  bgClips.push({ asset: { type: "video", src: bgUrl, volume: 0 }, start: s, length: Math.min(SRC, total - s), fit: "cover", scale: 1.1 });
}

const titleClip = { asset: { type: "html", html: `<div class="t"><p class="big">視聴者ランキング</p><p class="sub">発 表</p></div>`, css: `.t{display:flex;flex-direction:column;align-items:center;gap:24px}.big{font-family:'Noto Sans JP',sans-serif;font-size:140px;font-weight:700;color:${GOLD};text-shadow:0 8px 32px rgba(0,0,0,.7);margin:0}.sub{font-family:'Noto Sans JP',sans-serif;font-size:72px;font-weight:700;color:#fff;letter-spacing:.3em;margin:0}`, width: 1080, height: 540 }, start: 0, length: intro, transition: { in: "zoom", out: "fade" } };

const edit = {
  timeline: {
    fonts: [{ src: `${ASSET}/NotoSansJP-Bold.otf` }],
    background: "#08080e",
    tracks: [
      { clips: [titleClip] }, { clips: flashClips }, { clips: rankClips },
      { clips: nameClips }, { clips: avatarClips }, { clips: bgClips },
    ],
  },
  output: { format: "mp4", aspectRatio: "9:16", resolution: "1080", fps: 30 },
};

console.log("submitting render…");
const sub = await (await fetch(`${HOST}/render`, { method: "POST", headers: { "Content-Type": "application/json", "x-api-key": KEY }, body: JSON.stringify(edit) })).json();
console.log("submit:", JSON.stringify(sub).slice(0, 200));
const id = sub.response?.id;
if (!id) process.exit(1);
for (let i = 0; i < 50; i++) {
  await sleep(4000);
  const st = await (await fetch(`${HOST}/render/${id}`, { headers: { "x-api-key": KEY } })).json();
  process.stdout.write(" " + st.response?.status);
  if (st.response?.status === "done") { console.log("\nURL:", st.response.url); break; }
  if (st.response?.status === "failed") { console.log("\nFAILED", JSON.stringify(st.response?.error || st.response)); break; }
}
