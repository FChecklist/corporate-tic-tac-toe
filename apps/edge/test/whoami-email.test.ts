// The Organizer's e-mail address is returned by whoami (shown at the top right of the console), also for an older account that never stored it: the next sign-in stores it.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { lazyTickReset } from "../src/worker";
import { sentReports } from "../src/pay";
import { W, call, j, organizer, reset, restore } from "./param-harness";

beforeEach(() => { reset(); lazyTickReset(); sentReports.length = 0; });
afterEach(restore);

describe("whoami e-mail", () => {
  test("a new account's whoami carries its e-mail; a host or an AI key does not", async () => {
    const o = await organizer("who.am.i@acme.com");
    const me = await j(await call("GET", "/api/whoami", undefined, { "x-organizer": o.key })); expect(me).toMatchObject({ kind: "master", email: "who.am.i@acme.com" });
    const ai = await j(await call("GET", "/api/whoami", undefined, { "x-organizer": o.ai })); expect(ai.email).toBeUndefined();
  });
});
