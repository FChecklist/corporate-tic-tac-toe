import { describe, expect, test } from "bun:test";
import { activeBreak, callRoundFull, checkClaims, completionIndexKey, scheduleFull, settleAll, stillToWin, ticketFor, ticketsFor } from "../src/game";
import { OPENING_WINDOW_SECONDS, autoAfter, brandMomentsFor, breakShift, defaultCfg, keysInPlay, roundEid, validateCfg, type BreakCfg, type EngagementCfg } from "../src/config";
import { deriveCalls } from "../src";
import { createHash } from "node:crypto";
import { ticketNumbers } from "../../shared/src/ticket";

const rnd = (k: number) => createHash("sha256").update("cfg" + k).digest("hex");
const E = "ENG-CFG";
const LOG = deriveCalls(E, Array.from({ length: 75 }, (_, k) => rnd(k)));
const pids = Array.from({ length: 400 }, (_, i) => "q" + i);
const ok = (i: any, base?: EngagementCfg) => { const v = validateCfg(i, base); if (!v.ok) throw new Error(v.error); return v.cfg; };
const bad = (i: any, base?: EngagementCfg) => { const v = validateCfg(i, base); expect(v.ok).toBe(false); return (v as any).error as string; };

describe("engagement settings", () => {
  test("nothing set gives one card, the three default places with no text, auto marking and no breaks", () => {
    const c = ok({});
    expect(c.tickets).toBe(1);
    expect(c.rewards.map((r) => r.pattern)).toEqual(["first", "second", "third"]);
    expect(c.rewards.every((r) => r.ordinal === 1 && r.scope === "ticket" && r.text === "")).toBe(true);
    expect(c.mark).toBeUndefined();
    expect(c.breaks).toEqual([]);
  });
  test("rewards: only places that exist, one winner each, in sequence, text cleaned and cut", () => {
    const c = ok({ rewards: [{ pattern: "first", ordinal: 1, text: "Gift <b>hamper</b>" }, { pattern: "second", text: "x".repeat(200) }, { pattern: "third", text: "Coffee voucher" }] });
    expect(c.rewards[0]!.text).toBe("Gift bhamper/b");
    expect(c.rewards[1]!.text.length).toBe(80);
    expect(keysInPlay(c.rewards)).toEqual(["first", "second", "third"]);
    bad({ rewards: [{ pattern: "bingo" }] });
    bad({ rewards: [{ pattern: "full" }] });
    bad({ rewards: [] });
    bad({ rewards: [{ pattern: "first", ordinal: 2 }] }); // a 2nd winner needs a 1st
    bad({ rewards: [{ pattern: "first", ordinal: 1 }, { pattern: "first", ordinal: 1 }] });
    bad({ rewards: [{ pattern: "first", ordinal: 2 }] }); // every place has exactly one winner
    bad({ rewards: Array.from({ length: 31 }, (_, i) => ({ pattern: "second", ordinal: 1 + (i % 3) })) });
    bad({ rewards: "nope" });
  });
  test("one or two cards per guest; anything else is refused; marking is auto or tap", () => {
    expect(ok({ tickets: 2 }).tickets).toBe(2);
    bad({ tickets: 3 }); bad({ tickets: 0 });
    expect(ok({ mark: "tap" }).mark).toBe("tap");
    expect(ok({ mark: "auto" }, ok({ mark: "tap" })).mark).toBeUndefined();
    bad({ mark: "never" });
  });
  test("brand breaks: at most 3, 15 to 600 seconds in steps of 3, a kind, a title, a safe https link", () => {
    const b = (o: any = {}) => ({ after: 30, seconds: 30, kind: "speech", title: "CEO message", ...o });
    expect(ok({ breaks: [b(), b({ after: 60, kind: "youtube", mediaUrl: "https://youtu.be/abc" }), b({ after: 10, kind: "file", mediaUrl: "https://cdn.acme.com/v.mp4" })] }).breaks.map((x) => x.after)).toEqual([10, 30, 60]);
    bad({ breaks: [b(), b({ after: 31 }), b({ after: 32 }), b({ after: 33 })] });
    for (const o of [{ after: 0 }, { after: 75 }, { after: 1.5 }, { seconds: 12 }, { seconds: 31 }, { seconds: 601 }, { kind: "hologram" }, { title: "x" }, { title: "" }])
      bad({ breaks: [b(o)] });
    expect(ok({ breaks: [b({ after: 74 })] }).breaks[0]!.after).toBe(74);
    bad({ breaks: [b({ kind: "file" })] }); // needs a link
    bad({ breaks: [b({ kind: "youtube", mediaUrl: "https://evil.example/watch" })] });
    for (const u of ["http://acme.com/v.mp4", "javascript:alert(1)", "https://a b.com", "https://x.com/<script>", "ftp://x.com/a"]) bad({ breaks: [b({ kind: "file", mediaUrl: u })] });
    bad({ breaks: [b(), b()] }); // same position twice
    expect(ok({ breaks: [] }).breaks).toEqual([]);
  });
  test("partial updates keep everything else", () => {
    const base = ok({ tickets: 2, mark: "tap", rewards: [{ pattern: "first", text: "Hamper" }], breaks: [{ after: 20, seconds: 30, kind: "speech", title: "Welcome" }] });
    const next = ok({ breaks: [] }, base);
    expect(next.tickets).toBe(2); expect(next.mark).toBe("tap");
    expect(next.rewards).toEqual(base.rewards);
  });
});

describe("two cards", () => {
  test("a second card is always different from the first and stable; the first never changes", () => {
    for (const p of pids.slice(0, 60)) {
      const [a, b] = ticketsFor(E, p, 2);
      expect(a).toEqual(ticketFor(E, p));
      expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
      expect(ticketsFor(E, p, 2)[1]).toEqual(b);
    }
    expect(ticketsFor(E, "q1", 1)).toHaveLength(1);
  });
  test("a house is completed by the better of the two cards", () => {
    const tk = ticketsFor(E, "q5", 2);
    const single = tk.map((t) => completionIndexKey([t], "blackout", LOG));
    expect(completionIndexKey(tk, "blackout", LOG)).toBe(Math.min(...single));
  });
  test("still to win counts the nearer card", () => {
    const tk = ticketsFor(E, "q6", 2); const part = LOG.slice(0, 25);
    const left = (t: any) => ticketNumbers(t).filter((n) => !part.includes(n)).length;
    expect(stillToWin(tk, "blackout", part)).toBe(Math.min(left(tk[0]), left(tk[1])));
    expect(stillToWin(tk, "blackout", LOG)).toBe(0);
  });
});


describe("brand breaks move the schedule for everyone alike", () => {
  const breaks: BreakCfg[] = [{ after: 3, seconds: 30, kind: "speech", title: "A" }, { after: 10, seconds: 60, kind: "speech", title: "B" }];
  test("calls before a break are untouched, calls after are pushed by its length, in 3 s rounds", () => {
    expect(breakShift(breaks, 2)).toBe(0);
    expect(breakShift(breaks, 3)).toBe(10);
    expect(breakShift(breaks, 10)).toBe(30);
    const s = scheduleFull(null, 1000, 2, breaks, 12);
    expect(s[0]).toBe(1000); expect(s[2]).toBe(1004); expect(s[3]).toBe(1000 + 6 + 10); expect(s[10]).toBe(1000 + 20 + 30);
  });
  test("the gap between calls is the normal stride everywhere except across a break", () => {
    const s = scheduleFull(null, 1000, 2, breaks, 20) as number[];
    const gaps = s.slice(1).map((r, i) => r - s[i]!);
    expect(gaps.filter((g) => g === 2)).toHaveLength(17);
    expect(gaps[2]).toBe(2 + 10); expect(gaps[9]).toBe(2 + 20);
  });
  test("the break is showing exactly for its length, starting right after the call it follows, and never before or after", () => {
    const prev = callRoundFull(null, 1000, 2, breaks, 2)!; // the 3rd call
    expect(activeBreak(null, 1000, 2, breaks, prev)).toBeNull();
    expect(activeBreak(null, 1000, 2, breaks, prev + 1)?.brk.title).toBe("A");
    expect(activeBreak(null, 1000, 2, breaks, prev + 10)?.brk.title).toBe("A");
    expect(activeBreak(null, 1000, 2, breaks, prev + 11)).toBeNull();
    expect(callRoundFull(null, 1000, 2, breaks, 3)! > prev + 10).toBe(true);
  });
  test("breaks are part of the public settings, so they decide which rounds feed the numbers, identically for everyone", () => {
    const withB = scheduleFull(null, 1000, 2, breaks, 75) as number[]; const plain = scheduleFull(null, 1000, 2, [], 75) as number[];
    const rr = (r: number) => createHash("sha256").update("r" + r).digest("hex");
    expect(withB.map(rr)).not.toEqual(plain.map(rr)); // different rounds feed the numbers (as designed: the schedule is part of the engagement)
    expect(deriveCalls("X", withB.map(rr))).toEqual(deriveCalls("X", withB.map(rr)));
  });
});

describe("lucky draw", () => {
  const lucky = (o: any = {}) => ({ after: 30, seconds: 30, kind: "lucky", title: "Lucky draw", winners: 3, ...o });
  test("is a break that picks 1, 3, 5 or 10 people and has no link; 3 is the default", () => {
    expect(ok({ breaks: [lucky()] }).breaks[0]!.winners).toBe(3);
    expect(ok({ breaks: [{ after: 30, seconds: 30, kind: "lucky", title: "Draw" }] }).breaks[0]!.winners).toBe(3);
    for (const w of [1, 5, 10]) expect(ok({ breaks: [lucky({ winners: w })] }).breaks[0]!.winners).toBe(w as 1 | 5 | 10);
    for (const w of [0, 2, 11, "3", null]) bad({ breaks: [lucky({ winners: w })] });
    bad({ breaks: [lucky({ mediaUrl: "https://x.com/a" })] });
  });
  test("winners are not accepted on other kinds of break", () => {
    expect(ok({ breaks: [{ after: 30, seconds: 30, kind: "speech", title: "Hi", winners: 5 }] }).breaks[0]!.winners).toBeUndefined();
  });
});

describe("rounds", () => {
  test("1 to 5, whole numbers only, one by default, kept when other settings change", () => {
    expect(ok({}).rounds).toBe(1);
    for (const r of [1, 2, 5]) expect(ok({ rounds: r }).rounds).toBe(r);
    for (const r of [0, 6, 1.5, "2", null, -1]) bad({ rounds: r });
    expect(ok({ tickets: 2 }, ok({ rounds: 3 })).rounds).toBe(3);
  });
  test("each round has its own id, so its own numbers and tickets; round 1 keeps the engagement's id", () => {
    expect(roundEid("E1", 1)).toBe("E1");
    expect(roundEid("E1", 2)).toBe("E1~r2");
    expect(new Set([1, 2, 3, 4, 5].map((r) => roundEid("E1", r))).size).toBe(5);
  });
});

describe("five brand moments for each ticket: openings, during the game, closings", () => {
  const msg = (o: Record<string, unknown> = {}) => ({ kind: "speech", title: "Welcome from Acme", ...o });
  const mid = (o: Record<string, unknown> = {}) => ({ kind: "speech", title: "A word from Acme", ...o });
  const good = (i: any, base?: any) => { const v = validateCfg(i, base); if (!v.ok) throw new Error(v.error); return v.cfg; };
  const refused = (i: any, base?: any) => { const v = validateCfg(i, base); expect(v.ok).toBe(false); return v.ok ? "" : v.error; };

  test("even spread: the k-th of n moments goes after round(75 x k / (n + 1)), for n = 1 to 6", () => {
    const table: Record<number, number[]> = { 1: [38], 2: [25, 50], 3: [19, 38, 56], 4: [15, 30, 45, 60], 5: [13, 25, 38, 50, 63], 6: [11, 21, 32, 43, 54, 64] };
    for (const n of [1, 2, 3, 4, 5, 6]) expect(Array.from({ length: n }, (_, i) => autoAfter(n, i + 1))).toEqual(table[n]!);
  });

  test("the allowance follows the tickets: 1 ticket gives 1 + 3 + 1 = 5, 2 tickets give 2 + 6 + 2 = 10", () => {
    expect(brandMomentsFor(1)).toBe(5); expect(brandMomentsFor(2)).toBe(10);
    const c1 = good({ tickets: 1, opening: [msg()], breaks: [mid(), mid(), mid()], closing: [msg()] });
    expect([c1.opening!.length, c1.breaks.length, c1.closing!.length]).toEqual([1, 3, 1]);
    refused({ tickets: 1, breaks: [mid(), mid(), mid(), mid()] });
    refused({ tickets: 1, opening: [msg(), msg()] });
    refused({ tickets: 1, closing: [msg(), msg()] });
    const c2 = good({ tickets: 2, opening: [msg({ seconds: 60 }), msg({ seconds: 60 })], breaks: [mid(), mid(), mid(), mid(), mid(), mid()], closing: [msg(), msg()] });
    expect([c2.opening!.length, c2.breaks.length, c2.closing!.length]).toEqual([2, 6, 2]);
    refused({ tickets: 2, breaks: Array.from({ length: 7 }, () => mid()) });
    refused({ tickets: 2, opening: [msg(), msg(), msg()] });
  });

  test("breaks with no number typed are placed evenly, last for 60 s unless told, and are marked automatic", () => {
    const c = good({ tickets: 2, breaks: [mid(), mid({ seconds: 120 }), mid()] });
    expect(c.breaks.map((b) => b.after)).toEqual([19, 38, 56]);
    expect(c.breaks.map((b) => b.seconds)).toEqual([60, 120, 60]);
    expect(c.breaks.every((b) => b.auto === true)).toBe(true);
  });

  test("saving again re-spreads: adding a fourth automatic break moves the others; explicit numbers never move", () => {
    const three = good({ tickets: 2, breaks: [mid(), mid(), mid()] });
    const four = good({ tickets: 2, breaks: [...three.breaks, mid()] }, three);
    expect(four.breaks.map((b) => b.after)).toEqual([15, 30, 45, 60]);
    const old = good({ breaks: [{ after: 20, seconds: 30, kind: "speech", title: "Old game" }] });
    expect(old.breaks[0]!.after).toBe(20); expect(old.breaks[0]!.auto).toBeUndefined();
    const mixed = good({ breaks: [{ after: 10, seconds: 30, kind: "speech", title: "Fixed" }, mid(), mid()] });
    expect(mixed.breaks.map((b) => b.after)).toEqual([10, 25, 50]);
  });

  test("going from 2 tickets to 1 is refused while more than one ticket's worth is switched on, and says what to do", () => {
    const two = good({ tickets: 2, opening: [msg({ seconds: 30 }), msg({ seconds: 30 })], breaks: [mid(), mid(), mid(), mid()] });
    const why = refused({ tickets: 1 }, two);
    expect(why).toContain("1 card per person"); expect(why).toContain("5 brand moments"); expect(why).toContain("switch some off");
    expect(good({ tickets: 1, opening: [msg()], breaks: [mid(), mid(), mid()] }, two).tickets).toBe(1);
  });

  test("an opening plays inside the 2 minutes before the first number: 15 to 120 s in steps of 3, 60 s by default, together at most 120 s", () => {
    expect(OPENING_WINDOW_SECONDS).toBe(120);
    expect(good({ opening: [msg()] }).opening![0]!.seconds).toBe(60);
    for (const sec of [14, 16, 123, 0, "60", null]) if (sec !== null) refused({ opening: [msg({ seconds: sec })] });
    refused({ tickets: 2, opening: [msg({ seconds: 90 }), msg({ seconds: 60 })] });
    expect(good({ tickets: 2, opening: [msg({ seconds: 60 }), msg({ seconds: 60 })] }).opening!.length).toBe(2);
  });

  test("a closing carries no time; a lucky draw can only be placed during the game; links follow the same safe rules", () => {
    expect(good({ closing: [msg({ seconds: 99 })] }).closing![0]!.seconds).toBeUndefined();
    refused({ opening: [{ kind: "lucky", title: "Draw" }] }); refused({ closing: [{ kind: "lucky", title: "Draw" }] });
    refused({ closing: [{ kind: "file", title: "Thanks" }] });
    refused({ closing: [{ kind: "youtube", title: "Thanks", mediaUrl: "https://evil.example/x" }] });
    refused({ opening: [msg({ mediaUrl: "http://acme.com/a.mp4" })] });
    expect(good({ closing: [{ kind: "youtube", title: "Thanks", mediaUrl: "https://youtu.be/abcdefghijk" }] }).closing![0]!.mediaUrl).toContain("youtu.be");
    refused({ opening: [msg({ title: "x" })] });
  });

  test("lucky draws are placed together with the other during-the-game moments, in the order added", () => {
    const c = good({ tickets: 2, breaks: [mid(), { kind: "lucky", title: "Lucky draw: watch", winners: 1 }, mid()] });
    expect(c.breaks.map((b) => [b.kind, b.after])).toEqual([["speech", 19], ["lucky", 38], ["speech", 56]]);
  });

  test("nothing set gives no openings and no closings, and old saved settings still load", () => {
    const d = defaultCfg(); expect(d.opening).toEqual([]); expect(d.closing).toEqual([]);
    const old = good({ tickets: 1, rewards: undefined, breaks: [{ after: 31, seconds: 60, kind: "speech", title: "Saved earlier" }], rounds: 1 });
    expect(old.opening).toEqual([]); expect(old.closing).toEqual([]);
  });
});

describe("a media file kept on our own site", () => {
  const brk = (u: string) => ({ breaks: [{ after: 30, seconds: 30, kind: "file", title: "Explainer", mediaUrl: u }] });
  test("a plain path to a media file on the site is accepted (the demo's built-in video); anything with folders, other types or tricks is refused", () => {
    expect(validateCfg(brk("/demo-break.mp4")).ok).toBe(true);
    for (const u of ["/a/b.mp4", "//evil.example/x.mp4", "/x.html", "/x.mp4?y=1", "/../x.mp4", "demo.mp4", "/x.mp4 ", "/.mp4x", "javascript:alert(1)", "http://acme.com/v.mp4"]) expect([u, validateCfg(brk(u)).ok]).toEqual([u, false]);
  });
});

describe("guest invitations: each guest may invite 1 to 10 people (default 4)", () => {
  test("10 is the most; 0 and 11 are refused; the default stays 4", () => {
    expect(validateCfg({ invites: { on: true, per: 10, cats: ["family"] } }).ok).toBe(true);
    for (const per of [0, 11, 2.5]) expect(validateCfg({ invites: { on: true, per, cats: ["family"] } }).ok).toBe(false);
    expect(defaultCfg().invites!.per).toBe(4);
  });
});
