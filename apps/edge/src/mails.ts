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
<tr><td style="padding:18px 22px 4px;"><h1 style="margin:0;font-size:24px;line-height:1.25;color:#0B3D91;">${esc(opts.title)}</h1><p style="margin:10px 0 0;font-size:15px;line-height:1.5;">${esc(opts.intro)}</p></td></tr>
<tr><td style="padding:12px 22px 0;"><div style="background:#FBF0D9;border:1px solid #FFC93C;border-radius:8px;padding:10px 14px;font-size:14px;line-height:1.45;color:#5A3A00;"><b>${esc(opts.expiry)}</b></div></td></tr>
<tr><td align="center" style="padding:16px 22px 4px;"><a href="${esc(opts.button.url)}" style="display:inline-block;background:#FFC93C;color:#0B3D91;font-weight:700;font-size:16px;text-decoration:none;padding:13px 26px;border-radius:8px;">${esc(opts.button.label)}</a><div style="font-size:12px;color:#666;margin-top:8px;line-height:1.45;">${esc(opts.button.note)}</div></td></tr>
<tr><td style="padding:14px 22px 6px;"><div style="font-size:12px;font-weight:700;letter-spacing:.06em;color:#8A5A00;margin-bottom:6px;">${esc(opts.pasteLabel)}</div>
<div style="background:#FFFAF2;border:2px dashed #FFC93C;border-radius:8px;padding:14px;font-family:Consolas,'Courier New',monospace;font-size:13px;line-height:1.5;color:#111;white-space:pre-wrap;overflow-wrap:anywhere;text-decoration:none;">${esc(opts.paste)}</div>
<div style="font-size:12px;color:#666;margin-top:6px;">Plain text on purpose. Select it, copy it, paste it into your AI chat.</div></td></tr>
<tr><td style="padding:14px 22px 0;"><div style="font-size:12px;font-weight:700;letter-spacing:.06em;color:#8A5A00;margin-bottom:6px;">WHAT TO DO</div>
<table role="presentation" cellpadding="0" cellspacing="0" width="100%">${opts.steps.map((s, i) => `<tr><td valign="top" width="30" style="padding:4px 0;"><div style="width:24px;height:24px;border-radius:12px;background:#0B3D91;color:#FFE08A;text-align:center;line-height:24px;font-size:13px;font-weight:700;">${i + 1}</div></td><td style="padding:4px 0;font-size:15px;line-height:1.45;">${esc(s)}</td></tr>`).join("")}</table></td></tr>
<tr><td style="padding:14px 22px 0;"><div style="font-size:12px;font-weight:700;letter-spacing:.06em;color:#0b6b3a;margin-bottom:4px;">WHAT IT CAN DO</div><div style="font-size:14px;line-height:1.5;">${esc(opts.can)}</div></td></tr>
<tr><td style="padding:12px 22px 0;"><div style="font-size:12px;font-weight:700;letter-spacing:.06em;color:#8a4b00;margin-bottom:4px;">WHAT STAYS WITH YOU</div><div style="font-size:14px;line-height:1.5;">${esc(opts.stays)}</div></td></tr>
<tr><td style="padding:12px 22px 0;"><div style="font-size:12px;font-weight:700;letter-spacing:.06em;color:#555;margin-bottom:4px;">LOST IT?</div><div style="font-size:14px;line-height:1.5;">${esc(opts.replace)}</div></td></tr>
${opts.footer ? `<tr><td style="padding:12px 22px 6px;font-size:12px;color:#666;line-height:1.5;">${esc(opts.footer)}</td></tr>` : ""}
${warn("8px 22px 20px")}
`, opts.origin);
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
    intro: `For the Corporate Tic Tac Toe games of ${owner}. Watch and announce only. Give it to your Host by pasting the box. Do not forward this email.`,
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
  const text = [HOST_LINK_WARNING, "", hello, "You have been added as a Host of a Corporate Tic Tac Toe game.", "As a Host you can look after the game, add Co-hosts and pay. Only the Organizer can change the account.", "", `OPEN MY CONSOLE: ${url}`, "", "This link is only for you. Do not forward it or share it.", "", HOST_LINK_WARNING, "", footerText(origin), ""].join("\n");
  const warn = `<tr><td style="padding:16px 22px 0;"><div style="background:#fdecea;border:2px solid #c0392b;border-radius:8px;padding:12px 14px;color:#b71c1c;font-weight:700;font-size:14px;line-height:1.4;text-align:center;">${esc(HOST_LINK_WARNING)}</div></td></tr>`;
  const html = pageHtml("You are a Host", `${warn}<tr><td style="padding:18px 22px 4px;"><h1 style="margin:0;font-size:24px;line-height:1.25;color:#0B3D91;">You are a Host</h1><p style="margin:10px 0 0;font-size:15px;line-height:1.5;">${esc(hello)} You have been added as a Host of a Corporate Tic Tac Toe game. You can look after the game, add Co-hosts and pay. Only the Organizer can change the account.</p></td></tr>
<tr><td align="center" style="padding:16px 22px 4px;"><a href="${esc(url)}" style="display:inline-block;background:#FFC93C;color:#0B3D91;font-weight:700;font-size:16px;text-decoration:none;padding:13px 26px;border-radius:8px;">Open my console</a></td></tr>
<tr><td style="padding:12px 22px 6px;font-size:13px;color:#666;line-height:1.5;">This link is only for you. Do not forward it or share it.</td></tr>${warn.replace("16px 22px 0", "8px 22px 20px")}`, origin);
  return { subject: HOST_LINK_SUBJECT, text, html };
}

/** Help Desk: the mail to the helper when the Organizer published a game they prepared (helpdesk.ts). It carries the helper's Host console link (only the first time) and a Host AI link that works 24 hours, with the same warnings as the other link mails. */
export function helpDeskPublishedMail(origin: string, o: { eid: string; hostKey?: string; aiHostKey: string; expiresMs: number }): BuiltMail {
  const subject = `Your game ${o.eid} is published`;
  const consoleUrl = o.hostKey ? `${origin}/zc.html?k=${o.hostKey}&e=${encodeURIComponent(o.eid)}` : "", aiUrl = `${origin}/ai/${o.aiHostKey}`;
  const intro = `The Organizer published the game ${o.eid}. You are now a Host of this game, as the Help desk.`;
  const once = "This link works once, for 7 days. Confirm your e-mail and add your mobile number. After that, sign in with your e-mail code.";
  const text = [HOST_LINK_WARNING, "", intro, "", ...(consoleUrl ? [`OPEN MY HOST CONSOLE: ${consoleUrl}`, once, ""] : ["Open your Host console by signing in with your e-mail code.", ""]), `HOST AI LINK FOR THIS GAME (works 24 hours, until ${istStamp(o.expiresMs)}): ${aiUrl}`, "", "These links are only for you. Do not forward them or share them.", "", HOST_LINK_WARNING, "", footerText(origin), ""].join("\n");
  const warn = `<tr><td style="padding:16px 22px 0;"><div style="background:#fdecea;border:2px solid #c0392b;border-radius:8px;padding:12px 14px;color:#b71c1c;font-weight:700;font-size:14px;line-height:1.4;text-align:center;">${esc(HOST_LINK_WARNING)}</div></td></tr>`;
  const html = pageHtml(subject, `${warn}<tr><td style="padding:18px 22px 4px;"><h1 style="margin:0;font-size:24px;line-height:1.25;color:#0B3D91;">Your game is published</h1><p style="margin:10px 0 0;font-size:15px;line-height:1.5;">${esc(intro)}</p></td></tr>
${consoleUrl ? `<tr><td align="center" style="padding:16px 22px 4px;"><a href="${esc(consoleUrl)}" style="display:inline-block;background:#FFC93C;color:#0B3D91;font-weight:700;font-size:16px;text-decoration:none;padding:13px 26px;border-radius:8px;">Open my Host console</a><div style="font-size:12px;color:#666;margin-top:6px;">${esc(once)}</div></td></tr>` : ""}
<tr><td style="padding:14px 22px 6px;"><div style="font-size:12px;font-weight:700;letter-spacing:.06em;color:#8A5A00;margin-bottom:6px;">HOST AI LINK FOR THIS GAME (WORKS 24 HOURS)</div><div style="background:#FBF6EC;border:2px dashed #FFC93C;border-radius:8px;padding:14px;font-family:Consolas,'Courier New',monospace;font-size:13px;line-height:1.5;color:#111;overflow-wrap:anywhere;text-decoration:none;">${esc(aiUrl)}</div></td></tr>
<tr><td style="padding:12px 22px 6px;font-size:13px;color:#666;line-height:1.5;">These links are only for you. Do not forward them or share them.</td></tr>${warn.replace("16px 22px 0", "8px 22px 20px")}`, origin);
  return { subject, text, html };
}

/** A plain alert, no link and no key in it: an AI link was used from somewhere new. */
export function newUseAlertMail(info: { when: string; country: string; program: string; kind: "AI" | "Host"; origin?: string }): BuiltMail {
  const text = [
    `Someone new used your ${info.kind} work link`, "",
    `When: ${info.when}`, `Country: ${info.country || "unknown"}`, `Program: ${info.program || "unknown"}`, "",
    "Not you? Press \"Replace my AI link\" in your console.", "", footerText(info.origin), "",
  ].join("\n");
  const html = pageHtml("Someone new used your " + info.kind + " work link", `<tr><td style="padding:20px 22px 8px;"><h1 style="font-size:22px;color:#0B3D91;margin:0 0 8px;">Someone new used your ${esc(info.kind)} work link</h1><p style="font-size:15px;line-height:1.5;margin:0 0 12px;">When: ${esc(info.when)}<br>Country: ${esc(info.country || "unknown")}<br>Program: ${esc(info.program || "unknown")}</p><p style="font-size:15px;line-height:1.5;margin:0;">Not you? Press <b>Replace my AI link</b> in your console.</p></td></tr>`, info.origin);
  return { subject: `Someone new used your ${info.kind} work link`, text, html };
}

export const SIGNIN_SUBJECT = "Your Corporate Tic Tac Toe sign-in: a 6-digit code, or one tap";
/** The sign-in e-mail, for an Organizer and for a Host alike: exactly two ways in. Option 1 types the 6-digit code on the sign-in page; Option 2 taps the one button in this e-mail
 *  (single use, 10 minutes). Nothing else: no AI link, no extra choices (people were confused by "sign-in link" and three options). */
export function signInMail(origin: string, code: string, token: string, linkOverride?: string): BuiltMail {
  const link = linkOverride ?? `${origin}/signin.html?t=${token}&go=console`;
  const foot = "If you did not ask for this, ignore this e-mail. Do not forward it: it opens your account.";
  const text = [
    "SIGN IN TO YOUR ACCOUNT", "", "Do ONE of these two things. You do not need both.", "",
    "OPTION 1 - TYPE THE 6-DIGIT CODE", "Go back to the sign-in page, type these 6 numbers in the six boxes and press Submit:", code, "It works for 10 minutes.", "",
    "OPTION 2 - TAP THE BUTTON", "Tap this link. You are signed in at once:", link, "It works once, for 10 minutes.", "",
    foot, "", footerText(origin), "",
  ].join("\n");
  const card = (n: string, title: string, body: string) => `<tr><td style="padding:12px 22px 0;"><div style="border:1px solid #E6D9B8;border-radius:10px;background:#FBF6EC;padding:14px 16px;"><div style="font-size:12px;font-weight:700;letter-spacing:.06em;color:#8A5A00;">OPTION ${n}</div><div style="font-size:18px;font-weight:700;color:#0B3D91;margin:3px 0 6px;">${esc(title)}</div>${body}</div></td></tr>`;
  const btn = (label: string, url: string) => `<a href="${esc(url)}" style="display:inline-block;background:#E0B872;color:#0B3D91;font-weight:700;font-size:16px;text-decoration:none;padding:12px 22px;border-radius:8px;">${esc(label)}</a>`;
  const html = pageHtml("Sign in to " + BRAND.name, `<tr><td style="padding:20px 22px 4px;"><h1 style="margin:0;font-size:26px;line-height:1.25;color:#0B3D91;">Sign in to Corporate Tic Tac Toe</h1><p style="margin:10px 0 0;font-size:15px;line-height:1.5;">Do <b>one</b> of these two things. You do not need both.</p></td></tr>
${card("1", "Type the 6-digit code", `<p style="margin:0 0 8px;font-size:14px;line-height:1.5;">Go back to the sign-in page, type these 6 numbers in the six boxes and press <b>Submit</b>:</p><div style="font-family:Consolas,'Courier New',monospace;font-size:30px;letter-spacing:.3em;font-weight:700;color:#0B3D91;background:#fff;border:2px dashed #E0B872;border-radius:8px;padding:8px 14px;display:inline-block;">${esc(code)}</div><p style="margin:8px 0 0;font-size:13px;color:#555;">It works for 10 minutes.</p>`)}
${card("2", "Tap the button", `<p style="margin:0 0 12px;font-size:14px;line-height:1.5;">Tap the button below. You are signed in at once.</p>${btn("Sign me in", link)}<p style="margin:8px 0 0;font-size:13px;color:#555;">It works once, for 10 minutes.</p>`)}
<tr><td style="padding:14px 22px 20px;"><div style="background:#fdecea;border:1px solid #c0392b;border-radius:8px;padding:10px 12px;color:#b71c1c;font-weight:700;font-size:13px;text-align:center;">${esc(foot)}</div></td></tr>`, origin);
  return { subject: SIGNIN_SUBJECT, text, html };
}
