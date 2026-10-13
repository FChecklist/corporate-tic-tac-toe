// Test stand-in for Cloudflare D1, backed by bun:sqlite. Same prepare/bind/run/all/first/batch shape.
import { Database } from "bun:sqlite";
import { CONSENT_VERSION } from "../src/consent";
import { SCHEMA, type D1, type D1Stmt } from "../src/worker";

/**
 * `strictHosts: true` is the real rule (a new Host must confirm an e-mail and add a mobile number before the console works; apps/edge/test/host-setup.test.ts).
 * By default a trigger finishes that setup the moment a Host is created, so the older tests (roles, people, cancel...) can use a Host key straight away.
 */
export function makeD1(opts: { strictHosts?: boolean } = {}): { db: D1; raw: Database } {
  const raw = new Database(":memory:");
  for (const s of SCHEMA) raw.run(s);
  if (!opts.strictHosts) raw.run("CREATE TRIGGER IF NOT EXISTS test_hosts_ready AFTER INSERT ON host_state BEGIN UPDATE host_state SET verified_ms=1, mobile_ok=1 WHERE host_id=NEW.host_id; END");
  // a Co-host key counts as having ticked the Co-host box (K5) in the older tests; consent.test.ts uses strictHosts:true and proves the server refuses without it
  if (!opts.strictHosts) raw.run(`CREATE TRIGGER IF NOT EXISTS test_cohost_k5 AFTER INSERT ON organizer_key WHEN NEW.kind='cohost' BEGIN INSERT INTO consent_log(id,subject,kind,ref,version,boxes,text_hash,at_ms) VALUES('test-'||NEW.hash,'key:'||substr(NEW.hash,1,16),'K5',NEW.eid,'${CONSENT_VERSION}','A','test',0); END`);
  const stmt = (sql: string, vals: unknown[] = []): D1Stmt => ({
    bind: (...v) => stmt(sql, v),
    run: async () => { const r = raw.query(sql).run(...(vals as any[])); return { meta: { changes: r.changes } }; },
    all: async () => ({ results: raw.query(sql).all(...(vals as any[])) as any[] }),
    first: async () => (raw.query(sql).get(...(vals as any[])) as any) ?? null,
  });
  return { db: { prepare: (s) => stmt(s), batch: async (xs) => Promise.all(xs.map((x) => x.run())) }, raw };
}
