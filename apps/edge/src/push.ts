// "Notify me when this game begins": this game's side of the corporate-push service (FChecklist/corporate-push). DARK: nothing in this file does anything unless BOTH settings exist,
// PUSH_URL (the service's https address, a plain setting) and PUSH_ADMIN_KEY (a secret, at least 32 characters, never written to a file, a log or an answer).
//   - a begin message goes out ONCE per game, when the game really starts (POST /send {scope:"game:<id>", kind:"game_begins", title, body, url:<the game link>});
//   - every time this game's own data is deleted (lifecycle.ts erasePersonal: the 24-hour job, the Organizer's delete, an e-mailed erasure request) the service is told to forget the game (POST /purge {scope:"game:<id>"}).
// The service only ever holds a browser address and two keys for a game (no name, e-mail or phone), deletes a game's rows 24 hours after the tap at the latest even if this call is lost,
// and refuses a link that is not on one of the company's own sites (its ALLOWED_ORIGINS_EXTRA must list this site's host: a deploy setting, not code).
// A failed or slow call never stops a game from starting or its data from being deleted: it is one try, with a short time limit, and the answer is not shown to anybody.
import type { Env } from "./worker";

export interface PushEnv { PUSH_URL?: string; PUSH_ADMIN_KEY?: string }

const GAME_ID = /^[A-Za-z0-9_-]{1,128}$/; // the service accepts exactly this for "game:<id>"
const ORIGIN = /^https:\/\/[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+(:[0-9]{1,5})?$/;
export const PUSH_TIMEOUT_MS = 3000;
const PAUSE_AFTER_FAILURE_MS = 30_000;
/** The words of the message (simple English, no "your"). The browser shows them as the title and the text of the notification. */
export const BEGIN_TITLE = "The game is starting";
export const BEGIN_BODY = "Tap to open the game.";

let failedAt = 0; // one slow or failed call pauses the rest for a short while, so a service that is down cannot slow the job that deletes people's data (reset by tests)
export const resetPushState = () => { failedAt = 0; };

/** The two settings, or null while either is missing or wrong: then nothing is sent and nothing is written. */
export function pushSettings(env: PushEnv): { url: string; key: string } | null {
  const url = String(env.PUSH_URL ?? "").trim().replace(/\/+$/, ""), key = String(env.PUSH_ADMIN_KEY ?? "");
  return ORIGIN.test(url) && key ? { url, key } : null;
}

async function call(env: PushEnv, path: "/send" | "/purge", body: Record<string, unknown>): Promise<boolean> {
  const s = pushSettings(env);
  if (!s || Date.now() - failedAt < PAUSE_AFTER_FAILURE_MS) return false;
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), PUSH_TIMEOUT_MS);
  try {
    const res = await fetch(s.url + path, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + s.key }, body: JSON.stringify(body), signal: ctl.signal, redirect: "error" });
    if (!res.ok && res.status >= 500) failedAt = Date.now();
    return res.ok;
  } catch { failedAt = Date.now(); return false; } // never a reason to stop anything; the key is not in the error text and nothing is logged
  finally { clearTimeout(timer); }
}

/** The link a player taps: the game page of this game on the public address (the same default as the report mail, lifecycle.ts). */
export const gameLink = (env: Env, eid: string, fallbackOrigin = ""): string => `${String((env as { PUBLIC_ORIGIN?: string }).PUBLIC_ORIGIN ?? (fallbackOrigin || "https://tictactoe.corporatetambola.com")).replace(/\/+$/, "")}/z.html?e=${encodeURIComponent(eid)}`;

/** Sends the begin message for this game, once. The flag is taken first (one row in kv, `pushbegin/<id>`, erased with the game), so two presses or a press and the job cannot both send. Returns true when this call sent it. */
export async function announceBegin(env: Env, eid: string, fallbackOrigin = ""): Promise<boolean> {
  if (!pushSettings(env as PushEnv) || !GAME_ID.test(eid)) return false; // dark: not even the flag is written
  const link = gameLink(env, eid, fallbackOrigin);
  if (!link.startsWith("https://")) return false; // the service refuses anything that is not a company https link: do not use up the one send
  const claim = await env.DB.prepare("INSERT OR IGNORE INTO kv(k,v) VALUES(?,?)").bind(`pushbegin/${eid}`, String(Date.now())).run();
  if ((claim.meta?.changes ?? 0) === 0) return false; // already sent (or being sent) for this game
  return call(env as PushEnv, "/send", { scope: `game:${eid}`, kind: "game_begins", title: BEGIN_TITLE, body: BEGIN_BODY, url: link });
}

/** Tells the service to forget this game. Called whenever the game's own data is deleted. */
export async function purgeGame(env: Env, eid: string): Promise<boolean> {
  if (!pushSettings(env as PushEnv) || !GAME_ID.test(eid)) return false;
  return call(env as PushEnv, "/purge", { scope: `game:${eid}` });
}

/** Run by the minute job: a game whose published start has now come (the new flow can be started up to an hour ahead) and was not announced yet. At most 20 a call. */
export async function announceDueGames(env: Env, now: number): Promise<number> {
  if (!pushSettings(env as PushEnv)) return 0;
  const due = (await env.DB.prepare("SELECT t.eid AS eid FROM ttt_t t WHERE t.state='running' AND t.started_ms IS NOT NULL AND t.started_ms<=? AND t.started_ms>? AND NOT EXISTS (SELECT 1 FROM kv WHERE k='pushbegin/'||t.eid) LIMIT 20").bind(now, now - 6 * 3_600_000).all<{ eid: string }>()).results ?? [];
  let sent = 0;
  for (const g of due) if (await announceBegin(env, g.eid)) sent++;
  return sent;
}
