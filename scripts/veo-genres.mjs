import { readFileSync, writeFileSync } from "node:fs";
const KEY = readFileSync(".env.local", "utf8").match(/^GOOGLE_API_KEY=(.*)$/m)[1].trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MODEL = "veo-3.0-fast-generate-001";
const BASE = "https://generativelanguage.googleapis.com/v1beta";

const SHARED =
  "Vertical 9:16 abstract cinematic looping background. No people, no text, no characters, no logos. Smooth continuous motion. The centre stays relatively dark and uncluttered so a subject can be overlaid on top.";

const GENRES = {
  gold: "Luxurious deep dark backdrop. Golden glowing particles and sparkles slowly rising, soft warm golden light rays from above, elegant bokeh, premium award-show atmosphere. " + SHARED,
  neon: "Futuristic dark cyber backdrop. Glowing cyan and electric blue particles drifting, subtle neon grid lines, soft light streaks, electric energy, sci-fi atmosphere. " + SHARED,
  pink: "Dreamy dark romantic backdrop. Soft pink and magenta glowing bokeh particles floating gently, warm rose light glow, delicate sparkles, kawaii idol-stage atmosphere. " + SHARED,
};

async function gen(id, prompt) {
  console.log(`[${id}] submit`);
  const sub = await (await fetch(`${BASE}/models/${MODEL}:predictLongRunning?key=${KEY}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ instances: [{ prompt }], parameters: { aspectRatio: "9:16", sampleCount: 1 } }),
  })).json();
  const op = sub.name;
  if (!op) { console.log(`[${id}] submit fail`, JSON.stringify(sub).slice(0, 200)); return; }
  for (let i = 0; i < 45; i++) {
    await sleep(8000);
    const o = await (await fetch(`${BASE}/${op}?key=${KEY}`)).json();
    if (o.done) {
      if (o.error) { console.log(`[${id}] ERR`, JSON.stringify(o.error)); return; }
      const v = o.response?.generateVideoResponse?.generatedSamples?.[0]?.video;
      const dl = await fetch(v.uri.includes("key=") ? v.uri : `${v.uri}&key=${KEY}`);
      const buf = Buffer.from(await dl.arrayBuffer());
      writeFileSync(`scripts/veo-${id}.mp4`, buf);
      console.log(`[${id}] saved ${buf.length}B`);
      return;
    }
  }
  console.log(`[${id}] timeout`);
}

for (const [id, p] of Object.entries(GENRES)) await gen(id, p);
console.log("all done");
