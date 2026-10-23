// Finds every place the browser scripts keep something on the person's device: localStorage, sessionStorage and cookies.
// Used by storage-notice.test.ts (R9) to prove that the "what your device keeps" sentence on the Privacy page lists exactly what the code does.
//   bun apps/web/test/storage-scan.ts     prints what the scripts use now (to start or update apps/web/storage-registry.json)
// How a key is written down: a plain name stays as it is ("cb-theme"); a name built from pieces keeps its fixed pieces and shows each changing piece as * ("cbz:*:brand");
// a key held in a constant or built by a small helper is followed back to where it is built. A call whose key cannot be followed is written as "?<the code>" so it can never go unnoticed.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const PUB = join(import.meta.dir, "../public");
export interface Use { file: string; store: "localStorage" | "sessionStorage"; key: string }
export interface Cookie { file: string; name: string; maxAge: string }

const CALL = /(?:\b(localStorage|sessionStorage)\s*\.\s*(?:getItem|setItem|removeItem)|\b(ls|ss|store|storage|CTK)\s*\.\s*(?:get|set|del|remove))\s*\(|(?<![\w$.])(ls|ss)\s*\(/g;

function argAt(src: string, from: number): string {
  let depth = 0, j = from;
  for (; j < src.length; j++) {
    const c = src[j]!;
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") { if (depth === 0) break; depth--; }
    else if (c === "," && depth === 0) break;
    else if (c === '"' || c === "'" || c === "`") { const q = c; j++; while (j < src.length && src[j] !== q) { if (src[j] === "\\") j++; j++; } }
  }
  return src.slice(from, j).trim();
}
const lit = /^(["'])((?:(?!\1).)*)\1$/s;

/** Writes an expression as a key: fixed pieces as they are, every changing piece as *. Follows constants and small helpers inside the same file. */
function norm(expr: string, src: string, depth = 0): string {
  const e = expr.trim();
  let m = lit.exec(e);
  if (m) return m[2]!;
  if (e.startsWith("`") && e.endsWith("`")) return e.slice(1, -1).replace(/\$\{[^}]*\}/g, "*").replace(/\*+/g, "*");
  if (/^\(?.*\)?$/.test(e) && e.includes("+")) {
    const parts: string[] = []; let d = 0, cur = "";
    for (const c of e) { if (c === "(" || c === "[") d++; if (c === ")" || c === "]") d--; if (c === "+" && d === 0) { parts.push(cur); cur = ""; } else cur += c; }
    parts.push(cur);
    return parts.map((p) => { const q = p.trim(); return lit.test(q) ? lit.exec(q)![2]! : "*"; }).join("").replace(/\*+/g, "*");
  }
  if (depth > 3) return "?" + e;
  m = /^([A-Za-z_$][\w$]*)$/.exec(e);
  if (m) { // a constant
    const def = new RegExp("(?:const|let|var)\\s+" + m[1]!.replace(/\$/g, "\\$") + "\\s*=\\s*([^;\\n]+?)\\s*(?:;|$)", "m").exec(src);
    if (def && !def[1]!.startsWith("(") && !def[1]!.includes("=>")) return norm(def[1]!, src, depth + 1);
    return "?" + e;
  }
  m = /^((?:this\.)?[A-Za-z_$][\w$]*)\s*\(([^()]*)\)$/.exec(e);
  if (m) { // a small helper: name(args) built somewhere as  name = (p) => `...`  or  function name(p) { return ... }
    const name = m[1]!.replace(/^this\./, "").replace(/\$/g, "\\$"); const args = m[2]!.split(",").map((s) => s.trim());
    const arrow = new RegExp("\\b" + name + "\\s*=\\s*\\(?([\\w$, ]*)\\)?\\s*=>\\s*([^;\\n]+?)\\s*(?:;|\\n|$)").exec(src);
    const fn = new RegExp("function\\s+" + name + "\\s*\\(([\\w$, ]*)\\)\\s*\\{\\s*return\\s+([^;]+);").exec(src);
    const d = arrow ?? fn;
    if (d) {
      const params = d[1]!.split(",").map((s) => s.trim()).filter(Boolean); let body = d[2]!;
      params.forEach((p, i) => { const a = args[i]; if (a && lit.test(a)) body = body.replace(new RegExp("\\$\\{" + p.replace(/\$/g, "\\$") + "\\}", "g"), lit.exec(a)![2]!).replace(new RegExp("\\b" + p.replace(/\$/g, "\\$") + "\\b", "g"), JSON.stringify(lit.exec(a)![2]!)); });
      return norm(body, src, depth + 1);
    }
  }
  return "?" + e;
}

/** The storage uses and cookies of ONE script's text (also used by the test to show that a new key would be noticed). */
export function scanText(file: string, src: string, uses: Use[] = [], cookies: Cookie[] = []): { uses: Use[]; cookies: Cookie[] } {
  let m: RegExpExecArray | null; CALL.lastIndex = 0;
  while ((m = CALL.exec(src))) {
    const arg = argAt(src, m.index + m[0].length);
    if (!arg || /^[a-z]$/.test(arg) || arg === "key" || arg === "name") continue; // the inside of a small storage helper: the key it is given is what counts, at the call
    const direct = m[1] as Use["store"] | undefined;
    const store: Use["store"] = direct ?? ((m[2] ?? m[3]) === "ss" ? "sessionStorage" : "localStorage");
    const key = norm(arg, src);
    if (!uses.some((u) => u.file === file && u.store === store && u.key === key)) uses.push({ file, store, key });
  }
  for (const c of src.matchAll(/(?:doc|document)\.cookie\s*=\s*([^;\n]{0,200})/g)) {
    const name = /["'`]([A-Za-z0-9_]+)=/.exec(c[1]!)?.[1] ?? "?" + c[1]!.slice(0, 30);
    const age = /Max-Age=(\d+)/i.exec(c[1]!)?.[1] ?? /Max-Age=(\d+)/i.exec(src.slice(c.index!, c.index! + 260))?.[1] ?? "";
    if (!cookies.some((x) => x.file === file && x.name === name)) cookies.push({ file, name, maxAge: age });
  }
  return { uses, cookies };
}

/** The pages and scripts the build really ships (pages/build.mjs FILES): a prototype page that is never uploaded keeps nothing on anybody's device. */
export function shippedFiles(): string[] {
  const all = readdirSync(PUB).filter((f) => /\.(js|html)$/.test(f)).sort();
  try {
    const m = /const FILES = \[([\s\S]*?)\];/.exec(readFileSync(join(PUB, "../../../pages/build.mjs"), "utf8"));
    const list = m ? [...m[1]!.matchAll(/"([^"]+)"/g)].map((x) => x[1]!) : [];
    return list.length ? all.filter((f) => list.includes(f)) : all;
  } catch { return all; }
}

export function scan(): { uses: Use[]; cookies: Cookie[] } {
  const uses: Use[] = [], cookies: Cookie[] = [];
  for (const file of shippedFiles()) scanText(file, readFileSync(join(PUB, file), "utf8"), uses, cookies);
  return { uses, cookies };
}

if (import.meta.main) {
  const { uses, cookies } = scan();
  for (const u of uses) console.log(`${u.file.padEnd(16)} ${u.store.padEnd(15)} ${u.key}`);
  for (const c of cookies) console.log(`${c.file.padEnd(16)} cookie          ${c.name}  max-age ${c.maxAge || "session"}`);
}
