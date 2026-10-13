// Phone crowd over HTTP, in virtual time, against the running sim server (bun).  N real PhoneRuntime instances (the code the phone page runs) talk to the sim server's
// real Worker through HTTP (one simulated address per phone), and to the fake beacon. The server clock is frozen and moved with the phones' virtual clock, so a whole
// 90-number game takes seconds. Winners come from the phones' own votes (the Worker accepts no organizer settlement), exactly as in production.
// Usage: bun tools/sim2/crowd.ts '{"eid":"SIM1","startRound":123,"phones":30,"seed":"sim","lateFrac":0.3,"offlineFrac":0.05,"maxSteps":420,"base":"http://localhost:8801"}'
// Prints one JSON line:  { ok, phones, joined, steps, seconds, reference:[..], groups:[{canon,count}], logsEqual, ended, results:[...first phone], failures:[..] }
import { PhoneRuntime } from "../../packages/beacon/src/phone-runtime";
import { callRoundR } from "../../packages/beacon/src/game";
import { deriveCalls } from "../../packages/beacon/src";
import { GRACE_ROUNDS, roundEid } from "../../packages/beacon/src/config";
// @ts-ignore plain JS module shared with the node harness (no declaration file on purpose)
import { fakeFetcher, fakeVerify, randomnessOf, roundTimeMs } from "./lib/beacon.mjs";
import { createHash } from "node:crypto";

const a = JSON.parse(process.argv[2] ?? "{}");
const BASE: string = a.base ?? "http://localhost:8801", EID: string = a.eid, START: number = a.startRound, N: number = a.phones ?? 30, SEED: string = a.seed ?? "sim";
const LATE: number = a.lateFrac ?? 0.3, OFF: number = a.offlineFrac ?? 0.05, MAX: number = a.maxSteps ?? 420, PHONE0: number = a.phoneBase ?? 100000;
if (!EID || !START) { console.log(JSON.stringify({ ok: false, error: "eid and startRound needed" })); process.exit(2); }
let seedN = [...SEED].reduce((x, c) => (x * 31 + c.charCodeAt(0)) >>> 0, 7); const rng = () => ((seedN = (seedN * 1664525 + 1013904223) >>> 0) / 0x100000000);
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const post = (p: string, body: unknown) => fetch(BASE + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());

const info = await (await fetch(`${BASE}/api/z/${EID}/info`)).json() as any;
if (!info || info.error) { console.log(JSON.stringify({ ok: false, error: "info: " + JSON.stringify(info) })); process.exit(2); }
const STRIDE = info.callSeconds / 3;
let t = 0; const T0 = roundTimeMs(START) - 100_000; const utc = () => T0 + t;
await post("/__sim/clock", { set: utc(), freeze: true });

interface P { rt: PhoneRuntime; phone: string; joinAt: number; offFrom: number; offTo: number; failed: string[] }
let step = 0;
const phones: P[] = Array.from({ length: N }, (_, i) => {
  const mem = new Map<string, string>(), phone = "9" + String(PHONE0 + i).padStart(9, "0").slice(-9), ip = `10.20.${(i >> 8) & 255}.${(i & 255) + 1}`;
  const offFrom = rng() < OFF ? 20 + Math.floor(rng() * 100) : -1;
  const p: P = { rt: null as unknown as PhoneRuntime, phone, joinAt: rng() < LATE ? Math.floor(rng() * 150) : Math.floor(rng() * 8), offFrom, offTo: offFrom + 25, failed: [] };
  const isOff = () => offFrom >= 0 && step >= offFrom && step < p.offTo;
  p.rt = new PhoneRuntime(EID, {
    api: async (m: string, path: string, b?: unknown) => {
      if (isOff()) throw new Error("offline");
      const r = await fetch(BASE + path, { method: m, headers: { "content-type": "application/json", "x-sim-ip": ip }, body: b === undefined ? undefined : JSON.stringify(b) });
      const j: any = await r.json().catch(() => ({}));
      if (!r.ok) throw Object.assign(new Error(j.error ?? "http " + r.status), { status: r.status, code: j.code, body: j });
      return j;
    },
    beacon: { fetcher: isOff() ? undefined : (fakeFetcher(utc, SEED) as any), mirrors: ["https://api.t", "https://api2.t", "https://api3.t"], timeoutMs: 400 },
    mono: () => t, store: { get: (k: string) => mem.get(k) ?? null, set: (k: string, v: string) => void mem.set(k, v) },
    verify: fakeVerify(SEED) as any,
    getPublic: async (url: string) => { const r = await fetch(url); if (!r.ok) throw Object.assign(new Error("http " + r.status), { status: r.status }); return r.json(); },
  } as any);
  // the fetcher closure above must honour the offline window: wrap it
  const f = fakeFetcher(utc, SEED) as any; (p.rt.deps.beacon as any).fetcher = async (u: string, init: any) => { if (isOff()) throw new Error("offline"); return f(u, init); };
  return p;
});
const t0 = Date.now();
for (step = 0; step < MAX; step++) {
  t += 3000;
  await post("/__sim/clock", { set: utc() });
  const batch: Promise<unknown>[] = [];
  for (const p of phones) {
    if (step < p.joinAt) continue;
    const ph = p.rt.phase;
    if (step === p.joinAt) batch.push(p.rt.boot().then(() => p.rt.join(p.phone, "P" + p.phone.slice(-4))).catch((e: any) => p.failed.push("join: " + (e?.message ?? e))));
    else if (ph === "play" || ph === "ended") batch.push(p.rt.tick().catch((e: any) => p.failed.push("tick: " + (e?.message ?? e))));
    else if (ph === "join") batch.push(p.rt.join(p.phone, "P" + p.phone.slice(-4)).catch(() => {}));
    else if (ph === "boot") batch.push(p.rt.boot().catch(() => {}));
  }
  for (let i = 0; i < batch.length; i += 50) await Promise.all(batch.slice(i, i + 50));
  if (step > 60 && phones.every((p) => step < p.joinAt || p.rt.phase === "ended" || p.rt.phase === "missing")) { step++; break; }
}
await post("/__sim/clock", { set: utc(), freeze: false });

const views = phones.map((p) => ({ p, v: p.rt.view() }));
const joined = views.filter((x) => x.v.pid);
const ended = joined.filter((x) => x.v.phase === "ended");
const cfg = (joined[0]?.v.cfg ?? info) as any;
const rounds = cfg.rounds ?? 1;
const ref: number[][] = [];
for (let r = 1; r <= rounds; r++) ref.push(deriveCalls(roundEid(EID, r), Array.from({ length: 90 }, (_, k) => randomnessOf(callRoundR(null as any, START + GRACE_ROUNDS, STRIDE, cfg.breaks ?? [], r, k)!, SEED))));
const canon = (res: any[]) => JSON.stringify([...res].map((r) => `${r.round ?? 1}|${r.pattern}|${r.ordinal}|${r.idx}|${r.count ?? ""}`).sort());
const groups = new Map<string, number>(); for (const x of ended) groups.set(canon(x.v.results), (groups.get(canon(x.v.results)) ?? 0) + 1);
const full = ended.filter((x) => x.v.log.every((n: number, i: number) => n === ref[rounds - 1]![i + (x.v.late?.hidden ?? 0)])); // a game may end early when every prize is awarded: the log is then a prefix of the 90
const failures: string[] = [];
if (joined.length < N * 0.9) failures.push(`only ${joined.length} of ${N} phones joined`);
if (ended.length < joined.length) failures.push(`${joined.length - ended.length} joined phones had not ended after ${step} steps`);
if (groups.size > 1) failures.push(`phones disagree on the winners (${groups.size} different sets)`);
const badDetail: any[] = [];
for (const x of ended.filter((x) => !full.includes(x)).slice(0, 5)) { const off = x.v.late?.hidden ?? 0, rf = ref[rounds - 1]!; const fm = x.v.log.findIndex((n: number, i: number) => n !== rf[i + off]); badDetail.push({ phone: x.p.phone, joinAt: x.p.joinAt, offFrom: x.p.offFrom, hidden: off, logLen: x.v.log.length, firstMismatch: fm, got: x.v.log.slice(Math.max(0, fm - 1), fm + 4), want: rf.slice(Math.max(0, fm - 1) + off, fm + 4 + off), late: x.v.late }); failures.push(`phone ${x.p.phone} has a wrong number log (joinAt ${x.p.joinAt}, offline from ${x.p.offFrom}, first mismatch at call ${fm})`); }
const resultsFinal = await (await fetch(`${BASE}/api/z/${EID}/results`)).json() as any;
console.log(JSON.stringify({ ok: !failures.length, phones: N, joined: joined.length, ended: ended.length, steps: step, seconds: +((Date.now() - t0) / 1000).toFixed(1), logsEqual: `${full.length}/${ended.length}`, groups: [...groups].map(([c, n]) => ({ count: n, results: JSON.parse(c).length })), results: ended[0]?.v.results ?? [], published: resultsFinal.results ?? [], reference: ref[rounds - 1], perPhone: ended.slice(0, 400).map((x) => ({ phone: x.p.phone, canon: sha(canon(x.v.results)).slice(0, 8) })), failures, badDetail, phases: views.reduce((m: any, x) => (m[x.v.phase] = (m[x.v.phase] ?? 0) + 1, m), {}), sample: views.slice(0, 3).map((x) => ({ firstMismatch: x.v.log.findIndex((n: number, i: number) => n !== ref[rounds - 1]![i + (x.v.late?.hidden ?? 0)]), logHead: x.v.log.slice(0, 6), refHead: ref[rounds - 1]!.slice(0, 6), phone: x.p.phone, phase: x.v.phase, error: x.v.error, log: x.v.log.length, nowRound: x.v.nowRound, startRound: x.v.startRound, mode: x.v.mode, locked: x.v.locked, late: x.v.late })), phoneErrors: phones.flatMap((p) => p.failed).slice(0, 5) }));
