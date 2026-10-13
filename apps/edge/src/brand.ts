// One definition of how Corporate Tic Tac Toe presents itself in every e-mail: the same header (logo mark + wordmark) and the same footer (name, support address, legal link).
// Every e-mail the service sends goes through sendMail / sendReportMail (pay.ts), which adds this footer and wraps plain mails in this header, so a mail without the brand cannot go out.
// The name is always exactly "Corporate Tic Tac Toe". The palette is the site's (wine, gold, ivory).

/** The version of the Terms in force (the date at the top of /terms.html). Stored with the organizer when they continue. */
export const TERMS_VERSION = "2026-10-13"; // the one version of the Terms: terms.html, the consent boxes and the tests all read this value

export const BRAND = {
  name: "Corporate Tic Tac Toe",
  tagline: "Live games for companies",
  support: "rajatsiroffice@gmail.com", // the contact address the site's legal page publishes
  legalPath: "/legal.html",
  defaultOrigin: "https://corporate-tic-tac-toe.pages.dev",
  wine: "#0B5D5B", gold: "#FFC93C", gold2: "#FFE08A", ivory: "#F7FBFA", line: "#D5E3E1",
} as const;

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const base = (origin?: string) => (origin || BRAND.defaultOrigin).replace(/\/+$/, "");

/** Plain-text footer, identical in every e-mail. */
export const footerText = (origin?: string) => `--\n${BRAND.name}\nQuestions? Write to ${BRAND.support}\nRules, privacy and disclaimer: ${base(origin)}${BRAND.legalPath}`;
/** True when a text already ends with the brand footer. */
export const hasFooter = (text: string) => text.includes(`Write to ${BRAND.support}`) && text.includes(BRAND.legalPath);
export const withFooter = (text: string, origin?: string) => (hasFooter(text) ? text : `${text.replace(/\s+$/, "")}\n\n${footerText(origin)}\n`);

/** The header row of every HTML e-mail: the logo mark and the wordmark. `data-brand` lets tests find it. */
export function headerHtml(origin?: string): string {
  const o = base(origin);
  return `<tr data-brand="header"><td style="background:${BRAND.wine};border-radius:10px 10px 0 0;padding:14px 22px;"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td valign="middle" style="padding-right:10px;"><img src="${o}/icon-192.png" width="34" height="34" alt="" style="display:block;border-radius:8px;background:${BRAND.gold};"></td><td valign="middle" style="font-family:Georgia,'Times New Roman',serif;font-size:21px;font-weight:700;color:${BRAND.gold2};letter-spacing:.01em;">${BRAND.name}<span style="color:${BRAND.gold};">.</span></td></tr></table></td></tr>`;
}
/** The footer row of every HTML e-mail: name, support address, legal link. */
export function footerHtml(origin?: string): string {
  const o = base(origin);
  return `<tr data-brand="footer"><td style="border-top:1px solid ${BRAND.line};background:${BRAND.ivory};border-radius:0 0 10px 10px;padding:14px 22px;font-size:12px;line-height:1.6;color:#5C6F6D;"><b style="color:${BRAND.wine};">${BRAND.name}</b> &middot; ${BRAND.tagline}<br>Questions? Write to <a href="mailto:${BRAND.support}" style="color:${BRAND.wine};">${BRAND.support}</a><br><a href="${o}${BRAND.legalPath}" style="color:${BRAND.wine};">Rules, privacy and disclaimer</a></td></tr>`;
}

/** The full HTML page around some rows. */
export function pageHtml(title: string, rows: string, origin?: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head>
<body style="margin:0;background:#EEF5F4;font-family:Arial,Helvetica,sans-serif;color:#1c2433;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EEF5F4;"><tr><td align="center" style="padding:20px 10px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:10px;border:1px solid ${BRAND.line};">
${headerHtml(origin)}
${rows}
${footerHtml(origin)}
</table></td></tr></table></body></html>`;
}

/** A plain-text mail (reminders, "could not begin", invoice, report...) as branded HTML: paragraphs, web addresses made clickable. Never used for a mail that carries an AI link. */
export function plainToHtml(title: string, text: string, origin?: string): string {
  const link = (s: string) => esc(s).replace(/(https?:\/\/[^\s<]+)/g, (u) => `<a href="${u}" style="color:${BRAND.wine};font-weight:700;">${u}</a>`);
  const body = text.split(/\n{2,}/).map((p) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.55;">${link(p).replace(/\n/g, "<br>")}</p>`).join("");
  return pageHtml(title, `<tr><td style="padding:22px 22px 8px;">${body}</td></tr>`, origin);
}
