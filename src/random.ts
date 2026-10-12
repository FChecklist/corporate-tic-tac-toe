// Every random choice in a Corporate Tic Tac Toe tournament comes from the public randomness beacon (the same kind of source Corporate Tambola uses for its numbers),
// never from a server and never from a person. The beacon value for a round is published after the previous round has ended, so nobody (the organizer,
// the software, a player) can know a pairing, a starting mark or a tie-break in advance, and anyone can re-compute it afterwards.
// Here the beacon value is just a hex string passed in; `label` separates the different draws made from one value.

const enc = new TextEncoder();
const hex = (b: ArrayBuffer): string => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");
export const sha256Hex = async (s: string): Promise<string> => hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));

/** A deterministic stream of 32-bit numbers from (seed, label). Same input, same stream, on every device. */
export async function stream(seed: string, label: string, count: number): Promise<number[]> {
  const out: number[] = [];
  for (let block = 0; out.length < count; block++) {
    const h = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(`${seed}|${label}|${block}`)));
    for (let i = 0; i + 4 <= h.length && out.length < count; i += 4) out.push(((h[i]! << 24) | (h[i + 1]! << 16) | (h[i + 2]! << 8) | h[i + 3]!) >>> 0);
  }
  return out;
}

/** One fair coin. */
export async function coin(seed: string, label: string): Promise<boolean> { return ((await stream(seed, label, 1))[0]! & 1) === 1; }

/** An unbiased integer in [0, n) by rejection sampling over the stream. */
export async function below(seed: string, label: string, n: number): Promise<number> {
  const limit = Math.floor(0x100000000 / n) * n;
  for (let k = 0; ; k++) { const v = (await stream(seed, `${label}#${k}`, 1))[0]!; if (v < limit) return v % n; }
}

/** A seeded shuffle (Fisher-Yates) of a list. */
export async function shuffled<T>(seed: string, label: string, items: readonly T[]): Promise<T[]> {
  const a = [...items]; const r = await stream(seed, label, Math.max(1, a.length));
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(((r[i]! % 0x100000000) / 0x100000000) * (i + 1)); [a[i], a[j]] = [a[j]!, a[i]!]; }
  return a;
}

export interface Pairing { pairs: [number, number][]; bye: number | null }
/** Pairs the seats still in the tournament at random. With an odd number one seat gets a bye; nobody gets a bye twice unless everybody already had one. */
export async function pairRound(seed: string, round: number, alive: readonly number[], hadBye: ReadonlySet<number> = new Set()): Promise<Pairing> {
  const order = [...alive].sort((a, b) => a - b);
  let bye: number | null = null; let pool = order;
  if (order.length % 2 === 1) {
    const eligible = order.filter((s) => !hadBye.has(s)); const from = eligible.length ? eligible : order;
    bye = from[await below(seed, `bye|${round}`, from.length)]!; pool = order.filter((s) => s !== bye);
  }
  const sh = await shuffled(seed, `pair|${round}`, pool);
  const pairs: [number, number][] = [];
  for (let i = 0; i + 1 < sh.length; i += 2) { const a = sh[i]!, b = sh[i + 1]!; pairs.push(a < b ? [a, b] : [b, a]); }
  return { pairs, bye };
}

/** Who has X (moves first) on each of the three boards of a match: board 1 is a fresh coin, board 2 swaps it, board 3 is a fresh coin of its own. `true` = the lower seat (player A) has X. */
export async function starters(seed: string, round: number, a: number, b: number): Promise<[boolean, boolean, boolean]> {
  const key = `${round}|${a}|${b}`;
  const first = await coin(seed, `x1|${key}`); const third = await coin(seed, `x3|${key}`);
  return [first, !first, third];
}

/** The move placed for a player whose time ran out: a random empty cell, the same on both phones. */
export async function timeoutCell(seed: string, matchKey: string, board: number, seq: number, empties: readonly number[]): Promise<number> {
  return empties[await below(seed, `timeout|${matchKey}|${board}|${seq}`, empties.length)]!;
}

/** The last tie-break of a match (equal points, equal best run, equal last board): true = player A wins. */
export const beaconTieBreak = (seed: string, matchKey: string): Promise<boolean> => coin(seed, `tie|${matchKey}`);
