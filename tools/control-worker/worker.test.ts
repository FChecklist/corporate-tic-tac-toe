import { expect, test } from "bun:test";
import { nextMessage, publicKeyFromSecret, readPublished, signControlWithSecret, type KV } from "../../packages/beacon/src/control";
import worker, { type R2Like } from "./worker";

const secret = "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20";
const store = new Map<string, string>();
const BUCKET: R2Like = { get: async (k) => (store.has(k) ? { text: async () => store.get(k)! } : null), put: async (k, v) => void store.set(k, v) };
const kv: KV = { get: async (k) => store.get(k) ?? null, put: async (k, v) => void store.set(k, v) };
const env = { BUCKET, REGISTER_SECRET: "s3cret" };
const call = (method: string, path: string, body?: unknown, h: Record<string, string> = {}) => worker.fetch(new Request("https://w.example" + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), env);

test("the Worker registers a key (only with the backend secret) and then accepts signed messages from anyone, rejects the rest", async () => {
  expect((await call("PUT", "/control/WK12345/key", { publicKey: publicKeyFromSecret(secret) })).status).toBe(403);
  expect((await call("PUT", "/control/WK12345/key", { publicKey: publicKeyFromSecret(secret) }, { "x-register-secret": "s3cret" })).status).toBe(200);
  expect((await call("PUT", "/control/WK12345/key", { publicKey: "ab".repeat(32) }, { "x-register-secret": "s3cret" })).status).toBe(409);
  const f = (await readPublished(kv, "WK12345"))!;
  const msg = signControlWithSecret(secret, nextMessage(f, 5000, { action: "pause" }));
  expect((await call("POST", "/control/WK12345", { message: { ...msg, atBeaconRound: msg.atBeaconRound + 1 } })).status).toBe(403); // tampered
  expect((await call("POST", "/control/WK12345", { message: msg })).status).toBe(200);
  expect((await readPublished(kv, "WK12345"))!.messages.length).toBe(1);
  expect((await call("POST", "/control/NOPE123", { message: msg })).status).toBe(404);
  expect((await call("GET", "/control/WK12345")).status).toBe(405);
  expect((await call("POST", "/elsewhere", {})).status).toBe(404);
  expect((await call("POST", "/control/WK12345", { x: "y".repeat(3000) })).status).toBe(413);
});
