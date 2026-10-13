// The one place that builds an e-mail carrying an AI work link (organizer: cba_, Host: cbh_).
// Rule: a link to the AI work manual travels ONLY in these dedicated mails, to the organizer alone. No other mail (publish, payment, reminders, invoices,
// report, partners, invitations) and no report/PDF/guest page may carry one: mail scanners open links, forwarded mails leak them, and the key is a credential.
// The paste text is shown as plain text in a box, never as a hyperlink.

import { aiPaste } from "./ai-link";

export const AI_WARNING = "DO NOT FORWARD: this email holds your personal AI work link";
export const HOST_WARNING = "DO NOT FORWARD: this email holds a Host AI work link";
export const AI_SUBJECT = "Your personal AI work link - Corporate Tic Tac Toe";
export const HOST_SUBJECT = "A Host AI work link for your Corporate Tic Tac Toe account";

export interface BuiltMail { subject: string; text: string; html: string }

import { BRAND, esc, footerText, pageHtml } from "./brand";

const AI_CAN = "It can do what you do in the console.";
const AI_STAYS = "You keep payment, publishing, erasing data, and pause or stop.";
const HOST_CAN = "Watch the game, message every guest, tick prizes as given.";
const HOST_STAYS = "Nothing else. It cannot change settings, people, payment or data.";

function shell(opts: { origin: string; warning: string; title: string; intro: string; pasteLabel: string; expiry: string; button: { label: string; url: string; note: string }; paste: string; steps: string[]; can: string; stays: string; replace: string; footer: string }): { text: string; html: string } {
  const text = [
    opts.warning, "", opts.title.toUpperCase(), "", opts.intro, "", opts.expiry, "", `${opts.button.label.toUpperCase()}: ${opts.button.url}`, opts.button.note, "",
    opts.pasteLabel, "--------------------------------", opts.paste, "--------------------------------", "",
    "WHAT TO DO", ...opts.steps.map((s, i) => `${i + 1}. ${s}`), "",
    "WHAT IT CAN DO", opts.can, "", "WHAT STAYS WITH YOU", opts.stays, "",
    "LOST IT?", opts.replace, "",
    ...(opts.footer ? [opts.footer, ""] : []), opts.warning, "", footerText(opts.origin), "",
  ].join("\n");
  const warn = (pad: string) => `<tr><td style="padding:${pad};"><div style="background:#fdecea;border:2px solid #c0392b;border-radius:8px;padding:12px 14px;color:#b71c1c;font-weight:700;font-size:14px;line-height:1.4;text-align:center;">${esc(opts.warning)}</div></td></tr>`;
  const html = pageHtml(opts.title, `${warn("16px 22px 0")}
<tr><td style="padding:18px 22px 4px;"><h1 style="margin:0;font-size:24px;line-height:1.25;color:#0B5D5B;">${esc(opts.title)}</h1><p style="margin:10px 0 0;font-size:15px;line-height:1.5;">${esc(opts.intro)}</p></td></tr>
<tr><td style="padding:12px 22px 0;"><div style="background:#FBF0D9;border:1px solid #FFC93C;border-radius:8px;padding:10px 14px;font-size:14px;line-height:1.45;color:#5A3A00;"><b>${esc(opts.expiry)}</b></div></td></tr>
<tr><td align="center" style="padding:16px 22px 4px;"><a href="${esc(opts.button.url)}" style="display:inline-block;background:#FFC93C;color:#0B5D5B;font-weight:700;font-size:16px;text-decoration:none;padding:13px 26px;border-radius:8px;">${esc(opts.button.label)}</a><div style="font-size:12px;color:#666;margin-top:8px;line-height:1.45;">${esc(opts.button.note)}</div></td></tr>
<tr><td style="padding:14px 22px 6px;"><div style="font-size:12px;font-weight:700;letter-spacing:.06em;color:#8A5A00;margin-bottom:6px;">${esc(opts.pasteLabel)}</div>
<div style="background:#F7FBFA;border:2px dashed #FFC93C;border-radius:8px;padding:14px;font-family:Consolas,'Courier New',monospace;font-size:13px;line-height:1.5;color:#111;white-space:pre-wrap;overflow-wrap:anywhere;text-decoration:none;">${esc(opts.paste)}</div>
<div style="font-size:12px;color:#666;margin-top:6px;">Plain text on purpose. Select it, copy it, paste it into your AI chat.</div></td></tr>
<tr><td style="padding:14px 22px 0;"><div style="font-size:12px;font-weight:700;letter-spacing:.06em;color:#8A5A00;margin-bottom:6px;">WHAT TO DO</div>
<table role="presentation" cellpadding="0" cellspacing="0" width="100%">${opts.steps.map((s, i) => `<tr><td valign="top" width="30" style="padding:4px 0;"><div style="width:24px;height:24px;border-radius:12px;background:#0B5D5B;color:#FFE08A;text-align:center;line-height:24px;font-size:13px;font-weight:700;">${i + 1}</div></td><td style="padding:4px 0;font-size:15px;line-height:1.45;">${esc(s)}</td></tr>`).join("")}</table></td></tr>
<tr><td style="padding:14px 22px 0;"><div style="font-size:12px;font-weight:700;letter-spacing:.06em;color:#0b6b3a;margin-bottom:4px;">WHAT IT CAN DO</div><div style="font-size:14px;line-height:1.5;">${esc(opts.can)}</div></td></tr>
<tr><td style="padding:12px 22px 0;"><div style="font-size:12px;font-weight:700;letter-spacing:.06em;color:#8a4b00;margin-bottom:4px;">WHAT STAYS WITH YOU</div><div style="font-size:14px;line-height:1.5;">${esc(opts.stays)}</div></td></tr>
<tr><td style="padding:12px 22px 0;"><div style="font-size:12px;font-weight:700;letter-spacing:.06em;color:#555;margin-bottom:4px;">LOST IT?</div><div style="font-size:14px;line-height:1.5;">${esc(opts.replace)}</div></td></tr>
${opts.footer ? `<tr><td style="padding:12px 22px 6px;font-size:12px;color:#666;line-height:1.5;">${esc(opts.footer)}</td></tr>` : ""}
${warn("8px 22px 20px")}`, opts.origin);
  return { text, html };
}

/** The organizer's dedicated AI-link mail: sent when the account is created and when the link is replaced, and nowhere else. */
const istStamp = (ms: number) => new Date(ms).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true }) + " IST";
export const LINK_MAIL_TTL_MS = 24 * 3_600_000;
const FRESH = "Need a new one? Press the button below.";
export function aiLinkMail(origin: string, key: string, why: "start" | "replace" | "fresh", expiresMs: number): BuiltMail {
  const { text, html } = shell({
    origin, warning: AI_WARNING,
    title: why === "replace" ? "Your NEW personal AI work link" : why === "fresh" ? "Your fresh personal AI work link" : "Your personal AI work link",
    intro: why === "replace" ? "New link below. Every older link stopped at once." : "A free AI assistant can do the work for you.",
    expiry: `THIS LINK WORKS FOR 24 HOURS ONLY (until ${istStamp(expiresMs)}). ${FRESH}`,
    button: { label: "Show my AI work link", url: `${origin}/ai-link.html`, note: "Sign in with your 6-digit code. It always gives a fresh link." },
    pasteLabel: "COPY THIS BOX",
    paste: aiPaste(origin, key),
    steps: ["Copy the box.", "Paste it into any AI chat: ChatGPT, Claude, Gemini, Grok, DeepSeek, z.ai.", "Answer its questions. It does the work."],
    can: AI_CAN, stays: AI_STAYS,
    replace: "Press \"Replace my AI link\" in your console. Every AI link stops at once.",
    footer: "",
  });
  return { subject: AI_SUBJECT, text, html };
}

/** A Host's link, e-mailed to the organizer who made it. Role: watch and announce only. `owner` names whose engagements it belongs to. */
export function coHostLinkMail(origin: string, key: string, owner: string, expiresMs: number): BuiltMail {
  const { text, html } = shell({
    origin, warning: HOST_WARNING,
    title: "A Host AI work link",
    intro: `For the Corporate Tic Tac Toe engagements of ${owner}. Watch and announce only. Give it to your Host by pasting the box. Do not forward this email.`,
    expiry: `THIS HOST LINK WORKS FOR 24 HOURS ONLY (until ${istStamp(expiresMs)}).`,
    button: { label: "Open my console", url: `${origin}/zc.html`, note: "Your lasting Host link is in your console." },
    pasteLabel: "YOUR HOST PASTES THIS INTO AN AI CHAT",
    paste: aiPaste(origin, key).replace("MY OWN Corporate Tic Tac Toe account. I am the owner,", `the Corporate Tic Tac Toe account of ${owner}. I am their Host,`),
    steps: ["Copy the box. Give it only to your Host.", "They paste it into any AI chat.", "They ask how the game is going, or to message the guests."],
    can: HOST_CAN, stays: HOST_STAYS,
    replace: "Retire the Host key in your console and make a new one. The old link stops at once.",
    footer: "",
  });
  return { subject: HOST_SUBJECT, text, html };
}

export const HOST_LINK_SUBJECT = "You are a Host: your Corporate Tic Tac Toe link";
export const HOST_LINK_WARNING = "DO NOT FORWARD: this email holds your personal Host link";
/** The Host's OWN link (their console), e-mailed to the Host when the Organizer adds them. Not an AI link; it opens the Host's console. Only the Organizer and Hosts have an e-mail. */
export function hostLinkMail(origin: string, key: string, name: string, eid = ""): BuiltMail {
  const url = `${origin}/zc.html?k=${key}${eid ? "&e=" + encodeURIComponent(eid) : ""}`; // with a game id the link opens that game
  const hello = name ? `Hello ${name},` : "Hello,";
  const text = [HOST_LINK_WARNING, "", hello, "You have been added as a Host of a Corporate Tic Tac Toe game.", "As a Host you can look after the game, add Co-hosts and pay. Only the Organizer can change the account.", "", `OPEN MY CONSOLE: ${url}`, "", "This link is only for you. Keep it private. Do not forward it.", "", HOST_LINK_WARNING, "", footerText(origin), ""].join("\n");
  const warn = `<tr><td style="padding:16px 22px 0;"><div style="background:#fdecea;border:2px solid #c0392b;border-radius:8px;padding:12px 14px;color:#b71c1c;font-weight:700;font-size:14px;line-height:1.4;text-align:center;">${esc(HOST_LINK_WARNING)}</div></td></tr>`;
  const html = pageHtml("You are a Host", `${warn}<tr><td style="padding:18px 22px 4px;"><h1 style="margin:0;font-size:24px;line-height:1.25;color:#0B5D5B;">You are a Host</h1><p style="margin:10px 0 0;font-size:15px;line-height:1.5;">${esc(hello)} You have been added as a Host of a Corporate Tic Tac Toe game. You can look after the game, add Co-hosts and pay. Only the Organizer can change the account.</p></td></tr>
<tr><td align="center" style="padding:16px 22px 4px;"><a href="${esc(url)}" style="display:inline-block;background:#FFC93C;color:#0B5D5B;font-weight:700;font-size:16px;text-decoration:none;padding:13px 26px;border-radius:8px;">Open my console</a></td></tr>
<tr><td style="padding:12px 22px 6px;font-size:13px;color:#666;line-height:1.5;">This link is only for you. Keep it private. Do not forward it.</td></tr>${warn.replace("16px 22px 0", "8px 22px 20px")}`, origin);
  return { subject: HOST_LINK_SUBJECT, text, html };
}

/** A plain alert, no link and no key in it: an AI link was used from somewhere new. */
export function newUseAlertMail(info: { when: string; country: string; program: string; kind: "AI" | "Host"; origin?: string }): BuiltMail {
  const text = [
    `Someone new used your ${info.kind} work link`, "",
    `When: ${info.when}`, `Country: ${info.country || "unknown"}`, `Program: ${info.program || "unknown"}`, "",
    "Not you? Press \"Replace my AI link\" in your console.", "", footerText(info.origin), "",
  ].join("\n");
  const html = pageHtml("Someone new used your " + info.kind + " work link", `<tr><td style="padding:20px 22px 8px;"><h1 style="font-size:22px;color:#0B5D5B;margin:0 0 8px;">Someone new used your ${esc(info.kind)} work link</h1><p style="font-size:15px;line-height:1.5;margin:0 0 12px;">When: ${esc(info.when)}<br>Country: ${esc(info.country || "unknown")}<br>Program: ${esc(info.program || "unknown")}</p><p style="font-size:15px;line-height:1.5;margin:0;">Not you? Press <b>Replace my AI link</b> in your console.</p></td></tr>`, info.origin);
  return { subject: `Someone new used your ${info.kind} work link`, text, html };
}

export const SIGNIN_SUBJECT = "Sign in to Corporate Tic Tac Toe - choose how you want to continue";
/** The sign-in e-mail for an existing account: three ways in. No AI key or paste: the buttons are single-use sign-in links (10 minutes) to the signed-in pages; the 6-digit code is the fallback. */
export function signInMail(origin: string, code: string, token: string): BuiltMail {
  const aiUrl = `${origin}/signin.html?t=${token}&go=ai`, consoleUrl = `${origin}/signin.html?t=${token}&go=console`;
  const intro = "Choose one way to sign in.";
  const o1 = "Your AI asks a few questions and sets it all up. You keep payment and publishing.";
  const foot = "Did not ask for this? Ignore it. Do not forward it: it opens your account.";
  const text = [
    "YOU ARE ALMOST IN", "", intro, "",
    "OPTION 1 - LET YOUR AI DO THE WORK", o1, `Sign in and get my AI work link: ${aiUrl}`, "",
    "OPTION 2 - WORK ON YOUR OWN", `Open my console: ${consoleUrl}`, "",
    "OPTION 3 - SIGN-IN PAGE ALREADY OPEN?", `Type this 6-digit code there: ${code}`, "It works for 10 minutes.", "",
    foot, "", footerText(origin), "",
  ].join("\n");
  const card = (n: string, title: string, body: string) => `<tr><td style="padding:12px 22px 0;"><div style="border:1px solid #D5E3E1;border-radius:10px;background:#F7FBFA;padding:14px 16px;"><div style="font-size:12px;font-weight:700;letter-spacing:.06em;color:#8A5A00;">OPTION ${n}</div><div style="font-size:18px;font-weight:700;color:#0B5D5B;margin:3px 0 6px;">${esc(title)}</div>${body}</div></td></tr>`;
  const btn = (label: string, url: string) => `<a href="${esc(url)}" style="display:inline-block;background:#FFC93C;color:#0B5D5B;font-weight:700;font-size:16px;text-decoration:none;padding:12px 22px;border-radius:8px;">${esc(label)}</a>`;
  const html = pageHtml("Sign in to " + BRAND.name, `<tr><td style="padding:20px 22px 4px;"><h1 style="margin:0;font-size:26px;line-height:1.25;color:#0B5D5B;">You are almost in</h1><p style="margin:10px 0 0;font-size:15px;line-height:1.5;">${esc(intro)}</p></td></tr>
${card("1", "Let your AI do the work", `<p style="margin:0 0 12px;font-size:14px;line-height:1.5;">${esc(o1)}</p>${btn("Sign in and get my AI work link", aiUrl)}`)}
${card("2", "Work on your own", `<p style="margin:0 0 12px;font-size:14px;line-height:1.5;">Build it yourself in your console.</p>${btn("Open my console", consoleUrl)}`)}
${card("3", "Sign-in page already open?", `<p style="margin:0 0 8px;font-size:14px;line-height:1.5;">Type this 6-digit code there:</p><div style="font-family:Consolas,'Courier New',monospace;font-size:30px;letter-spacing:.3em;font-weight:700;color:#0B5D5B;background:#fff;border:2px dashed #FFC93C;border-radius:8px;padding:8px 14px;display:inline-block;">${esc(code)}</div><p style="margin:8px 0 0;font-size:13px;color:#555;">It works for 10 minutes.</p>`)}
<tr><td style="padding:14px 22px 20px;"><div style="background:#fdecea;border:1px solid #c0392b;border-radius:8px;padding:10px 12px;color:#b71c1c;font-weight:700;font-size:13px;text-align:center;">${esc(foot)}</div></td></tr>`, origin);
  return { subject: SIGNIN_SUBJECT, text, html };
}
