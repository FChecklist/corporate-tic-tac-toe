// WhatsApp simulator client: redirect wa.me / api.whatsapp.com in a browser context to the simulator (:8890), press SEND, read inboxes, open a received link as the recipient.
import { WA, sleep } from "./env.mjs";

/** Every navigation to wa.me/<number>?text=... or api.whatsapp.com/send?phone=&text=... lands on the simulator chat page (message pre-filled, nothing sent until SEND is pressed). `sender` = the number of the person using WhatsApp. */
export async function routeWhatsApp(ctx, { sender = "" } = {}) {
  await ctx.route(/^https:\/\/(wa\.me|api\.whatsapp\.com|web\.whatsapp\.com|whatsapp\.com|www\.whatsapp\.com)\//, async (route) => {
    const u = new URL(route.request().url());
    const to = u.hostname === "wa.me" ? u.pathname.replace(/\D/g, "") : (u.searchParams.get("phone") ?? "").replace(/\D/g, "");
    const loc = `${WA}/chat?to=${encodeURIComponent(to)}&text=${encodeURIComponent(u.searchParams.get("text") ?? "")}&as=${encodeURIComponent(sender)}`;
    await route.fulfill({ status: 302, headers: { location: loc }, body: "" });
  });
}
/** On the simulator chat page: press SEND and wait until the message is in the inbox. */
export async function pressSend(page) {
  await page.waitForSelector("#send");
  await page.click("#send");
  await page.waitForFunction(() => document.body.dataset.sent === "1", null, { timeout: 5000 });
}
/** Click an element that opens WhatsApp (target=_blank or same tab), press SEND on the simulator page it leads to; returns the WA page. */
export async function clickToWhatsApp(page, locator, { send = true } = {}) {
  const ctx = page.context();
  const waited = Promise.race([ctx.waitForEvent("page", { timeout: 8000 }).catch(() => null), page.waitForURL(/localhost:8890/, { timeout: 8000 }).then(() => page).catch(() => null)]);
  await locator.click();
  const wp = await waited; if (!wp) throw new Error("clicking did not open WhatsApp (no navigation to the simulator)");
  await wp.waitForLoadState("domcontentloaded");
  if (send) await pressSend(wp);
  return wp;
}
export const wa = {
  inbox: async (number, after = 0) => (await (await fetch(`${WA}/api/inbox/${String(number).replace(/\D/g, "")}?after=${after}`)).json()).messages,
  all: async () => (await (await fetch(`${WA}/api/all`)).json()).messages,
  clear: () => fetch(`${WA}/api/all`, { method: "DELETE" }),
  /** direct send (a person typing in a chat); the browser-free equivalent of pressSend */
  send: async (from, to, text) => (await fetch(`${WA}/api/send`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ from, to, text }) })).json(),
  async waitFor(number, { match, timeout = 8000, after = 0 } = {}) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) { const l = (await wa.inbox(number, after)).filter((m) => !match || (match instanceof RegExp ? match.test(m.text) : m.text.includes(match))); if (l.length) return l[l.length - 1]; await sleep(150); }
    throw new Error(`no WhatsApp message to ${number} within ${timeout} ms`);
  },
};
/** The recipient taps the first link of a message: a NEW mobile browser context (their own phone, own storage), with the sim's address header and the fake beacon already routed by `open`. */
export async function openLinkAsRecipient(open, number, message, { index = 0 } = {}) {
  const link = message.links[index]; if (!link) throw new Error("the message has no link: " + message.text.slice(0, 120));
  const o = await open({ device: "mobile", ip: "10.8." + (Number(String(number).slice(-4)) % 250) + ".9" });
  await o.page.goto(link, { waitUntil: "domcontentloaded" });
  return { ...o, link };
}
