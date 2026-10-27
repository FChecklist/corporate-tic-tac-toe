// Winners are decided by the software: several different phones report the same winners and the store accepts the result. Tests use this to put a result in place.
import { SEEN_DEVICES } from "./device";
type CallFn = (method: string, path: string, body?: unknown, headers?: Record<string, string>, now?: number) => Promise<Response>;
export interface Res { pattern: string; ordinal?: number; round?: number; idx: number; pids: string[] }
export async function settleByPhones(call: CallFn, eid: string, results: Res[], voters: string[], now?: number): Promise<void> {
  for (const pid of voters) for (let i = 0; i < results.length; i += 3) {
    const body = { pid, results: results.slice(i, i + 3).map((r) => ({ ordinal: 1, round: 1, ...r })) };
    for (const device of SEEN_DEVICES) { const r = await call("POST", `/api/z/${eid}/vote`, { ...body, device }, {}, now); if (r.status !== 403) break; } // the phone's own device id goes with its vote: the one that fits this card is the one that is let through
  }
}
