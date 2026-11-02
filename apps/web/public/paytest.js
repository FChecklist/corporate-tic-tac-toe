/* Corporate Tic Tac Toe: "Test our payment". A real payment of ₹ 1 (India) or US$ 1 (any other country) that buys nothing, so anybody can see that paying and the invoice work. Any number of times.
   Open to everybody: no key, no sign-in. A Game ID may be typed; it is plain text and is never looked up, so nothing about any game is shown here.
   The look and the behaviour are the shared payment kit (paykit.js), the same in all six games. Only the country is asked (it decides the currency); Razorpay asks for the e-mail and the mobile.
   Kept for this tab as it is typed (paykit.js draft): the Game ID, the chosen country and the payment already made; put back after a failed or closed Razorpay window or a reload. */
(function () {
  const TB = window.TB, PK = window.PK, F = window.PAYFIELDS, esc = TB.esc, $app = document.getElementById("app");
  const KEYS = ["gameId", "pick", "paid"];
  const draft = PK.draft("paytest");
  const S = { gameId: "", pick: "", auto: "", paid: "", whereDone: false, ctyOpen: false, err: "", busy: false, done: null };
  const save = PK.persist($app, S, draft, KEYS);
  const GAME_ID = /^[A-Za-z0-9_-]{4,40}$/;
  const cur = () => PK.cur(S);
  const label = () => (cur() ? "Pay " + TB.money(1, cur()) + " (test)" : "Choose your country first");

  const asideHtml = () => PK.summary({
    game: null, test: true, paid: !!S.done, noPrice: !cur(), price: { total: 1, base: 1, gst: 0, currency: cur() || "INR" }, priceLabel: "Payment test (nothing is bought)", totalLabel: S.done ? "Paid" : "Total to pay",
    emptyTitle: "Payment test", emptyText: "Nothing is bought. A receipt is sent to the e-mail you give Razorpay.",
  }) + PK.trust();

  function formHtml() {
    return `${PK.countryLine(S)}
      <section class="pk-card"><h2>Game ID <span class="opt">(optional)</span></h2><p class="pk-sub">Type a Game ID only if you want it noted with this test. It is not looked up.</p>
        <div class="pk-f"><label for="gid">Game ID</label><input class="pk-in pk-mono" id="gid" data-f="gameId" value="${esc(S.gameId)}" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="40" placeholder="For example ACME-DIWALI" aria-describedby="gid-h gid-e"><p class="pk-hint" id="gid-h" hidden></p><p class="pk-ferr" id="gid-e" hidden></p></div>
        ${PK.errBox()}${PK.busyBox("Confirming your payment with Razorpay. Please keep this page open.")}
        <button class="pk-btn" id="go" type="button" ${cur() ? 'aria-disabled="false"' : 'disabled aria-disabled="true"'}>${label()}</button>
        ${CBConsent.html("K3")}
        <p class="pk-note">Secure payment by Razorpay to ${esc(PK.BRAND.payee)}. Billing data is kept for audit and tax reasons. A test payment is only for trying the payment, and stays as that record.</p></section>${PK.live()}`;
  }
  function doneHtml() {
    const d = S.done, gid = (S.gameId || "").trim();
    return PK.layout({
      title: "Payment received", tag: "Test", step: 3, finished: true, formFirst: true, aside: asideHtml(),
      col: PK.receipt(d, {
        title: "Payment received. The test worked.", lead: `You paid <b>${esc(TB.money(d.total, d.currency))}</b>. Nothing was bought and nothing else will happen.`,
        forLabel: gid ? `Payment test (game ID ${gid})` : "Payment test",
        after: '<div class="pk-btns"><button class="pk-btn" id="again" type="button">Test again</button></div>',
      }),
    });
  }
  function view() {
    if (S.done) return doneHtml();
    return PK.layout({
      title: "Test our payment", step: 1, formFirst: true, aside: asideHtml(), col: formHtml(),
      lead: `Pay <b>${esc(cur() ? TB.money(1, cur()) : "₹ 1 or US$ 1")}</b> (₹ 1 in India, US$ 1 in any other country) to see how paying works. Nothing is bought, and you get a receipt.`,
    });
  }
  const draw = (focus) => { PK.page($app, view(), focus); bind(); if (S.done && TB.invoiceWire) TB.invoiceWire(S.done); };

  async function waitForConfirm(paymentId) {
    const t0 = Date.now();
    while (Date.now() - t0 < 300000) {
      await new Promise((ok) => setTimeout(ok, 4000));
      try { const r = await TB.api("GET", "/api/payments/paytest/" + paymentId); if (r && !r.confirming) return r; } catch (e) { if (e.status && e.status < 500) throw e; }
    }
    throw new Error("Razorpay has not confirmed yet. If money was taken, your receipt will be e-mailed to you once it is.");
  }
  const paidNow = (res, pid) => { S.done = res; S.paid = (res && res.orderId) || pid || ""; S.busy = false; save(); draw(true); };
  async function pay() {
    PK.setError($app, "");
    PK.sync($app, S, KEYS);
    if (!PK.cty(S)) return PK.setError($app, "Please choose your country first.");
    const gid = (S.gameId || "").trim();
    if (gid && !GAME_ID.test(gid)) return PK.setError($app, "A game ID has 4 to 40 letters, digits, - or _.", "gid");
    S.busy = true; PK.busy($app, true, "go", { on: "Confirming your payment…", off: label() });
    let pid = "";
    try {
      const body = Object.assign(PK.orderBody(S), { consent: CBConsent.payload($app, "K3") });
      if (gid) body[F.gameId] = gid;
      const r = await TB.api("POST", "/api/payments/paytest", body);
      pid = r.paymentId;
      let res = await TB.pay(r.razorpay, r.paymentId, r.hop); // opens Razorpay Checkout; the server verifies the payment
      if (res && res.confirming) res = await waitForConfirm(r.paymentId);
      return paidNow(res, pid);
    } catch (e) {
      if (e && e.maybePaid && pid) { try { return paidNow(await waitForConfirm(pid), pid); } catch (e2) { e = e2; } }
      S.busy = false;
      PK.busy($app, false, "go", { on: "", off: label() });
      PK.setError($app, PK.friendly(e));
    }
  }
  function bind() {
    const $ = (id) => document.getElementById(id);
    if ($("go")) $("go").onclick = pay;
    if ($("again")) $("again").onclick = () => { S.done = null; S.paid = ""; S.err = ""; save(); draw(true); };
    PK.countryWire($app, S, save, () => draw());
    PK.refill($app, S, KEYS); // what was typed always shows in the boxes, whatever the browser does with the markup
  }
  (async () => {
    await PK.where(S);
    if (/^pay_[0-9a-f]{16}$/.test(S.paid)) { try { const r = await TB.api("GET", "/api/payments/paytest/" + S.paid); if (r && !r.confirming) S.done = r; } catch (e) { if (e.status === 404) { S.paid = ""; save(); } } } else S.paid = "";
    draw();
  })();
})();
