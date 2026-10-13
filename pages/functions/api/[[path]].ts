// Cloudflare Pages Function: the whole /api/* surface of Corporate Tic Tac Toe, served from the same address as the website (no CORS, no extra domain).
// Everything lives in apps/edge/src/worker.ts; this file only hands requests over. Static files never reach it (see _routes.json).
import { handle } from "../../../apps/edge/src/worker";

export const onRequest = (ctx: { request: Request; env: any; waitUntil: (p: Promise<unknown>) => void }) =>
  handle(ctx.request, ctx.env, Date.now(), (p) => ctx.waitUntil(p));
