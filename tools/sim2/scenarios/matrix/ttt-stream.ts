// TEST AUTHOR 30 Oct 2026. Streamed scenario matrix for Corporate Tic Tac Toe: bun tools/sim2/scenarios/matrix/ttt-stream.ts [--tier pure|wire|bracket|all] [--limit N] [--out results/matrix]
// Nothing is stored: every scenario is DECODED from its number (mixed-radix, a bijection, so no two are equal) and asserted at once; memory stays flat.
// Tiers:  pure    = the real product functions called in-process (employee-ID and e-mail cleaners, verify config, link codes, payment mode, prices, theme-init.js) with an independent oracle written here.
//         wire    = the real Worker with an in-memory database: join and approval over HTTP (era, verify mode, access, ID typing, list, payment state, device, approver).
//         bracket = whole tournaments played to a champion (solo, teams of 3 and 5, every move clock).
// Only dimensions that can fail are counted: each one feeds an assertion of its own (listed in DIMENSIONS below and proven by planted breaks, tools/breakchecks/).
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanEmail, normEmpFor, EMP_CLEAN_FROM_MS } from "../../../../apps/edge/src/ids";
import { normMail } from "../../../../apps/edge/src/mode";
import { emailHashOf } from "../../../../apps/edge/src/hostsetup";
import { verifyOf, parseFrom, fromCodeOf, inviterOf, newToken, tokenHash } from "../../../../apps/edge/src/people";
import { payMode, freeLaunch } from "../../../../apps/edge/src/pay";
import { PACKS, price } from "../../../../packages/shared/src/pricing";

const args = process.argv.slice(2); const arg = (k: string, d: string) => { const i = args.indexOf("--" + k); return i >= 0 ? args[i + 1]! : d; };
const TIER = arg("tier", "all"), LIMIT = Number(arg("limit", "0")), OUT = arg("out", "results/matrix");
// --limit N takes the first N scenarios; with --sample it takes N scenarios spread over the WHOLE product (every k*7919-th, 7919 is prime and does not divide any radix, so no scenario repeats)
const SAMPLE = args.includes("--sample"); const at = (k: number, n: number) => (SAMPLE ? (k * 7919) % n : k);
const ROOT = join(import.meta.dir, "../../../..");

// ---------------------------------------------------------------- mixed radix
const decode = (i: number, radix: readonly number[]): number[] => { const d: number[] = []; for (const r of radix) { d.push(i % r); i = Math.floor(i / r); } return d; };
const encode = (d: readonly number[], radix: readonly number[]): number => { let n = 0, m = 1; for (let k = 0; k < radix.length; k++) { n += d[k]! * m; m *= radix[k]!; } return n; };
const total = (radix: readonly number[]) => radix.reduce((a, b) => a * b, 1);

// ---------------------------------------------------------------- results
interface Fail { tier: string; id: number; tuple: string; check: string; got: unknown; want: unknown }
const R = { tiers: {} as Record<string, { total: number; pass: number; fail: number; checks: number }>, fails: [] as Fail[], dims: {} as Record<string, number> };
const sink = (tier: string) => (R.tiers[tier] ??= { total: 0, pass: 0, fail: 0, checks: 0 });
function mk(tier: string, id: number, tuple: () => string) {
  let bad = 0; const t = sink(tier);
  return { eq(check: string, got: unknown, want: unknown) { t.checks++; const ok = typeof got === "object" || typeof want === "object" ? JSON.stringify(got) === JSON.stringify(want) : got === want; if (!ok) { bad++; if (R.fails.length < 200) R.fails.push({ tier, id, tuple: tuple(), check, got, want }); } },
    done() { t.total++; if (bad) t.fail++; else t.pass++; } };
}

// ================================================================ TIER 1: pure
// -- dimension: employee-ID typing. Each format knows what a NEW game and an OLD game must make of it, built from the base ID by construction (not by calling the product).
const BASES = ["1B678", "E101"];
const fw = (s: string) => [...s].map((c) => (c >= "0" && c <= "9") || (c >= "A" && c <= "Z") ? String.fromCodePoint(c.charCodeAt(0) + 0xFEE0) : c).join("");
interface Fmt { name: string; typed: (B: string) => string; nw: (B: string) => string | null; old: (B: string) => string | null }
const ins = (B: string, mid: string) => B.slice(0, 2) + mid + B.slice(2);
const F: Fmt[] = [
  { name: "plain", typed: (B) => B, nw: (B) => B, old: (B) => B },
  { name: "lowercase", typed: (B) => B.toLowerCase(), nw: (B) => B, old: (B) => B },
  { name: "mixed case", typed: (B) => [...B].map((c, i) => i % 2 ? c.toLowerCase() : c).join(""), nw: (B) => B, old: (B) => B },
  { name: "dash", typed: (B) => ins(B, "-"), nw: (B) => B, old: (B) => ins(B, "-") },
  { name: "lower dash", typed: (B) => ins(B, "-").toLowerCase(), nw: (B) => B, old: (B) => ins(B, "-") },
  { name: "slash", typed: (B) => ins(B, "/"), nw: (B) => B, old: (B) => ins(B, "/") },
  { name: "space", typed: (B) => ins(B, " "), nw: (B) => B, old: (B) => B },
  { name: "dot", typed: (B) => ins(B, "."), nw: (B) => B, old: (B) => ins(B, ".") },
  { name: "underscore", typed: (B) => ins(B, "_"), nw: (B) => B, old: (B) => ins(B, "_") },
  { name: "outer spaces", typed: (B) => `   ${B}   `, nw: (B) => B, old: (B) => B },
  { name: "tab", typed: (B) => ins(B, "\t"), nw: (B) => B, old: (B) => B },
  { name: "space between every character", typed: (B) => [...B].join(" "), nw: (B) => B, old: (B) => B },
  { name: "backslash", typed: (B) => ins(B, "\\"), nw: (B) => B, old: () => null },
  { name: "star", typed: (B) => ins(B, "*"), nw: (B) => B, old: () => null },
  { name: "hash", typed: (B) => ins(B, "#"), nw: (B) => B, old: () => null },
  { name: "comma", typed: (B) => ins(B, ","), nw: (B) => B, old: () => null },
  { name: "colon", typed: (B) => ins(B, ":"), nw: (B) => B, old: () => null },
  { name: "brackets", typed: (B) => `(${B.slice(0, 2)})${B.slice(2)}`, nw: (B) => B, old: () => null },
  { name: "leading dash", typed: (B) => "-" + B, nw: (B) => B, old: () => null },
  { name: "trailing dash", typed: (B) => B + "-", nw: (B) => B, old: (B) => B + "-" },
  { name: "double dash", typed: (B) => ins(B, "--"), nw: (B) => B, old: (B) => ins(B, "--") },
  { name: "full-width letters and digits", typed: (B) => fw(B), nw: (B) => B, old: () => null },
  { name: "full-width dash", typed: (B) => ins(B, "－"), nw: (B) => B, old: () => null },
  { name: "emoji at the end", typed: (B) => B + "😀", nw: (B) => B, old: () => null },
  { name: "emoji inside", typed: (B) => ins(B, "😀"), nw: (B) => B, old: () => null },
  { name: "zero-width space", typed: (B) => ins(B, "\u200B"), nw: (B) => B, old: () => null },
  { name: "zero-width non-joiner", typed: (B) => ins(B, "\u200C"), nw: (B) => B, old: () => null },
  { name: "zero-width joiner", typed: (B) => ins(B, "\u200D"), nw: (B) => B, old: () => null },
  { name: "word joiner", typed: (B) => ins(B, "\u2060"), nw: (B) => B, old: () => null },
  { name: "byte-order mark", typed: (B) => "\uFEFF" + B, nw: (B) => B, old: (B) => B }, // JavaScript counts U+FEFF as white space, so the old rule drops it too
  { name: "accented letter inside", typed: (B) => ins(B, "é"), nw: (B) => B, old: () => null },
  { name: "Hindi digit in front", typed: (B) => "१" + B, nw: (B) => B, old: () => null },
  { name: "Arabic digit at the end", typed: (B) => B + "٣", nw: (B) => B, old: () => null },
  { name: "CJK character inside", typed: (B) => ins(B, "员"), nw: (B) => B, old: () => null },
  { name: "nothing typed", typed: () => "", nw: () => "", old: () => "" },
  { name: "spaces only", typed: () => "     ", nw: () => "", old: () => "" },
  { name: "dashes only", typed: () => "-----", nw: () => null, old: () => null },
  { name: "slashes only", typed: () => "//", nw: () => null, old: () => null },
  { name: "emoji only", typed: () => "😀😀", nw: () => null, old: () => null },
  { name: "symbols only", typed: () => "!#$%", nw: () => null, old: () => null },
  { name: "31 characters", typed: (B) => B.padEnd(31, "A"), nw: () => null, old: () => null },
  { name: "exactly 30 characters", typed: (B) => B.padEnd(30, "A"), nw: (B) => B.padEnd(30, "A"), old: (B) => B.padEnd(30, "A") },
  { name: "40 typed, 20 left after cleaning", typed: () => "A-".repeat(20), nw: () => "A".repeat(20), old: () => null },
  { name: "e-mail typed in the box", typed: () => "demo1@demo-test.invalid", nw: () => null, old: () => null },
  { name: "e-mail with full-width @", typed: () => "demo1＠demo-test.invalid", nw: () => null, old: () => null },
  { name: "ID with a trailing @", typed: (B) => B + "@", nw: () => null, old: () => null },
  { name: "ID and a phone-like tail", typed: (B) => B + " 9876543210", nw: (B) => B + "9876543210", old: (B) => B + "9876543210" },
];
// -- dimension: verify configuration (what the organizer chose) as stored JSON, including rubbish values
const VERIFY: { cfg: unknown; mode: string; only: boolean }[] = [];
for (const m of ["mobile", "id", "either", "both"]) for (const o of [false, true]) VERIFY.push({ cfg: { verify: m, employeesOnly: o }, mode: m, only: o });
// -- dimension: e-mail typing
const CASES: ((s: string) => string)[] = [(s) => s, (s) => s.toUpperCase(), (s) => s[0]!.toUpperCase() + s.slice(1), (s) => [...s].map((c, i) => i % 2 ? c.toUpperCase() : c).join(""), (s) => s.replace("demo-test.invalid", "DEMO-TEST.INVALID"), (s) => s.replace(/^demo\d+/, (x) => x.toUpperCase()), (s) => [...s].map((c, i) => (i * 7 + s.length) % 3 === 0 ? c.toUpperCase() : c).join(""), (s) => s.toLowerCase().replace(/^d/, "D").replace("-t", "-T")];
const NOISE: { name: string; f: (s: string) => string; tag: boolean }[] = [
  { name: "none", f: (s) => s, tag: false }, { name: "outer spaces", f: (s) => `  ${s} `, tag: false }, { name: "spaces round the @", f: (s) => s.replace("@", " @ "), tag: false },
  { name: "full-width @", f: (s) => s.replace("@", "＠"), tag: false }, { name: "zero-width inside", f: (s) => s.replace("demo", "de\u200Bmo"), tag: false }, { name: "tab and new line", f: (s) => "\t" + s + "\n", tag: false },
  { name: "+tag", f: (s) => s.replace("@", "+Tag@"), tag: true },
];
const PATHS = ["organizer sign-in (normMail)", "Google (cleanEmail)", "Host setup (emailHashOf)"];
// -- dimension: link type (the `from=` code of a common link, or a personal link token)
const LINKS = ["Organizer common link", "Host common link", "Co-host common link", "guest seat link", "personal link token"];
const ALPHA = "abcdefghjkmnpqrstuvwxyz23456789";
// -- the pure matrix radix: format x base x era x verify x case x noise x path x link
const PURE = [F.length, BASES.length, 2, VERIFY.length, CASES.length, NOISE.length, PATHS.length, LINKS.length] as const;
const PURE_DIMS = ["idFormat", "idBase", "gameEra", "verifyConfig", "emailCase", "emailNoise", "emailPath", "linkType"];

async function pure() {
  const N = LIMIT ? Math.min(LIMIT, total(PURE)) : total(PURE); const hashCache = new Map<string, string>();
  const NP0 = total(PURE);
  for (let k = 0; k < N; k++) {
    const i = at(k, NP0);
    const d = decode(i, PURE); const [fi, bi, era, vi, ci, ni, pi, li] = d as [number, number, number, number, number, number, number, number];
    const t = mk("pure", i, () => `${F[fi]!.name} | base ${BASES[bi]} | ${era ? "new" : "old"} game | verify ${JSON.stringify(VERIFY[vi]!.cfg)} | email case ${ci} noise ${NOISE[ni]!.name} | ${PATHS[pi]} | ${LINKS[li]}`);
    t.eq("number <-> scenario is a bijection", encode(d, PURE), i);
    // employee ID
    const B = BASES[bi]!, f = F[fi]!, created = era ? EMP_CLEAN_FROM_MS + (i % 1000) : EMP_CLEAN_FROM_MS - 1 - (i % 1000);
    t.eq("employee ID cleaned as the rule says", normEmpFor(f.typed(B), created), era ? f.nw(B) : f.old(B));
    // verify config
    const v = VERIFY[vi]!; const got = verifyOf({ config: JSON.stringify(v.cfg) }); t.eq("verify mode and employees-only read back", got, { mode: v.mode, employeesOnly: v.only });
    if (i % 7 === 0) { t.eq("a rubbish verify value falls back to mobile", verifyOf({ config: JSON.stringify({ verify: "passport", employeesOnly: "yes" }) }), { mode: "mobile", employeesOnly: false }); t.eq("broken config text falls back", verifyOf({ config: "{oops" }), { mode: "mobile", employeesOnly: false }); }
    // e-mail
    const n = (i % 9999) + 1, canon = `demo${n}@demo-test.invalid`, noisy = NOISE[ni]!.f(CASES[ci]!(canon));
    const keepTag = NOISE[ni]!.tag; const wantClean = keepTag ? `demo${n}+tag@demo-test.invalid` : canon;
    if (pi === 0) t.eq("organizer e-mail: one person, +tag dropped", normMail(noisy), canon);
    else if (pi === 1) t.eq("Google e-mail: one form, +tag kept", cleanEmail(noisy), wantClean);
    else { const h = await emailHashOf(noisy); const key = wantClean; let want = hashCache.get(key); if (!want) { want = await emailHashOf(key); if (hashCache.size < 50_000) hashCache.set(key, want); } t.eq("Host e-mail hash equals the hash of the plain address", h, want); }
    if (ni === 0 && ci === 0) t.eq("the ID cleaner is never applied to an e-mail (typed in the ID box it is refused)", normEmpFor(noisy, EMP_CLEAN_FROM_MS + 5), null);
    // link
    const hex = ((i * 2654435761) % 0x10000000), h7 = hex.toString(16).padStart(7, "0"), seq = (i % 999_999) + 1;
    if (li === 0) { t.eq("org code", fromCodeOf("o"), 1_900_000_000); t.eq("org parse", parseFrom(1_900_000_000), { kind: "org" }); t.eq("org inviter", inviterOf(parseFrom(1_900_000_000)!), "o"); }
    else if (li === 1) { const c = fromCodeOf("h:" + h7); t.eq("host code", c, 1_500_000_000 + hex); t.eq("host parse", parseFrom(c), { kind: "host", hex: h7 }); t.eq("host inviter", inviterOf(parseFrom(c)!), "h:" + h7); }
    else if (li === 2) { const c = fromCodeOf("c:" + h7); t.eq("co-host code", c, 1_000_000_000 + hex); t.eq("co-host parse", parseFrom(c), { kind: "cohost", hex: h7 }); t.eq("co-host inviter", inviterOf(parseFrom(c)!), "c:" + h7); }
    else if (li === 3) { t.eq("guest seat code", fromCodeOf("s:" + seq), seq); t.eq("guest seat parse", parseFrom(seq), { kind: "guest", seq }); t.eq("guest inviter", inviterOf(parseFrom(seq)!), "s:" + seq); }
    else { const tok = newToken(); t.eq("token is 10 characters from the unambiguous alphabet", tok.length === 10 && [...tok].every((c) => ALPHA.includes(c)), true); t.eq("token hash ignores case", await tokenHash(tok) === await tokenHash(tok.toUpperCase()), true); t.eq("token hash is 32 hex", /^[0-9a-f]{32}$/.test(await tokenHash(tok)), true); }
    t.done();
  }
  // payment mode x free launch x razorpay keys x pack x currency
  const TM = ["1", "0", undefined], FL = ["1", "0", undefined], RZ = [true, false], CUR = ["INR", "USD"] as const;
  const PAY = [TM.length, FL.length, RZ.length, PACKS.length, CUR.length] as const; const NP = total(PAY);
  const TABLE: Record<number, [number, number]> = { 100: [2399, 34], 250: [3499, 51], 500: [4699, 67], 750: [5899, 84], 1000: [7099, 101], 2500: [11799, 169], 5000: [17699, 253], 10000: [29499, 421] };
  for (let i = 0; i < NP; i++) {
    const [a, b, c, p, u] = decode(i, PAY) as [number, number, number, number, number]; const t = mk("pure-pay", i, () => `TEST_MODE=${TM[a]} FREE_LAUNCH=${FL[b]} razorpay=${RZ[c]} pack ${PACKS[p]![0]} ${CUR[u]}`);
    const env: any = { ...(TM[a] !== undefined ? { TEST_MODE: TM[a] } : {}), ...(FL[b] !== undefined ? { FREE_LAUNCH: FL[b] } : {}), ...(RZ[c] ? { RAZORPAY_KEY_ID: "rzp_test_demo", RAZORPAY_KEY_SECRET: "demo" } : {}) };
    t.eq("payment mode", payMode(env), RZ[c] ? "razorpay" : TM[a] === "1" ? "test" : "off"); t.eq("free launch only for FREE_LAUNCH=1", freeLaunch(env), FL[b] === "1");
    const pk = PACKS[p]![0], pr = price(pk, CUR[u]!); const want = TABLE[pk]![u]!; t.eq("price is the price list (no tax)", pr, { total: want, base: want, tax: 0 });
    t.done();
  }
  // theme choice x mode choice x storage
  const CT = ["blue", "maroon", "emerald", "indigo", "purple", null], CG = ["dark", "light", "sepia", null], ST = ["ok", "blocked"] as const; const TH = [CT.length, CG.length, ST.length] as const; const src = readFileSync(join(ROOT, "apps/web/public/theme-init.js"), "utf8");
  for (let i = 0; i < total(TH); i++) {
    const [a, b, s] = decode(i, TH) as [number, number, number]; const t = mk("pure-theme", i, () => `ct-theme=${CT[a]} cg-theme=${CG[b]} storage ${ST[s]}`);
    const attrs: Record<string, string> = {}; const classes: string[] = [];
    const doc = { documentElement: { classList: { add: (c: string) => classes.push(c) }, setAttribute: (k: string, v: string) => { attrs[k] = v; } } };
    const ls = { getItem: (k: string) => { if (ST[s] === "blocked") throw new Error("blocked"); return k === "ct-theme" ? CT[a] : k === "cg-theme" ? CG[b] : null; } };
    new Function("document", "localStorage", src)(doc, ls);
    t.eq("the page is marked script-capable", classes, ["js"]);
    const wantAttrs: Record<string, string> = {}; if (ST[s] === "ok") { if (["blue", "maroon", "emerald", "indigo"].includes(CT[a] as string)) wantAttrs["data-theme"] = CT[a] as string; if (CG[b] === "dark" || CG[b] === "light") wantAttrs["data-mode"] = CG[b] as string; }
    t.eq("theme and light/dark applied only when valid", attrs, wantAttrs); t.done();
  }
}

// ================================================================ TIER 2: wire (real Worker, in-memory database)
async function wire() {
  const { world, T_NEW, T_OLD, dev, j, roundAt } = await import("../../../../apps/edge/test/t30-kit");
  const { termsFor } = await import("../../../../apps/edge/test/with-terms");
  const ERA = ["old", "new"], VM = ["mobile", "id", "either", "both"], ACCESS = ["anyone", "list", "employees only"], PAY = ["paid", "unpaid, early", "unpaid, locked", "draft"], DEV = ["same phone again", "another phone"], LISTED = [false, true];
  const KINDS = [
    { name: "plain", typed: "1B678", nw: "1B678", old: "1B678" }, { name: "dash", typed: "1B-678", nw: "1B678", old: "1B-678" }, { name: "lower with space", typed: "1b 678", nw: "1B678", old: "1B678" },
    { name: "slash", typed: "1B/678", nw: "1B678", old: "1B/678" }, { name: "full-width", typed: "１Ｂ６７８", nw: "1B678", old: null }, { name: "e-mail", typed: "demo1@demo-test.invalid", nw: null, old: null },
    { name: "symbols only", typed: "---//", nw: null, old: null }, { name: "empty", typed: "", nw: "", old: "" },
  ] as { name: string; typed: string; nw: string | null; old: string | null }[];
  const WIRE = [ERA.length, VM.length, ACCESS.length, KINDS.length, LISTED.length, PAY.length, DEV.length] as const;
  const APPROVALS = ["Organizer admits", "Organizer declines", "another Organizer's key", "an unknown key", "no key at all"];
  let n = 0; const NW = total(WIRE); const cap = LIMIT ? Math.min(LIMIT, NW) : NW;
  for (let k = 0; k < cap; k++) {
    const i = at(k, NW);
    const [ei, vi, ai, ki, li, pi, di] = decode(i, WIRE) as [number, number, number, number, number, number, number];
    const era = ERA[ei]!, vmode = VM[vi]!, access = ACCESS[ai]!, kind = KINDS[ki]!, listed = LISTED[li]!, pay = PAY[pi]!;
    // "employees only" is only meaningful with an ID mode; with 'mobile' the organizer's page forbids it, so that combination cannot exist and is not counted
    if (access === "employees only" && vmode === "mobile") continue;
    // same-phone/other-phone only matters when the first attempt gets in; the other cell of the pair is skipped for outcomes that cannot reach it (decided below)
    const E = (era === "new" ? kind.nw : kind.old); const eid = "MX-" + (++n).toString(36).toUpperCase();
    const W = world(era === "new" ? T_NEW : T_OLD);
    try {
      const startMs = Date.UTC(1970, 0, 1) + ((roundAt(W.now) + 1200 - 1) * 3 + 1692803367) * 1000;
      const draft = pay === "draft"; const key = await W.organizer(1);
      await W.call("POST", "/api/z", { id: eid, startRound: roundAt(W.now) + 1200, callSeconds: 6, cap: 100, ...(access !== "anyone" ? { whoCanJoin: "list" } : {}) }, key);
      if (!draft) await W.call("POST", `/api/z/${eid}/publish`, { email: "demo90@demo-test.invalid", phone: "98765 43210" }, key);
      if (!draft) { const s = await W.call("PATCH", `/api/z/${eid}/settings`, { verify: vmode, ...(access === "employees only" ? { employeesOnly: true } : {}) }, key); if (s.status !== 200) throw new Error("settings " + s.status); }
      if (pay === "paid") W.raw.run("UPDATE engagement SET pack=100 WHERE id=?", [eid]);
      const now = pay === "unpaid, locked" ? W.now + 1200 * 3000 - 30_000 : W.now; // 30 s before the start: payment due
      if (!draft && listed) { const r = await W.call("POST", `/api/z/${eid}/people`, { people: [{ name: "Asha Demo", empId: "1B678" }] }, key); if (r.status !== 200) throw new Error("list " + r.status); }
      // ---- oracle (written from the rules in docs/TEST_HANDOFF.md and the join rules, not from the code)
      const only = access === "employees only", closed = access !== "anyone";
      const askId = vmode === "id" || vmode === "either" || vmode === "both";
      let want: { status: number; code?: string };
      if (draft) want = { status: 403 };
      else if (E === null) want = { status: 400, code: "bad-id" };
      else if (only && (vmode === "id" || vmode === "both") && !E) want = { status: 400, code: "need-id" };
      else if (only && vmode === "either" && !E) want = { status: 400, code: "need-id" };
      else if (vmode === "both" && E) want = { status: 400, code: "need-id" };
      else if (askId && !E) want = { status: 400, code: "need-id" };
      else if (vmode === "mobile" && E) want = { status: 400 };
      else if (vmode === "mobile" && !E && only) want = { status: 400 };
      else {
        const known = (vmode === "id" || vmode === "either") && !!E && listed && E === "1B678";
        if (pay === "unpaid, locked") want = { status: 403, code: "locked" };
        else if (vmode === "mobile") want = closed ? { status: 403, code: "waiting" } : { status: 200 }; // name only
        else if (known) want = { status: 200 };
        else want = closed || (askId && !!E) ? { status: 403, code: "waiting" } : { status: 200 }; // an ID that is not on the list is always the organizer's decision, whatever "who can join" says
      }
      const t = mk("wire", i, () => `${era} game | verify ${vmode} | ${access} | typed "${kind.typed}" (${kind.name}) | ${listed ? "on the list" : "not on the list"} | ${pay} | ${DEV[di]}`);
      const body = { name: "Demo Player", device: dev(1), ...(kind.typed ? { empId: kind.typed } : {}) };
      const r = await W.call("POST", `/api/z/${eid}/join`, body, undefined, now); const b: any = await j(r);
      t.eq("status", r.status, want.status); if (want.code) t.eq("code", b.code, want.code);
      if (want.status >= 400) t.eq("a refusal has a plain sentence", typeof b.error === "string" && b.error.length > 5 && !/undefined|null|SQL|TypeError/.test(b.error), true);
      if (want.status === 200) {
        const count = () => W.raw.query("SELECT COUNT(*) c FROM participant WHERE eid=?").get(eid).c;
        t.eq("one participant", count(), 1);
        const again = await W.call("POST", `/api/z/${eid}/join`, { ...body, device: di === 0 ? dev(1) : dev(2) }, undefined, now); const ab: any = await j(again);
        const nameOnly = vmode === "mobile" && !E; // a name-only guest is known by name + the phone's own random id, so a second phone is a second guest
        if (di === 0) { t.eq("same phone again is the same place", [again.status, ab.pid, ab.again], [200, b.pid, true]); t.eq("still one participant", count(), 1); }
        else if (nameOnly) { t.eq("another phone with a name only is a second guest", [again.status, ab.pid !== b.pid], [200, true]); t.eq("two participants", count(), 2); }
        else { t.eq("another phone for the same place is refused", again.status, 423); t.eq("with the id-used or other-phone code", ["id-used", "other-phone"].includes(ab.code), true); t.eq("still one participant", count(), 1); }
      }
      if (want.code === "waiting") {
        const ap = APPROVALS[(i >> 3) % APPROVALS.length]!; // the approver axis: expanded round-robin over the waiting outcomes so each approver meets each ID kind
        const list: any = await j(await W.call("GET", `/api/z/${eid}/waiting`, undefined, key)); const row = (list.waiting ?? [])[0];
        t.eq("the request is in the waiting room", !!row, true);
        if (row) {
          const k2 = ap === "another Organizer's key" ? await W.organizer(2) : ap === "an unknown key" ? "cbk_" + "0".repeat(48) : ap === "no key at all" ? undefined : key;
          const dec = await W.call("POST", `/api/z/${eid}/waiting/${row.id}`, { decision: ap === "Organizer declines" ? "decline" : "admit" }, k2, now);
          if (ap === "Organizer admits") { t.eq("admit works", dec.status, 200); const in2 = await W.call("POST", `/api/z/${eid}/join`, body, undefined, now); t.eq("the admitted person gets in", in2.status, 200); }
          else if (ap === "Organizer declines") { t.eq("decline works", dec.status, 200); const in2 = await W.call("POST", `/api/z/${eid}/join`, body, undefined, now); t.eq("a declined person does not get in", in2.status === 200, false); }
          else { t.eq("an outsider cannot decide", [401, 403, 404].includes(dec.status), true); const in2 = await W.call("POST", `/api/z/${eid}/join`, body, undefined, now); t.eq("and the person is still waiting", [in2.status, (await j(in2)).code], [403, "waiting"]); }
        }
      }
      t.done();
    } finally { W.restore(); }
  }
  R.dims.wireCombos = n;
}

// ================================================================ TIER 3: bracket (whole tournaments)
async function bracket() {
  const { startTournament, rankings } = await import("../../../../packages/ttt/src/bracket");
  const { drive, lcg } = await import("../../../../packages/ttt/test/drive");
  const MAX_GAMES = 3; // written out on purpose: the rule is three games, so a changed constant in the product must make this matrix red
  const SHAPES: { format: "solo" | "team"; teamSize?: number; n: number }[] = [];
  for (let n = 2; n <= 40; n++) SHAPES.push({ format: "solo", n }); for (let n = 6; n <= 42; n++) SHAPES.push({ format: "team", teamSize: 3, n }); for (let n = 10; n <= 45; n++) SHAPES.push({ format: "team", teamSize: 5, n });
  const CLOCKS = [10_000, 20_000, 30_000, 60_000], SEEDS = ["a", "b", "c", "d", "e", "f"], ABS = [0, 10, 30]; // percent of players who never move
  const BR = [SHAPES.length, CLOCKS.length, SEEDS.length, ABS.length] as const; const NB = LIMIT ? Math.min(LIMIT, total(BR)) : total(BR); const T0 = 5_000_000;
  for (let k = 0; k < NB; k++) {
    const i = at(k, total(BR));
    const [si, ci, sd, ai] = decode(i, BR) as [number, number, number, number]; const s = SHAPES[si]!; const t = mk("bracket", i, () => `${s.format}${s.teamSize ?? ""} ${s.n} players | clock ${CLOCKS[ci]! / 1000} s | seed ${SEEDS[sd]} | ${ABS[ai]}% absent`);
    const players = Array.from({ length: s.n }, (_, k) => ({ pid: `p${String(k + 1).padStart(4, "0")}`, name: `Player ${k + 1}` }));
    const tour = await startTournament({ eid: "MX", seed: `${SEEDS[sd]}|${si}|${ci}`, players, format: s.format, teamSize: s.teamSize, moveMs: CLOCKS[ci]!, readyMs: 15_000, startAt: T0 });
    const absent = new Set(players.filter((_, k) => (k * 37 + i) % 100 < ABS[ai]!).map((p) => p.pid));
    await drive(tour, T0, { rng: lcg(i + 1), absent, maxMs: 24 * 3_600_000 });
    const entrants = s.format === "solo" ? s.n : Math.floor(s.n / s.teamSize!);
    t.eq("it finished with one champion", tour.done && !!tour.champion, true); t.eq("entrants", tour.entrants.length, entrants);
    t.eq("rounds = ceil(log2(entrants))", tour.rounds, Math.ceil(Math.log2(entrants)));
    const rk = await rankings(tour); t.eq("ranks are 1..N, no ties", rk.map((x) => x.rank), Array.from({ length: entrants }, (_, k) => k + 1)); t.eq("champion ranks first", rk[0]!.id, tour.champion);
    t.eq("N-1 real matches", Object.values(tour.matches).filter((m) => !m.bye).length, entrants - 1);
    const boards = Object.values(tour.matches).flatMap((m) => m.boards);
    t.eq("every board has a winner and at most 3 games", boards.every((b) => b.done && !!b.winner && b.games.length <= MAX_GAMES), true);
    t.eq("fate only after three draws", boards.every((b) => b.via !== "fate" || (b.games.length === MAX_GAMES && b.games.every((g) => g.result?.kind === "draw"))), true);
    t.eq("a drawn game is followed by the swapped marks", boards.every((b) => b.games.every((g, k) => g.result?.kind !== "draw" || k !== 0 || !b.games[1] || (b.games[1].x === g.o && b.games[1].o === g.x))), true);
    t.done();
  }
}

// ================================================================ run
const t0 = Date.now();
if (TIER === "all" || TIER === "pure") await pure();
if (TIER === "all" || TIER === "wire") await wire();
if (TIER === "all" || TIER === "bracket") await bracket();
const secs = Math.round((Date.now() - t0) / 1000);
const all = Object.values(R.tiers).reduce((a, x) => ({ total: a.total + x.total, pass: a.pass + x.pass, fail: a.fail + x.fail, checks: a.checks + x.checks }), { total: 0, pass: 0, fail: 0, checks: 0 });
const summary = { when: new Date().toISOString(), tier: TIER, limit: LIMIT || null, seconds: secs, ...all, tiers: R.tiers, pureDimensions: Object.fromEntries(PURE_DIMS.map((d, k) => [d, PURE[k]])), pureProduct: total(PURE), firstFailures: R.fails.slice(0, 30) };
mkdirSync(join(ROOT, OUT), { recursive: true }); writeFileSync(join(ROOT, OUT, `summary-${TIER}${LIMIT ? "-limit" + LIMIT : ""}.json`), JSON.stringify(summary, null, 1));
console.log(`MATRIX tier=${TIER} scenarios=${all.total} pass=${all.pass} fail=${all.fail} checks=${all.checks} seconds=${secs}`);
for (const [k, v] of Object.entries(R.tiers)) console.log(`  ${k}: scenarios=${v.total} pass=${v.pass} fail=${v.fail} checks=${v.checks}`);
for (const f of R.fails.slice(0, 15)) console.log(`FAIL [${f.tier} #${f.id}] ${f.check} | got ${JSON.stringify(f.got)} want ${JSON.stringify(f.want)} | ${f.tuple}`);
process.exit(all.fail ? 1 : 0);
