"""Makes the app icons for Corporate Tic Tac Toe (run once: python tools/make-icons.py).
A teal square with a white disk and a yellow ring; on the disk a tic tac toe board (two lines each way) with an X and an O and a row of three X."""
import os
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(__file__), "..", "apps", "web", "public")
TEAL, YELLOW, WHITE = "#0B5D5B", "#FFC93C", "#FFFFFF"
SCALE = 4  # drawn four times larger and scaled down, so the strokes are smooth

def mk(size, pad):
    n = size * SCALE
    im = Image.new("RGB", (n, n), TEAL)
    d = ImageDraw.Draw(im)
    s = n * (1 - 2 * pad)             # the safe area
    c = n / 2
    r = s * 0.46                      # the disk
    d.ellipse([c - r, c - r, c + r, c + r], fill=YELLOW)
    r2 = r * 0.84
    d.ellipse([c - r2, c - r2, c + r2, c + r2], fill=WHITE)
    g = r2 * 1.12                     # the board: a square inside the disk
    x0, y0 = c - g / 2, c - g / 2
    cell = g / 3
    w = max(2, int(g * 0.045))
    for k in (1, 2):                  # the four lines of the board
        d.line([x0 + k * cell, y0 + g * 0.02, x0 + k * cell, y0 + g * 0.98], fill=TEAL, width=w)
        d.line([x0 + g * 0.02, y0 + k * cell, x0 + g * 0.98, y0 + k * cell], fill=TEAL, width=w)
    def cell_c(i, j): return x0 + (j + 0.5) * cell, y0 + (i + 0.5) * cell
    def X(i, j):
        cx, cy = cell_c(i, j); a = cell * 0.26; ww = max(2, int(cell * 0.12))
        d.line([cx - a, cy - a, cx + a, cy + a], fill=TEAL, width=ww); d.line([cx - a, cy + a, cx + a, cy - a], fill=TEAL, width=ww)
    def O(i, j):
        cx, cy = cell_c(i, j); a = cell * 0.27; ww = max(2, int(cell * 0.12))
        d.ellipse([cx - a, cy - a, cx + a, cy + a], outline="#E0A300", width=ww)
    for j in range(3): X(0, j)        # three X in a row on the top line
    O(1, 1); O(1, 0); X(2, 2); O(2, 0)
    return im.resize((size, size), Image.LANCZOS)

for name, size, pad in [("icon-192.png", 192, 0.08), ("icon-512.png", 512, 0.08), ("icon-maskable-512.png", 512, 0.20), ("apple-touch-icon.png", 180, 0.08)]:
    mk(size, pad).save(os.path.join(OUT, name), optimize=True)
    print("wrote", name)
