/**
 * Visual regression contact sheet.
 *
 * For every screenshot in test-shots/, calls the detection API, runs the SAME
 * circle math the app uses (boxesToCircles), crops each avatar with sharp, and
 * tiles them into one PNG — so we can eyeball grounding quality across the whole
 * test set at once instead of uploading images one-by-one in the browser.
 *
 * Output: scripts/contact-sheet.png   (one row per screenshot, one cell per avatar)
 * Usage:  node scripts/contact-sheet.mjs   (needs dev server up + test-shots/ populated)
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, extname } from "node:path";
import sharp from "sharp";

const DIR = "test-shots";
const BASE = "http://localhost:3000";
const CELL = 110; // thumbnail px
const PAD_FACTOR = 0.18; // must match CROP_PADDING in lib/parser.ts
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function getPassword() {
  try {
    const m = readFileSync(".env.local", "utf8").match(/^APP_PASSWORD=(.*)$/m);
    return m ? m[1].trim() : "";
  } catch {
    return "";
  }
}
const mimeOf = (f) =>
  /\.jpe?g$/i.test(f) ? "image/jpeg" : /\.webp$/i.test(f) ? "image/webp" : "image/png";
const median = (xs) =>
  xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : 0;

function theilSen(ys) {
  const n = ys.length;
  if (n < 2) return { slope: 0, intercept: ys[0] ?? 0 };
  const slopes = [];
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) slopes.push((ys[j] - ys[i]) / (j - i));
  const slope = median(slopes);
  const intercept = median(ys.map((y, i) => y - slope * i));
  return { slope, intercept };
}

// Mirror of lib/extractor/avatar-detect.ts boxesToCircles (boxes in pixels).
function boxesToCircles(boxes) {
  const n = boxes.length;
  if (n === 0) return [];
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
    const actualCy = cys[i];
    const fittedCy = intercept + slope * i;
    const cy = pitch > 0 && Math.abs(actualCy - fittedCy) > snap ? fittedCy : actualCy;
    return { cx: medCx, cy, r };
  });
}

async function detect(buf, f, cookie) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const fd = new FormData();
    fd.append("file", new Blob([buf], { type: mimeOf(f) }), f);
    const res = await fetch(`${BASE}/api/parse-screenshot`, {
      method: "POST",
      body: fd,
      headers: { Cookie: cookie },
    });
    if (res.ok) return res.json();
    if (res.status !== 503) return null;
    await sleep(2500 * attempt);
  }
  return null;
}

async function run() {
  const cookie = `auth=${getPassword()}`;
  const files = readdirSync(DIR)
    .filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
    .sort((a, b) => parseInt(a) - parseInt(b) || a.localeCompare(b));
  if (!files.length) return console.error("no images in test-shots/");

  const rows = [];
  let maxCols = 0;
  for (const f of files) {
    const buf = readFileSync(join(DIR, f));
    const meta = await sharp(buf).metadata();
    const FW = meta.width;
    const FH = meta.height;
    const data = await detect(buf, f, cookie);
    if (!data?.entries?.length) {
      console.log(`${f}: no entries (${data?._model ?? "fail"})`);
      rows.push({ f, model: data?._model ?? "FAIL", cells: [] });
      continue;
    }
    const entries = data.entries.slice().sort((a, b) => a.ymin - b.ymin);
    const boxes = entries.map((e) => ({
      x0: (e.xmin / 1000) * FW,
      y0: (e.ymin / 1000) * FH,
      x1: (e.xmax / 1000) * FW,
      y1: (e.ymax / 1000) * FH,
    }));
    const circles = boxesToCircles(boxes);
    const cells = [];
    for (const c of circles) {
      const r = Math.round(c.r * (1 + PAD_FACTOR));
      const left = Math.round(c.cx - r);
      const top = Math.round(c.cy - r);
      const size = r * 2;
      // clamp extract to image bounds
      const L = Math.max(0, left);
      const T = Math.max(0, top);
      const W = Math.min(size, FW - L);
      const H = Math.min(size, FH - T);
      if (W < 4 || H < 4) continue;
      try {
        const thumb = await sharp(buf)
          .extract({ left: L, top: T, width: W, height: H })
          .resize(CELL, CELL, { fit: "cover" })
          .png()
          .toBuffer();
        cells.push(thumb);
      } catch {
        /* skip bad crop */
      }
    }
    maxCols = Math.max(maxCols, cells.length);
    rows.push({ f, model: data._model ?? "?", cells });
    console.log(`${f}: ${cells.length} avatars (${data._model})`);
  }

  // Compose sheet: each row = one screenshot's avatars.
  const W = Math.max(1, maxCols) * CELL;
  const H = rows.length * CELL;
  const composites = [];
  rows.forEach((row, ri) => {
    row.cells.forEach((cell, ci) => {
      composites.push({ input: cell, left: ci * CELL, top: ri * CELL });
    });
  });
  await sharp({
    create: { width: W, height: H, channels: 3, background: { r: 20, g: 20, b: 24 } },
  })
    .composite(composites)
    .png()
    .toFile("scripts/contact-sheet.png");
  console.log(`\nWrote scripts/contact-sheet.png (${W}x${H}, ${rows.length} rows)`);
}

run();
