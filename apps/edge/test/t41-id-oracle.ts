// TEST AUTHOR, fix pass 1.4.1. The ORACLE for the Email ID / employee ID cleaning matrix. Written by hand from the owner's rules, NOT from ids.ts or people.ts:
// every token below carries the answer a person would expect, worked out from the Unicode chart, so the product is never asked what the right answer is.
// Owner rules: employee ID = NFKC, upper case, keep only A-Z and 0-9, 1 to 30 left, never an e-mail ("@" after NFKC is refused). Email ID = NFKC, no inner spaces or zero-width marks, lower case.
// Cleaning works one character at a time, so the answer for a whole input is the answers of its tokens put side by side (no token joins with its neighbour: there are no combining marks).
export type Tok = { s: string; emp: string; mail: string; at?: true; ws?: true };
const t = (s: string, emp: string, mail: string, f: { at?: true; ws?: true } = {}): Tok => ({ s, emp, mail, ...f });
const AT = { at: true } as const, WS = { ws: true } as const;
export const VOCAB: Tok[] = [
  // ASCII letters and digits
  t("a", "A", "a"), t("B", "B", "b"), t("z", "Z", "z"), t("Q", "Q", "q"), t("0", "0", "0"), t("7", "7", "7"), t("9", "9", "9"), t("Q1", "Q1", "q1"), t("sam", "SAM", "sam"), t("x9", "X9", "x9"),
  // dashes, slashes, dots and the other symbols (an employee ID drops them all; an Email ID keeps them except what NFKC turns into something else)
  t("-", "", "-"), t("–", "", "–"), t("—", "", "—"), t("‐", "", "‐"), t("－", "", "-"), t("/", "", "/"), t(".", "", "."), t("_", "", "_"), t("#", "", "#"), t("+", "", "+"), t("＋", "", "+"), t("．", "", "."), t("(", "", "("), t("*", "", "*"), t("\\", "", "\\"), t("~", "", "~"), t("!", "", "!"), t(":", "", ":"), t(",", "", ","), t("%", "", "%"),
  // at-signs: plain, full-width, small
  t("@", "", "@", AT), t("＠", "", "@", AT), t("﹫", "", "@", AT),
  // full-width letters and digits
  t("Ａ", "A", "a"), t("ｂ", "B", "b"), t("１", "1", "1"), t("０", "0", "0"), t("９", "9", "9"),
  // sharp s: NFKC leaves it, upper case makes SS; the capital sharp s has no A-Z upper case
  t("ß", "SS", "ß"), t("ẞ", "", "ß"),
  // Devanagari digits (not 0-9)
  t("१", "", "१"), t("२", "", "२"), t("०", "", "०"),
  // compatibility letters and numbers that NFKC turns into plain ones
  t("ﬁ", "FI", "fi"), t("ﬀ", "FF", "ff"), t("ℌ", "H", "h"), t("Ⅷ", "VIII", "viii"), t("²", "2", "2"), t("①", "1", "1"), t("K", "K", "k"), t("ſ", "S", "s"), t("ǅ", "D", "dž"), t("Ω", "", "ω"),
  // Turkish i, accents, other scripts
  t("ı", "I", "ı"), t("İ", "", "i̇"), t("é", "", "é"), t("ü", "", "ü"), t("а", "", "а"), t("Ω", "", "ω"), t("日", "", "日"), t("अ", "", "अ"),
  // emoji (an Email ID keeps them, an employee ID drops them)
  t("\u{1F600}", "", "\u{1F600}"), t("\u{1F468}‍\u{1F469}", "", "\u{1F468}\u{1F469}"),
  // inner spaces of every kind (all removed from both; JS treats these as white space when trimming)
  t(" ", "", "", WS), t("\t", "", "", WS), t("\n", "", "", WS), t("\r", "", "", WS), t(" ", "", "", WS), t("　", "", "", WS), t(" ", "", "", WS), t(" ", "", "", WS), t(" ", "", "", WS),
  // zero-width marks (removed from both; only the byte-order mark is white space for trimming) and the soft hyphen (an Email ID keeps it)
  t("​", "", ""), t("‌", "", ""), t("‍", "", ""), t("⁠", "", ""), t("﻿", "", "", WS), t("­", "", "­"),
  // pieces that make real-looking addresses
  t("dev@", "DEV", "dev@", AT), t("@corp.in", "CORPIN", "@corp.in", AT), t("bob@x.io", "BOBXIO", "bob@x.io", AT), t(".com", "COM", ".com"), t("co", "CO", "co"), t("mail.", "MAIL", "mail."),
  // very long runs (lengths on both sides of 30, 64, 254)
  t("A".repeat(29), "A".repeat(29), "a".repeat(29)), t("A".repeat(30), "A".repeat(30), "a".repeat(30)), t("a".repeat(31), "A".repeat(31), "a".repeat(31)), t("9".repeat(60), "9".repeat(60), "9".repeat(60)),
  t("c".repeat(64), "C".repeat(64), "c".repeat(64)), t("d".repeat(65), "D".repeat(65), "d".repeat(65)), t("b".repeat(250), "B".repeat(250), "b".repeat(250)), t("e".repeat(255), "E".repeat(255), "e".repeat(255)),
];

/** white space as String.trim() sees it (written out, not asked from the engine) */
const JS_WS = new Set([0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0xa0, 0x1680, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff, ...Array.from({ length: 11 }, (_, i) => 0x2000 + i)]);
export const answers = (toks: Tok[]) => ({ emp: toks.map((x) => x.emp).join(""), mail: toks.map((x) => x.mail).join(""), hasAt: toks.some((x) => x.at), allWs: toks.every((x) => x.ws) });

/** Employee ID, NEW rule (game created at or after EMP_CLEAN_FROM_MS): "" = nothing typed, null = refused. */
export const oracleEmp = (toks: Tok[]): string | null => { const a = answers(toks); if (toks.length === 0 || a.allWs) return ""; if (a.hasAt) return null; return a.emp.length >= 1 && a.emp.length <= 30 ? a.emp : null; };

/** Email ID: "" = nothing typed, null = not a usable address. Shape by hand: one "@" at most once, local 1-64, a dot with 1-255 before it and 2+ after, no white space, 254 in all. */
export const oracleMailId = (toks: Tok[]): string | null => {
  const m = answers(toks).mail; if (m === "") return "";
  if (m.length > 254) return null;
  const at = m.indexOf("@"); if (at < 1 || at !== m.lastIndexOf("@") || at > 64) return null;
  const rest = m.slice(at + 1); for (let i = 0; i < m.length; i++) if (JS_WS.has(m.charCodeAt(i))) return null;
  for (let dot = 1; dot < rest.length; dot++) { if (rest[dot] !== "." || dot > 255) continue; if (rest.length - dot - 1 >= 2) return m; }
  return null;
};

/** Employee ID, OLD rule (game created before EMP_CLEAN_FROM_MS): white space dropped, upper case, then A-Z 0-9 first and A-Z 0-9 . _ - / after, 1 to 30. */
export const oracleEmpOld = (raw: string): string | null => {
  let s = ""; for (const ch of raw) if (!(JS_WS.has(ch.codePointAt(0)!) || ch === " " || /[ -  ]/.test(ch))) s += ch; s = s.toUpperCase();
  if (s === "") return ""; if (s.length > 30) return null;
  const alnum = (c: number) => (c >= 48 && c <= 57) || (c >= 65 && c <= 90);
  if (!alnum(s.charCodeAt(0))) return null;
  for (let i = 1; i < s.length; i++) { const c = s.charCodeAt(i); if (!(alnum(c) || c === 46 || c === 95 || c === 45 || c === 47)) return null; }
  return s;
};

/** An ACCOUNT e-mail: only the outer white space goes and the letters are lower case. Nothing inside changes. */
export const oracleAccount = (raw: string): string => { let a = 0, b = raw.length; while (a < b && JS_WS.has(raw.charCodeAt(a))) a++; while (b > a && JS_WS.has(raw.charCodeAt(b - 1))) b--; return raw.slice(a, b).toLowerCase(); };
