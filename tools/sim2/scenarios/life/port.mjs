// Imported FIRST by every life module: points the shared harness (lib/env.mjs reads SIM_PORT at import time) at the life sim server (8803), never at 8801/8802.
process.env.SIM_PORT = process.env.LIFE_PORT ?? "8803";
process.env.WA_PORT = process.env.WA_PORT ?? "8893";
