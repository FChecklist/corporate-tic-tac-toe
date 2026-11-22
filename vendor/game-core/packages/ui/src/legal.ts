// The shared page renderer for Privacy, Terms, storage notice and grievance, and for a game's rules. The words come from packages/wording (one common text);
// only the rules of a game differ between games, and they come from the game's rules book. A site never keeps its own copy of the common text.
import { LEGAL, DOCUMENT, DOC_TITLES, NOTICE_LINKS, NOTICE_TEXT, TERMS_VERSION, TERMS_DATE, type LegalKind } from "../../wording/src";
const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
/** One section of the common text, e.g. renderLegal("privacy"). With no kind: all of them, in order. */
export function renderLegal(kind?: LegalKind): string {
  return LEGAL.filter((s) => !kind || s.id === kind)
    .map((s) => `<section class="legal" id="${s.id}"><h2>${esc(s.title)}</h2>${s.paragraphs.map((p) => `<p>${esc(p)}</p>`).join("")}</section>`).join("");
}
/** A game's rules page from its rules book (plain markdown: "# title", "## heading", numbered or dashed lines, paragraphs). The rules are the only text that differs between games. */
export function renderRules(markdown: string): string {
  const out: string[] = []; let list: string[] = [];
  const flush = (): void => { if (list.length) { out.push(`<ol class="rules">${list.join("")}</ol>`); list = []; } };
  const inline = (s: string): string => esc(s).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
  for (const raw of markdown.split("\n")) {
    const l = raw.trim(), h = /^(#{1,3})\s+(.*)$/.exec(l), n = /^(?:\d+[a-z]?\.|-)\s+(.*)$/.exec(l);
    if (h) { flush(); out.push(`<h${h[1]!.length + 1}>${inline(h[2]!)}</h${h[1]!.length + 1}>`); }
    else if (n) list.push(`<li>${inline(n[1]!)}</li>`);
    else if (l) { flush(); out.push(`<p>${inline(l)}</p>`); }
  }
  flush();
  return `<article class="rules-page">${out.join("")}</article>`;
}
/** THE document (published once at DOC_URL): title, version and date at the top, a short contents list with anchors, numbered headings. Print-friendly; styles in document.css. */
const tbl = (t: string[][]): string => `<table class="retention"><thead><tr>${t[0]!.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${t.slice(1).map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
export function renderDocument(): string {
  const toc = DOCUMENT.map((s, i) => `<li><a href="#${s.id}">${i + 1}. ${esc(s.title)}</a><ol>${s.subs.map((u, j) => `<li><a href="#${s.id}-${u.id}">${i + 1}.${j + 1} ${esc(u.heading)}</a></li>`).join("")}</ol></li>`).join("");
  const body = DOCUMENT.map((s, i) => `<section id="${s.id}"><h2>${i + 1}. ${esc(s.title)}</h2>${s.subs.map((u, j) => `<section id="${s.id}-${u.id}"><h3>${i + 1}.${j + 1} ${esc(u.heading)}</h3>${u.paragraphs.map((p) => `<p>${esc(p)}</p>`).join("")}${u.table ? tbl(u.table) : ""}</section>`).join("")}</section>`).join("");
  return `<article class="legal-doc" data-version="${TERMS_VERSION}"><h1>Terms, Policies and Game Rules</h1><p class="version">Version ${TERMS_VERSION}, ${esc(TERMS_DATE)}</p><nav class="toc" aria-label="Contents"><ol>${toc}</ol></nav>${body}</article>`;
}
/** The gentle notice BELOW the action button, very small: "By continuing, you agree to the Terms and Conditions, Privacy and Data, and Game rules." with three links. No input, no box, nothing that blocks. */
export function renderNotice(): string {
  const [a, b, c] = NOTICE_LINKS.map((l) => `<a href="${esc(l.href)}">${esc(l.label)}</a>`);
  return `<p class="legal-notice" data-text="${esc(NOTICE_TEXT)}">By continuing, you agree to the ${a}, ${b}, and ${c}.</p>`;
}
