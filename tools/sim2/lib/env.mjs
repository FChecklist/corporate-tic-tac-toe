// Paths, ports and the Playwright loader shared by the harness. Everything is overridable by environment variables.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
export const SIM_PORT = Number(process.env.SIM_PORT ?? 8801), WA_PORT = Number(process.env.WA_PORT ?? 8890);
export const SIM = `http://localhost:${SIM_PORT}`, WA = `http://localhost:${WA_PORT}`;
export const PLATFORM_KEY = "sim-platform-key-0123456789"; // SIM_KEYS.platform in server.ts
export const CHROME = process.env.CHROME_EXE ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
export const BUN = process.env.BUN_EXE ?? (existsSync("C:/Users/Dell/AppData/Roaming/npm/node_modules/bun/node_modules/@oven/bun-windows-x64-baseline/bin/bun.exe") ? "C:/Users/Dell/AppData/Roaming/npm/node_modules/bun/node_modules/@oven/bun-windows-x64-baseline/bin/bun.exe" : "bun");
export const SHOTS = join(ROOT, "sim/shots");
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pw;
/** playwright-core, from this repo's junction (devDependency playwright-core) */
export function playwright() {
  if (pw) return pw;
  for (const base of [join(ROOT, "package.json")]) { try { pw = createRequire(base)("playwright-core"); return pw; } catch { /* try next */ } }
  throw new Error("playwright-core not found: run bun install (it is a devDependency)");
}
