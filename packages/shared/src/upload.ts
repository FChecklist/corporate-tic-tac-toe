import { normalize } from "./phone";

export interface UploadItem { ln: string; name: string; e164: string }
export interface UploadCheck {
  ready: UploadItem[];
  fixed: UploadItem[];
  repeats: { ln: string; reason: string }[];
  bad: { ln: string; reason: string }[];
}

/** Pick the cell with the most digits as the number; the rest is the name. */
export function splitLine(line: string): { num: string; name: string } {
  const cells = line.split(/[,\t;|]/).map((x) => x.trim()).filter(Boolean);
  let best = -1, bd = 0;
  cells.forEach((c, i) => { const n = (c.match(/\d/g) ?? []).length; if (n > bd) { bd = n; best = i; } });
  if (best < 0) return { num: "", name: cells.join(" ") };
  return { num: cells[best]!, name: cells.filter((c, i) => i !== best && !/\d{4,}/.test(c)).join(" ") };
}

/** Check pasted/CSV text: no saving. `exists` says whether a number is already in the engagement. */
export function checkUpload(text: string, country: string, exists: (e164: string) => boolean): UploadCheck {
  const out: UploadCheck = { ready: [], fixed: [], repeats: [], bad: [] };
  const seen = new Set<string>();
  const lines = String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  lines.forEach((ln, i) => {
    if (i === 0 && !/\d/.test(ln)) return; // header row
    const { num, name } = splitLine(ln);
    if (!num) { out.bad.push({ ln, reason: "No number found" }); return; }
    const r = normalize(num, country);
    if (!r.ok) { out.bad.push({ ln, reason: r.reason }); return; }
    if (seen.has(r.e164)) { out.repeats.push({ ln, reason: "Repeated in your list" }); return; }
    if (exists(r.e164)) { out.repeats.push({ ln, reason: "Already in this engagement" }); return; }
    seen.add(r.e164);
    (r.changed ? out.fixed : out.ready).push({ ln, name, e164: r.e164 });
  });
  return out;
}
