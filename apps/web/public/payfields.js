/* The field names the payment pages send to the Worker, in ONE small place (browser twin of apps/edge/src/payfields.ts; apps/edge/test/paypages.test.ts checks they match).
   The work that records the game ID on the payment reads `gameId` from here, so it and the payment pages never edit the same lines. */
window.PAYFIELDS = Object.freeze({ name: "name", email: "email", phone: "phone", phoneCode: "phoneCode", org: "org", taxId: "taxId", country: "country", gameId: "gameId" });
