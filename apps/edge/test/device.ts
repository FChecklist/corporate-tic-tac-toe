// Phones send a device id when they join (one ticket, one device). Older tests do not care which device: they all join from the same one unless they say otherwise.
export const DEVICE = "a".repeat(32);
/** Every device id a test has used: a vote or a game-over report now carries the phone's own device id, and a test that settles "by phones" tries these. */
export const SEEN_DEVICES = new Set<string>([DEVICE]);
/** One phone, one ticket: tests that do not say which device joins get a device of their own for each mobile number (the same number twice is the same device). */
export const deviceOf = (phone: unknown): string => { const d = (String(phone ?? "").replace(/\D/g, "").slice(-10) + "0".repeat(32)).slice(0, 32); SEEN_DEVICES.add(d); return d; };
export const withDevice = (method: string, path: string, body: unknown) => {
  const b = method === "POST" && /\/join$/.test(path) && body && typeof body === "object" && !("device" in (body as object)) ? { device: deviceOf((body as any).phone) || DEVICE, ...(body as object) } : body;
  return b === undefined ? undefined : typeof b === "string" ? b : JSON.stringify(b);
};
