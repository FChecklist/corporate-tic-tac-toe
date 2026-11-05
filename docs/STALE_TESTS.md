# Old tests changed because a newer owner rule replaced what they expected (31 Oct 2026)

| Test | Old expectation | New expectation | Why |
|---|---|---|---|
| apps/edge/test/t30-join-wire.test.ts, "refusals have plain words", case "31 characters" | "An employee ID has letters and numbers only (up to 30)." | "This ID is too long. An employee ID may be up to 30 characters once cleaned." (status 400 and code bad-id unchanged) | owner rule tested in t42-id-rules (OWNER RULE too long) |
| apps/web/test/t30-join-hint.test.ts, "the box accepts up to 60 typed characters" | no hint for 40 cleaned characters | the same too-long sentence as the hint | owner rule tested in t42-join-texts (over 30 once cleaned); maxlength 60 unchanged |
| apps/edge/test/verify.test.ts, "name-only joining with IDs asked" | changing verify after someone joined answers 400 ids-locked | 409 id-kind-locked | owner rule D-1 (t41-owner-rules) |
| apps/web/test/t30-pages.test.ts, "headers from a real build" | spawned `bun` from `URL.pathname` (an invalid folder on Windows) | runs the running bun with `fileURLToPath`; assertions unchanged | the test could not start the build on Windows |
