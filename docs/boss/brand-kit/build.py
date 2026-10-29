"""Corporate Games brand kit: prints and writes the checksum manifest (SHA-256 of every file), and refuses to build if an SVG is not well-formed XML.

    python -I build.py            writes CHECKSUMS.sha256 and vendor-checksums.json, prints both
    python -I build.py --check    only checks the files against CHECKSUMS.sha256 (exit 1 if anything differs, is missing, or is not listed)

Text files are hashed with line endings normalised to LF (git may check files out with CRLF); binary files (png, ico, woff2) byte for byte.
The VENDOR set is the files a site copies; each site's checksum test pins these hashes (see README.md, 'Checksum test')."""
import hashlib, json, os, sys
import xml.etree.ElementTree as ET

VERSION = "1.0.0"
ROOT = os.path.dirname(os.path.abspath(__file__))
SKIP_DIRS = {".git", "__pycache__", "node_modules"}
SKIP_FILES = {"CHECKSUMS.sha256", "vendor-checksums.json"}
TEXT = {".css", ".js", ".mjs", ".html", ".svg", ".json", ".webmanifest", ".md", ".py", ".txt", ".example", ".sha256", ".gitignore", ".gitattributes"}
VENDOR = ["tokens.css", "fonts.css", "components.css", "console.css", "brandkit.js", "theme-init.js", "fonts/Inter-normal-400.woff2", "fonts/Fraunces-normal-500-700.woff2"]


def sha(path):
    data = open(os.path.join(ROOT, path), "rb").read()
    if os.path.splitext(path)[1] in TEXT or os.path.basename(path).startswith("."):
        data = data.replace(b"\r\n", b"\n")
    return hashlib.sha256(data).hexdigest()


def files():
    out = []
    for d, dirs, names in os.walk(ROOT):
        dirs[:] = sorted(x for x in dirs if x not in SKIP_DIRS)
        for n in sorted(names):
            if n in SKIP_FILES or n.endswith(".pyc"):
                continue
            out.append(os.path.relpath(os.path.join(d, n), ROOT).replace(os.sep, "/"))
    return sorted(out)


def check_svgs(fs):
    bad = []
    for f in fs:
        if f.endswith(".svg"):
            try:
                ET.parse(os.path.join(ROOT, f))
            except ET.ParseError as e:
                bad.append(f"{f}: {e}")
    return bad


def main():
    fs = files()
    bad = check_svgs(fs)
    if bad:
        print("SVG files that are not well-formed:\n  " + "\n  ".join(bad))
        return 1
    lines = [f"{sha(f)}  {f}" for f in fs]
    if "--check" in sys.argv:
        listed = dict((l.split("  ", 1)[1], l.split("  ", 1)[0]) for l in open(os.path.join(ROOT, "CHECKSUMS.sha256"), encoding="utf-8").read().split("\n") if l)
        problems = [f"changed: {f}" for f in fs if f in listed and listed[f] != sha(f)] + [f"not listed: {f}" for f in fs if f not in listed] + [f"missing: {f}" for f in listed if f not in fs]
        print("\n".join(problems) if problems else f"OK: {len(fs)} files match CHECKSUMS.sha256")
        return 1 if problems else 0
    vendor = {f: sha(f) for f in VENDOR}
    open(os.path.join(ROOT, "CHECKSUMS.sha256"), "w", encoding="utf-8", newline="\n").write("\n".join(lines) + "\n")
    open(os.path.join(ROOT, "vendor-checksums.json"), "w", encoding="utf-8", newline="\n").write(json.dumps({"kit": "corporate-brand-kit", "version": VERSION, "files": vendor}, indent=2) + "\n")
    print(f"Corporate Games brand kit {VERSION}: {len(fs)} files\n")
    print("\n".join(lines))
    print("\nVENDOR set (what a site copies; pin these in its checksum test):")
    for f, h in vendor.items():
        print(f"  {h}  {f}")
    return 0


sys.exit(main())
