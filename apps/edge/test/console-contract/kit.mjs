// Contract kit: builds signed assertions for the fixtures, checks fixtures against the contract schemas, and runs a fixture against ANY base URL
// (the fake game, and each real game's bridge). Run under Bun. Copied byte for byte into every game (tools/vendor-bridge.mjs) together with fixtures.json and schemas.json.
import { readFileSync, existsSync } from "node:fs";
import { signAssertion, makeKeyPair, parseKeyList } from "../../src/console-bridge/assertion.ts";
import { check } from "./schema-check.mjs";

const here = (p) => new URL(p, import.meta.url);
const contract = (name) => JSON.parse(readFileSync(existsSync(here("./" + name)) ? here("./" + name) : here("../../../contract/" + name), "utf8")); // in a game the files sit next to the kit; in the console repo they live in contract/
const sha256hex = async (s) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");
export const emailHash = (email) => sha256hex("email|" + email.trim().toLowerCase());
export const SCHEMAS = contract("schemas.json");
export const FIXTURES = contract("fixtures.json");
const defs = SCHEMAS.$defs;
/** validate value against a named schema of the contract; returns problems */
export const validate = (name, value) => { if (!defs[name]) throw new Error("no schema " + name); return check({ ...defs[name], $defs: defs }, value); };

export const PEOPLE = { alice: "alice@acme.example", bob: "bob@bob.example", carol: "carol@carol.example", dave: "dave@new.example", nobody: "nobody@nowhere.example" };

export async function makeCtx() {
  const kp = await makeKeyPair(), other = await makeKeyPair();
  const people = {};
  for (const [n, email] of Object.entries(PEOPLE)) people[n] = { email, sub: await emailHash(email) };
  return { privateKey: kp.privateKey, otherKey: other.privateKey, publicB64u: kp.publicB64u, keys: parseKeyList("k1:" + kp.publicB64u), kid: "k1", people };
}

let jtiN = 0;
/** spec: { act, person, eid?, sa?, withEm?, mutate?: { aud, iatOffsetS, expOffsetS, kid, drop:[fields], forge } } -> { token, payload } */
export async function buildAssertion(ctx, spec, origin, nowMs) {
  const nowS = Math.floor(nowMs / 1000), m = spec.mutate || {};
  const who = ctx.people[spec.person];
  const payload = { v: 1, kid: ctx.kid, aud: origin, sub: who.sub, act: spec.act, jti: ("j" + (++jtiN) + "x".repeat(20)).slice(0, 22).replace(/[^A-Za-z0-9_-]/g, "x"), iat: nowS, exp: nowS + 60 };
  if (spec.withEm) payload.em = who.email;
  if (spec.eid) payload.eid = spec.eid;
  if (spec.sa) payload.sa = spec.sa;
  const problemsBefore = validate("AssertionPayload", payload);
  if (m.aud) payload.aud = m.aud;
  if (m.iatOffsetS) payload.iat += m.iatOffsetS;
  if (m.expOffsetS) payload.exp += m.expOffsetS;
  if (m.kid) payload.kid = m.kid;
  if (m.sub) payload.sub = ctx.people[m.sub].sub;
  if (m.em) payload.em = m.em;
  if (spec.hint) payload.hint = spec.hint;
  for (const f of m.drop || []) delete payload[f];
  if (m.reuseJti) payload.jti = m.reuseJti;
  const token = await signAssertion(payload, m.forge ? ctx.otherKey : ctx.privateKey);
  return { token, payload, problemsBefore };
}

const dig = (o, path) => path.split(".").reduce((a, k) => (a == null ? a : a[k]), o);
function evalChecks(res, checks) {
  const bad = [];
  for (const c of checks || []) {
    const v = c.path === "" ? res : dig(res, c.path);
    if ("eq" in c && JSON.stringify(v) !== JSON.stringify(c.eq)) bad.push(`${c.path}: expected ${JSON.stringify(c.eq)}, got ${JSON.stringify(v)}`);
    if ("gte" in c && !(v >= c.gte)) bad.push(`${c.path}: expected at least ${c.gte}, got ${v}`);
    if ("lte" in c && !(v <= c.lte)) bad.push(`${c.path}: expected at most ${c.lte}, got ${v}`);
    if ("lengthGte" in c && !(v && v.length >= c.lengthGte)) bad.push(`${c.path}: expected at least ${c.lengthGte} items`);
    if ("absent" in c && v !== undefined) bad.push(`${c.path}: must not be there`);
    if ("matches" in c && !new RegExp(c.matches).test(String(v))) bad.push(`${c.path}: ${v} does not match ${c.matches}`);
  }
  return bad;
}

/** run one fixture; ctx from makeCtx(); 'keys' is a cache person->kind->key so that several fixtures share a session */
export async function runFixture(fx, { ctx, origin, nowMs, keyCache = {}, fake = true, skipGameRoutes = false }) {
  const problems = [];
  if (fx.fakeOnly && !fake) return { skipped: true, problems };
  if (fx.gameRoute && skipGameRoutes) return { skipped: true, problems };
  const call = async (method, path, headers, body) => {
    const r = await fetch(origin + path, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    let json = null; try { json = await r.json(); } catch { /* not json */ }
    return { status: r.status, json, headers: r.headers };
  };
  const sign = async (s) => { const a = await buildAssertion(ctx, s, origin, nowMs); if (fx.payloadMustBeValid !== false) problems.push(...a.problemsBefore.map((p) => "payload " + p)); return a.token; };
  // a key, when the fixture needs one
  const headers = {};
  if (fx.key) {
    const [person, which] = fx.key.split("/");
    const ck = person + "|" + which;
    if (!keyCache[ck]) {
      const r = await call("POST", "/api/console/session", {}, { assertion: await sign({ act: "session", person }) });
      if (r.status !== 200) { problems.push(`could not get a key for ${fx.key}: ${r.status} ${JSON.stringify(r.json)}`); return { problems }; }
      keyCache[person + "|organizer"] = r.json.organizer && r.json.organizer.key;
      for (const s of r.json.scoped) keyCache[person + "|" + s.role + ":" + s.eid] = s.key;
    }
    if (!keyCache[ck]) { problems.push(`no ${which} key for ${person}`); return { problems }; }
    headers["x-organizer"] = keyCache[ck];
  }
  if (fx.step) headers["x-console-step"] = await sign(fx.step);
  // body: replace {"$sign": spec} by a signed assertion
  const resolveBody = async (b) => {
    if (b && typeof b === "object" && !Array.isArray(b)) {
      if ("$sign" in b) return sign(b.$sign);
      const o = {}; for (const [k, v] of Object.entries(b)) o[k] = await resolveBody(v); return o;
    }
    return b;
  };
  const body = fx.body === undefined ? undefined : await resolveBody(fx.body);
  if (fx.requestSchema && body !== undefined && !fx.negative) problems.push(...validate(fx.requestSchema, body).map((p) => "request " + p));
  const [method, path] = fx.route.split(" ");
  let r = await call(method, path, headers, body);
  if (fx.replay) r = await call(method, path, headers, body); // the same signed request again: must be refused
  const exp = fx.expect;
  if (r.status !== exp.status) problems.push(`status ${r.status}, expected ${exp.status} (${JSON.stringify(r.json)})`);
  if (exp.schema) problems.push(...validate(exp.schema, r.json).map((p) => "response " + p));
  problems.push(...evalChecks(r.json, exp.checks));
  return { problems, response: r.json };
}
