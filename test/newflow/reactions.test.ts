// X*: Reaction scheduler hooks: at most 15 per 10 minutes of game time, 2 to 3 s each, none while paused. The reactions a page offers must be ones the scheduler knows.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { MAX_PER_WINDOW, REACTIONS, ReactionScheduler, WINDOW_MS, reactionsFor, type Reaction } from "../../vendor/game-core/packages/ui/src/reactions";
import { REACTION_GAP_MS, REACTION_MAX, REACTION_SHOW_MS, reactionGate } from "../../vendor/game-core/packages/tictactoe/src";

const pub = (f: string) => readFileSync(new URL(`../../apps/web/public/${f}`, import.meta.url), "utf8");
const stripC = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
const sched = (viewer: string | null = "me") => { const shown: { r: Reaction; at: number }[] = []; let clock = 0; const s = new ReactionScheduler(viewer, (r) => shown.push({ r, at: clock })); return { s, shown, at: (t: number) => (clock = t) }; };
const ttPublic = () => reactionsFor("tictactoe").filter((r) => !r.personal || true);

describe("X1 at most 15 in 10 minutes of game time", () => {
  test("X1: offering a reaction every 16 s for 10 minutes shows exactly 15, never more", () => {
    const { s, shown, at } = sched(); const gen = REACTIONS.find((r) => r.id === "yeah")!;
    for (let t = 0; t < WINDOW_MS; t += 16_000) { at(t); s.react(gen.id, { now: t, who: "me", game: "tictactoe" }); }
    expect(shown.length).toBe(15); expect(MAX_PER_WINDOW).toBe(15); expect(WINDOW_MS).toBe(600_000);
  });
  test("X1b: not even a high-priority reaction goes over the 15 (champion, bullseye, poof_gone count too)", () => {
    const { s, shown, at } = sched();
    for (let t = 0; t < 300_000; t += 3_000) { at(t); s.react("champion", { now: t, who: "me", priority: "high", game: "tictactoe" }); }
    expect(shown.length).toBeLessThanOrEqual(15);
  });
  test("X1c: in any sliding 10-minute window of a 30-minute game no more than 15 are shown", () => {
    const { s, shown, at } = sched();
    for (let t = 0; t < 1_800_000; t += 5_000) { at(t); s.react("yeah", { now: t, who: "me", game: "tictactoe" }); s.tick(t); }
    for (const w of shown) expect(shown.filter((x) => x.at >= w.at && x.at < w.at + WINDOW_MS).length).toBeLessThanOrEqual(15);
    expect(shown.length).toBeGreaterThan(15);
  });
  test("X1d: the gap between two shown reactions of one player is at least 15 s (20 to 25 s is the aim: about one in 22 s)", () => {
    const { s, shown, at } = sched();
    for (let t = 0; t < 120_000; t += 1_000) { at(t); s.react("yeah", { now: t, who: "me", game: "tictactoe" }); s.tick(t); }
    for (let i = 1; i < shown.length; i++) expect(shown[i]!.at - shown[i - 1]!.at).toBeGreaterThanOrEqual(15_000);
  });
  test("X2: the Tic Tac Toe gate: 22 s gap exactly, 15 at most, 2.5 s each", () => {
    const g = reactionGate(); expect(g.allow(0)).toBe(true); expect(g.allow(REACTION_GAP_MS - 1)).toBe(false); expect(g.allow(REACTION_GAP_MS)).toBe(true);
    const h = reactionGate(); let n = 0; for (let t = 0; t < 3_600_000; t += REACTION_GAP_MS) if (h.allow(t)) n++; expect(n).toBe(15);
    expect(REACTION_GAP_MS).toBe(22_000); expect(REACTION_MAX).toBe(15); expect(REACTION_SHOW_MS).toBe(2500);
  });
});

describe("X3 2 to 3 seconds each", () => {
  test("X3: every reaction of the pack shows for 2000 to 3000 ms", () => { for (const r of REACTIONS) { expect(r.ms).toBeGreaterThanOrEqual(2000); expect(r.ms).toBeLessThanOrEqual(3000); } });
  test("X3b: every reaction is a short English phrase (no digits, at most 3 words)", () => { for (const r of REACTIONS) { expect(r.text).toMatch(/^[A-Za-z' ,!?-]+$/); expect(r.text.split(" ").length).toBeLessThanOrEqual(3); } });
});

describe("X4 none while paused", () => {
  test("X4: the scheduler is given game time, so a pause stands still: offers during a pause (the same game second) show nothing new after the first", () => {
    const { s, shown, at } = sched(); at(1000); s.react("yeah", { now: 1000, who: "me", game: "tictactoe" });
    for (let i = 0; i < 50; i++) s.react("yes", { now: 1000, who: "me", game: "tictactoe" }); // paused: game time does not move
    expect(shown.length).toBe(1);
  });
  test("X4b: a reaction offered while the game is paused is not shown (the scheduler has a paused state)", () => {
    const { s, shown } = sched(); (s as any).paused = true; (s as any).setPaused?.(true);
    const v = s.react("yeah", { now: 5000, who: "me", game: "tictactoe", paused: true } as any); expect(v).not.toBe("show"); expect(shown.length).toBe(0);
  });
  test("X4c: the player page offers no reaction on pause (no rx('pause') or rx('resume') call in the page code)", () => {
    const code = stripC(pub("ttt.js")) + stripC(pub("tttstage.js"));
    expect(/rx\(\s*paused\s*\?\s*["']pause["']/.test(code) || /rx\(\s*["'](pause|resume)["']/.test(code)).toBe(false);
  });
  test("X4d: the page gives the scheduler game time (clock minus pauses), not the wall clock", () => {
    const code = stripC(pub("ttt.js")); const call = code.match(/\.react\([^)]*\)/)?.[0] ?? "";
    expect(/now:\s*Date\.now\(\)/.test(call)).toBe(false);
  });
});

describe("X5 the hooks", () => {
  test("X5: every reaction id the player pages offer is a real reaction of the pack for Tic Tac Toe (an unknown id never shows anything)", () => {
    const code = stripC(pub("ttt.js")) + stripC(pub("tttstage.js")); const ids = new Set<string>();
    for (const m of code.matchAll(/\brx\(\s*["']([a-z_]+)["']/g)) ids.add(m[1]!);
    for (const m of code.matchAll(/rx\([^)]*\?\s*["']([a-z_]+)["']\s*:\s*["']([a-z_]+)["']/g)) { ids.add(m[1]!); ids.add(m[2]!); }
    expect(ids.size).toBeGreaterThan(5);
    const known = new Set(reactionsFor("tictactoe").map((r) => r.id)), unknown = [...ids].filter((i) => !known.has(i));
    expect(unknown).toEqual([]);
  });
  test("X5b: the scheduler shows a Tic Tac Toe reaction at a fitting event and refuses another game's", () => {
    const { s, shown, at } = sched(); at(0);
    expect(s.react("champion", { now: 0, who: "me", priority: "high", game: "tictactoe" })).toBe("show"); expect(shown[0]!.r.text).toBe("Champion!");
    const { s: s2 } = sched(); expect(s2.react("jackpot", { now: 0, game: "tictactoe" })).toBe("wrong-game");
  });
  test("X5c: a personal reaction shows only to the player it happened to", () => {
    const { s } = sched("me"); expect(s.react("poof_gone", { now: 0, who: "somebody-else", game: "tictactoe" })).toBe("not-yours"); expect(s.react("poof_gone", { now: 0, who: "me", game: "tictactoe" })).toBe("show");
  });
  test("X5d: mode 'off' shows nothing at all", () => { const { s, shown } = sched(); s.setMode("off"); for (const r of ttPublic()) s.react(r.id, { now: 0, who: "me", game: "tictactoe" }); expect(shown.length).toBe(0); });
});
