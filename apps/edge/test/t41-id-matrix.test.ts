// TEST AUTHOR, fix pass 1.4.1. THE ID MATRIX: over a million DISTINCT typed inputs are streamed (never held as a list of results) through every ID cleaner and compared with the separate
// oracle in t41-id-oracle.ts. The exact count of distinct inputs is counted by a Set and printed. Fake data only.
import { describe, expect, test } from "bun:test";
import { EMP_CLEAN_FROM_MS, cleanAccountEmail, cleanEmail, cleanEmpId, empHint, normEmpFor } from "../src/ids";
import { normId } from "../src/people";
import { VOCAB, answers, oracleAccount, oracleEmp, oracleEmpOld, oracleMailId, type Tok } from "./t41-id-oracle";
import { world, T_NEW, dev, j } from "./t30-kit";

/** every sequence of 0 to 3 tokens, then seeded random sequences of 4 to 8 tokens until `want` distinct inputs have been produced */
function* inputs(want: number): Generator<{ raw: string; toks: Tok[] }> {
  const seen = new Set<string>(); const n = VOCAB.length;
  const emit = (toks: Tok[]) => { const raw = toks.map((x) => x.s).join(""); if (seen.has(raw)) return null; seen.add(raw); return { raw, toks }; };
  let r = emit([]); if (r) yield r;
  for (let a = 0; a < n; a++) { r = emit([VOCAB[a]!]); if (r) yield r; }
  for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) { r = emit([VOCAB[a]!, VOCAB[b]!]); if (r) yield r; }
  for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) for (let c = 0; c < n; c++) { r = emit([VOCAB[a]!, VOCAB[b]!, VOCAB[c]!]); if (r) yield r; }
  let x = 123456789; const next = () => { x = (Math.imul(x, 1103515245) + 12345) >>> 0; return x; };
  while (seen.size < want) { const len = 4 + (next() % 5); const toks: Tok[] = []; for (let i = 0; i < len; i++) toks.push(VOCAB[next() % n]!); r = emit(toks); if (r) yield r; }
  (inputs as any).distinct = seen.size;
}

describe("the Email ID / employee ID cleaning matrix", () => {
  test("the oracle itself: a few answers worked out by hand", () => {
    const by = (s: string) => VOCAB.find((x) => x.s === s)!;
    expect(answers([by("Ａ"), by("１"), by("ß")]).emp).toBe("A1SS"); expect(answers([by("ﬁ"), by("Ⅷ")]).mail).toBe("fiviii");
    expect(oracleEmp([by("a"), by("-"), by("7")])).toBe("A7"); expect(oracleEmp([by("a"), by("@")])).toBeNull(); expect(oracleEmp([by(" "), by("\t")])).toBe(""); expect(oracleEmp([by("​")])).toBeNull(); expect(oracleEmp([by("A".repeat(30))])).toBe("A".repeat(30)); expect(oracleEmp([by("A".repeat(30)), by("a")])).toBeNull();
    expect(oracleMailId([by("bob@x.io")])).toBe("bob@x.io"); expect(oracleMailId([by("a"), by("@"), by("B")])).toBeNull(); expect(oracleMailId([by("dev@"), by("mail."), by("co")])).toBe("dev@mail.co"); expect(oracleMailId([by("c".repeat(64)), by("@"), by("a"), by("."), by("co")])).toBe("c".repeat(64) + "@a.co"); expect(oracleMailId([by("d".repeat(65)), by("@"), by("a"), by("."), by("co")])).toBeNull();
    expect(oracleAccount("  Demo 1＠Xyz.In\t")).toBe("demo 1＠xyz.in"); expect(oracleEmpOld(" 1b-678 ")).toBe("1B-678"); expect(oracleEmpOld("1b*678")).toBeNull(); expect(oracleEmpOld("-1")).toBeNull();
  });

  test("at least 1,000,000 distinct inputs: every cleaner agrees with the oracle", () => {
    const WANT = 1_300_000, bad: string[] = []; let n = 0, accepted = { emp: 0, mail: 0, empOld: 0 }, refused = { emp: 0, mail: 0 }; const NEW = EMP_CLEAN_FROM_MS + 1, OLD = EMP_CLEAN_FROM_MS - 1;
    const note = (rule: string, raw: string, got: unknown, want: unknown) => { if (bad.length < 25) bad.push(`${rule}: ${JSON.stringify(raw.length > 70 ? raw.slice(0, 70) + "..." : raw)} -> ${JSON.stringify(got)} (oracle ${JSON.stringify(want)})`); };
    for (const { raw, toks } of inputs(WANT)) {
      n++; const a = answers(toks);
      const e = cleanEmpId(raw); if (e !== a.emp) note("cleanEmpId", raw, e, a.emp);
      const h = empHint(raw); if (h !== (a.emp ? "The system will read this as " + a.emp : "")) note("empHint", raw, h, a.emp);
      const m = cleanEmail(raw); if (m !== a.mail) note("cleanEmail", raw, m, a.mail);
      const wantEmp = oracleEmp(toks), gotEmp = normEmpFor(raw, NEW); if (gotEmp !== wantEmp) note("normEmpFor new", raw, gotEmp, wantEmp);
      const gotEmp2 = normId(raw, "emp", NEW); if (gotEmp2 !== wantEmp) note("normId emp new", raw, gotEmp2, wantEmp);
      const wantMail = oracleMailId(toks), gotMail = normId(raw, "email"); if (gotMail !== wantMail) note("normId email", raw, gotMail, wantMail);
      const wantOld = oracleEmpOld(raw), gotOld = normEmpFor(raw, OLD); if (gotOld !== wantOld) note("normEmpFor old", raw, gotOld, wantOld);
      const acc = cleanAccountEmail(raw); if (acc !== oracleAccount(raw)) note("cleanAccountEmail", raw, acc, oracleAccount(raw));
      if (wantEmp) accepted.emp++; else if (wantEmp === null) refused.emp++; if (wantMail) accepted.mail++; else if (wantMail === null) refused.mail++; if (wantOld) accepted.empOld++;
      if (bad.length >= 25) break;
    }
    const distinct = (inputs as any).distinct as number | undefined;
    console.log(`ID MATRIX: ${n} distinct inputs checked against 8 rules (${n * 8} checks); employee ID new rule accepted ${accepted.emp}, refused ${refused.emp}; Email ID accepted ${accepted.mail}, refused ${refused.mail}; old rule accepted ${accepted.empOld}; vocabulary ${VOCAB.length} tokens; generator reported ${distinct}`);
    expect(bad).toEqual([]); expect(n).toBeGreaterThanOrEqual(1_000_000); expect(distinct).toBe(n);
    expect(accepted.emp).toBeGreaterThan(50_000); expect(accepted.mail).toBeGreaterThan(1_000); expect(refused.emp).toBeGreaterThan(50_000); expect(refused.mail).toBeGreaterThan(50_000); // the matrix really exercises both outcomes
  }, 280_000);

  test("the same oracle through the real join (a sample of 150 inputs per kind): accepted -> waits (403 waiting), nothing typed -> need-id, refused -> bad-id", async () => {
    const W = world(T_NEW); try {
      const by = (x: string) => VOCAB.find((v) => v.s === x)!, pick: { raw: string; toks: Tok[] }[] = []; let k = 0;
      for (const seq of [["dev@", "mail.", "co"], ["bob@x.io"], ["\uFF21", "\uFF42", "@corp.in"], ["dev@", "\u200B", "mail.", "co"], ["bob@x.io", " "], ["sam", " ", "@corp.in"], ["dev@", "mail.", "\u00AD", "co"], ["a", "\uFF20", "B", ".", "co"], ["0", "-", "7"], ["Q1"], ["\uFF11", "\uFF11", "\u00DF"], ["sam", "-", "9"], [" "], [" ", "\t"], ["\u200B"], ["A".repeat(30)], ["a".repeat(31)], ["c".repeat(64), "@", "a", ".", "co"], ["d".repeat(65), "@", "a", ".", "co"]]) pick.push({ raw: seq.join(""), toks: seq.map(by) });
      for (const x of inputs(20000)) { if (k++ % 137 === 0) pick.push(x); if (pick.length >= 150) break; }
      for (const kind of ["emp", "email"] as const) {
        const id = kind === "emp" ? "M41-E" : "M41-M"; await W.game(id, { who: "list", verify: "id", n: kind === "emp" ? 1 : 2, settings: kind === "email" ? { idKind: "email" } : {} });
        let i = 0, bads = 0, waits = 0; const wrong: string[] = [];
        for (const { raw, toks } of pick) {
          const want = kind === "emp" ? oracleEmp(toks) : oracleMailId(toks);
          i++; const r = await W.call("POST", `/api/z/${id}/join`, { name: "Pat Demo", empId: raw, device: dev(i + (kind === "emp" ? 0 : 400)) }, undefined, W.now, `11.${kind === "emp" ? 1 : 2}.${i >> 8}.${i & 255}`); const b = await j(r); // a new network address each time: the per-address try limit is not what is tested here
          const got = r.status === 403 && b.code === "waiting" ? "ok" : r.status === 400 && b.code === "bad-id" ? "bad" : r.status === 400 && b.code === "need-id" ? "none" : `${r.status}/${b.code}`;
          const exp = want === null ? "bad" : want === "" ? "none" : "ok"; if (got !== exp && wrong.length < 10) wrong.push(`${kind}: ${JSON.stringify(raw.slice(0, 40))} got ${got} want ${exp}`);
          if (exp === "ok") waits++; if (exp === "bad") bads++;
        }
        expect(wrong).toEqual([]); expect(waits).toBeGreaterThan(5); expect(bads).toBeGreaterThan(5);
      }
    } finally { W.restore(); }
  }, 120_000);
});
