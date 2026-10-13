// Cloudflare Pages Function: the short AI work link, https://<site>/ai/<key> (the manual) and /ai/<key>/<api path> (the same API with the key in the address).
// Everything lives in apps/edge/src/worker.ts; this file only hands requests over. See docs/AI_LINK.md.
import { handle } from "../../../apps/edge/src/worker";

export const onRequest = (ctx: { request: Request; env: any; waitUntil: (p: Promise<unknown>) => void }) =>
  handle(ctx.request, ctx.env, Date.now(), (p) => ctx.waitUntil(p));
