"""Corporate Games brand kit: writes the logo SVG files (badges, mark, lockups, social cards) and the favicon.ico files.

Run only when a logo or a name changes (the outputs are committed):
    python -I tools/make_logos.py badges <home-sprite.json>   # first time only: badges taken from the home site sprite
    python -I tools/make_logos.py lockups                      # lockups + social cards (text is turned into outlines: no font needed to view them)
    python -I tools/make_logos.py ico                          # favicon.ico per product from logos/png/*-512.png (needs Pillow)

Lockups need fontTools + brotli (developer tools only, never shipped to a site). Set BRANDKIT_PYLIB to a folder that has them
(pip install --target <folder> fonttools brotli). The self-hosted fonts in fonts/ are the source of the outlines.
"""
import json, os, re, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if os.environ.get("BRANDKIT_PYLIB"):
    sys.path.insert(0, os.environ["BRANDKIT_PYLIB"])

PRODUCTS = [  # slug, proper name, host, social tagline
    ("tambola", "Tambola", "housie.corporatetambola.com"),
    ("bingo", "Bingo", "bingo.corporatetambola.com"),
    ("tictactoe", "Tic Tac Toe", "tictactoe.corporatetambola.com"),
    ("snakes", "Snakes and Ladders", "snakes.corporatetambola.com"),
    ("luck", "Luck by Chance", "luck.corporatetambola.com"),
    ("draw", "Lucky Draw", "home.corporatetambola.com"),
]
TAGLINE = "Online games for company events"
INK, MUTED, BG = "#1B1442", "#4D4870", "#FFFAF2"          # light lockup
DINK, DMUTED, DBG = "#F6F3FF", "#C9C3EA", "#130F2E"       # dark lockup
NS = 'xmlns="http://www.w3.org/2000/svg"'


def p(*a):
    return os.path.join(ROOT, *a)


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)


def badges(sprite_json):
    sp = json.load(open(sprite_json, encoding="utf-8"))
    for slug, name, _ in PRODUCTS:
        s = sp[slug]
        write(p("logos", slug + ".svg"),
              f'<svg {NS} viewBox="{s["viewBox"]}" width="512" height="512" role="img" aria-label="Corporate {name}"><title>Corporate {name}</title>{s["inner"]}</svg>\n')
    mark = open(sprite_json.replace("sprite.json", "brandmark.svg.txt"), encoding="utf-8").read()
    mark = mark.replace('<svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">', f'<svg {NS} viewBox="0 0 64 64" width="512" height="512" role="img" aria-label="Corporate Games"><title>Corporate Games</title>')
    write(p("logos", "corporate-games-mark.svg"), mark + "\n")


# ---------- text to outlines ----------
_fonts = {}


def font(kind):
    if kind in _fonts:
        return _fonts[kind]
    from fontTools.ttLib import TTFont
    from fontTools.varLib import instancer
    f = TTFont(p("fonts", "Fraunces-normal-500-700.woff2" if kind == "serif" else "Inter-normal-400.woff2"))
    axes = {a.axisTag: (a.minValue, a.defaultValue, a.maxValue) for a in f["fvar"].axes}
    loc = {"wght": min(max(700, axes["wght"][0]), axes["wght"][2])}
    for tag, (lo, dflt, hi) in axes.items():
        if tag != "wght":
            loc[tag] = dflt
    f = instancer.instantiateVariableFont(f, loc)
    _fonts[kind] = f
    return f


def outline(text, kind, size, x, y, tracking=0.0, anchor="start"):
    """returns (svg path d, advance width) for text drawn with baseline at y"""
    from fontTools.pens.svgPathPen import SVGPathPen
    from fontTools.pens.transformPen import TransformPen
    f = font(kind)
    cmap, gs, hmtx = f.getBestCmap(), f.getGlyphSet(), f["hmtx"]
    upm = f["head"].unitsPerEm
    k = size / upm
    kern = _kern_pairs(f)
    width, prev = 0.0, None
    for ch in text:
        g = cmap[ord(ch)]
        if prev is not None:
            width += kern.get((prev, g), 0) * k
        width += hmtx[g][0] * k + tracking
        prev = g
    width -= tracking if text else 0
    x0 = x - (width / 2 if anchor == "middle" else width if anchor == "end" else 0)
    d, cur, prev = [], x0, None
    for ch in text:
        g = cmap[ord(ch)]
        if prev is not None:
            cur += kern.get((prev, g), 0) * k
        pen = SVGPathPen(gs, ntos=lambda v: ("%.2f" % v).rstrip("0").rstrip("."))
        gs[g].draw(TransformPen(pen, (k, 0, 0, -k, cur, y)))
        if pen.getCommands():
            d.append(pen.getCommands())
        cur += hmtx[g][0] * k + tracking
        prev = g
    return "".join(d), width


def _kern_pairs(f):
    """simple pair kerning from GPOS (format 1 and 2 pair adjustment); enough for a logo"""
    if hasattr(f, "_kp"):
        return f._kp
    kp = {}
    try:
        gpos = f["GPOS"].table
        feats = [fr.Feature for fr in gpos.FeatureList.FeatureRecord if fr.FeatureTag == "kern"]
        idx = {i for ft in feats for i in ft.LookupListIndex}
        for i in idx:
            for st in gpos.LookupList.Lookup[i].SubTable:
                if st.LookupType == 9:
                    st = st.ExtSubTable
                if st.LookupType != 2:
                    continue
                cov = st.Coverage.glyphs
                if st.Format == 1:
                    for g1, ps in zip(cov, st.PairSet):
                        for pv in ps.PairValueRecord:
                            v = pv.Value1.XAdvance if pv.Value1 and hasattr(pv.Value1, "XAdvance") else 0
                            if v:
                                kp[(g1, pv.SecondGlyph)] = v
                else:
                    c1, c2 = st.ClassDef1.classDefs, st.ClassDef2.classDefs
                    for g1 in cov:
                        r1 = st.Class1Record[c1.get(g1, 0)]
                        for g2, cls in c2.items():
                            v = r1.Class2Record[cls].Value1
                            v = v.XAdvance if v and hasattr(v, "XAdvance") else 0
                            if v:
                                kp[(g1, g2)] = v
    except Exception:
        pass
    f._kp = kp
    return kp


def badge_inner(slug):
    s = open(p("logos", slug + ".svg"), encoding="utf-8").read()
    s = re.sub(r"^<svg[^>]*>", "", s.strip())
    s = re.sub(r"<title>.*?</title>", "", s)
    return s[: -len("</svg>")]


def lockup(slug, name, dark):
    ink, muted = (DINK, DMUTED) if dark else (INK, MUTED)
    corp, cw = outline("CORPORATE", "sans", 11.5, 80, 28, tracking=2.2)
    nm, nw = outline(name, "serif", 31, 80, 62)
    w = max(cw, nw) + 80 + 12
    title = f"Corporate {name}"
    return (f'<svg {NS} viewBox="0 0 {w:.0f} 72" width="{w:.0f}" height="72" role="img" aria-label="{title}"><title>{title}</title>'
            f'<g transform="translate(0 4) scale(1)"><svg viewBox="0 0 64 64" width="64" height="64">{badge_inner(slug)}</svg></g>'
            f'<path d="{corp}" fill="{muted}"/><path d="{nm}" fill="{ink}"/></svg>\n')


def mark_lockup(dark):
    ink, muted = (DINK, DMUTED) if dark else (INK, MUTED)
    corp, cw = outline("CORPORATE", "sans", 11.5, 80, 28, tracking=2.2)
    nm, nw = outline("Games", "serif", 31, 80, 62)
    w = max(cw, nw) + 92
    inner = re.sub(r"^<svg[^>]*>|<title>.*?</title>", "", open(p("logos", "corporate-games-mark.svg"), encoding="utf-8").read().strip())[:-6]
    return (f'<svg {NS} viewBox="0 0 {w:.0f} 72" width="{w:.0f}" height="72" role="img" aria-label="Corporate Games"><title>Corporate Games</title>'
            f'<g transform="translate(0 4)"><svg viewBox="0 0 64 64" width="64" height="64">{inner}</svg></g>'
            f'<path d="{corp}" fill="{muted}"/><path d="{nm}" fill="{ink}"/></svg>\n')


def social(slug, name, host):
    title = f"Corporate {name}"
    parts = name.split(" and ") if len(name) > 14 else [name]
    lines = [parts[0] + (" and" if len(parts) > 1 else "")] + ([parts[1]] if len(parts) > 1 else [])
    size = 104 if len(lines) == 1 else 88
    y0 = 372 if len(lines) == 1 else 322
    paths = []
    for i, ln in enumerate(lines):
        d, _ = outline(ln, "serif", size, 380, y0 + i * (size + 6))
        paths.append(f'<path d="{d}" fill="{INK}"/>')
    corp, _ = outline("CORPORATE", "sans", 30, 384, y0 - size - 14 + (0 if len(lines) == 1 else -6), tracking=7)
    tag, _ = outline(TAGLINE, "sans", 31, 384, y0 + (len(lines) - 1) * (size + 6) + 70)
    hd, _ = outline(host, "sans", 26, 384, 538)
    badge = badge_inner(slug)
    return (f'<svg {NS} viewBox="0 0 1200 630" width="1200" height="630" role="img" aria-label="{title}: {TAGLINE}"><title>{title}</title>'
            '<defs><radialGradient id="b1" cx="88%" cy="10%" r="45%"><stop offset="0" stop-color="#FF5C8A" stop-opacity=".30"/><stop offset="1" stop-color="#FF5C8A" stop-opacity="0"/></radialGradient>'
            '<radialGradient id="b2" cx="4%" cy="96%" r="40%"><stop offset="0" stop-color="#2EC4B6" stop-opacity=".30"/><stop offset="1" stop-color="#2EC4B6" stop-opacity="0"/></radialGradient>'
            '<linearGradient id="bg" x1="0" y1="0" x2=".35" y2="1"><stop offset="0" stop-color="#FFF4DC"/><stop offset="1" stop-color="#FFE1AD"/></linearGradient></defs>'
            '<rect width="1200" height="630" fill="url(#bg)"/><rect width="1200" height="630" fill="url(#b1)"/><rect width="1200" height="630" fill="url(#b2)"/>'
            '<rect x="64" y="64" width="1072" height="502" rx="40" fill="none" stroke="#F08C00" stroke-opacity=".55" stroke-width="3" stroke-dasharray="3 10" stroke-linecap="round"/>'
            '<g transform="translate(96 150) scale(4.6)"><svg viewBox="0 0 64 64" width="64" height="64">' + badge + '</svg></g>'
            f'<path d="{corp}" fill="{MUTED}"/>' + "".join(paths) + f'<path d="{tag}" fill="{MUTED}"/><path d="{hd}" fill="#9E3C00"/></svg>\n')


def lockups():
    for slug, name, host in PRODUCTS:
        write(p("logos", "lockups", f"{slug}-lockup-light.svg"), lockup(slug, name, False))
        write(p("logos", "lockups", f"{slug}-lockup-dark.svg"), lockup(slug, name, True))
        write(p("logos", "social", f"{slug}-social-1200x630.svg"), social(slug, name, host))
    write(p("logos", "lockups", "corporate-games-lockup-light.svg"), mark_lockup(False))
    write(p("logos", "lockups", "corporate-games-lockup-dark.svg"), mark_lockup(True))
    print("lockups and social cards written")


def ico():
    from PIL import Image
    names = [s for s, _, _ in PRODUCTS] + ["corporate-games-mark"]
    for n in names:
        im = Image.open(p("logos", "png", f"{n}-512.png")).convert("RGBA")
        out = p("logos", "ico", f"{n}.ico")
        os.makedirs(os.path.dirname(out), exist_ok=True)
        im.save(out, format="ICO", sizes=[(16, 16), (32, 32), (48, 48)])
    print("favicon.ico written")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "badges":
        badges(sys.argv[2])
    elif cmd == "lockups":
        lockups()
    elif cmd == "ico":
        ico()
    else:
        print(__doc__)
