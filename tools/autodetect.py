"""V11: avatar = X range where vertical extent h(x) stays HIGH (avatars are tall, text is short)."""
from PIL import Image, ImageDraw

NON_WHITE_THRESHOLD = 252
HEADER_SKIP_FRAC = 0.02   # cropped screenshots typically have no header
FOOTER_SKIP_FRAC = 0.02
ROW_MIN = 4
MERGE_GAP_FRAC = 0.010
ROW_MIN_HEIGHT_FRAC = 0.025
EXT_GAP_FRAC = 0.012
MIN_AVATAR_W_FRAC = 0.06
MAX_AVATAR_W_FRAC = 0.30
SEARCH_X_MAX_FRAC = 0.50
HEIGHT_FRAC_THRESHOLD = 0.50  # more permissive
SMALL_IMAGE_THRESHOLD = 600   # if W < this, treat as small image with header
SMALL_IMAGE_HEADER_SKIP_FRAC = 0.18


def median(xs):
    s = sorted(xs); return s[len(s)//2]


def detect(path):
    img = Image.open(path).convert("RGB")
    W, H = img.size
    px = img.load()
    label = path.split("\\")[-1].replace(".png.jpg", "")
    print(f"\n=== {label}: {W}x{H}")

    header_frac = SMALL_IMAGE_HEADER_SKIP_FRAC if W < SMALL_IMAGE_THRESHOLD else HEADER_SKIP_FRAC
    y_start = int(H * header_frac)
    y_end = int(H * (1 - FOOTER_SKIP_FRAC))
    merge_gap = max(3, int(H * MERGE_GAP_FRAC))
    min_rh = max(15, int(H * ROW_MIN_HEIGHT_FRAC))
    ext_gap = max(5, int(W * EXT_GAP_FRAC))
    min_aw = int(W * MIN_AVATAR_W_FRAC)
    max_aw = int(W * MAX_AVATAR_W_FRAC)
    search_x_max = int(W * SEARCH_X_MAX_FRAC)

    def is_nw(x, y):
        if x < 0 or x >= W or y < 0 or y >= H: return False
        r, g, b = px[x, y]
        return r < NON_WHITE_THRESHOLD or g < NON_WHITE_THRESHOLD or b < NON_WHITE_THRESHOLD

    # Row bands
    counts = [0]*H
    row_x_max = W // 2
    for y in range(y_start, y_end):
        c = 0
        for x in range(0, row_x_max):
            if is_nw(x, y): c += 1
        counts[y] = c

    raw = []
    in_b = False; s = 0
    for y in range(y_start, y_end):
        if counts[y] >= ROW_MIN:
            if not in_b: in_b = True; s = y
        else:
            if in_b: in_b = False; raw.append([s, y-1])
    if in_b: raw.append([s, y_end-1])
    merged = []
    for b in raw:
        if merged and b[0] - merged[-1][1] <= merge_gap:
            merged[-1][1] = b[1]
        else:
            merged.append(b[:])
    row_bands = [(b[0], b[1]) for b in merged if b[1]-b[0] >= min_rh]
    print(f"row bands: {len(row_bands)}, params: aw=[{min_aw},{max_aw}], search_x_max={search_x_max}")

    def vert_extent(x, near_y, gap=ext_gap):
        yt = near_y; ws = 0
        for y in range(near_y-1, y_start-1, -1):
            if is_nw(x, y): yt = y; ws = 0
            else:
                ws += 1
                if ws > gap: break
        yb = near_y; ws = 0
        for y in range(near_y+1, y_end):
            if is_nw(x, y): yb = y; ws = 0
            else:
                ws += 1
                if ws > gap: break
        return yt, yb

    avatars = []
    for y0, y1 in row_bands:
        peak_y = y0; pv = counts[y0]
        for y in range(y0, y1+1):
            if counts[y] > pv: pv = counts[y]; peak_y = y

        # Compute h(x) for x in search range
        h_at = [0] * W
        for x in range(0, search_x_max):
            if not is_nw(x, peak_y):
                h_at[x] = 0
                continue
            yt, yb = vert_extent(x, peak_y)
            h_at[x] = yb - yt

        # Find peak h in search range
        max_h = max(h_at[:search_x_max])
        if max_h < min_rh:
            print(f"  band {y0}..{y1}: peak h={max_h} too small, skip")
            continue
        threshold = max(20, int(max_h * HEIGHT_FRAC_THRESHOLD))

        # Find longest contiguous X range where h(x) >= threshold
        best_start = -1; best_end = -1
        cur_start = -1
        for x in range(0, search_x_max):
            if h_at[x] >= threshold:
                if cur_start == -1: cur_start = x
                cur_end = x
            else:
                if cur_start != -1:
                    if cur_end - cur_start > best_end - best_start:
                        best_start = cur_start; best_end = cur_end
                    cur_start = -1
        if cur_start != -1 and cur_end - cur_start > best_end - best_start:
            best_start = cur_start; best_end = cur_end

        if best_start == -1:
            print(f"  band {y0}..{y1}: no high-h X range")
            continue

        w = best_end - best_start + 1
        cx = (best_start + best_end) // 2
        if w < min_aw or w > max_aw:
            print(f"  band {y0}..{y1}: w={w} OOR, skip")
            continue

        # cy from vert extent at cx
        yt, yb = vert_extent(cx, peak_y)
        cy = (yt + yb) // 2
        h = yb - yt
        d = max(w, h)
        avatars.append({"cx": cx, "cy": cy, "d": d, "w": w, "h": h, "max_h": max_h})
        print(f"  band {y0}..{y1}: cx={cx} cy={cy} d={d} (w={w}, h={h}, max_h={max_h})")

    if not avatars:
        print("  NO AVATARS DETECTED")
        return

    cxs = [a["cx"] for a in avatars]
    ds = [a["d"] for a in avatars]
    canon_cx = median(cxs)
    canon_r = median(ds) // 2 + 2
    print(f"canonical: cx={canon_cx} r={canon_r}, detected {len(avatars)}")

    out = img.copy()
    draw = ImageDraw.Draw(out)
    line_w = max(2, W // 200)
    for i, a in enumerate(avatars):
        r = a["d"] // 2 + 2
        draw.ellipse([a["cx"]-r, a["cy"]-r, a["cx"]+r, a["cy"]+r],
                     outline=(255, 200, 0), width=line_w)
        draw.ellipse([canon_cx-canon_r, a["cy"]-canon_r, canon_cx+canon_r, a["cy"]+canon_r],
                     outline=(255, 0, 0), width=line_w*2)
        draw.text((canon_cx+canon_r+10, a["cy"]-15), f"#{i+1}", fill=(255, 0, 0))
    out_path = path.replace(".png.jpg", "_v11.png").replace(".jpg", "_v11.png")
    out.save(out_path)


import os
TESTS = sorted(p for p in [
    f"C:\\Users\\wpop0\\ranking-generator\\tt{i}.png.jpg" for i in range(1, 6)
] if os.path.exists(p))
if not TESTS:
    print("No tt files found. Save them to ranking-generator folder.")
for p in TESTS:
    detect(p)
