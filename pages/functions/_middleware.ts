// Cloudflare Pages middleware: the old *.pages.dev address redirects page requests (301) to the real address; /api/* keeps working as before.
import { domainRedirect } from "../../apps/edge/src/domain-redirect";
import { BRAND } from "../../apps/edge/src/brand";
// With SITE_HIDDEN = "1" the public marketing pages show "coming soon" (apps/edge/src/site-hidden.ts); off: nothing changes.
import { siteHidden } from "../../apps/edge/src/site-hidden";

export const onRequest = (ctx: { request: Request; env: any; next: () => Promise<Response> }) =>
  domainRedirect(ctx.request, ctx.env.PUBLIC_ORIGIN || BRAND.defaultOrigin) ?? siteHidden(ctx.request, ctx.env, BRAND.name) ?? ctx.next();
