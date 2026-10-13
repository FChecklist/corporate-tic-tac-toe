// Refer & earn: sales partners who sell Corporate Tic Tac Toe.
//   - A partner's reference code is a random 8-character code (no mobile number in it); the number and e-mail are kept only as salted hashes. Enrolling needs an e-mailed 6-digit code, and the answer never says whether a number or e-mail is already enrolled. Their link is  /?ref=<code>.
//   - Anyone can enrol (a participant from the ticket, or a stranger from the page) by giving a mobile number and agreeing; they get a private partner key (shown once)
//     to see their own sales. Nobody else can see a partner's sales, and a partner never sees who the buyer is (only date, pack and amount).
//   - A commission row is written when a referred purchase is PAID (never earlier). The commission RATE is not decided yet: rows wait as `pending_rate` with the
//     taxable value recorded, and we apply a rate later (or set PARTNER_COMMISSION_RATE) without losing anything. Self-referral is blocked with a reason.
//   - Attribution lasts ATTRIBUTION_DAYS from the click (kept in the buyer's own browser); the server only checks the code is a real, active partner.
//   - Payouts are made by us, outside this Worker (KYC, TDS and the payout channel are decided separately); here we only record that a payout was made.
import type { D1, Env } from "./worker";
import { sendMail, type PayEnv } from "./pay";
import { testFlag } from "./mode";
import { syncCommissions } from "./ledgerc";

export const ATTRIBUTION_DAYS = 30;
/** The commission every partner earns on the software price (no GST is charged) of a paid, referred purchase. product decision 2026-10-03: 50%. PARTNER_COMMISSION_RATE can lower it (never above 50%). */
export const COMMISSION_RATE = 0.5;
/** What the partner who first brought a customer earns when that customer buys again within a year. product decision 2026-10-06: the same up to 50% as a first purchase. */
export const REPEAT_COMMISSION_RATE = 0.5;
export const REPEAT_WINDOW_DAYS = 365;
export const PARTNER_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS partner (code TEXT PRIMARY KEY, key_hash TEXT NOT NULL, name TEXT, source TEXT, enrolled_ms INTEGER NOT NULL, consent_ms INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'active')`,
  `CREATE TABLE IF NOT EXISTS commission (id INTEGER PRIMARY KEY AUTOINCREMENT, payment_id TEXT UNIQUE NOT NULL, partner_code TEXT NOT NULL, base REAL NOT NULL, currency TEXT NOT NULL, rate REAL, amount REAL, status TEXT NOT NULL, reason TEXT, created_ms INTEGER NOT NULL, paid_ref TEXT, paid_ms INTEGER)`,
];

const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const sha = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))), (b) => b.toString(16).padStart(2, "0")).join("");
const randHex = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, "0")).join("");
const r2 = (x: number) => Math.round(x * 100) / 100;
async function body(req: Request, max = 2048): Promise<any | null> { const t = await req.text(); if (t.length > max) return null; try { const v = JSON.parse(t); return v && typeof v === "object" ? v : null; } catch { return null; } }

/** A partner's public code: 8 letters and digits (no I, O, 0, 1), random. Never derived from anything personal. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const newRefCode = (): string => Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
export const refCode = (raw: unknown): string | null => { const c = String(raw ?? "").trim().toUpperCase(); return /^[A-HJ-NP-Z2-9]{8}$/.test(c) ? c : null; };
/** The 10 digits of a mobile number as typed (+91 98765 43210, 098765 43210, 9876543210 are one person). */
export const partnerCode = (raw: unknown): string | null => { const d = String(raw ?? "").replace(/\D/g, ""); return d.length >= 10 && d.length <= 15 ? d.slice(-10) : null; };
export const phoneHashFor = (env: Env, code: string) => sha(`${env.PHONE_SALT ?? env.ORGANIZER_SECRET ?? "unset"}|${code}`); // same recipe the join route uses for participants

/** A refunded purchase earns the partner nothing: pending and accrued commission on that payment is voided (one already paid out is left alone). Returns how many rows changed; safe to call twice. */
export async function voidCommission(db: D1, paymentId: string, reason = "refund"): Promise<number> {
  const r = await db.prepare("UPDATE commission SET status='void', reason=? WHERE payment_id=? AND status IN ('pending_rate','accrued')").bind(reason, paymentId).run();
  return r.meta?.changes ?? 0;
}

/** Called when a payment is fulfilled. Writes at most one commission row per payment; never throws into the purchase. */
export async function recordCommission(env: PayEnv, p: { id: string; ref?: string | null; buyer_phone_hash?: string | null; currency: string }, base: number, now: number): Promise<void> {
  try {
    if (!((p as any).amount > 0)) return; // a game paid wholly from credit is not a new sale: the commission was earned on the original payment
    // a customer belongs to the partner who first brought them for 12 months: their repeat purchases earn that partner the repeat rate, whether or not a link was used again
    const email = String((p as any).email ?? "").trim().toLowerCase();
    const since = now - REPEAT_WINDOW_DAYS * 86_400_000;
    const earlier = email ? await env.DB.prepare("SELECT c.partner_code AS code FROM payment pay LEFT JOIN commission c ON c.payment_id=pay.id AND c.status<>'void' WHERE lower(pay.email)=? AND pay.status='paid' AND pay.id<>? AND pay.paid_ms>? ORDER BY pay.paid_ms LIMIT 1").bind(email, p.id, since).first<{ code: string | null }>() : null;
    const repeat = !!earlier;
    const code = earlier?.code ?? p.ref;
    if (!code) return;
    const partner = await env.DB.prepare("SELECT code, phone_hash, is_test FROM partner WHERE code=? AND state='active'").bind(code).first<{ code: string; phone_hash: string | null; is_test: number }>();
    if (!partner) return; // unknown or stopped code: the purchase is simply not attributed
    let status = "pending_rate", reason: string | null = null, rate: number | null = null, amount: number | null = null;
    if (p.buyer_phone_hash && partner.phone_hash && p.buyer_phone_hash === partner.phone_hash) { status = "blocked"; reason = "self_referral"; }
    else {
      const set = env.PARTNER_COMMISSION_RATE !== undefined && env.PARTNER_COMMISSION_RATE !== "" ? Number(env.PARTNER_COMMISSION_RATE) : NaN;
      const first = set >= 0 && set <= 0.5 ? set : COMMISSION_RATE; // 50% on a customer's first purchase, unless the owner chose something lower
      const x = repeat ? Math.min(REPEAT_COMMISSION_RATE, first) : first; // the same up-to-50% when the customer buys again within 12 months (product decision 2026-10-06)
      rate = x; amount = r2(base * x); status = "accrued";
    }
    await env.DB.prepare("INSERT OR IGNORE INTO commission(payment_id,partner_code,base,currency,rate,amount,status,reason,created_ms,is_test) VALUES(?,?,?,?,?,?,?,?,?,?)").bind(p.id, partner.code, base, p.currency, rate, amount, status, reason, now, (p as any).is_test || partner.is_test ? 1 : 0).run(); // a test payment or a test partner makes a test commission: it never counts in real figures
    await syncCommissions(env, now, { paymentId: p.id, limit: 1 }).catch(() => null); // ledger C -> B: an accrued row is posted at once (a row that waits for a rate, or is blocked, is not); if B is not ready the lifecycle tick retries
  } catch { /* a ledger problem must never undo a paid purchase; the payment row still carries the ref so it can be rebuilt */ }
}

export async function partnerRoute(req: Request, env: PayEnv, now: number, spend: (n: number) => Promise<boolean>, platform: boolean): Promise<Response | null> {
  const url = new URL(req.url); const p = url.pathname; const db: D1 = env.DB;
  if (!p.startsWith("/api/partner") && !p.startsWith("/api/partners")) return null;
  const busy = () => json({ error: "It is very busy right now. Please try again in a few minutes." }, 503);
  const origin = env.PUBLIC_ORIGIN ?? url.origin;

  const ipHash = async () => (await sha("pip|" + (req.headers.get("cf-connecting-ip") ?? "local"))).slice(0, 16);
  const dayKey = new Date(now).toISOString().slice(0, 10);
  /** Counts one try against a daily limit kept by network (a salted-free hash that is deleted after two days by the retention sweep). */
  const overLimit = async (kind: string, max: number): Promise<boolean> => {
    const k = `plim/${kind}/${dayKey}/${await ipHash()}`;
    const n = Number((await db.prepare("SELECT v FROM kv WHERE k=?").bind(k).first<{ v: string }>())?.v ?? 0);
    if (n >= max) return true;
    await db.prepare("INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=?").bind(k, String(n + 1), String(n + 1)).run();
    return false;
  };
  const validEmail = (v: unknown): string => { const e = typeof v === "string" ? v.trim().toLowerCase() : ""; return /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/.test(e) ? e : ""; };

  if (req.method === "GET" && p === "/api/partner/check") { // the landing page asks whether a ?ref= code is real, to show "referred by a partner"; limited per network so codes cannot be tried one after another
    if (await overLimit("check", 60)) return json({ valid: false });
    const c = refCode(url.searchParams.get("code"));
    const row = c ? await db.prepare("SELECT code FROM partner WHERE code=? AND state='active'").bind(c).first() : null;
    return json({ valid: !!row });
  }

  // Step 1: the answer is the same whether or not the number or e-mail is already enrolled, so nobody can find out who is a partner.
  if (req.method === "POST" && p === "/api/partner/enroll") {
    const b = await body(req);
    const digits = partnerCode(b?.phone), email = validEmail(b?.email);
    if (!b || !digits) return json({ error: "Enter a valid mobile number." }, 400);
    if (!email) return json({ error: "Enter a valid e-mail address. We send you a code." }, 400);
    if (b.consent !== true) return json({ error: "Please agree to join Refer & earn." }, 400);
    if (await overLimit("enroll", 10)) return json({ error: "Too many tries from this network today. Please try again tomorrow." }, 429);
    const name = typeof b.name === "string" ? b.name.replace(/[<>`]/g, "").trim().slice(0, 60) : "";
    const ph = await phoneHashFor(env, digits), eh = await sha("pemail|" + email);
    const have = await db.prepare("SELECT code FROM partner WHERE phone_hash=? OR email_hash=?").bind(ph, eh).first();
    const win = await db.prepare("SELECT v FROM kv WHERE k=?").bind(`penr/${eh}`).first<{ v: string }>();
    const prev = win ? JSON.parse(win.v) : null;
    if (prev && now - prev.t < 60_000 * 60 && prev.n >= 5) return json({ ok: true, sent: true }); // quietly stop mailing: no more than 5 a hour per address
    if (!(await spend(3))) return busy();
    const n = prev && now - prev.t < 3_600_000 ? prev.n + 1 : 1, t0 = prev && now - prev.t < 3_600_000 ? prev.t : now;
    let devCode: string | undefined;
    if (have) {
      await db.prepare("INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").bind(`penr/${eh}`, JSON.stringify({ t: t0, n })).run();
      await sendMail(env, db, email, "Refer & earn: you already have an account", `This e-mail address or mobile number is already enrolled in Refer & earn.\n\nSign in with your partner key: ${origin}/partner.html\n\nLost the key? Reply to this e-mail.`, now);
    } else {
      const code = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0]! % 900000));
      await db.prepare("INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").bind(`penr/${eh}`, JSON.stringify({ t: t0, n, c: await sha("pcode|" + eh + "|" + code), x: now + 600_000, ph, nm: name, src: b.source === "card" ? "card" : "direct", a: 0 })).run();
      await sendMail(env, db, email, "Your Refer & earn code", `Your code is ${code}. It works for 10 minutes.\n\nIf you did not ask for it, ignore this e-mail.`, now);
      if (env.TEST_MODE === "1") devCode = code;
    }
    return json({ ok: true, sent: true, ...(devCode ? { devCode } : {}) });
  }
  // Step 2: the code from the e-mail. Only now is the partner created: random public code, private key shown once.
  if (req.method === "POST" && p === "/api/partner/enroll/verify") {
    const b = await body(req);
    const email = validEmail(b?.email), code = typeof b?.code === "string" ? b.code.replace(/\D/g, "") : "";
    const bad = () => json({ error: "That code is not right or has expired. Please ask for a new one." }, 400);
    if (!email || code.length !== 6) return bad();
    const eh = await sha("pemail|" + email);
    const row = await db.prepare("SELECT v FROM kv WHERE k=?").bind(`penr/${eh}`).first<{ v: string }>();
    const e = row ? JSON.parse(row.v) : null;
    if (!e || !e.c || e.x < now || e.a >= 5) return bad();
    if (e.c !== (await sha("pcode|" + eh + "|" + code))) { e.a++; await db.prepare("UPDATE kv SET v=? WHERE k=?").bind(JSON.stringify(e), `penr/${eh}`).run(); return bad(); }
    if (!(await spend(3))) return busy();
    const have = await db.prepare("SELECT code FROM partner WHERE phone_hash=? OR email_hash=?").bind(e.ph, eh).first();
    if (have) { await db.prepare("DELETE FROM kv WHERE k=?").bind(`penr/${eh}`).run(); return bad(); }
    const key = "cbp_" + randHex(20), ref = newRefCode();
    await db.prepare("INSERT OR IGNORE INTO partner(code,key_hash,name,source,enrolled_ms,consent_ms,state,phone_hash,email_hash,is_test) VALUES(?,?,?,?,?,?, 'active',?,?,?)").bind(ref, await sha("partner|" + key), e.nm || null, e.src, now, now, e.ph, eh, await testFlag(env)).run();
    await db.prepare("DELETE FROM kv WHERE k=?").bind(`penr/${eh}`).run();
    return json({ ok: true, code: ref, partnerKey: key, link: `${origin}/?ref=${ref}` });
  }

  if (req.method === "POST" && p === "/api/partner/close") { // a partner closes their own account: the partner row (name, hashes, key) goes; commission rows stay as accounting records, without any link to a person
    const k = req.headers.get("x-partner") ?? "";
    const mine = k ? await db.prepare("SELECT code FROM partner WHERE key_hash=?").bind(await sha("partner|" + k)).first<{ code: string }>() : null;
    if (!mine) return json({ error: "Not allowed." }, 403);
    await db.prepare("DELETE FROM partner WHERE code=?").bind(mine.code).run();
    return json({ ok: true, closed: true });
  }
  const me = async () => {
    const k = req.headers.get("x-partner") ?? "";
    if (!k) return null;
    return db.prepare("SELECT code, name, state, enrolled_ms, is_test FROM partner WHERE key_hash=?").bind(await sha("partner|" + k)).first<{ code: string; name: string | null; state: string; enrolled_ms: number; is_test: number }>();
  };
  if (req.method === "GET" && p === "/api/partner/me") {
    const m = await me();
    if (!m) return json({ error: "Not allowed." }, 403);
    const rows = (await db.prepare("SELECT c.payment_id, c.base, c.currency, c.rate, c.amount, c.status, c.reason, c.created_ms, pay.pack FROM commission c LEFT JOIN payment pay ON pay.id=c.payment_id WHERE c.partner_code=? AND c.is_test=? ORDER BY c.id DESC LIMIT 200").bind(m.code, m.is_test ? 1 : 0).all<any>()).results ?? [];
    const sum = (st: string) => r2(rows.filter((r: any) => r.status === st && r.currency === "INR").reduce((s: number, r: any) => s + (r.amount ?? 0), 0));
    return json({
      code: m.code, name: m.name, state: m.state, link: `${origin}/?ref=${m.code}`, attributionDays: ATTRIBUTION_DAYS,
      totals: { sales: rows.length, accruedInr: sum("accrued"), paidInr: sum("paid"), waitingForRate: rows.filter((r: any) => r.status === "pending_rate").length, blocked: rows.filter((r: any) => r.status === "blocked").length },
      rateAnnounced: true, rate: COMMISSION_RATE, repeatRate: REPEAT_COMMISSION_RATE,
      sales: rows.map((r: any) => ({ date: r.created_ms, pack: r.pack, currency: r.currency, status: r.status, reason: r.reason, amount: r.amount })), // never who bought
    });
  }

  // ---- us (platform) ----
  if (!platform) return json({ error: "Not allowed." }, 403);
  if (req.method === "GET" && p === "/api/partners") {
    const t = url.searchParams.get("mode") === "test" ? 1 : 0; // the owner's list shows real partners unless the test ones are asked for
    const rows = (await db.prepare("SELECT p.code, p.name, p.state, p.source, p.enrolled_ms, (SELECT COUNT(*) FROM commission c WHERE c.partner_code=p.code AND c.is_test=?) AS sales, (SELECT COALESCE(SUM(amount),0) FROM commission c WHERE c.partner_code=p.code AND status='accrued' AND c.is_test=?) AS accrued FROM partner p WHERE p.is_test=? ORDER BY p.enrolled_ms DESC LIMIT 500").bind(t, t, t).all<any>()).results ?? [];
    return json({ partners: rows });
  }
  if (req.method === "POST" && p === "/api/partners/commission/rate") { // set the rate once it is decided; applies to every sale still waiting for one
    const b = await body(req);
    const rate = Number(b?.rate);
    if (!b || typeof b.rate !== "number" || !(rate >= 0 && rate <= 0.5)) return json({ error: "Rate must be between 0 and 0.5 (50%)." }, 400);
    const rows = (await db.prepare("SELECT id, base FROM commission WHERE status='pending_rate' AND is_test=0").all<any>()).results ?? [];
    if (!(await spend(rows.length + 1))) return busy();
    for (const r of rows) await db.prepare("UPDATE commission SET rate=?, amount=?, status='accrued' WHERE id=? AND status='pending_rate'").bind(rate, r2(r.base * rate), r.id).run();
    return json({ ok: true, applied: rows.length });
  }
  if (req.method === "POST" && p === "/api/partners/payout") { // we paid the partner outside this system; record it once
    const b = await body(req);
    const code = refCode(b?.code);
    if (!b || !code || typeof b.reference !== "string" || b.reference.length < 3) return json({ error: "Give the partner code and the payment reference." }, 400);
    const r = await db.prepare("UPDATE commission SET status='paid', paid_ref=?, paid_ms=? WHERE partner_code=? AND status='accrued' AND is_test=0").bind(b.reference.slice(0, 80), now, code).run();
    await syncCommissions(env, now, { partnerCode: code, limit: 10 }).catch(() => null); // ledger C -> B: the paid rows are posted with the payout reference
    return json({ ok: true, paidRows: r.meta?.changes ?? 0 });
  }
  if (req.method === "POST" && p === "/api/partners/commission/void") { // a refunded purchase earns nothing
    const b = await body(req);
    if (!b || typeof b.paymentId !== "string") return json({ error: "Give the payment id." }, 400);
    const voided = await voidCommission(db, b.paymentId, typeof b.reason === "string" ? b.reason.slice(0, 120) : "refund");
    await syncCommissions(env, now, { paymentId: b.paymentId, limit: 5 }).catch(() => null); // ledger C -> B: the void is posted
    return json({ ok: true, voided });
  }
  if (req.method === "POST" && p === "/api/partners/state") {
    const b = await body(req);
    const code = refCode(b?.code);
    if (!b || !code || !["active", "blocked"].includes(b.state)) return json({ error: "Give the partner code and a state (active or blocked)." }, 400);
    await db.prepare("UPDATE partner SET state=? WHERE code=?").bind(b.state, code).run();
    return json({ ok: true });
  }
  return json({ error: "Not found" }, 404);
}
