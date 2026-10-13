"""Makes the app icons for Corporate Tic Tac Toe (run once: python tools/make-icons.py).
A teal square with a white bingo ball: a yellow ring, the letter B, a small card grid under it."""
import os
from PIL import Image, ImageDraw, ImageFont

OUT = os.path.join(os.path.dirname(__file__), "..", "apps", "web", "public")
TEAL, TEAL_D, YELLOW, WHITE = "#0B5D5B", "#063B3A", "#FFC93C", "#FFFFFF"

def font(size):
    for f in ("C:/Windows/Fonts/arialbd.ttf", "C:/Windows/Fonts/segoeuib.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"):
        if os.path.exists(f):
            return ImageFont.truetype(f, size)
    return ImageFont.load_default()

def mk(size, pad):
    im = Image.new("RGB", (size, size), TEAL)
    d = ImageDraw.Draw(im)
    s = size * (1 - 2 * pad)          # the safe area
    c = size / 2
    r = s * 0.46                      # the ball
    d.ellipse([c - r, c - r, c + r, c + r], fill=YELLOW)
    r2 = r * 0.84
    d.ellipse([c - r2, c - r2, c + r2, c + r2], fill=WHITE)
    f = font(int(r * 1.25))
    d.text((c, c - r * 0.24), "B", font=f, fill=TEAL, anchor="mm")
    # a tiny 5 x 5 card under the letter
    g = r * 0.5; cell = g / 5; x0 = c - g / 2; y0 = c + r * 0.26
    for i in range(5):
        for j in range(5):
            on = (i + j) % 2 == 0 or (i == 2 and j == 2)
            d.rectangle([x0 + j * cell + 1, y0 + i * cell * 0.62 + 1, x0 + (j + 1) * cell - 1, y0 + (i + 1) * cell * 0.62 - 1], fill=TEAL_D if on else "#CFEDEA")
    return im

for name, size, pad in [("icon-192.png", 192, 0.08), ("icon-512.png", 512, 0.08), ("icon-maskable-512.png", 512, 0.20), ("apple-touch-icon.png", 180, 0.08)]:
    mk(size, pad).save(os.path.join(OUT, name), optimize=True)
    print("wrote", name)
