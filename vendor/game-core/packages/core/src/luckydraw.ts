// Reference implementation for the Lucky Draw type: register once, registration closes at draw time, the draw uses the public beacon,
// auto at the time or a manual Draw press. The Organizer sets winners and prizes; the result is shown to all and e-mailed to winners ("You won").
export interface DrawState { entries: string[]; closeAt: number; winners: number; mode: "auto" | "manual"; drawn?: string[]; beacon?: string }
export const drawInit = (closeAt: number, winners: number, mode: "auto" | "manual"): DrawState => ({ entries: [], closeAt, winners, mode });
/** Register once; closes at draw time (game time). Returns the same state when refused. */
export function register(st: DrawState, id: string, now: number): { state: DrawState; why?: string } {
  if (st.drawn) return { state: st, why: "The draw is done." };
  if (now >= st.closeAt) return { state: st, why: "Registration is closed." };
  if (st.entries.includes(id)) return { state: st, why: "You are already in the draw." };
  return { state: { ...st, entries: [...st.entries, id] } };
}
/** Auto draws when the time comes; manual waits for the Organizer or Host to press Draw. */
export const drawReady = (st: DrawState, now: number, pressed: boolean): boolean => !st.drawn && (st.mode === "auto" ? now >= st.closeAt : pressed);
const hash = async (s: string): Promise<number> => {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  return ((d[0]! << 24) | (d[1]! << 16) | (d[2]! << 8) | d[3]!) >>> 0;
};
/** Anyone with the entries and the beacon value gets the same winners: sorted entries, pick by hash(beacon|i) among those left. */
export async function draw(st: DrawState, beacon: string): Promise<DrawState> {
  if (st.drawn) return st;
  const pool = [...st.entries].sort();
  const winners: string[] = [];
  for (let i = 0; i < Math.min(st.winners, pool.length); i++) winners.push(pool.splice((await hash(`${beacon}|${i}`)) % pool.length, 1)[0]!);
  return { ...st, drawn: winners, beacon };
}
