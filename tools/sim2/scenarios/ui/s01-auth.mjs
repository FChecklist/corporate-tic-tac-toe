// Group 1: Organizer sign-up and log-in (e-mail code, fake Google) and the sign-in e-mail link page.
import { H, fakeGoogle, nextMail, openConsole, tickTerms, askCodeUi, tickIfAny, tickCode } from "./kit.mjs";

// the home page sign-up sheet: the e-mail, then the Terms box (K2, never ticked in advance; the button stays disabled until it is), then the button
const signUpUi = async (t, x, email) => {
  await x.page.goto(H.SIM + "/"); await x.page.click("#payBtn"); await x.page.fill("#fMail", email);
  await tickTerms(t, x.page, { scope: ".tb", btn: "#frGo", what: "Sign-up" }); await x.page.click("#frGo");
};
const sessionKey = (page) => page.evaluate(() => sessionStorage.getItem("cbz-org"));

export default [
  {
    id: "S01-01", name: "Organizer signs up on the home page (laptop) and lands in an empty console",
    async run(t) {
      const email = nextMail("su"); t.team.add(email);
      const x = await t.open({ device: "laptop" });
      await signUpUi(t, x, email);
      await x.page.waitForURL(/\/zc/, { timeout: 15000 });
      t.check("console key is stored in the tab", /^cbk_[0-9a-f]{48}$/.test((await sessionKey(x.page)) ?? ""));
      await x.page.waitForSelector("#mk"); t.check("empty console offers 'Start a new game'", true);
      t.check("role pill / whoami says Organizer", (await H.call("GET", "/api/whoami", undefined, { "x-organizer": await sessionKey(x.page) })).body.kind === "master");
      await t.shot(x.page, "console-empty");
    },
  },
  {
    id: "S01-02", name: "Sign-up with a bad e-mail shows a calm message and nothing is created",
    async run(t) {
      const x = await t.open({ device: "mobile" });
      await x.page.goto(H.SIM + "/"); await x.page.click("#payBtn"); await x.page.fill("#fMail", "not-an-email");
      await tickTerms(t, x.page, { scope: ".tb", btn: "#frGo", what: "Sign-up" }); await x.page.click("#frGo");
      await x.page.waitForTimeout(500);
      const txt = await t.text(x.page);
      t.check("a friendly e-mail message is shown", /valid work email|valid email|check the e-mail address|e-mail address is missing/i.test(txt), txt.slice(0, 160));
      t.check("still on the home page", !/\/zc/.test(x.page.url()));
      await t.shot(x.page, "bad-email");
    },
  },
  {
    id: "S01-03", name: "Log in on a phone with the e-mailed code (code taken from the mail sink)",
    async run(t) {
      const org = await t.org("li"); const email = org.email;
      const x = await t.open({ device: "mobile" });
      await askCodeUi(x.page, email); await x.page.waitForSelector("#lCode");
      const m = await H.mailbox.waitFor({ to: email, timeout: 8000 }); const code = H.mailbox.code(m);
      t.check("the mail carries a 6 digit code", /^\d{6}$/.test(code ?? ""), m.subject);
      await x.page.fill("#lCode", code); await tickCode(x.page); await x.page.click("#cdGo"); await x.page.waitForURL(/\/zc/, { timeout: 15000 });
      const key = await sessionKey(x.page);
      t.check("signed in with a new key", /^cbk_/.test(key ?? "") && key !== org.token);
      t.check("the old key still works (a second device)", (await org.whoami()).body.kind === "master");
      await t.shot(x.page, "after-login");
    },
  },
  {
    id: "S01-04", name: "Wrong code is refused with a message, the right code then works; 'Use this passcode' helper works in TEST mode",
    async run(t) {
      const org = await t.org("wc");
      const x = await t.open({ device: "mobile" });
      await askCodeUi(x.page, org.email); await x.page.waitForSelector("#lCode");
      await x.page.fill("#lCode", "000000"); await tickCode(x.page); await x.page.click("#cdGo"); await x.page.waitForTimeout(700);
      const bad = await t.text(x.page, "#fErr");
      t.check("wrong code gives an error line", bad.length > 3 && !/\/zc/.test(x.page.url()), bad);
      t.check("TEST mode shows the helper line", !!(await x.page.$("#useCode")));
      await x.page.fill("#lCode", "12"); await tickCode(x.page); await x.page.click("#cdGo"); await x.page.waitForTimeout(300);
      t.check("short code says 'Enter the 6-digit passcode'", /6-digit|6 digits/.test(await t.text(x.page, "#fErr")));
      await x.page.click("#useCode"); await x.page.waitForURL(/\/zc/, { timeout: 15000 });
      t.check("helper signs in", true);
    },
  },
  {
    id: "S01-05", name: "Sign in with a NEW e-mail: the Terms box appears, ticking it creates the account and opens the console (no code is needed for a new address)",
    async run(t) {
      const email = nextMail("fresh"); t.team.add(email);
      const x = await t.open({ device: "laptop" });
      await x.page.goto(H.SIM + "/#login"); await x.page.fill("#lMail", email); await x.page.click("#lgGo");
      await x.page.waitForSelector("#k2slot input[data-box]", { timeout: 8000 });
      t.check("a new address is told it is new and shown the Terms box (unticked)", !(await x.page.isChecked("#k2slot input[data-box]")) && /New here/i.test(await t.text(x.page, "#k2slot")));
      await tickTerms(t, x.page, { scope: "#k2slot", btn: "#lgGo", what: "Sign-in (new)" }); await x.page.click("#lgGo");
      await x.page.waitForURL(/\/zc/, { timeout: 15000 });
      t.check("the account exists: a master key is stored", /^cbk_/.test((await sessionKey(x.page)) ?? ""));
    },
  },
  {
    id: "S01-12", name: "Back on the console without a key: e-mail on the console card, six boxes typed digit by digit, Submit, back in the console",
    async run(t) {
      const org = await t.org("consold");
      const x = await t.open({ device: "mobile" });
      await x.page.goto(H.SIM + "/zc.html"); await x.page.waitForSelector("#lem", { timeout: 10000 });
      t.check("the console card says Sign in to your console, e-mail first", /Sign in to your console/.test(await t.text(x.page)) && !!(await x.page.$(".zc-keybox")));
      await x.page.fill("#lem", org.email); await x.page.click("#goLogin");
      await x.page.waitForSelector("#lMail"); await x.page.click("#lgGo");
      await x.page.waitForSelector(".otpb", { timeout: 10000 });
      const boxes = await x.page.$$(".otpb"); t.check("six code boxes", boxes.length === 6);
      const txt = await t.text(x.page); t.check("the words are plain: 'We have sent a 6-digit code' and a Submit button", /We have sent a 6-digit code/.test(txt) && /Submit/.test(txt) && /Send a new code/.test(txt) && !/company\.com|work e-?mail/i.test(txt), txt.slice(0, 200));
      const m = await H.mailbox.waitFor({ to: org.email, timeout: 8000 }); const code = H.mailbox.code(m);
      await boxes[0].click(); await x.page.keyboard.type(code, { delay: 30 });
      const typed = await Promise.all((await x.page.$$(".otpb")).map((b) => b.inputValue()));
      t.check("each digit landed in its own box, in order", typed.join("") === code, typed.join(""));
      await t.shot(x.page, "code-phone");
      await x.page.click("#cdGo");
      await x.page.waitForURL(/\/zc/, { timeout: 15000 });
      await x.page.waitForSelector("#mk", { timeout: 20000 });
      t.check("signed in and back on the console", /^cbk_/.test((await sessionKey(x.page)) ?? ""));
    },
  },
  {
    id: "S01-06", name: "Fake Google: sign up a new Organizer with 'Continue with Google'",
    async run(t) {
      const email = nextMail("gg"); t.team.add(email);
      const x = await t.open({ device: "laptop" });
      await fakeGoogle(x.ctx, email);
      await x.page.goto(H.SIM + "/"); await x.page.click("#payBtn");
      await x.page.waitForSelector("#fakegoogle", { timeout: 8000 });
      await tickIfAny(t, x.page, { scope: ".tb", what: "Google sign-up" }); // the server refuses a Google sign-in without the K2 tick
      await x.page.click("#fakegoogle");
      await x.page.waitForURL(/\/zc/, { timeout: 15000 });
      const key = await sessionKey(x.page);
      t.check("signed up with Google: a master key", (await H.call("GET", "/api/whoami", undefined, { "x-organizer": key })).body.kind === "master");
      const o2 = new H.Organizer(email, key); const hist = await o2.history();
      t.check("the account is that e-mail (history works)", hist.ok);
    },
  },
  {
    id: "S01-07", name: "Fake Google: log in an existing Organizer on the sign-in page and from the home page",
    async run(t) {
      const org = await t.org("g2");
      const x = await t.open({ device: "mobile" });
      await fakeGoogle(x.ctx, org.email);
      await x.page.goto(H.SIM + "/#login"); await x.page.waitForSelector("#fakegoogle", { timeout: 8000 });
      await x.page.click("#fakegoogle"); await tickIfAny(t, x.page, { scope: ".tb", what: "Google sign-in" }); await x.page.click("#fakegoogle");
      await x.page.waitForURL(/\/zc/, { timeout: 15000 });
      const key = await sessionKey(x.page);
      t.check("Google log-in gives a key for the same account", key && key !== org.token && (await H.call("GET", "/api/org/keys", undefined, { "x-organizer": key })).ok);
      await t.shot(x.page, "google-login-console");
    },
  },
  {
    id: "S01-08", name: "Fake Google token from a different (unknown) audience is refused; tampered credential refused",
    async run(t) {
      const email = nextMail("gx");
      const g = await (await fetch(`${H.SIM}/__sim/google-token?email=${encodeURIComponent(email)}`)).json();
      const bad = g.credential.slice(0, -4) + "AAAA";
      const r1 = await H.call("POST", "/api/auth/google", { credential: bad, intent: "signin" }, {}, { ip: t.ip() });
      t.check("tampered Google token is refused (4xx, no key)", r1.status >= 400 && r1.status < 500 && !r1.body.token, `${r1.status} ${JSON.stringify(r1.body).slice(0, 100)}`);
      const r2 = await H.call("POST", "/api/auth/google", { credential: "abc.def.ghi", intent: "signup" }, {}, { ip: t.ip() });
      t.check("garbage credential is refused", r2.status >= 400 && r2.status < 500 && !r2.body.token, `${r2.status}`);
    },
  },
  {
    id: "S01-09", name: "The sign-in e-mail link page: incomplete link message, then a good link signs in once only",
    async run(t) {
      const org = await t.org("lk");
      const x = await t.open({ device: "laptop" });
      await x.page.goto(H.SIM + "/signin.html");
      t.check("incomplete link says so", /incomplete/i.test(await t.text(x.page)));
      // ask for a sign-in mail and take the link out of it
      await H.call("POST", "/api/auth/email", { email: org.email }, {}, { ip: t.ip() });
      const m = await H.mailbox.waitFor({ to: org.email, timeout: 8000 });
      const link = H.mailbox.links(m).find((l) => /signin/.test(l));
      t.check("the mail has a sign-in link", !!link, H.mailbox.links(m).join(" ").slice(0, 160));
      if (link) {
        await x.page.goto(link); await x.page.waitForSelector("#go"); await x.page.click("#go"); await x.page.waitForURL(/\/(zc|ai-link)/, { timeout: 15000 });
        t.check("link signs in", true);
        const y = await t.open({ device: "mobile" });
        await y.page.goto(link); await y.page.waitForTimeout(600);
        const had = await y.page.$("#go");
        if (had) { await y.page.click("#go", { timeout: 5000 }).catch(() => {}); await y.page.waitForTimeout(900); }
        t.check("the same link a second time does not sign in again", !/\/(zc|ai-link)/.test(y.page.url()), y.page.url());
      }
    },
  },
  {
    id: "S01-10", name: "Console without a key shows the sign-in prompt (not a blank page)",
    async run(t) {
      const x = await t.open({ device: "mobile", token: "cbk_" + "0".repeat(48) });
      await x.page.goto(H.SIM + "/zc"); await x.page.waitForTimeout(2000);
      const txt = await t.text(x.page);
      t.check("a wrong key gives a readable message", txt.length > 30, txt.slice(0, 200));
      await t.shot(x.page, "wrong-key");
      const y = await t.open({ device: "mobile" });
      await y.page.goto(H.SIM + "/zc"); await y.page.waitForTimeout(1500);
      t.check("no key: sign-in prompt", /sign in|log in|continue/i.test(await t.text(y.page)), (await t.text(y.page)).slice(0, 200));
      await t.shot(y.page, "no-key");
    },
  },
];
