// The field names the three payment pages (pay, paylink, paytest) and the Worker agree on. ONE small file, so that the work that records the game ID on the payment
// (order notes, the game's own payment record, the central ledger row and the receipt) and the redesign of the payment pages can be merged without touching each other's lines:
// both read the names from here. The browser twin is apps/web/public/payfields.js and must list exactly the same names (apps/edge/test/paypages.test.ts checks it).
export const PAY_FIELDS = {
  name: "name",
  email: "email",
  phone: "phone",
  phoneCode: "phoneCode",
  org: "org",
  taxId: "taxId",
  country: "country",
  /** the game a payment is for. On the owner's payment test it is optional (empty = "payment test (no game)"). */
  gameId: "gameId",
} as const;

/** A game ID as every game route spells it (letters, digits, - and _; 4 to 40 characters). */
export const GAME_ID_RE = /^[A-Za-z0-9_-]{4,40}$/;
