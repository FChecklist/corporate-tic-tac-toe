// The UI scenario suite's own sim server: the same startSim() as tools/sim2/server.ts, but on its own port (default 8804) and its OWN database file (sim/run-ui.sqlite),
// so it never collides with the shared sim server on 8801 or its sim/run.sqlite. Pages are NOT rebuilt here (SIM_BUILD=0): run.mjs builds pages/public once before starting.
// Run: bun tools/sim2/scenarios/ui/server-ui.ts   (env UI_SIM_PORT=8804)
import { join } from "node:path";
import { startSim } from "../../server";

const ROOT = join(import.meta.dir, "../../../..");
const s = await startSim({ port: Number(process.env.UI_SIM_PORT ?? 8804), runFile: join(ROOT, "sim/run-ui.sqlite"), build: false });
console.log(`SIM-UI READY ${s.url} (db ${s.raw.filename})`);
