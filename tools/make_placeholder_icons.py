"""
make_placeholder_icons.py: writes the placeholder app icons into public/icons/ (synthetic artwork, safe to commit).
Davide will provide the final icons (ROADMAP M5).

  python3 tools/make_placeholder_icons.py
Requires: Python 3.9+, pillow.
"""
import os
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(__file__), "..", "public", "icons")
BG = (17, 17, 17, 255)
GOLD = (229, 181, 58, 255)
INK = (40, 33, 20, 255)
SKY = (74, 130, 196, 255)


def draw_icon(size, safe_scale=1.0):
    s = 1024
    im = Image.new("RGBA", (s, s), BG)
    d = ImageDraw.Draw(im)
    # a card, slightly rotated feel through an offset shadow
    cw, ch = 0.52 * s * safe_scale, 0.72 * s * safe_scale
    x0, y0 = (s - cw) / 2, (s - ch) / 2
    d.rounded_rectangle([x0 + 18, y0 + 22, x0 + cw + 18, y0 + ch + 22], radius=cw * 0.07, fill=(0, 0, 0, 255))
    d.rounded_rectangle([x0, y0, x0 + cw, y0 + ch], radius=cw * 0.07, fill=GOLD)
    m = cw * 0.08
    d.rectangle([x0 + m, y0 + ch * 0.13, x0 + cw - m, y0 + ch * 0.58], fill=SKY, outline=INK, width=int(cw * 0.012))
    for k in range(4):
        y = y0 + ch * (0.66 + k * 0.07)
        d.rounded_rectangle([x0 + m, y, x0 + cw - m - (k % 2) * cw * 0.2, y + ch * 0.025], radius=4, fill=INK)
    return im.resize((size, size), Image.LANCZOS)


os.makedirs(OUT, exist_ok=True)
draw_icon(192).save(os.path.join(OUT, "icon-192.png"))
draw_icon(512).save(os.path.join(OUT, "icon-512.png"))
draw_icon(512, safe_scale=0.8).save(os.path.join(OUT, "icon-maskable-512.png"))
draw_icon(180).convert("RGB").save(os.path.join(OUT, "apple-touch-icon.png"))  # iOS: opaque
print("icons written to", os.path.normpath(OUT))
