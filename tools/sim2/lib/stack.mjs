// Start / stop / reset the whole simulation stack: the sim server (:8801), the WhatsApp simulator (:8890). The e-mail sink lives inside the sim server (/__sim/mail).
import { spawn } from "node:child_process";
import { mkdirSync, openSync } from "node:fs";
import { join } from "node:path";
import { BUN, ROOT, SIM, WA, SIM_PORT, WA_PORT, sleep } from "./env.mjs";

async function up(url, ms = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { const r = await fetch(url); if (r.ok) return true; } catch { /* not yet */ } await sleep(300); }
  return false;
}
const alive = async (url) => { try { return (await fetch(url)).ok; } catch { return false; } };

/** Starts what is not already running. Returns { sim, wa, stop(), reset(), started: [...] }. `reuse:false` refuses to attach to something already on the port. */
export async function startStack({ build = true, google = true, reuse = true, logs = join(ROOT, "sim") } = {}) {
  mkdirSync(logs, { recursive: true });
  const procs = [], started = [];
  const launch = (name, script, env) => {
    const out = openSync(join(logs, `${name}.log`), "w");
    const p = spawn(BUN, [join(ROOT, script)], { cwd: ROOT, env: { ...process.env, ...env }, stdio: ["ignore", out, out], windowsHide: true });
    procs.push(p); started.push(name); return p;
  };
  if (await alive(SIM + "/__sim/health")) { if (!reuse) throw new Error(`port ${SIM_PORT} already serves a sim server`); }
  else launch("sim-server", "tools/sim2/server.ts", { SIM_PORT: String(SIM_PORT), SIM_BUILD: build ? "1" : "0", SIM_GOOGLE: google ? "1" : "0" });
  if (await alive(WA + "/health")) { if (!reuse) throw new Error(`port ${WA_PORT} already serves a WhatsApp simulator`); }
  else launch("whatsapp", "tools/sim2/whatsapp/server.ts", { WA_PORT: String(WA_PORT) });
  if (!(await up(SIM + "/__sim/health"))) throw new Error("sim server did not come up; see sim/sim-server.log");
  if (!(await up(WA + "/health", 20000))) throw new Error("WhatsApp simulator did not come up; see sim/whatsapp.log");
  const stack = {
    sim: SIM, wa: WA, started,
    /** fresh database copy from the live copy, clock back to real time, inboxes and mail emptied */
    async reset() { const r = await fetch(SIM + "/__sim/reset", { method: "POST", body: "{}" }); if (!r.ok) throw new Error("reset " + r.status); await fetch(WA + "/api/all", { method: "DELETE" }); return r.json(); },
    stop() { for (const p of procs) { try { p.kill(); } catch { /* gone */ } } },
  };
  return stack;
}
