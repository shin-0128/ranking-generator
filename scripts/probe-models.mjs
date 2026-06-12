/**
 * Probe each candidate Gemini model's bounding-box coordinate convention.
 *
 * Different models normalize boxes differently: an "aspect-correct" model
 * returns w/h ≈ image aspect (so a square avatar in a 2.16:1 portrait reads
 * ~2.16), while a "square-grid" model returns w/h ≈ 1.0 (and its boxes then
 * map to the wrong pixels, drifting the crop). We only want aspect-correct
 * models in the fallback chain.
 *
 * Usage: node scripts/probe-models.mjs
 */
import { readFileSync } from "node:fs";
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";

const KEY = readFileSync(".env.local", "utf8").match(/^GOOGLE_API_KEY=(.*)$/m)[1].trim();
const IMG = "test-shots/1.jpg";

const SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    entries: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          rank: { type: SchemaType.INTEGER },
          name: { type: SchemaType.STRING },
          ymin: { type: SchemaType.INTEGER },
          xmin: { type: SchemaType.INTEGER },
          ymax: { type: SchemaType.INTEGER },
          xmax: { type: SchemaType.INTEGER },
        },
        required: ["rank", "name", "ymin", "xmin", "ymax", "xmax"],
      },
    },
  },
  required: ["entries"],
};
const SYS = `Return one record per ranked user row: rank, name, and a tight bounding box around the circular avatar as normalized integers [0,1000] (ymin,xmin,ymax,xmax). Top-to-bottom.`;

const MODELS = [
  "gemini-3.5-flash",
  "gemini-2.5-flash",
  "gemini-3-flash-preview",
  "gemini-3.1-flash-lite",
  "gemini-2.5-flash-lite",
  "gemini-flash-latest",
  "gemini-flash-lite-latest",
];

const IMG_ASPECT = 2.16; // 870x1882

async function run() {
  const buf = readFileSync(IMG);
  const b64 = buf.toString("base64");
  const client = new GoogleGenerativeAI(KEY);
  for (const name of MODELS) {
    try {
      const model = client.getGenerativeModel(
        {
          model: name,
          systemInstruction: SYS,
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: SCHEMA,
            temperature: 0,
          },
        },
        { timeout: 40000 },
      );
      const res = await model.generateContent([
        { inlineData: { mimeType: "image/jpeg", data: b64 } },
        "Extract every ranked user row.",
      ]);
      const d = JSON.parse(res.response.text());
      const es = (d.entries ?? []).slice(0, 6);
      if (!es.length) {
        console.log(`${name.padEnd(26)} no entries`);
        continue;
      }
      const ratios = es.map((e) => (e.xmax - e.xmin) / Math.max(1, e.ymax - e.ymin));
      const med = [...ratios].sort((a, b) => a - b)[Math.floor(ratios.length / 2)];
      // aspect-correct if ratio ≈ image aspect; square-grid if ≈ 1
      const verdict =
        med > IMG_ASPECT * 0.7 ? "ASPECT-CORRECT ✓" : med < 1.4 ? "SQUARE-GRID ✗ (drifts)" : "??";
      console.log(
        `${name.padEnd(26)} rows=${es.length} w/h=${med.toFixed(2)} (img=${IMG_ASPECT}) → ${verdict}`,
      );
    } catch (e) {
      console.log(`${name.padEnd(26)} ERR ${String(e.message).slice(0, 50)}`);
    }
  }
}
run();
