/**
 * Client-side: turn a square avatar crop into the circular gold-ringed PNG the
 * Shotstack reel expects (the same format we prototyped as static assets). The
 * ring is baked in so it stays aligned over any background.
 */
function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("avatar image load failed"));
    img.src = src;
  });
}

export async function makeCircularAvatar(
  srcDataUrl: string,
  size = 800,
): Promise<Blob> {
  const img = await loadImg(srcDataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");

  const ringW = Math.round(size * 0.028);
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - ringW; // leave room for the ring

  // cover-fit the crop inside the circle
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  const aspect = img.width / img.height;
  let dw: number;
  let dh: number;
  if (aspect >= 1) {
    dh = r * 2;
    dw = dh * aspect;
  } else {
    dw = r * 2;
    dh = dw / aspect;
  }
  ctx.drawImage(img, cx - dw / 2, cy - dh / 2, dw, dh);
  ctx.restore();

  // gold ring
  const grad = ctx.createLinearGradient(0, cy - r, 0, cy + r);
  grad.addColorStop(0, "#FFF1B8");
  grad.addColorStop(0.5, "#FFD24D");
  grad.addColorStop(1, "#C8860B");
  ctx.lineWidth = ringW;
  ctx.strokeStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
      "image/png",
    );
  });
}
