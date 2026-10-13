// Family "brand": the brand strip (name, one of 8 colours, logo up to 30 KB checked by its first bytes), brand moments (before the game, during it, at the end; 5 per ticket), links, times, and lucky draws.
// Rules: docs/BRANDING.md, docs/ROLES_AND_CONSOLE_SPEC_2.md item 11, packages/beacon/src/config.ts (validateCfg).
export default async function gen({ R, L }) {
  const { A, mobile, personName } = L;
  const out = [];
  const b64 = (bytes) => Buffer.from(bytes).toString("base64");
  const pad = (head, n) => { const a = new Uint8Array(n); a.set(head); return a; };
  // real picture headers: the server reads the size in pixels (96 x 96) from the first bytes
  const PNG = (n = 200) => `data:image/png;base64,${b64(pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 96, 0, 0, 0, 96], n))}`;
  const JPG = (n = 200) => `data:image/jpeg;base64,${b64(pad([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 0, 96, 0, 96, 3, 1, 0x11, 0, 2, 0x11, 1], n))}`;
  const WEBP = (n = 200) => { const a = pad([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58, 10, 0, 0, 0, 0, 0, 0, 0, 95, 0, 0, 95, 0, 0], n); return `data:image/webp;base64,${b64(a)}`; };
  const COLORS = ["#0B5D5B", "#1B7F5C", "#B3261E", "#6A1B9A", "#C26A00", "#00798C", "#37474F", "#AD1457"];
  async function draft(t, o = {}) { const org = await t.newOrg(); const g = await t.game(org, { cap: 50, tickets: o.tickets ?? 1, days: 6 }); if (!g.r.ok) throw new Error("create " + JSON.stringify(g.r.body)); return { org, g }; }
  const info = async (org, id) => (await A.call("GET", `/api/z/${id}/info`, undefined, org.h)).body;

  // ---------- brand strip ----------
  COLORS.forEach((c, i) => out.push({ name: `brand|colour ${c} with a name and a ${["PNG", "JPEG", "WebP"][i % 3]} logo is saved and shown to guests`, run: async (t) => {
    const { org, g } = await draft(t); const logo = [PNG, JPG, WEBP][i % 3](); const name = ["Sharma Textiles", "Kaveri Foods", "Mehta and Sons", "Bluestone Logistics", "Gupta Agro", "Nair Pharma", "Reddy Infra", "Tulsi Jewellers"][i];
    const r = await org.settings(g.id, { brand: { name, color: c.toLowerCase(), logo } }); t.expect("save the brand", r, "ok");
    const inf = await info(org, g.id); t.eq("name", inf.brand?.name, name); t.eq("colour kept in capitals", inf.brand?.color, c); t.eq("logo kept inside the game", inf.brand?.logo, logo);
    await t.publishPay(org, g.id); const j = await t.guest(g.id).join(); t.eq("the guest's phone receives the brand", j.body.brand?.name, name); const pub = (await A.call("GET", `/api/z/${g.id}/info`)).body; t.check("the logo reaches guests as a data URL, never an outside address", /^data:image\//.test(j.body.brand?.logo ?? pub.brand?.logo ?? ""), "join brand " + JSON.stringify(j.body.brand)?.slice(0, 120) + " | info brand " + JSON.stringify(pub.brand)?.slice(0, 120));
  } }));
  for (const [label, brand, ok] of [
    ["name of 1 character", { name: "A", color: "#0B5D5B" }, true], ["name of 40 characters", { name: "N".repeat(40), color: "#0B5D5B" }, true], ["name of 41 characters", { name: "N".repeat(41), color: "#0B5D5B" }, false], ["empty name", { name: "", color: "#0B5D5B" }, false], ["only spaces", { name: "    ", color: "#0B5D5B" }, false],
    ["colour not in the list", { name: "Acme", color: "#000000" }, false], ["colour as a word", { name: "Acme", color: "red" }, false], ["colour missing", { name: "Acme" }, false], ["name missing", { color: "#0B5D5B" }, false], ["an extra field", { name: "Acme", color: "#0B5D5B", website: "https://evil.example" }, false], ["brand is a text", "Acme", false], ["brand is a list", ["Acme"], false],
    ["name with markup: the markup characters are removed", { name: "Acme <b>\"Corp\"</b> & 'Sons'", color: "#0B5D5B" }, true],
    ["logo: SVG", { name: "Acme", color: "#0B5D5B", logo: "data:image/svg+xml;base64," + b64(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>")) }, false],
    ["logo: remote address", { name: "Acme", color: "#0B5D5B", logo: "https://evil.example/logo.png" }, false], ["logo: javascript address", { name: "Acme", color: "#0B5D5B", logo: "javascript:alert(1)" }, false],
    ["logo: JPEG bytes declared as PNG", { name: "Acme", color: "#0B5D5B", logo: `data:image/png;base64,${b64(pad([0xff, 0xd8, 0xff], 100))}` }, false], ["logo: text declared as PNG", { name: "Acme", color: "#0B5D5B", logo: `data:image/png;base64,${b64(Buffer.from("this is not a picture at all"))}` }, false],
    ["logo: exactly 30 KB", { name: "Acme", color: "#0B5D5B", logo: PNG(30 * 1024) }, true], ["logo: 30 KB and one byte", { name: "Acme", color: "#0B5D5B", logo: PNG(30 * 1024 + 1) }, false], ["logo: 1 MB", { name: "Acme", color: "#0B5D5B", logo: PNG(1024 * 1024) }, false],
    ["logo: broken base64", { name: "Acme", color: "#0B5D5B", logo: "data:image/png;base64,@@@@" }, false], ["logo: a number", { name: "Acme", color: "#0B5D5B", logo: 42 }, false],
  ]) out.push({ name: `brand|${label}`, run: async (t) => {
    const { org, g } = await draft(t); const r = await org.settings(g.id, { brand }); const inf = await info(org, g.id);
    if (ok) { t.expect("accepted", r, "ok"); t.check("saved", !!inf.brand, JSON.stringify(inf.brand)?.slice(0, 100)); if (inf.brand?.name) t.check("no markup characters kept in the name", !/[<>`"'&\\]/.test(inf.brand.name), inf.brand.name); }
    else { t.expect("refused in plain words", r, "bad"); t.check("nothing saved", !inf.brand, JSON.stringify(inf.brand)?.slice(0, 100)); }
  } });
  out.push({ name: "brand|removing the brand with null or an empty object", run: async (t) => {
    const { org, g } = await draft(t); await org.settings(g.id, { brand: { name: "Acme", color: "#0B5D5B" } }); t.expect("remove with null", await org.settings(g.id, { brand: null }), "ok"); t.check("gone", !(await info(org, g.id)).brand);
    await org.settings(g.id, { brand: { name: "Acme", color: "#0B5D5B" } }); t.expect("remove with {}", await org.settings(g.id, { brand: {} }), "ok"); t.check("gone again", !(await info(org, g.id)).brand);
  } });
  out.push({ name: "brand|a Host can set the brand, a Co-host and the AI key's hand-over rules hold", run: async (t) => {
    const { org, g } = await draft(t); const host = await t.host(org), co = await t.cohost(org, g.id);
    t.expect("Host sets the brand", await host.api("PATCH", `/api/z/${g.id}/settings`, { brand: { name: "Hema Foods", color: "#1B7F5C" } }), "ok"); t.expect("Co-host cannot", await co.api("PATCH", `/api/z/${g.id}/settings`, { brand: { name: "Mine", color: "#1B7F5C" } }), "deny");
    t.eq("brand is the Host's", (await info(org, g.id)).brand?.name, "Hema Foods");
  } });

  // ---------- brand moments: how many, where, which kind ----------
  const MOMENT = (kind, i = 0) => ({ speech: { kind: "speech", title: `A message from your organizer ${i}` }, youtube: { kind: "youtube", title: "Our year in 60 seconds", mediaUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }, file: { kind: "file", title: "Welcome video", mediaUrl: "https://cdn.example.com/welcome.mp4" }, slides: { kind: "slides", title: "Awards slides" }, lucky: { kind: "lucky", title: "Lucky draw", winners: 3 } })[kind];
  for (const tickets of [1, 2]) for (const slot of ["opening", "x", "closing"]) for (const count of [0, "max", "max+1"]) out.push({ name: `moments|${tickets} ticket${tickets > 1 ? "s" : ""}: ${slot} x ${count}`, run: async (t) => {
    const { org, g } = await draft(t, { tickets }); const max = slot === "x" ? 3 * tickets : tickets; const n = count === 0 ? 0 : count === "max" ? max : max + 1;
    const list = Array.from({ length: n }, (_, i) => ({ ...MOMENT("speech", i), ...(slot === "x" ? { after: 10 * (i + 1) + 5, seconds: 30 } : slot === "opening" ? { seconds: Math.floor(120 / Math.max(1, n) / 3) * 3 || 15 } : {}) }));
    if (slot === "opening" && n > 0 && n * 15 > 120) return t.check("skipped: too many to fit 120 seconds anyway", true);
    const key = slot === "x" ? "breaks" : slot; const r = await org.settings(g.id, { tickets, [key]: list });
    if (n <= max) { t.expect("accepted", r, "ok"); t.eq("saved count", ((await org.summary(g.id)).body[key] ?? []).length, n); } else { t.expect("refused", r, "bad"); t.check("message names the allowance", new RegExp(String(max)).test(r.body.error ?? ""), r.body.error); }
  } });
  out.push({ name: "moments|going from 2 tickets to 1 with 6 moments set is refused with the allowance named", run: async (t) => {
    const { org, g } = await draft(t, { tickets: 2 }); const mids = [10, 20, 30, 40, 50, 60].map((a, i) => ({ ...MOMENT("speech", i), after: a, seconds: 30 }));
    t.expect("six moments with two tickets", await org.settings(g.id, { tickets: 2, breaks: mids }), "ok"); const r = await org.settings(g.id, { tickets: 1 }); t.expect("back to one ticket", r, "bad"); t.eq("still two tickets", (await org.summary(g.id)).body.tickets, 2);
  } });
  for (const kind of ["speech", "youtube", "file", "slides", "lucky"]) for (const slot of ["opening", "x", "closing"]) out.push({ name: `moments|a ${kind} moment as ${slot}`, run: async (t) => {
    const { org, g } = await draft(t); const m = { ...MOMENT(kind), ...(slot === "x" ? { after: 30, seconds: 60 } : slot === "opening" ? { seconds: 60 } : {}) }; const r = await org.settings(g.id, { [slot === "x" ? "breaks" : slot]: [m] });
    if (kind === "lucky" && slot !== "x") { t.expect("a lucky draw only goes during the game", r, "bad"); t.check("message says so", /during the game/i.test(r.body.error ?? ""), r.body.error); } else t.expect("accepted", r, "ok");
  } });
  for (const [label, m, ok] of [
    ["YouTube link: youtu.be", { kind: "youtube", title: "Greeting", mediaUrl: "https://youtu.be/dQw4w9WgXcQ" }, true], ["YouTube link: not YouTube", { kind: "youtube", title: "Greeting", mediaUrl: "https://vimeo.com/12345" }, false], ["YouTube link: look-alike host", { kind: "youtube", title: "Greeting", mediaUrl: "https://youtube.com.evil.example/watch?v=1" }, false], ["YouTube without a link", { kind: "youtube", title: "Greeting" }, false],
    ["video file link: https", { kind: "file", title: "Welcome", mediaUrl: "https://cdn.example.com/a.mp4" }, true], ["video file link: http", { kind: "file", title: "Welcome", mediaUrl: "http://cdn.example.com/a.mp4" }, false], ["video file link: javascript", { kind: "file", title: "Welcome", mediaUrl: "javascript:alert(1)" }, false], ["video file link: data URL", { kind: "file", title: "Welcome", mediaUrl: "data:text/html,<script>alert(1)</script>" }, false],
    ["video file link: with a space", { kind: "file", title: "Welcome", mediaUrl: "https://cdn.example.com/my video.mp4" }, false], ["video file link: 301 characters", { kind: "file", title: "Welcome", mediaUrl: "https://c.example.com/" + "a".repeat(279) }, false], ["video file link: 300 characters", { kind: "file", title: "Welcome", mediaUrl: "https://c.example.com/" + "a".repeat(278) }, true],
    ["video file link: on our own site", { kind: "file", title: "Welcome", mediaUrl: "/demo-welcome.mp4" }, true], ["video file link: our own site with a folder", { kind: "file", title: "Welcome", mediaUrl: "/a/b.mp4" }, false], ["video file without a link", { kind: "file", title: "Welcome" }, false],
    ["title of 1 character", { kind: "speech", title: "A" }, false], ["title of 2 characters", { kind: "speech", title: "Hi" }, true], ["title of 80 characters", { kind: "speech", title: "T".repeat(80) }, true], ["title with markup is cleaned", { kind: "speech", title: "<b>Hello</b> `team`" }, true], ["no title", { kind: "speech" }, false], ["unknown kind", { kind: "hologram", title: "Hello" }, false],
    ["seconds 15", { kind: "speech", title: "Hello", seconds: 15 }, true], ["seconds 600", { kind: "speech", title: "Hello", seconds: 600 }, true], ["seconds 14", { kind: "speech", title: "Hello", seconds: 14 }, false], ["seconds 16 (not a step of 3)", { kind: "speech", title: "Hello", seconds: 16 }, false], ["seconds 603", { kind: "speech", title: "Hello", seconds: 603 }, false], ["seconds as text", { kind: "speech", title: "Hello", seconds: "60" }, false],
    ["starts after number 1", { kind: "speech", title: "Hello", after: 1, seconds: 30 }, true], ["starts after number 89", { kind: "speech", title: "Hello", after: 89, seconds: 30 }, true], ["starts after number 0", { kind: "speech", title: "Hello", after: 0, seconds: 30 }, false], ["starts after number 90", { kind: "speech", title: "Hello", after: 90, seconds: 30 }, false], ["starts after 2.5", { kind: "speech", title: "Hello", after: 2.5, seconds: 30 }, false],
  ]) out.push({ name: `moments|during the game: ${label}`, run: async (t) => {
    const { org, g } = await draft(t); const mom = { after: 30, seconds: 60, ...m }; const r = await org.settings(g.id, { breaks: [mom] });
    if (ok) { t.expect("accepted", r, "ok"); const saved = ((await org.summary(g.id)).body.breaks ?? [])[0]; t.check("saved", !!saved); if (saved?.title) t.check("title has no markup characters", !/[<>`]/.test(saved.title), saved.title); } else { t.expect("refused", r, "bad"); t.eq("nothing saved", ((await org.summary(g.id)).body.breaks ?? []).length, 0); }
  } });
  out.push({ name: "moments|two moments at the same number are refused, different numbers are sorted", run: async (t) => {
    const { org, g } = await draft(t); const a = { ...MOMENT("speech", 1), after: 40, seconds: 30 }, b = { ...MOMENT("speech", 2), after: 40, seconds: 30 }, c = { ...MOMENT("speech", 3), after: 10, seconds: 30 };
    t.expect("same number", await org.settings(g.id, { breaks: [a, b] }), "bad"); t.expect("different numbers", await org.settings(g.id, { breaks: [a, c] }), "ok"); t.eq("sorted by number", ((await org.summary(g.id)).body.breaks ?? []).map((x) => x.after), [10, 40]);
  } });
  out.push({ name: "moments|moments left to the software are spread evenly", run: async (t) => {
    const { org, g } = await draft(t, { tickets: 2 }); const r = await org.settings(g.id, { tickets: 2, breaks: [1, 2, 3].map((i) => ({ ...MOMENT("speech", i) })) }); t.expect("save three with no numbers", r, "ok");
    t.eq("spread over the 90 numbers", ((await org.summary(g.id)).body.breaks ?? []).map((x) => x.after), [23, 45, 68]); t.check("each lasts 60 seconds by default", ((await org.summary(g.id)).body.breaks ?? []).every((x) => x.seconds === 60));
  } });
  out.push({ name: "moments|openings must fit in the 2 minutes before the first number", run: async (t) => {
    const { org, g } = await draft(t, { tickets: 2 }); const o = (s) => ({ ...MOMENT("speech"), seconds: s });
    t.expect("60 + 60 seconds", await org.settings(g.id, { tickets: 2, opening: [o(60), o(60)] }), "ok"); t.expect("63 + 60 seconds", await org.settings(g.id, { tickets: 2, opening: [o(63), o(60)] }), "bad"); t.expect("one opening of 123 seconds", await org.settings(g.id, { tickets: 2, opening: [o(123)] }), "bad");
  } });

  // ---------- lucky draws ----------
  for (const winners of [1, 3, 5, 10, 2, 0, 11, "3"]) for (const style of [undefined, "draw", "scratch", "flip"]) out.push({ name: `lucky|${JSON.stringify(winners)} winner${winners === 1 ? "" : "s"} shown as ${style ?? "the default"}`, run: async (t) => {
    const { org, g } = await draft(t); const m = { kind: "lucky", title: "Lucky draw", after: 45, seconds: 30, winners, ...(style ? { style } : {}) }; const r = await org.settings(g.id, { breaks: [m] });
    const okW = [1, 3, 5, 10].includes(winners), okS = style !== "flip";
    if (okW && okS) { t.expect("accepted", r, "ok"); const s = ((await org.summary(g.id)).body.breaks ?? [])[0]; t.eq("winners kept", s?.winners, winners); t.eq("style kept", s?.style ?? "draw", style ?? "draw"); } else { t.expect("refused", r, "bad"); t.check("message names the choice", /1, 3, 5 or 10|draw or as a scratch/i.test(r.body.error ?? ""), r.body.error); }
  } });
  out.push({ name: "lucky|a lucky draw with a link is refused; a non-lucky moment with a style is refused", run: async (t) => {
    const { org, g } = await draft(t); t.expect("lucky with a link", await org.settings(g.id, { breaks: [{ kind: "lucky", title: "Lucky draw", after: 30, seconds: 30, winners: 3, mediaUrl: "https://cdn.example.com/x.mp4" }] }), "bad");
    t.expect("speech with a scratch style", await org.settings(g.id, { breaks: [{ kind: "speech", title: "Hello", after: 30, seconds: 30, style: "scratch" }] }), "bad");
  } });
  out.push({ name: "lucky|three lucky draws in a one-ticket game use all three moments; the organizer, Host and Co-host stay out of the draw once marked", run: async (t) => {
    const { org, g } = await draft(t); const m = (a) => ({ kind: "lucky", title: "Lucky draw", after: a, seconds: 30, winners: 3 });
    t.expect("three draws", await org.settings(g.id, { breaks: [m(20), m(45), m(70)] }), "ok"); t.expect("a fourth", await org.settings(g.id, { breaks: [m(10), m(20), m(45), m(70)] }), "bad");
    await t.publishPay(org, g.id); const a = t.guest(g.id); await a.join(); const mk = await org.api("POST", `/api/z/${g.id}/mark`, { seat: (await a.me()).body.seat, role: "organizer" }); t.expect("mark the Organizer's own seat", mk, "ok");
    const pe = (await org.api("GET", `/api/z/${g.id}/participants`)).body.participants; t.eq("the seat carries the role", pe[0].role, "organizer");
  } });
  return out;
}
