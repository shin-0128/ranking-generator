"""Detect each gold ring's outer edge via Hough-like fit, derive inner edge,
update config.json with per-row iconRadius, and re-clean template fills."""
from PIL import Image, ImageDraw
import json
import math

SOURCE = r"C:\Users\wpop0\ranking-generator\public\themes\gold\template-with-samples.png"
CONFIG = r"C:\Users\wpop0\ranking-generator\public\themes\gold\config.json"
OUT_TEMPLATE = r"C:\Users\wpop0\ranking-generator\public\themes\gold\template.png"

with open(CONFIG, encoding="utf-8") as f:
    cfg = json.load(f)

img = Image.open(SOURCE).convert("RGB")
W, H = img.size
src_px = img.load()

def is_gold(r, g, b):
    return r > 170 and g > 130 and b < 110 and r >= g and g > b

def is_gold_at(x, y):
    if x < 0 or x >= W or y < 0 or y >= H:
        return False
    r, g, b = src_px[x, y]
    return is_gold(r, g, b)

# Brute-force ring outer-edge fit per row
def fit_outer_radius(cx, cy):
    best_score = -1
    best_r = 65
    for r in range(50, 85):
        hits = 0
        # sample 36 points on the circle perimeter, accept if any within 2px is gold
        for k in range(36):
            theta = 2 * math.pi * k / 36
            x = round(cx + r * math.cos(theta))
            y = round(cy + r * math.sin(theta))
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    if is_gold_at(x + dx, y + dy):
                        hits += 1
                        break
                else:
                    continue
                break
        if hits > best_score:
            best_score = hits
            best_r = r
    return best_r, best_score

# Determine outer radii
outers = []
for row in cfg["rows"]:
    cx, cy = row["iconCenter"]
    r, sc = fit_outer_radius(cx, cy)
    outers.append((row["rank"], cx, cy, r, sc))

# Use median as canonical for outliers
sorted_rs = sorted(o[3] for o in outers)
median_r = sorted_rs[len(sorted_rs) // 2]
print(f"Median outer radius: {median_r}")

RING_THICKNESS = 5
print("Per-row outer/inner:")
results = []
for rank, cx, cy, outer, score in outers:
    # If detected outer is much smaller than median, use median (likely false detection)
    if outer < median_r - 6:
        outer = median_r
        note = " (median fallback)"
    else:
        note = ""
    inner = outer - RING_THICKNESS
    results.append((rank, cx, cy, outer, inner))
    print(f"  rank {rank:2d}: cx={cx} cy={cy} outer={outer} inner={inner} score={score}{note}")

# Update config.json with per-row iconRadius
for row, (_, _, _, _, inner) in zip(cfg["rows"], results):
    row["iconRadius"] = inner
with open(CONFIG, "w", encoding="utf-8") as f:
    json.dump(cfg, f, ensure_ascii=False, indent=2)
print(f"\nupdated {CONFIG}")

# Rebuild template: per-row, fill white inside inner edge, restore ring
out = img.copy()
out_draw = ImageDraw.Draw(out)
out_px = out.load()
for rank, cx, cy, outer, inner in results:
    # 1. white fill INSIDE inner edge (also +1 to overlap any AA pixel)
    fill_r = inner + 1
    out_draw.ellipse(
        [cx - fill_r, cy - fill_r, cx + fill_r, cy + fill_r],
        fill=(255, 255, 255),
    )
    # 2. restore gold ring annulus from source
    r_in = inner - 1
    r_out = outer + 4
    for y in range(max(0, cy - r_out), min(H, cy + r_out + 1)):
        for x in range(max(0, cx - r_out), min(W, cx + r_out + 1)):
            dx = x - cx
            dy = y - cy
            d2 = dx * dx + dy * dy
            if d2 < r_in * r_in or d2 > r_out * r_out:
                continue
            r, g, b = src_px[x, y]
            if is_gold(r, g, b):
                out_px[x, y] = (r, g, b)

out.save(OUT_TEMPLATE)
print(f"saved -> {OUT_TEMPLATE}")
