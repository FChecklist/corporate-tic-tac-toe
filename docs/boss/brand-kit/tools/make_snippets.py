"""Writes snippets/ (HTML a site pastes in), manifest/ (one PWA manifest per product) and demo/ pages from ONE table of products,
so every site gets exactly the same header, footer and wording.   Run:  python -I tools/make_snippets.py   then:  python -I build.py
Header labels (exact, in this order): How it works | Free demo game | Guide | Brochure | Refer & earn | Log in."""
import json, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MENU = [("How it works", "/how-it-works", ""), ("Free demo game", "/zc?demo=1", "demo"), ("Guide", "/guide", ""), ("Brochure", "/brochure", ""), ("Refer &amp; earn", "/refer", ""), ("Log in", "/zc", "login")]
THEMES = [("blue", "Studio blue"), ("maroon", "Maroon"), ("emerald", "Emerald")]

# slug, sprite id, css class, proper name, host, hero lead, three panel lines, free-demo wording on the hero button
P = [
    ("tambola", "i-tambola", "g-tambola", "Tambola", "housie.corporatetambola.com",
     "The classic number game, also called Housie. Every player gets a ticket on their phone, and the software finds every winner.",
     ["A ticket on every phone", "No app to install", "The software finds every winner"]),
    ("bingo", "i-bingo", "g-bingo", "Bingo", "bingo.corporatetambola.com",
     "Numbers are called out loud. Every player gets a card on their phone, and the software finds every winner.",
     ["A card on every phone", "No app to install", "The software finds every winner"]),
    ("tictactoe", "i-ttt", "g-ttt", "Tic Tac Toe", "tictactoe.corporatetambola.com",
     "A tournament for your whole company. Colleagues play one against one, every move has a clock, and the software names the winners.",
     ["One against one", "Every move has a clock", "The software names the winners"]),
    ("snakes", "i-snakes", "g-snakes", "Snakes and Ladders", "snakes.corporatetambola.com",
     "Everyone gets their own board and plays at the same time. Each turn is a 20-second window, and the software finds every winner.",
     ["Everyone has their own board", "Each turn is a 20-second window", "The software finds every winner"]),
    ("luck", "i-luck", "g-luck", "Luck by Chance", "luck.corporatetambola.com",
     "A dice game of pure luck. Every round has a clock, the software names the winners, and a top-10 list is shown.",
     ["A dice game of pure luck", "Every round has a clock", "A top-10 list is shown"]),
    ("draw", "i-draw", "g-draw", "Lucky Draw", "home.corporatetambola.com",
     "A live draw that picks the winners in front of everyone. Not built yet: tell us you want it.",
     ["A live draw", "Picks the winners in front of everyone", "Tell us you want it"]),
]
GAMES_LINKS = [("Tambola", "https://housie.corporatetambola.com/"), ("Bingo", "https://bingo.corporatetambola.com/"), ("Tic Tac Toe", "https://tictactoe.corporatetambola.com/"),
               ("Snakes and Ladders", "https://snakes.corporatetambola.com/"), ("Luck by Chance", "https://luck.corporatetambola.com/"), ("Lucky Draw: tell us you want it", "https://home.corporatetambola.com/contact")]
TRUST = ["Designed for the engagement of company employees and their extended families.", "Close group online engagement and fun.", "Players never pay.",
         "Only the people you invite can join.", "No app to install.", "Player details are erased within 24 hours.",
         "A free Tambola or Bingo demo for 10 people.", "Designed to follow the EU GDPR, US privacy laws and India’s DPDP Act."]
STEPS = [(1, "Date and time of the game", "blue", "Pick the occasion, day and time."), (2, "Number of participants", "aqua", "How many players, and how the game runs."),
         (3, "Set Prizes", "violet", "Tick the prizes. Pick what each one is."), (4, "Set Brand Moments", "magenta", "Add your message or video. Test it first."),
         (5, "Make hosts and co-hosts", "green", "Add Hosts and Co-hosts. Send each link to one person."), (6, "Invite and Share links", "yellow", "Share the link. Add your people."),
         (7, "Check and publish", "orange", "Check everything. Then publish, free."), (8, "Pay", "lime", "Pay once, before the start time."),
         (9, "Game day", "violet", "Run the game. Message your guests."), (10, "After the game", "red", "Get your report. Erase data if you want.")]
STATUSES = [("draft", "Draft"), ("waiting", "Waiting for payment"), ("ready", "Ready"), ("playing", "Playing now"), ("finished", "Finished"), ("cancelled", "Cancelled"), ("notstarted", "Did not start")]
V = 1  # the ?v=N cache number written into the snippets; raise it when any css/js changes


def w(rel, text):
    path = os.path.join(ROOT, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)


def logo_inner(slug):
    s = open(os.path.join(ROOT, "logos", slug + ".svg"), encoding="utf-8").read().strip()
    vb = re.search(r'viewBox="([^"]+)"', s).group(1)
    return vb, re.sub(r"<title>.*?</title>", "", re.sub(r"^<svg[^>]*>", "", s))[:-6]


def sprite():
    out = ['<svg class="ck-sprite" width="0" height="0" aria-hidden="true" focusable="false"><defs>']
    for slug, sid, *_ in P:
        vb, inner = logo_inner(slug)
        out.append(f'<symbol id="{sid}" viewBox="{vb}">{inner}</symbol>')
    vb, inner = logo_inner("corporate-games-mark")
    out.append(f'<symbol id="i-games" viewBox="{vb}">{inner}</symbol>')
    out.append("</defs></svg>")
    return "\n".join(out) + "\n"


def header(slug, sid, name, current=None):
    links = "".join(f'<a href="{h}"' + (f' class="{c}"' if c else "") + (' aria-current="page"' if current == lab else "") + f">{lab}</a>" for lab, h, c in MENU)
    dots = "".join(f'<button type="button" data-t="{t}" aria-pressed="{"true" if t == "blue" else "false"}" aria-label="{lab} theme" title="{lab}"></button>' for t, lab in THEMES)
    return (f'<a class="ck-skip" href="#main">Skip to the content</a>\n<header class="ck-top"><div class="ck-top-in">\n'
            f'<a class="ck-brand" href="/" aria-label="Corporate {name}, home"><svg class="ck-badge" aria-hidden="true" focusable="false"><use href="#{sid}"/></svg>'
            f'<span class="ck-name"><i>Corporate</i><b>{name}</b></span></a>\n'
            f'<button class="ck-menu" type="button" id="ck-menu" aria-expanded="false" aria-controls="ck-nav">Menu</button>\n'
            f'<nav class="ck-nav" id="ck-nav" aria-label="Main">{links}<span class="ck-dots" role="group" aria-label="Colour theme">{dots}</span></nav>\n</div></header>\n')


def hero(slug, sid, cls, name, lead, bullets):
    lis = "".join(f"<li>{b}</li>" for b in bullets)
    btn = ('<a class="ck-btn main" href="/contact">Tell us you want it</a>' if slug == "draw"
           else '<a class="ck-btn main" href="/zc?demo=1">Try a free game with 10 people</a><a class="ck-btn" href="/zc">Log in</a>')
    return (f'<section class="ck-hero {cls}"><div class="ck-wrap ck-hero-in"><div>\n<span class="ck-kicker">For HR teams and managers</span>\n'
            f'<h1>This week, which teams will you engage with <span class="ck-hl">Corporate {name}?</span></h1>\n<p class="ck-lead">{lead}</p>\n'
            f'<div class="ck-btn-row">{btn}</div>\n</div>\n'
            f'<div class="ck-panel"><svg class="ck-badge" aria-hidden="true" focusable="false"><use href="#{sid}"/></svg><p class="ck-name"><i>Corporate</i><b>{name}</b></p><ul>{lis}</ul></div>\n</div></section>\n')


def trust():
    return ('<section class="ck-trust" id="trust"><div class="ck-wrap"><h2>What you can count on</h2>\n<ul class="ck-facts">\n'
            + "\n".join(f"<li><b>{t}</b></li>" for t in TRUST) + "\n</ul></div></section>\n")


def gameday():
    ol = open(os.path.join(ROOT, "tools", "gameday.src.html"), encoding="utf-8").read().strip()
    return ('<section class="ck-wash-rose ck-sec" id="game-day"><div class="ck-wrap"><div class="ck-sec-head"><span class="ck-kicker">How a game day feels</span><h2>Easy for you. Fun for your people.</h2></div>\n'
            + ol + '\n<div class="ck-day-actions"><div class="ck-btn-row"><a class="ck-btn main" href="/zc?demo=1">Try a free game with 10 people</a></div></div></div></section>\n')


def footer(name, sid):
    games = "".join(f'<li><a href="{h}">{t}</a></li>' for t, h in GAMES_LINKS)
    site = "".join(f'<li><a href="{h}">{t}</a></li>' for t, h, _ in MENU)
    return ('<footer class="ck-foot"><div class="ck-wrap"><div class="ck-foot-grid">\n'
            f'<div><p class="ck-brandline">Corporate {name}</p><p>Online games for company events, for the people you invite.</p><p>A product of IT Services by Rajat Agarwal.</p>'
            '<p><a href="mailto:hello@corporatetambola.com">hello@corporatetambola.com</a><br><a href="tel:+919650397480">(+91) 96503 97480</a></p>'
            '<p><button class="ck-mode" type="button" data-ck-mode>Dark</button></p></div>\n'
            f'<div><h2>The games</h2><ul>{games}</ul></div>\n<div><h2>This site</h2><ul>{site}</ul></div>\n'
            '<div><h2>Legal, on corporatetambola.com</h2><ul><li><a href="https://housie.corporatetambola.com/terms">Terms</a></li><li><a href="https://housie.corporatetambola.com/privacy">Privacy notice</a></li>'
            '<li><a href="https://housie.corporatetambola.com/subprocessors">Sub-processors</a></li><li><a href="https://housie.corporatetambola.com/dpa">Data processing terms</a></li>'
            '<li><a href="https://housie.corporatetambola.com/refund-policy">Refund policy</a></li></ul></div>\n</div>\n'
            '<div class="ck-legal"><p>IT Services by Rajat Agarwal is the trade name of Rajat Agarwal, an individual running a sole proprietorship in India. B-1105, Shipra Krishna Vista, Indirapuram, Ghaziabad, Uttar Pradesh, 201014, India. GST is not charged. Payments are collected by IT Services by Rajat Agarwal.</p>'
            '<p>&copy; 2026 Rajat Agarwal. All rights reserved.</p></div>\n</div></footer>\n')


def head(slug, name, host):
    return (f'<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
            f'<title>Corporate {name} | Online games for company events</title>\n'
            f'<meta name="description" content="Corporate {name}: online games for company events, for the people you invite.">\n'
            f'<meta name="theme-color" content="#0B3D91">\n'
            f'<meta property="og:type" content="website"><meta property="og:site_name" content="Corporate {name}"><meta property="og:title" content="Corporate {name} | Online games for company events">'
            f'<meta property="og:image" content="https://{host}/og-card.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="Corporate {name}">\n'
            f'<meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="https://{host}/og-card.png">\n'
            f'<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="icon" href="/favicon.ico" sizes="16x16 32x32 48x48"><link rel="icon" href="/favicon-32.png" type="image/png" sizes="32x32">\n'
            f'<link rel="apple-touch-icon" href="/apple-touch-icon.png?v={V}"><link rel="manifest" href="/manifest.webmanifest">\n'
            f'<link rel="preload" href="/fonts/Inter-normal-400.woff2" as="font" type="font/woff2" crossorigin><link rel="preload" href="/fonts/Fraunces-normal-500-700.woff2" as="font" type="font/woff2" crossorigin>\n'
            f'<link rel="stylesheet" href="/fonts.css?v={V}"><link rel="stylesheet" href="/tokens.css?v={V}"><link rel="stylesheet" href="/components.css?v={V}">\n'
            f'<script src="/theme-init.js?v={V}"></script>\n'
            f'<!-- end of head; before </body>: --><!-- <script src="/brandkit.js?v={V}" defer></script> -->\n')


def console_step_card(n, title, colour, hint, open_=False):
    body = ('<div class="cs-step-body"><p class="cs-says">Hello. Let us start with the basics.</p>'
            '<div class="ck-field"><label class="ck-lab" for="occ">Occasion</label><input class="ck-input" id="occ" value="Team party"></div>'
            '<div class="cs-actions"><a class="ck-btn main" href="#">Save and continue</a><button class="cs-skip" type="button">Skip</button></div></div>') if open_ else ""
    return (f'<li class="cs-step" data-c="{colour}" id="step-{n}"><div class="cs-step-head"><span class="cs-num" aria-hidden="true">{n}</span>'
            f'<div class="cs-step-text"><h2 class="cs-step-title">{title}</h2><p class="cs-step-hint">{hint}</p></div></div>{body}</li>\n')


def console_shell(name, sid, cls):
    chips = "".join(f'<span class="cs-chip" data-s="{s}">{l}</span> ' for s, l in STATUSES)
    steps = "".join(console_step_card(n, t, c, h, n == 1) for n, t, c, h in STEPS)
    side = "".join(f'<li><a href="#step-{n}"{" aria-current=\"step\"" if n == 1 else ""}><span class="cs-num" aria-hidden="true">{n}</span>{t}</a></li>' for n, t, c, h in STEPS)
    return (f'<header class="cs-top"><div class="cs-top-in"><a class="ck-brand" href="/zc" aria-label="Corporate {name}, my game"><svg class="ck-badge" aria-hidden="true" focusable="false"><use href="#{sid}"/></svg>'
            f'<span class="ck-name"><i>Corporate</i><b>{name}</b></span></a><div class="cs-top-end"><span class="cs-chip" data-s="draft">Draft</span><span class="cs-who">you@example.com</span><a class="cs-link" href="https://home.corporatetambola.com/">All games</a><button class="cs-link" type="button">Sign out</button></div></div></header>\n'
            f'<main class="cs-main" id="main"><h1 class="cs-title">Your game</h1><p class="cs-sub">Ten short steps. You can leave and come back.</p>\n'
            f'<div class="cs-pay"><span class="cs-chip" data-s="waiting">Waiting for payment</span> Pay before the start time to keep your game.</div>\n'
            f'<div class="cs-progress"><span>1 of 10</span><progress class="cs-meter" value="1" max="10" aria-label="Steps done">1 of 10</progress></div>\n'
            f'<div class="cs-layout"><nav class="cs-side" aria-label="Steps"><ol>{side}</ol></nav><ol class="cs-steps">\n{steps}</ol></div>\n'
            f'<p>{chips}</p></main>\n<div class="cs-tabs"><a class="ck-btn" href="#step-1">Steps</a><a class="ck-btn main" href="#step-2">Next</a></div>\n')


def manifest(slug, name):
    return json.dumps({
        "name": f"Corporate {name}", "short_name": name, "description": f"Corporate {name}: online games for company events, for the people you invite.",
        "id": "/", "start_url": "/", "scope": "/", "display": "standalone", "orientation": "portrait",
        "background_color": "#FFFAF2", "theme_color": "#0B3D91",
        "icons": [{"src": "/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any"}, {"src": "/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any"},
                  {"src": "/icon-maskable-192.png", "sizes": "192x192", "type": "image/png", "purpose": "maskable"}, {"src": "/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"}],
    }, indent=2) + "\n"


def demo_head(slug, name, host):
    h = head(slug, name, host).split("<!-- end of head")[0]
    # the demo is served from the kit folder: icons and manifest of a real site do not exist here
    h = re.sub(r'<link rel="(icon|apple-touch-icon|manifest)"[^>]*>', "", h)
    icon = f'<link rel="icon" href="/logos/{slug}.svg" type="image/svg+xml">'
    return h.replace('<link rel="stylesheet" href="/fonts.css', icon + '\n<link rel="stylesheet" href="/fonts.css', 1)


def page(slug, sid, cls, name, host, lead, bullets):
    return (f'<!doctype html>\n<html lang="en" data-theme="blue"><head>\n{demo_head(slug, name, host)}'
            f'<link rel="stylesheet" href="/console.css?v={V}"><link rel="stylesheet" href="/demo/demo.css?v={V}">\n</head>\n<body class="ck cs {cls}">\n'
            f'{{SPRITE}}<div class="demo-note"><p><b>Brand kit demo: Corporate {name}.</b> Landing page first, then the organizer console. <a href="/demo/">All products</a></p></div>\n'
            f'{header(slug, sid, name)}<main id="main" tabindex="-1">\n{hero(slug, sid, cls, name, lead, bullets)}{trust()}{gameday()}</main>\n{footer(name, sid)}'
            f'<div class="demo-note"><p><b>The organizer console of Corporate {name}</b> (a step card, the seven status chips)</p></div>\n'
            f'<div class="demo-console">{console_shell(name, sid, cls)}</div>\n'
            f'<script src="/brandkit.js?v={V}" defer></script>\n</body></html>\n')


def main():
    spr = sprite()
    w("snippets/sprite.html", spr)
    w("snippets/trust.html", trust())
    w("snippets/gameday.html", gameday())
    for slug, sid, cls, name, host, lead, bullets in P:
        w(f"snippets/head-{slug}.html", head(slug, name, host))
        w(f"snippets/header-{slug}.html", header(slug, sid, name))
        w(f"snippets/hero-{slug}.html", hero(slug, sid, cls, name, lead, bullets))
        w(f"snippets/footer-{slug}.html", footer(name, sid))
        w(f"manifest/{slug}.webmanifest", manifest(slug, name))
        w(f"demo/{slug}.html", page(slug, sid, cls, name, host, lead, bullets).replace("{SPRITE}", spr))
    cards = "".join(f'<article class="ck-card {cls}"><svg class="ck-badge" aria-hidden="true" focusable="false"><use href="#{sid}"/></svg><h3>Corporate {name}</h3><p>{lead}</p><a class="go" href="/demo/{slug}.html" aria-label="Open the {name} demo">Open the {name} demo &rarr;</a></article>' for slug, sid, cls, name, host, lead, bullets in P)
    w("demo/index.html", f'''<!doctype html>
<html lang="en" data-theme="blue"><head>
{demo_head("corporate-games-mark", "Games", "home.corporatetambola.com").replace("Corporate Games | Online", "Brand kit demo | Online")}<link rel="stylesheet" href="/console.css?v={V}"><link rel="stylesheet" href="/demo/demo.css?v={V}">
</head>
<body class="ck">
{spr}
<header class="ck-top"><div class="ck-top-in"><a class="ck-brand" href="/demo/" aria-label="Corporate Games brand kit demo"><svg class="ck-badge" aria-hidden="true" focusable="false"><use href="#i-games"/></svg><span class="ck-name"><i>Corporate</i><b>Games</b></span></a><button class="ck-menu" type="button" id="ck-menu" aria-expanded="false" aria-controls="ck-nav">Menu</button><nav class="ck-nav" id="ck-nav" aria-label="Main"><a href="/demo/tambola.html">Tambola</a><a href="/demo/bingo.html">Bingo</a><a href="/demo/tictactoe.html">Tic Tac Toe</a></nav></div></header>
<main id="main"><section class="ck-sec"><div class="ck-wrap"><span class="ck-kicker">Brand kit demo</span><h1>One look for every Corporate Games website and console.</h1><p class="ck-lead">Each page shows the landing page header, hero, trust list, game day strip and footer, then the organizer console. Use the Dark button in the footer and the three dots in the header.</p><div class="ck-cards">{cards}</div></div></section></main>
<script src="/brandkit.js?v={V}" defer></script>
</body></html>
''')
    w("snippets/console-shell.html", console_shell("Tambola", "i-tambola", "g-tambola"))
    w("snippets/forms.html", '<form class="ck-form" action="#" method="post" novalidate>\n<div class="ck-field"><label class="ck-lab" for="f-name">Your name</label><input class="ck-input" id="f-name" name="name" autocomplete="name"><p class="ck-hint">As you want it on the winners list.</p></div>\n'
      '<div class="ck-field"><label class="ck-lab" for="f-size">Number of players</label><select class="ck-input" id="f-size" name="size"><option>Demo, 10 people</option><option>100 people</option></select></div>\n'
      '<div class="ck-field"><label class="ck-lab" for="f-mail">E-mail</label><input class="ck-input" id="f-mail" name="mail" type="email" aria-invalid="true" aria-describedby="f-mail-e"><p class="ck-error" id="f-mail-e">Please write your e-mail like name@company.com.</p></div>\n'
      '<label class="ck-check"><input type="checkbox" name="ok"> I have read the notice and I am 18 or older.</label>\n'
      '<div class="ck-chips" role="group" aria-label="Day"><button class="ck-chip" type="button" aria-pressed="true">Today</button><button class="ck-chip" type="button" aria-pressed="false">Tomorrow</button></div>\n'
      '<div class="ck-btn-row"><button class="ck-btn main" type="submit">Save</button><button class="ck-btn" type="button">Cancel</button></div>\n</form>\n'
      '<table class="ck-table"><thead><tr><th>Name</th><th>Status</th><th>Joined</th></tr></thead><tbody><tr><td><span class="ck-lab-m">Name</span>Asha</td><td><span class="ck-lab-m">Status</span>Joined</td><td><span class="ck-lab-m">Joined</span>7:42 pm</td></tr></tbody></table>\n')
    print("snippets, manifests and demo pages written")


main()
