// One hash function, on its own, so the server can use it (and the commit/reveal check in seal.ts) without pulling any game rule into the Worker.
const enc = new TextEncoder();
const hex = (b: ArrayBuffer): string => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");
export const sha256Hex = async (s: string): Promise<string> => hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));
