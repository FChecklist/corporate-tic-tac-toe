// One network key for per-address limits. IPv4 is used as it is. For IPv6 only the first 64 bits
// (the /64, which one home or phone normally holds in full) are used, so changing the address
// inside your own /64 does not give you a fresh counter. Anything that does not look like an
// address is returned unchanged (so "local" in tests keeps working).
export function netKey(ip: string | null | undefined): string {
  const raw = (ip ?? "").trim().toLowerCase();
  if (!raw) return "local";
  if (!raw.includes(":")) return raw; // IPv4, or a test value
  const a = raw.split("%")[0] ?? raw; // drop a zone id
  const mapped = a.match(/^(?:0*:)*:?ffff:(\d{1,3}(?:\.\d{1,3}){3})$/); // ::ffff:1.2.3.4 is an IPv4 address
  if (mapped?.[1]) return mapped[1];
  let head: string[], tail: string[];
  const dbl = a.indexOf("::");
  if (dbl >= 0) { head = a.slice(0, dbl) ? a.slice(0, dbl).split(":") : []; tail = a.slice(dbl + 2) ? a.slice(dbl + 2).split(":") : []; }
  else { head = a.split(":"); tail = []; }
  if (dbl < 0 && head.length !== 8) return raw;
  const groups = dbl >= 0 ? [...head, ...Array(Math.max(0, 8 - head.length - tail.length)).fill("0"), ...tail] : head;
  if (groups.length !== 8 || !groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return raw;
  return groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":") + "::/64";
}
export const netKeyOf = (req: Request): string => netKey(req.headers.get("cf-connecting-ip"));
