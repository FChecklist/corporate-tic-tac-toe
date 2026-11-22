// SHA-256 in plain code (sync, no platform API), so a draw or a tie-break gives the same answer in a phone, a server or a test.
const K = Uint32Array.from({ length: 64 }, (_, i) => {
  let n = 2, c = 0;
  for (let p = 2; ; p++) { let ok = true; for (let d = 2; d * d <= p; d++) if (p % d === 0) { ok = false; break; } if (ok && c++ === i) { n = p; break; } }
  return Math.floor((Math.cbrt(n) % 1) * 2 ** 32);
});
const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n));
/** Lower-case hex SHA-256 of the UTF-8 bytes of `s`. */
export function sha256Hex(s: string): string {
  const m = new TextEncoder().encode(s), l = m.length, padded = new Uint8Array(((l + 9 + 63) >> 6) << 6);
  padded.set(m); padded[l] = 0x80;
  new DataView(padded.buffer).setUint32(padded.length - 4, l * 8, false); new DataView(padded.buffer).setUint32(padded.length - 8, Math.floor((l * 8) / 2 ** 32), false);
  const h = Uint32Array.from({ length: 8 }, (_, i) => { const p = [2, 3, 5, 7, 11, 13, 17, 19][i]!; return Math.floor((Math.sqrt(p) % 1) * 2 ** 32); });
  const w = new Uint32Array(64), dv = new DataView(padded.buffer);
  for (let o = 0; o < padded.length; o += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(o + i * 4, false);
    for (let i = 16; i < 64; i++) { const a = w[i - 15]!, b = w[i - 2]!; w[i] = (w[i - 16]! + (rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3)) + w[i - 7]! + (rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10))) >>> 0; }
    let [a, b, c, d, e, f, g, hh] = h as unknown as number[];
    for (let i = 0; i < 64; i++) {
      const t1 = (hh! + (rotr(e!, 6) ^ rotr(e!, 11) ^ rotr(e!, 25)) + ((e! & f!) ^ (~e! & g!)) + K[i]! + w[i]!) >>> 0;
      const t2 = ((rotr(a!, 2) ^ rotr(a!, 13) ^ rotr(a!, 22)) + ((a! & b!) ^ (a! & c!) ^ (b! & c!))) >>> 0;
      hh = g; g = f; f = e; e = (d! + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    [a, b, c, d, e, f, g, hh].forEach((v, i) => { h[i] = (h[i]! + v!) >>> 0; });
  }
  return [...h].map((v) => v.toString(16).padStart(8, "0")).join("");
}
