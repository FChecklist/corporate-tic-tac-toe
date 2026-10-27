// The pause file phones ask for every few seconds is answered once per place per second and shared (far fewer database reads); signed-in calls are never shared.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { publicKeyFromSecret } from "../../../packages/beacon/src/control";
import { call, create, j, keyH, organizer, publish, reset, restore, uid, W } from "./param-harness";

const store = new Map<string, Response>();
const fakeCache = { async match(r: Request) { const x = store.get(r.url); return x ? x.clone() : undefined; }, async put(r: Request, x: Response) { store.set(r.url, x.clone()); } };
beforeEach(() => { reset(); store.clear(); (globalThis as any).caches = { default: fakeCache }; });
afterEach(() => { delete (globalThis as any).caches; restore(); });

describe("shared read of the pause file", () => {
  test("the second ask within the second does not touch the database; a sign-in bypasses the share; an unknown game is never kept", async () => {
    const o = await organizer(); const id = uid(); await create(o.key, id); await publish(o.key, id); expect((await call("PUT", `/api/z/${id}/control/key`, { publicKey: publicKeyFromSecret("11".repeat(32)) }, keyH(o.key))).status).toBe(200); // a game with a signing key has a pause file
    let prepares = 0; const db = W.env.DB as any; const orig = db.prepare.bind(db); db.prepare = (s: string) => { prepares++; return orig(s); };
    const a = await call("GET", `/api/z/${id}/control`); expect(a.status).toBe(200); const first = prepares;
    const b = await call("GET", `/api/z/${id}/control`); expect(b.status).toBe(a.status); expect(prepares).toBe(first); // answered from the share: nothing read
    expect(store.size).toBe(1);
    const signed = await call("GET", `/api/z/${id}/control`, undefined, keyH(o.key)); expect(signed.status).toBe(a.status); expect(prepares).toBeGreaterThan(first); // a signed-in call asks the database itself
    const n0 = store.size; const none = await call("GET", `/api/z/NOGAME-1/control`); expect(none.status).toBe(404); expect(store.size).toBe(n0);
    expect(await j(b)).toEqual(await j(a));
  });
});
