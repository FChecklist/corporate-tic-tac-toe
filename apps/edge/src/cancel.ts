// Cancel a game, and the e-mails around it (round 2 spec item 1; rewritten by docs/ROLES_AND_CONSOLE_SPEC_6.md: THERE ARE NO REFUNDS).
//   - Only the Organizer and a Host may cancel (worker.ts checks the key; a Host's cancel also tells the Organizer, who is always on the mail list). Unpaid: any time, no money is involved.
//     Paid: only BEFORE the start time. Once the start time has passed a paid game has started, so it cannot be cancelled.
//   - Cancelling a PAID game turns what was paid into CREDIT for the account, valid 365 days from the date of the original payment (credit.ts). Credit that had been used to pay for the game
//     comes back to the same credit with the same expiry. There is no refund, no gateway call, no refund fee, no credit note, and the partner's commission on the sale stays as earned.
//   - The guests' names and numbers are erased 23 hours after the cancel time by the normal lifecycle tick (lifecycle.ts); a Co-host's name and number go at once.
// Nothing here may carry an AI link (mails.ts is the only place that builds those).
import { zoneStamp, tzOfRow } from "./tz";
import { creditExpiryMs, creditFromPayment, creditLastDay, mailTeam, NO_REFUND_LINE, restoreCreditUses, rs, teamEmails, type CreditRow } from "./credit";
import type { PayEnv } from "./pay";
import type { D1 } from "./worker";

export { teamEmails };
const r2 = (x: number) => Math.round(x * 100) / 100;
/** A PAID game that was cancelled can be moved to a new date at any time within 365 days of the payment (the credit that the cancel made ends at the same moment). */
export const RESCHEDULE_WINDOW_MS = 365 * 86_400_000;
export const rescheduleUntilMs = (cancelledMs: number): number => cancelledMs + RESCHEDULE_WINDOW_MS;
const GENESIS = 1692803367;
const roundMs = (r: number) => (GENESIS + (r - 1) * 3) * 1000;
const istStamp = (ms: number, tz?: string) => zoneStamp(ms, tz);

/** What cancelling (or having cancelled) a paid game leaves the account: one amount and the earliest date any of it lapses. */
export interface CreditView { id: string; amountInr: number; expiresMs: number }

/** The paid payments of a game: the ones made for it, and the earlier one whose pack it was published with. */
export async function paymentsOfGame(db: D1, eid: string): Promise<any[]> {
  return (await db.prepare("SELECT * FROM payment WHERE status='paid' AND (eid=? OR id IN (SELECT payment_id FROM entitlement WHERE eid=?)) ORDER BY paid_ms").bind(eid, eid).all<any>()).results ?? [];
}

/** What a cancel would put in the account (before it happens): the cash paid for the game, plus any credit that had been used for it, which comes back with its own expiry. */
async function creditIfCancelled(db: D1, eid: string): Promise<CreditView | null> {
  const pays = await paymentsOfGame(db, eid);
  const uses = (await db.prepare("SELECT cu.credit_id AS credit_id, cu.amount_inr AS amount, c.expires_ms AS exp FROM credit_use cu JOIN credit c ON c.id=cu.credit_id WHERE cu.eid=? AND cu.status='applied'").bind(eid).all<{ credit_id: string; amount: number; exp: number }>()).results ?? [];
  const cash = pays.filter((p) => p.amount > 0.004);
  const total = r2(cash.reduce((t, p) => t + p.amount, 0) + uses.reduce((t, u) => t + u.amount, 0));
  if (!(total > 0.004)) return null;
  const exps = [...cash.map((p) => creditExpiryMs(p.paid_ms ?? 0)), ...uses.map((u) => u.exp)];
  return { id: cash.length ? "(on cancel)" : uses[0]!.credit_id, amountInr: total, expiresMs: Math.min(...exps) };
}
/** What a cancelled game left in the account (credit made from its payments, and credit given back). */
async function creditOfCancelled(db: D1, eid: string): Promise<CreditView | null> {
  const made = (await db.prepare("SELECT * FROM credit WHERE eid=? AND kind='cancel' AND status<>'revived' ORDER BY created_ms, id").bind(eid).all<CreditRow>()).results ?? [];
  const back = (await db.prepare("SELECT cu.credit_id AS credit_id, cu.amount_inr AS amount, c.expires_ms AS exp FROM credit_use cu JOIN credit c ON c.id=cu.credit_id WHERE cu.eid=? AND cu.status='restored'").bind(eid).all<{ credit_id: string; amount: number; exp: number }>()).results ?? [];
  const total = r2(made.reduce((t, c) => t + c.total_inr, 0) + back.reduce((t, u) => t + u.amount, 0));
  if (!(total > 0.004)) return null;
  return { id: made[0]?.id ?? back[0]!.credit_id, amountInr: total, expiresMs: Math.min(...made.map((c) => c.expires_ms), ...back.map((u) => u.exp)) };
}

/** Can this game be cancelled right now, and what would it leave in the account? (GET /api/z/{id}/cancel-preview) */
export async function cancelPreview(env: PayEnv, e: any, now: number): Promise<{ canCancel: boolean; reason?: string; paid: boolean; cancelled?: boolean; credit: { amountInr: number; expiresMs: number; id?: string } | null; rescheduleUntilMs?: number; canReschedule?: boolean; rescheduleReason?: string; rescheduleDays?: number; maxStartMs?: number }> {
  const paid = e.pack !== 0;
  if (e.cancelled_ms) {
    const c = await creditOfCancelled(env.DB, e.id), rb = await reopenBlocker(env.DB, e, now);
    return { canCancel: false, reason: "This game is already cancelled.", paid, cancelled: true, credit: c, ...(paid ? { rescheduleUntilMs: rescheduleUntilMs(e.cancelled_ms) } : {}), canReschedule: !rb.reason, ...(rb.reason ? { rescheduleReason: rb.reason } : { maxStartMs: Math.min(rb.maxStartMs, now + 30 * 86_400_000) }) };
  }
  if (paid && roundMs(e.start_round) <= now) return { canCancel: false, reason: "The start time has passed and this game is paid, so it cannot be cancelled now. Please use End the game instead.", paid, credit: null };
  if (e.unplayed_ms) return { canCancel: false, reason: "This game did not start and is closed. You can create a new game like this one.", paid, credit: null };
  const c = await creditIfCancelled(env.DB, e.id); // a paid game: what was paid. Any game: credit that had been applied to it comes back
  return { canCancel: true, paid, credit: c ? { amountInr: c.amountInr, expiresMs: c.expiresMs } : null, ...(paid ? { rescheduleDays: 30 } : {}) };
}

/**
 * Can a cancelled PAID game still be moved to a new date? Three things must hold: (1) 365 days have not passed since the payment; (2) the credit that the cancel made from this game's payments has not been
 * used for another game (the money is then no longer here to move back); (3) every part of that money is still alive (not past day 365 after its payment). The latest allowed start is just before the first lapse,
 * so a moved game is always played inside the 365 days. Returns the reason in plain words, or the latest allowed start.
 */
type RestoredUse = { id: number; credit_id: string; amount_inr: number; exp: number };
async function reopenBlocker(db: D1, e: any, now: number): Promise<{ reason?: string; maxStartMs: number; made: CreditRow[]; restored: RestoredUse[] }> {
  const none = { maxStartMs: 0, made: [] as CreditRow[], restored: [] as RestoredUse[] };
  if (!e.cancelled_ms) return { ...none, reason: "This game is not cancelled." };
  if (e.pack === 0) return { ...none, reason: "Nothing was paid for this game, so there is nothing to move. You can create a new game like this one." };
  if (now >= rescheduleUntilMs(e.cancelled_ms)) return { ...none, reason: `This game can no longer be moved: 365 days have passed since the payment. Your payment stays as credit for a new game while it lasts.` };
  const made = (await db.prepare("SELECT * FROM credit WHERE eid=? AND kind='cancel' AND status<>'revived' ORDER BY created_ms, id").bind(e.id).all<CreditRow>()).results ?? [];
  const restored = (await db.prepare("SELECT cu.id AS id, cu.credit_id AS credit_id, cu.amount_inr AS amount_inr, c.expires_ms AS exp FROM credit_use cu JOIN credit c ON c.id=cu.credit_id WHERE cu.eid=? AND cu.status='restored'").bind(e.id).all<RestoredUse>()).results ?? [];
  for (const c of made) {
    if (c.status === "expired" || c.expires_ms <= now) return { ...none, reason: "The credit from this payment has lapsed (365 days after the payment), so the game can no longer be moved." };
    if (c.status !== "active" || Math.round(c.remaining_inr * 100) !== Math.round(c.total_inr * 100)) return { ...none, reason: "The credit from this payment has already been used for another game, so this game can no longer be moved. What is left of the credit is still yours for a new game." };
  }
  for (const u of restored) if (u.exp <= now) return { ...none, reason: "Part of the credit that paid for this game has lapsed, so the game can no longer be moved." };
  const exps = [...made.map((c) => c.expires_ms), ...restored.map((u) => u.exp)];
  return { maxStartMs: exps.length ? Math.min(...exps) - 1 : Number.MAX_SAFE_INTEGER, made, restored };
}

/**
 * Moves a cancelled PAID game to a new date (product rule 2026-10-09). The game keeps its payment: the credit that the cancel made is taken back out of the account (marked `revived`, so the money can never be
 * spent twice), credit that had paid for the game goes back onto the game, the cancel mark is cleared and the new start time is set. Guests must join again (their data was erased 23 hours after the cancel).
 * `maxAheadMs` = how far ahead a game time may be set. Every step that changes money is guarded and undone if a later step fails.
 */
export async function reopenGame(env: PayEnv, e: any, startRound: unknown, now: number, by: string, maxAheadMs: number): Promise<{ status: number; body: any }> {
  const db = env.DB;
  const fail = (status: number, error: string, code: string) => ({ status, body: { error, code } });
  if (!e.cancelled_ms) return fail(409, "This game is not cancelled.", "not-cancelled");
  const rb = await reopenBlocker(db, e, now);
  if (rb.reason) return fail(409, rb.reason, e.pack === 0 ? "unpaid" : now >= rescheduleUntilMs(e.cancelled_ms) ? "window-closed" : "credit-gone");
  if (typeof startRound !== "number" || !Number.isInteger(startRound) || startRound < 1) return fail(400, "Pick the new start date and time.", "start");
  const startMs = roundMs(startRound);
  if (startMs <= now) return fail(400, "Pick a start time in the future.", "start");
  if (startMs > now + maxAheadMs) return fail(400, "A paid game can be moved to any date within 365 days of the payment.", "too-far");
  if (startMs > rb.maxStartMs) return fail(400, `Pick a date on or before ${creditLastDay(rb.maxStartMs + 1)}: the money for this game must be used within 365 days of the payment.`, "after-credit-end");
  const undo: (() => Promise<unknown>)[] = [];
  const rollback = async () => { for (const u of undo.reverse()) { try { await u(); } catch { /* best effort: every step above is guarded, so money is never half moved */ } } };
  // 1) take the credit the cancel made out of the account
  for (const c of rb.made) {
    const tag = c.payment_id === null ? null : `rev:${c.payment_id}:${now}`; // the payment can make credit again if the game is cancelled a second time
    const r = await db.prepare("UPDATE credit SET status='revived', remaining_inr=0, payment_id=? WHERE id=? AND status='active' AND expires_ms>? AND CAST(ROUND(remaining_inr*100) AS INTEGER)=CAST(ROUND(total_inr*100) AS INTEGER)").bind(tag, c.id, now).run();
    if ((r.meta?.changes ?? 0) === 0) { await rollback(); return fail(409, "The credit from this payment was just used for another game, so this game can no longer be moved.", "credit-gone"); }
    undo.push(() => db.prepare("UPDATE credit SET status='active', remaining_inr=total_inr, payment_id=? WHERE id=? AND status='revived'").bind(c.payment_id, c.id).run());
  }
  // 2) put the credit that had paid for the game back onto it
  for (const u of rb.restored) {
    const amt = r2(u.amount_inr);
    const r = await db.prepare("UPDATE credit SET remaining_inr=ROUND(remaining_inr-?,2), status=CASE WHEN CAST(ROUND((remaining_inr-?)*100) AS INTEGER)<=0 THEN 'used' ELSE 'active' END WHERE id=? AND status='active' AND expires_ms>? AND CAST(ROUND(remaining_inr*100) AS INTEGER)>=CAST(ROUND(?*100) AS INTEGER)").bind(amt, amt, u.credit_id, now, amt).run();
    if ((r.meta?.changes ?? 0) === 0) { await rollback(); return fail(409, "Part of the credit that paid for this game was just used for another game, so this game can no longer be moved.", "credit-gone"); }
    const f = await db.prepare("UPDATE credit_use SET status='applied', restored_ms=NULL WHERE id=? AND status='restored'").bind(u.id).run();
    const back = async () => { await db.prepare("UPDATE credit SET remaining_inr=ROUND(remaining_inr+?,2), status='active' WHERE id=?").bind(amt, u.credit_id).run(); await db.prepare("UPDATE credit_use SET status='restored', restored_ms=? WHERE id=?").bind(now, u.id).run(); };
    if ((f.meta?.changes ?? 0) === 0) { await db.prepare("UPDATE credit SET remaining_inr=ROUND(remaining_inr+?,2), status='active' WHERE id=?").bind(amt, u.credit_id).run(); await rollback(); return fail(409, "Please try again.", "busy"); }
    undo.push(back);
  }
  // 3) the game itself comes back, with its new time
  const up = await db.prepare("UPDATE engagement SET cancelled_ms=NULL, cancelled_by=NULL, start_round=? WHERE id=? AND cancelled_ms=? AND pack<>0").bind(startRound, e.id, e.cancelled_ms).run();
  if ((up.meta?.changes ?? 0) === 0) { await rollback(); return fail(409, "Please try again.", "busy"); }
  await db.prepare("DELETE FROM life WHERE eid=? AND report_ms IS NULL").bind(e.id).run(); // the 23-hour clock of the cancel no longer applies; the game gets a fresh lifecycle
  await db.prepare("DELETE FROM kv WHERE k=?").bind(`startpending/${e.id}`).run();
  await db.prepare("INSERT OR REPLACE INTO kv(k,v) VALUES(?,?)").bind(`reopened/${e.id}/${now}`, JSON.stringify({ by, ms: now, wasCancelledMs: e.cancelled_ms, startRound })).run(); // the trail: who moved it, and when
  let name = e.id; try { name = JSON.parse(e.config ?? "{}").name || e.id; } catch { /* the id */ }
  const who = by === "host" ? "a Host" : by === "master" ? "the Organizer" : "the platform owner";
  await mailTeam(env, e.org, e.id, `Your game is back on: ${name}`, [`The game "${name}" (${e.id}) was moved to a new date by ${who}. It now starts on ${istStamp(startMs, tzOfRow(e))}.`, "Your payment stays with this game, so nothing more is due. The credit that the cancel made is taken back out of your account.", "Guests who had joined must join again: their names and numbers were erased after the cancel. Send them the link once more."].join("\n\n"), now);
  return { status: 200, body: { ok: true, reopened: true, startRound, startMs } };
}


/** A Co-host's name and mobile number, and their key, go away (at the 23-hour erasure of the game's participant data, or at cancel). */
export const eraseCohostsSql = "UPDATE organizer_key SET revoked=1, label=NULL, pii=NULL WHERE eid=? AND kind='cohost'";

/**
 * The cancel itself. The caller has already checked who is asking and that the body said confirmations: 3. Returns the HTTP status and body.
 * `by` is the key kind that cancelled (master, host or platform). A second cancel changes nothing and answers the same.
 */
export async function cancelGame(env: PayEnv, e: any, now: number, by: string): Promise<{ status: number; body: any }> {
  const db = env.DB;
  const view = (c: CreditView | null) => (c ? { id: c.id, amountInr: c.amountInr, expiresMs: c.expiresMs } : null);
  if (e.cancelled_ms) return { status: 200, body: { ok: true, cancelled: true, already: true, credit: view(await creditOfCancelled(db, e.id)) } };
  const pre = await cancelPreview(env, e, now);
  if (!pre.canCancel) return { status: 409, body: { error: pre.reason, canCancel: false } };
  const up = await db.prepare("UPDATE engagement SET cancelled_ms=?, cancelled_by=? WHERE id=? AND cancelled_ms IS NULL").bind(now, by, e.id).run();
  if ((up.meta?.changes ?? 0) === 0) return { status: 200, body: { ok: true, cancelled: true, already: true, credit: view(await creditOfCancelled(db, e.id)) } }; // someone cancelled at the same moment
  await db.prepare(eraseCohostsSql).bind(e.id).run(); // Co-hosts of this game: name, mobile and key go now
  await db.prepare("DELETE FROM kv WHERE k=?").bind(`ann/${e.id}`).run();
  let credit: CreditView | null = null; const made: CreditRow[] = [];
  await restoreCreditUses(db, e.id, now); // credit that was applied to this game goes back to where it came from, expiry unchanged (paid or not)
  if (e.pack !== 0) for (const p of await paymentsOfGame(db, e.id)) { const c = await creditFromPayment(db, p, e.org, e.id, now, "cancel"); if (c && c.kind === "cancel") made.push(c); }
  credit = await creditOfCancelled(db, e.id);
  // one "game cancelled" mail to the Organizer and each Host (the Organizer is always told, also when a Host cancelled)
  let name = e.id; try { name = JSON.parse(e.config ?? "{}").name || e.id; } catch { /* the id */ }
  const who = by === "host" ? "a Host" : by === "master" ? "the Organizer" : "the platform owner";
  const test = made.some((c) => c.is_test);
  const lines = [
    `The game "${name}" (${e.id}) was cancelled by ${who} on ${istStamp(now, tzOfRow(e))}. It was due to start on ${istStamp(roundMs(e.start_round), tzOfRow(e))}.`,
    "Guests who open the link are told: This game was cancelled by the organizer. Their names and mobile numbers are deleted within 24 hours.",
    credit && e.pack !== 0
      ? `Your game is cancelled. ${credit.expiresMs <= now ? `The credit from your payment of ${rs(credit.amountInr)} lapsed on ${creditLastDay(credit.expiresMs)}, 365 days after the payment, so there is nothing left to use.` : `Your payment of ${rs(credit.amountInr)} stays as credit until ${creditLastDay(credit.expiresMs)}. Use it for your next game.`}${test ? " (This is a TEST game: nothing was really paid.)" : ""}\n\n${NO_REFUND_LINE}${credit.expiresMs <= now ? "" : `\n\nYou can also move this game to a new date until ${istStamp(rescheduleUntilMs(now))}: open it in your console and choose a new date. Your payment then stays with this game. If you use the credit for another game first, this game can no longer be moved.`}`
      : e.pack !== 0 ? "Nothing was paid for this game through this service, so there is no credit." : "The game had not been paid for, so no money is involved.",
    ...(e.pack === 0 && credit ? [`The credit you had applied to this game (${rs(credit.amountInr)}) is back in your account, valid until ${creditLastDay(credit.expiresMs)}.`] : []),
  ];
  for (const c of made) await db.prepare("UPDATE credit SET mail_created_ms=? WHERE id=? AND mail_created_ms IS NULL").bind(now, c.id).run(); // this mail is the "credit created" mail: one of each per credit
  await mailTeam(env, e.org, e.id, `Game cancelled: ${name}`, lines.join("\n\n"), now);
  return { status: 200, body: { ok: true, cancelled: true, credit: view(credit), ...(e.pack !== 0 ? { rescheduleUntilMs: rescheduleUntilMs(now) } : {}) } };
}

/**
 * "Your guests' personal data has been deleted": to the Organizer and the Host(s), at the automatic deletion, with the exact time (IST). Best effort; never blocks the deletion.
 * `didNotStart` = the wording for a game that never began ("Your game did not start. We erased the guest list at <time>.").
 */
export async function mailDataDeleted(env: PayEnv, e: { id: string; org: string | null; config?: string | null }, now: number, opts: { didNotStart?: boolean } = {}): Promise<void> {
  try {
    let name = e.id; try { name = JSON.parse(e.config ?? "{}").name || e.id; } catch { /* the id */ }
    if (opts.didNotStart) {
      await mailTeam(env, e.org, e.id, `Your game did not start: ${name}`, [`Your game did not start. We erased the guest list at ${istStamp(now, tzOfRow(e))}.`, `For the game "${name}" (${e.id}), every guest's name and mobile number was permanently deleted, as promised. The game is now closed: nobody can join or pay for it.`, "Your own details and your settings stay. Open the game and tap Create a new game like this one to start again with the same settings."].join("\n\n"), now);
      return;
    }
    const text = [`Your guests' personal data has been deleted.`, `For the game "${name}" (${e.id}), every guest's name and mobile number was permanently deleted on ${istStamp(now, tzOfRow(e))}, as promised.`, "Nothing more is needed from you. The winners record (seat number, prize, time) stays for your records, as explained in your Terms."].join("\n\n");
    await mailTeam(env, e.org, e.id, `Your guests' personal data has been deleted: ${name}`, text, now);
  } catch { /* the deletion already happened; a mail is a courtesy */ }
}

/** The heads-up, about 6 hours before the erasure of a game that did not start ("Tap to reschedule and keep it."). */
export async function mailErasureHeadsUp(env: PayEnv, e: { id: string; org: string | null; config?: string | null }, erasureMs: number, now: number): Promise<void> {
  try {
    let name = e.id; try { name = JSON.parse(e.config ?? "{}").name || e.id; } catch { /* the id */ }
    const origin = env.PUBLIC_ORIGIN ?? "";
    await mailTeam(env, e.org, e.id, `Your game time has passed: ${name}`, [`Your game time has passed. Guest data will be erased at ${istStamp(erasureMs, tzOfRow(e))}. Tap to reschedule and keep it.`, `${origin}/zc.html?e=${e.id}`, "If the game is not paid for and not moved, it closes then: nobody can join or pay, and the guest list is erased. Your settings stay for 30 days so you can create a new game like this one."].join("\n\n"), now);
  } catch { /* a heads-up is a courtesy */ }
}


