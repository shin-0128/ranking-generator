/**
 * Padding tuner. Renders each avatar the way the composer actually shows it —
 * the padded square cover-fit into a CIRCLE on a dark background — so the
 * "does it fill the gold frame?" gap is visible (the square contact sheet hid
 * it). Detections are cached to scripts/detections.json so we can sweep padding
 * values WITHOUT re-calling Gemini.
 *
 * Usage:
 *   node scripts/tune-padding.mjs 0.18 0.05 0.0 -0.08   (compare these paddings)
 *   node scripts/tune-padding.mjs --refresh 0.05        (re-fetch detections)
 * Output: scripts/pad-<value>.png per padding.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

const DIR = "test-shots";
const CACHE = "scripts/detections.json";
const BASE = "http://localhost:3000";
const CELL = 130;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const getPw = () => {
  const m = readFileSync(".env.local", "utf8").match(/^APP_PASSWORD=(.*)$/m);
  return m ? m[1].trim() : "";
};
const mimeOf = (f) => (/\.jpe?g$/i.test(f) ? "image/jpeg" : "image/png");
const median = (xs) =>
  xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : 0;

function theilSen(ys) {
  const n = ys.length;
  if (n < 2) return { slope: 0, intercept: ys[0] ?? 0 };
  const s = [];
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) s.push((ys[j] - ys[i]) / (j - i));
  const slope = median(s);
  return { slope, intercept: median(ys.map((y, i) => y - slope * i)) };
}
function boxesToCircles(boxes) {
  if (!boxes.length) return [];
  const cxs = boxes.map((b) => (b.x0 + b.x1) / 2);
  const cys = boxes.map((b) => (b.y0 + b.y1) / 2);
  const rs = boxes.map((b) => Math.max(b.x1 - b.x0, b.y1 - b.y0) / 2);
  const medCx = median(cxs);
  const medR = median(rs);
  const { slope, intercept } = theilSen(cys);
  const pitch = Math.abs(slope);
  const r = pitch > 0 ? Math.min(medR, pitch * 0.5) : medR;
  const snap = pitch * 0.35;
  return boxes.map((b, i) => {
    const cy =
      pitch > 0 && Math.abs(cys[i] - (intercept + slope * i)) > snap
        ? intercept + slope * i
        : cys[i];
    return { cx: medCx, cy, r };
  });
}

async function fetchDetections() {
  const cookie = `auth=${getPw()}`;
  const files = readdirSync(DIR)
    .filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
    .sort((a, b) => parseInt(a) - parseInt(b) || a.localeCompare(b));
  const out = {};
  for (const f of files) {
    const buf = readFileSync(join(DIR, f));
    const { width: FW, height: FH } = await sharp(buf).metadata();
    let data = null;
    for (let a = 1; a <= 4 && !data; a++) {
      const fd = new FormData();
      fd.append("file", new Blob([buf], { type: mimeOf(f) }), f);
      const res = await fetch(`${BASE}/api/parse-screenshot`, {
        method: "POST",
        body: fd,
        headers: { Cookie: cookie },
      });
      if (res.ok) data = await res.json();
      else if (res.status === 503) await sleep(2500 * a);
      else break;
    }
    const entries = (data?.entries ?? []).slice().sort((a, b) => a.ymin - b.ymin);
    out[f] = {
      FW,
      FH,
      model: data?._model ?? "FAIL",
      boxes: entries.map((e) => ({
        x0: (e.xmin / 1000) * FW,
        y0: (e.ymin / 1000) * FH,
        x1: (e.xmax / 1000) * FW,
        y1: (e.ymax / 1000) * FH,
      })),
    };
    console.log(`${f}: ${entries.length} (${out[f].model})`);
  }
  writeFileSync(CACHE, JSON.stringify(out));
  return out;
}

const circleMask = Buffer.from(
  `<svg width="${CELL}" height="${CELL}"><circle cx="${CELL / 2}" cy="${CELL / 2}" r="${CELL / 2 - 2}" fill="#fff"/></svg>`,
);

async function renderSheet(dets, pad) {
  const files = Object.keys(dets);
  const rows = [];
  let maxCols = 0;
  for (const f of files) {
    const { FW, FH, boxes } = dets[f];
    const buf = readFileSync(join(DIR, f));
    const circles = boxesToCircles(boxes);
    const cells = [];
    for (const c of circles) {
      const r = Math.round(c.r * (1 + pad));
      const L = Math.max(0, Math.round(c.cx - r));
      const T = Math.max(0, Math.round(c.cy - r));
      const W = Math.min(r * 2, FW - L);
      const H = Math.min(r * 2, FH - T);
      if (W < 4 || H < 4) continue;
      const thumb = await sharp(buf)
        .extract({ left: L, top: T, width: W, height: H })
        .resize(CELL, CELL, { fit: "fill" })
        .composite([{ input: circleMask, blend: "dest-in" }])
        .png()
        .toBuffer();
      cells.push(thumb);
    }
    maxCols = Math.max(maxCols, cells.length);
    rows.push(cells);
  }
  const W = maxCols * CELL;
  const H = rows.length * CELL;
  const composites = [];
  rows.forEach((cells, ri) =>
    cells.forEach((cell, ci) =>
      composites.push({ input: cell, left: ci * CELL, top: ri * CELL }),
    ),
  );
  const name = `scripts/pad-${pad}.png`;
  await sharp({
    create: { width: W, height: H, channels: 3, background: { r: 12, g: 12, b: 14 } },
  })
    .composite(composites)
    .png()
    .toFile(name);
  console.log(`wrote ${name} (${W}x${H})`);
}

async function run() {
  const args = process.argv.slice(2);
  const refresh = args.includes("--refresh");
  const pads = args.filter((a) => a !== "--refresh").map(Number);
  if (!pads.length) pads.push(0.18, 0.05, 0.0, -0.08);
  const dets =
    !refresh && existsSync(CACHE)
      ? JSON.parse(readFileSync(CACHE, "utf8"))
      : await fetchDetections();
  for (const pad of pads) await renderSheet(dets, pad);
}
run();
