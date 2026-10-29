"""Copies the brand kit into ONE site's public folder, with the right file names, and prints the checksums to pin in the site's test.

    python -I vendor.py <product> <site-public-folder> [--console] [--no-manifest] [--apply]

<product> is one of: tambola, bingo, tictactoe, snakes, luck, draw.   Without --apply it only prints what it would do (a dry run).
--console      also copies console.css (for the organizer console pages).
--no-manifest  keep the site's own manifest.webmanifest (do this when the site already has one with its own start_url).
It never edits any page: the html you paste in is in snippets/ (head-<product>.html, header-<product>.html, hero-<product>.html, footer-<product>.html, sprite.html)."""
import hashlib, os, shutil, sys

ROOT = os.path.dirname(os.path.abspath(__file__))
PRODUCTS = ["tambola", "bingo", "tictactoe", "snakes", "luck", "draw"]


def plan(slug, console, manifest):
    p = [(f, f) for f in ["tokens.css", "fonts.css", "components.css", "brandkit.js", "theme-init.js"]]
    if console:
        p.append(("console.css", "console.css"))
    p += [("fonts/Inter-normal-400.woff2", "fonts/Inter-normal-400.woff2"), ("fonts/Fraunces-normal-500-700.woff2", "fonts/Fraunces-normal-500-700.woff2")]
    L = "logos/png/" + slug
    p += [(f"{L}-192.png", "icon-192.png"), (f"{L}-512.png", "icon-512.png"), (f"{L}-maskable-192.png", "icon-maskable-192.png"), (f"{L}-maskable-512.png", "icon-maskable-512.png"),
          (f"{L}-180.png", "apple-touch-icon.png"), (f"{L}-32.png", "favicon-32.png"), (f"logos/ico/{slug}.ico", "favicon.ico"), (f"logos/{slug}.svg", "favicon.svg"),
          (f"logos/social/{slug}-social-1200x630.png", "og-card.png")]
    if manifest:
        p.append((f"manifest/{slug}.webmanifest", "manifest.webmanifest"))
    return p


def sha(path):
    data = open(path, "rb").read()
    if path.endswith((".css", ".js", ".svg", ".webmanifest")):
        data = data.replace(b"\r\n", b"\n")
    return hashlib.sha256(data).hexdigest()


def main(argv):
    args = [a for a in argv if not a.startswith("--")]
    if len(args) != 2 or args[0] not in PRODUCTS:
        print(__doc__)
        return 2
    slug, dest = args
    apply = "--apply" in argv
    if not os.path.isdir(dest):
        print("site folder not found:", dest)
        return 2
    pl = plan(slug, "--console" in argv, "--no-manifest" not in argv)
    missing = [s for s, _ in pl if not os.path.exists(os.path.join(ROOT, s))]
    if missing:
        print("kit files missing (build the kit first):", missing)
        return 1
    print(("COPYING" if apply else "DRY RUN (add --apply to copy)"), "brand kit,", slug, "->", dest)
    for src, name in pl:
        to = os.path.join(dest, name)
        print(f"  {src}  ->  {name}" + ("   (replaces an existing file)" if os.path.exists(to) else ""))
        if apply:
            os.makedirs(os.path.dirname(to), exist_ok=True)
            shutil.copyfile(os.path.join(ROOT, src), to)
    print("\nPin these in the site's checksum test (see checksum.test.ts.example):")
    for src, name in pl:
        if name.endswith((".css", ".js", ".woff2")):
            print(f"  {sha(os.path.join(ROOT, src))}  {name}")
    print("\nNext: paste snippets/sprite.html and snippets/header-%s.html, hero-%s.html, footer-%s.html into the pages, merge snippets/head-%s.html into <head>," % (slug, slug, slug, slug))
    print("raise ?v=N on every css/js link, bump the service-worker version, add the no-cache lines from _headers.example.")
    return 0


sys.exit(main(sys.argv[1:]))
