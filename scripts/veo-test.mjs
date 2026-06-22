import { readFileSync, writeFileSync } from "node:fs";
const KEY = readFileSync(".env.local", "utf8").match(/^GOOGLE_API_KEY=(.*)$/m)[1].trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MODEL = "veo-3.0-fast-generate-001";
const BASE = "https://generativelanguage.googleapis.com/v1beta";

const prompt =
  "Vertical 9:16 abstract cinematic looping background. Deep dark backdrop. Glowing orange and gold embers and sparks slowly drifting upward, soft volumetric light rays, gentle bokeh. No people, no text, no characters. Smooth continuous motion. The centre stays relatively dark and uncluttered so a subject can be overlaid on top.";

console.log("submitting Veo generation…");
const sub = await fetch(`${BASE}/models/${MODEL}:predictLongRunning?key=${KEY}`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    instances: [{ prompt }],
    parameters: { aspectRatio: "9:16", sampleCount: 1 },
  }),
});
const subj = await sub.json();
console.log("submit:", sub.status, JSON.stringify(subj).slice(0, 300));
const opName = subj.name;
if (!opName) process.exit(1);

let video;
for (let i = 0; i < 40; i++) {
  await sleep(8000);
  const op = await (await fetch(`${BASE}/${opName}?key=${KEY}`)).json();
  process.stdout.write(op.done ? " done" : " …");
  if (op.done) {
    if (op.error) { console.log("\nERROR", JSON.stringify(op.error)); process.exit(1); }
    const s = op.response?.generateVideoResponse?.generatedSamples?.[0]?.video;
    video = s;
    console.log("\nvideo:", JSON.stringify(s).slice(0, 200));
    break;
  }
}
if (!video) { console.log("timeout / no video"); process.exit(1); }

// video may be a uri (needs key) or inline bytes
if (video.uri) {
  const dl = await fetch(video.uri.includes("key=") ? video.uri : `${video.uri}&key=${KEY}`);
  const buf = Buffer.from(await dl.arrayBuffer());
  writeFileSync("scripts/veo.mp4", buf);
  console.log("saved scripts/veo.mp4", buf.length, "bytes");
} else if (video.bytesBase64Encoded || video.videoBytes) {
  writeFileSync("scripts/veo.mp4", Buffer.from(video.bytesBase64Encoded || video.videoBytes, "base64"));
  console.log("saved scripts/veo.mp4 (inline)");
}
