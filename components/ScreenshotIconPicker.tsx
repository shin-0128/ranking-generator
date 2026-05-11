"use client";
import { useEffect, useRef, useState } from "react";
import type { EntrySource } from "@/lib/extractor/types";

interface Marker {
  x: number;
  y: number;
  r: number;
  label: string;
}

interface Props {
  source: EntrySource;
  cropRadius: number;
  markers?: Marker[];
  activeLabel?: string;
  hint?: string;
  onPick: (
    cropDataUrl: string,
    pickPos: { x: number; y: number },
    radius: number,
  ) => void;
  onMarkerTap?: (label: string) => void;
}

const MIN_DRAG = 8; // px in source coords; below this treated as click

export function ScreenshotIconPicker({
  source,
  cropRadius,
  markers,
  activeLabel,
  hint,
  onPick,
  onMarkerTap,
}: Props) {
  const imgRef = useRef<HTMLImageElement>(null);
  const sourceImgRef = useRef<HTMLImageElement | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [drag, setDrag] = useState<{
    start: { x: number; y: number };
    current: { x: number; y: number };
  } | null>(null);
  const [renderedSize, setRenderedSize] = useState<{
    w: number;
    h: number;
  } | null>(null);

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      sourceImgRef.current = img;
    };
    img.src = source.screenshotUrl;
    sourceImgRef.current = null;
  }, [source.screenshotUrl]);

  useEffect(() => {
    const update = () => {
      const el = imgRef.current;
      if (!el) return;
      setRenderedSize({ w: el.clientWidth, h: el.clientHeight });
    };
    update();
    const ro = new ResizeObserver(update);
    if (imgRef.current) ro.observe(imgRef.current);
    return () => ro.disconnect();
  }, []);

  const toSourceCoords = (
    e: React.MouseEvent | React.TouchEvent,
  ): { x: number; y: number } | null => {
    const el = imgRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const point =
      "touches" in e
        ? e.changedTouches[0] ?? e.touches[0]
        : (e as React.MouseEvent);
    if (!point) return null;
    const px = point.clientX - rect.left;
    const py = point.clientY - rect.top;
    if (px < 0 || py < 0 || px > rect.width || py > rect.height) return null;
    const x = (px / rect.width) * source.width;
    const y = (py / rect.height) * source.height;
    return { x, y };
  };

  const cropAt = (sx: number, sy: number, r: number): string | null => {
    const img = sourceImgRef.current;
    if (!img) return null;
    const cx = Math.max(r, Math.min(source.width - r, Math.round(sx)));
    const cy = Math.max(r, Math.min(source.height - r, Math.round(sy)));
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = r * 2;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, cx - r, cy - r, r * 2, r * 2, 0, 0, r * 2, r * 2);
    return canvas.toDataURL("image/png");
  };

  const handleStart = (e: React.MouseEvent | React.TouchEvent) => {
    const pos = toSourceCoords(e);
    if (!pos) return;
    setDrag({ start: pos, current: pos });
  };

  const handleMove = (e: React.MouseEvent | React.TouchEvent) => {
    const el = imgRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const point =
      "touches" in e
        ? e.touches[0] ?? e.changedTouches[0]
        : (e as React.MouseEvent);
    if (!point) return;
    const hx = point.clientX - rect.left;
    const hy = point.clientY - rect.top;
    setHover({ x: hx, y: hy });

    if (drag) {
      const pos = toSourceCoords(e);
      if (pos) setDrag({ ...drag, current: pos });
    }
  };

  const handleEnd = (e: React.MouseEvent | React.TouchEvent) => {
    if (!drag) return;
    const isTouch = "touches" in e;
    const dx = drag.current.x - drag.start.x;
    const dy = drag.current.y - drag.start.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // On touch devices, large movement means the user was scrolling — not picking.
    // Only fire a pick if movement is small (tap).
    const SCROLL_THRESHOLD_SRC = 40;
    if (isTouch && dist > SCROLL_THRESHOLD_SRC) {
      setDrag(null);
      return;
    }

    // Drag-to-define-radius is mouse-only (touch can't disambiguate from scroll)
    const useDrag = !isTouch && dist >= MIN_DRAG;

    // If this was a tap (not drag) on a non-active marker, switch instead of crop
    if (!useDrag && onMarkerTap && markers) {
      const hit = markers.find((m) => {
        const ddx = drag.start.x - m.x;
        const ddy = drag.start.y - m.y;
        return Math.sqrt(ddx * ddx + ddy * ddy) <= m.r;
      });
      if (hit && hit.label !== activeLabel) {
        setDrag(null);
        if ("touches" in e) e.preventDefault();
        onMarkerTap(hit.label);
        return;
      }
    }

    // Snap-to-nearest: if user just tapped (not dragged), find the closest
    // detected avatar within snap range and use its precise center+radius.
    let pickX = drag.start.x;
    let pickY = drag.start.y;
    let pickR = useDrag ? Math.max(15, Math.round(dist)) : cropRadius;
    if (!useDrag && source.detected && source.detected.length > 0) {
      const snapRange = Math.max(40, cropRadius * 1.5);
      let best: { cx: number; cy: number; r: number } | null = null;
      let bestDist = Infinity;
      for (const d of source.detected) {
        const ddx = drag.start.x - d.cx;
        const ddy = drag.start.y - d.cy;
        const dd = Math.sqrt(ddx * ddx + ddy * ddy);
        if (dd < bestDist && dd <= snapRange) {
          bestDist = dd;
          best = d;
        }
      }
      if (best) {
        pickX = best.cx;
        pickY = best.cy;
        pickR = best.r;
      }
    }
    const data = cropAt(pickX, pickY, pickR);
    setDrag(null);
    if (data) onPick(data, { x: pickX, y: pickY }, pickR);
  };

  const renderScale =
    renderedSize && source.width > 0 ? renderedSize.w / source.width : 1;
  const hoverR = cropRadius * renderScale;
  const dragR = drag
    ? Math.sqrt(
        (drag.current.x - drag.start.x) ** 2 +
          (drag.current.y - drag.start.y) ** 2,
      ) * renderScale
    : 0;

  return (
    <div className="space-y-2">
      {hint && <p className="text-sm text-amber-400 font-medium">{hint}</p>}
      <p className="text-xs text-zinc-500">
        スマホ: アイコンをタップで固定半径クロップ。スクロールはスクショ上でも縦スワイプOK。
        PC: クリックでクロップ、ドラッグでサイズも同時指定。
      </p>
      <div className="relative w-full select-none">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imgRef}
          src={source.screenshotUrl}
          alt="screenshot"
          draggable={false}
          onMouseDown={handleStart}
          onMouseMove={handleMove}
          onMouseUp={handleEnd}
          onMouseLeave={() => {
            setHover(null);
            setDrag(null);
          }}
          onTouchStart={handleStart}
          onTouchMove={handleMove}
          onTouchEnd={handleEnd}
          className="block w-full h-auto rounded border border-zinc-700 cursor-crosshair"
        />
        {/* Existing pick markers (each at its own radius) */}
        {markers?.map((m, i) => {
          const left = m.x * renderScale;
          const top = m.y * renderScale;
          const visualR = m.r * renderScale;
          const isActive = m.label === activeLabel;
          return (
            <div
              key={i}
              className="absolute pointer-events-none flex items-center justify-center"
              style={{
                left: left - visualR,
                top: top - visualR,
                width: visualR * 2,
                height: visualR * 2,
              }}
            >
              <div
                className={`absolute inset-0 rounded-full ${
                  isActive
                    ? "border-[3px] border-amber-300 bg-amber-300/20 ring-2 ring-amber-300/40"
                    : "border-2 border-amber-400/70 bg-amber-400/5"
                }`}
              />
              <span
                className={`relative text-xs font-bold rounded-full px-1.5 py-0.5 shadow ${
                  isActive
                    ? "bg-amber-300 text-zinc-900"
                    : "bg-amber-500/80 text-zinc-900"
                }`}
              >
                {m.label}
              </span>
            </div>
          );
        })}
        {/* Drag preview circle */}
        {drag && (
          <div
            className="absolute pointer-events-none border-2 border-cyan-300 rounded-full bg-cyan-300/10"
            style={{
              left: drag.start.x * renderScale - dragR,
              top: drag.start.y * renderScale - dragR,
              width: dragR * 2,
              height: dragR * 2,
            }}
          />
        )}
        {/* Hover preview (only when not dragging) */}
        {!drag && hover && (
          <div
            className="absolute pointer-events-none border-2 border-cyan-400 rounded-full"
            style={{
              left: hover.x - hoverR,
              top: hover.y - hoverR,
              width: hoverR * 2,
              height: hoverR * 2,
            }}
          />
        )}
      </div>
    </div>
  );
}
