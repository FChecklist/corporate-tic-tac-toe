# Builds ../gamesbar.js from gamesbar.src.js + badges.svg (the ticket/board badges copied from the Corporate Games home site), and prints the
# SHA-256 of both shipped files. Usage: python -I build.py   (bump VERSION when anything changes, so browsers fetch the new gamesbar.css)
import json, hashlib, os
VERSION = "2"
here = os.path.dirname(os.path.abspath(__file__)); out = os.path.dirname(here)
src = open(os.path.join(here, "gamesbar.src.js"), encoding="utf-8").read()
svg = open(os.path.join(here, "badges.svg"), encoding="utf-8").read().strip()
js = src.replace("__V__", VERSION).replace("__SPRITE__", json.dumps(svg))
open(os.path.join(out, "gamesbar.js"), "w", encoding="utf-8", newline="\n").write(js)
for f in ("gamesbar.js", "gamesbar.css"):
    print(f, hashlib.sha256(open(os.path.join(out, f), "rb").read()).hexdigest())
