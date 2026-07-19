"""Draw calibration overlay onto the template to verify config coords."""
from PIL import Image, ImageDraw
import json

TEMPLATE = r"C:\Users\wpop0\ranking-generator\public\themes\gold\template.png"
CONFIG = r"C:\Users\wpop0\ranking-generator\public\themes\gold\config.json"
OUT = r"C:\Users\wpop0\template_overlay_check.png"

with open(CONFIG, encoding="utf-8") as f:
    cfg = json.load(f)

img = Image.open(TEMPLATE).convert("RGBA")
overlay = Image.new("RGBA", img.size, (0,0,0,0))
draw = ImageDraw.Draw(overlay)

for row in cfg["rows"]:
    cx, cy = row["iconCenter"]
    r = row["iconRadius"]
    draw.ellipse([cx-r, cy-r, cx+r, cy+r], outline=(255, 60, 60, 220), width=3)
    nx, ny, nw, nh = row["nameArea"]
    draw.rectangle([nx, ny, nx+nw, ny+nh], outline=(80, 200, 255, 220), width=3)

out = Image.alpha_composite(img, overlay)
out.save(OUT)
print(f"saved: {OUT}")
print(f"size: {img.size}")
