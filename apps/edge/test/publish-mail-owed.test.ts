// R3 (5 Nov 2026 audit, Option B): Publish saves the game in one all-or-nothing step and then sends the confirmation e-mail. If a passing database hiccup hits in the short gap, the game IS published
// but the e-mail used to be lost for good (a repeat said "already published" and sent nothing). Now "e-mail owed" is recorded in the same step as the publish and the e-mail goes out on the next visit, once.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { W, contact, create, j, mails, one, organizer, publish, reset, restore, uid } from "./param-harness";

const OVERLOAD = "D1_ERROR: D1 DB is overloaded. Too many resources consumed within a 10 second window";
const wrapStmt = (s: any, fail: (sql: string) => void, sql: string): any => new Proxy(s, {
  get(t, k) {
    const v = t[k];
    if (k === "__raw") return t;
    if (k === "bind") return (...a: any[]) => wrapStmt(v.apply(t, a), fail, sql);
    if (k === "first" || k === "run" || k === "all" || k === "raw") return async (...a: any[]) => { fail(sql); return v.apply(t, a); };
    return v;
  },
});
const flaky = (fail: (sql: string) => void) => {
  const real = W.env.DB as any;
  (W.env as any).DB = { prepare: (sql: string) => wrapStmt(real.prepare(sql), fail, sql), batch: async (xs: any[]) => { fail("BATCH"); return real.batch(xs.map((x) => x.__raw ?? x)); } };
};
const owedRows = (id: string) => one("SELECT COUNT(*) c FROM kv WHERE k=?", `mailowed/${id}`).c as number;

describe("R3: the publish e-mail is never lost to a database hiccup", () => {
  beforeEach(() => reset()); afterEach(() => restore());

  test("a normal publish: one e-mail, nothing left owed", async () => {
    const o = await organizer(); const id = uid("PM"); expect((await create(o.key, id)).status).toBe(200);
    expect((await publish(o.key, id)).status).toBe(200);
    expect(mails(contact.email).length).toBe(1); expect(owedRows(id)).toBe(0);
  });

  test("the database hiccups right after the game was saved: busy answer, e-mail owed; the next visit sends it exactly once", async () => {
    const o = await organizer(); const id = uid("PM"); expect((await create(o.key, id)).status).toBe(200);
    let n = 1; flaky((sql) => { if (n > 0 && sql.startsWith("INSERT INTO outbox")) { n--; throw new Error(OVERLOAD); } });
    const r1 = await publish(o.key, id); expect(r1.status).toBe(503); expect((await j(r1)).code).toBe("busy");
    expect(n).toBe(0);
    expect(mails(contact.email).length).toBe(0); // nothing went out yet ...
    expect(owedRows(id)).toBe(1); // ... but it is written down, in the same step as the publish
    const r2 = await j(await publish(o.key, id)); expect(r2.published).toBe(true); expect(r2.already).toBe(true);
    expect(mails(contact.email).length).toBe(1); expect(owedRows(id)).toBe(0);
    expect((await publish(o.key, id)).status).toBe(200);
    expect(mails(contact.email).length).toBe(1); // a third visit sends nothing more
  });
});
