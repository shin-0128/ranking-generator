/**
 * Detection test harness.
 *
 * Posts every image in test-shots/ to the running dev server's
 * /api/parse-screenshot and reports the GEOMETRY of Gemini's avatar boxes, so
 * we can verify (with numbers, not eyeballing one image) the structural
 * assumptions the pipeline relies on:
 *   - cx spread   → are all avatars really in one column? (medCx safe?)
 *   - size spread → are all avatars really one size? (medR safe?)
 *   - Y spacing   → is the row pitch even? (linear Y-grid fit safe?)
 *
 * Usage:  node scripts/test-detection.mjs
 * Requires: pnpm dev running on :3000, and test-shots/ populated.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, extname } from "node:path";

const DIR = "test-shots";
const BASE = "http://localhost:3000";

function getPassword() {
  try {
    const env = readFileSync(".env.local", "utf8");
    const m = env.match(/^APP_PASSWORD=(.*)$/m);
    return m ? m[1].trim() : "";
  } catch {
    return "";
  }
}

function mimeOf(file) {
  const e = extname(file).toLowerCase();
  if (e === ".jpg" || e === ".jpeg") return "image/jpeg";
  if (e === ".webp") return "image/webp";
  return "image/png";
}

const median = (xs) =>
  xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : 0;
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** Least-squares fit cy = a + b*index; return {residual, slope}. */
function lineFit(cys) {
  const n = cys.length;
  if (n < 3) return { residual: 0, slope: 0 };
  const xs = cys.map((_, i) => i);
  const mx = mean(xs);
  const my = mean(cys);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (cys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  const b = den ? num / den : 0;
  const a = my - b * mx;
  return {
    residual: Math.max(...cys.map((cy, i) => Math.abs(cy - (a + b * i)))),
    slope: b, // = row pitch in normalized units
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run() {
  const pw = getPassword();
  const cookie = `auth=${pw}`;
  let files;
  try {
    files = readdirSync(DIR).filter((f) =>
      [".png", ".jpg", ".jpeg", ".webp"].includes(extname(f).toLowerCase()),
    );
  } catch {
    console.error(`Cannot read ${DIR}/ — create it and drop screenshots in.`);
    process.exit(1);
  }
  if (files.length === 0) {
    console.error(`No images in ${DIR}/.`);
    process.exit(1);
  }
  files.sort();
  console.log(`Testing ${files.length} screenshots against ${BASE}\n`);

  let totalRows = 0;
  const allCxSpread = [];
  const allSizeSpread = [];
  const allYResidual = [];
  const allRatios = []; // medSize / rowPitch — the layout-invariant we hope is stable

  for (const f of files) {
    const buf = readFileSync(join(DIR, f));
    let data;
    let lastStatus = 0;
    // Retry transient 503s in the harness too, with spacing, so overload
    // doesn't masquerade as a detection failure.
    for (let attempt = 1; attempt <= 4; attempt++) {
      const fd = new FormData();
      fd.append("file", new Blob([buf], { type: mimeOf(f) }), f);
      try {
        const res = await fetch(`${BASE}/api/parse-screenshot`, {
          method: "POST",
          body: fd,
          headers: { Cookie: cookie },
        });
        lastStatus = res.status;
        if (res.ok) {
          data = await res.json();
          break;
        }
        if (res.status !== 503) break;
      } catch (e) {
        lastStatus = -1;
        console.log(`${f.padEnd(28)} ERROR ${e.message}`);
        break;
      }
      await sleep(2500 * attempt);
    }
    if (!data) {
      console.log(`${f.padEnd(28)} HTTP ${lastStatus} (after retries)`);
      await sleep(1500);
      continue;
    }
    const entries = (data.entries ?? []).slice().sort((a, b) => a.ymin - b.ymin);
    if (entries.length === 0) {
      console.log(`${f.padEnd(28)} 0 entries`);
      continue;
    }
    const cxs = entries.map((e) => (e.xmin + e.xmax) / 2);
    const sizes = entries.map((e) =>
      Math.max(e.xmax - e.xmin, e.ymax - e.ymin),
    );
    const cys = entries.map((e) => (e.ymin + e.ymax) / 2);
    const medCx = median(cxs);
    const medSize = median(sizes);
    const cxSpread = Math.max(...cxs) - Math.min(...cxs);
    const sizeSpread = Math.max(...sizes) - Math.min(...sizes);
    const { residual: yRes, slope: pitch } = lineFit(cys);
    const ratio = pitch > 0 ? medSize / pitch : 0;
    const ranks = entries.map((e) => e.rank);

    totalRows += entries.length;
    allCxSpread.push(cxSpread);
    allSizeSpread.push(sizeSpread);
    allYResidual.push(yRes);
    if (ratio > 0) allRatios.push(ratio);

    console.log(
      `${f.padEnd(10)} ${(data._model ?? "?").replace("gemini-", "").padEnd(16)} ` +
        `rows=${String(entries.length).padStart(2)} ` +
        `ranks=${String(ranks[0]).padStart(3)}-${String(ranks[ranks.length - 1]).padStart(3)} ` +
        `medCx=${medCx.toFixed(0).padStart(3)} ` +
        `medSize=${medSize.toFixed(0).padStart(3)} ` +
        `pitch=${pitch.toFixed(0).padStart(3)} ` +
        `size/pitch=${ratio.toFixed(2)} ` +
        `Yresid=${yRes.toFixed(1)}`,
    );
  }

  const rMin = allRatios.length ? Math.min(...allRatios) : 0;
  const rMax = allRatios.length ? Math.max(...allRatios) : 0;
  console.log(
    `\n== Aggregate over ${files.length} shots, ${totalRows} rows ==\n` +
      `cx spread:    median ${median(allCxSpread).toFixed(1)}  worst ${Math.max(...allCxSpread).toFixed(1)}  (lower = column consistent → medCx safe)\n` +
      `size spread:  median ${median(allSizeSpread).toFixed(1)}  worst ${Math.max(...allSizeSpread).toFixed(1)}  (lower = one size → medR safe)\n` +
      `Y residual:   median ${median(allYResidual).toFixed(1)}  worst ${Math.max(...allYResidual).toFixed(1)}  (lower = even pitch → Y-grid fit safe)\n` +
      `size/pitch:   median ${median(allRatios).toFixed(2)}  range ${rMin.toFixed(2)}–${rMax.toFixed(2)}  (TIGHT range = derive radius from pitch, ignore Gemini's noisy size)\n` +
      `All numbers are normalized /1000 of image dimension.`,
  );
}

run();
