// Cloudflare Pages middleware: the old *.pages.dev address redirects page requests (301) to the real address; /api/* keeps working as before.
// With SITE_HIDDEN = "1" the public marketing pages show "coming soon" (apps/edge/src/site-hidden.ts); off: nothing changes.
// With PAY_VIA_CONSOLE = "1" the old pay pages (/pay.html, /paylink.html, /paytest.html) also send people to the console (off: nothing changes).
import { domainRedirect } from "../../apps/edge/src/domain-redirect";
import { BRAND } from "../../apps/edge/src/brand";
import { payRedirect } from "../../apps/edge/src/pay-redirect";
import { siteHidden } from "../../apps/edge/src/site-hidden";

export const onRequest = (ctx: { request: Request; env: any; next: () => Promise<Response> }) =>
  domainRedirect(ctx.request, ctx.env.PUBLIC_ORIGIN || BRAND.defaultOrigin) ?? payRedirect(ctx.request, ctx.env) ?? siteHidden(ctx.request, ctx.env, BRAND.name) ?? ctx.next();
