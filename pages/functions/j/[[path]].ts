// Cloudflare Pages Function: the short personal invitation link, https://<site>/j/<token> (see apps/edge/src/people.ts). It only hands the request to the Worker code.
import { handle } from "../../../apps/edge/src/worker";

export const onRequest = (ctx: { request: Request; env: any; waitUntil: (p: Promise<unknown>) => void }) =>
  handle(ctx.request, ctx.env, Date.now(), (p) => ctx.waitUntil(p));
