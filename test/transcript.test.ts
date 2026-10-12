import { describe, expect, test } from "bun:test";
import { MatchState, TOTAL_MOVES, newDeviceKeys, signMove, verifyTranscript, type DeviceKeys, type SignedMove } from "../src/transcript";
import { emptyCells } from "../src/engine";

const XA = [true, false, true];

async function playRandom(seedNum = 1) {
  let s = seedNum; const rnd = (n: number) => { s = (s * 1664525 + 1013904223) >>> 0; return s % n; };
  const ka = await newDeviceKeys(), kb = await newDeviceKeys();
  const st = new MatchState("m1", XA, ka.pubJwk, kb.pubJwk);
  while (!st.done) {
    const who = st.mover!; const cells = emptyCells(st.boards[st.boardIndex]!.cells);
    const sm = await signMove(who === "A" ? ka : kb, st.nextMove(who, cells[rnd(cells.length)]!, 1000 + st.seq));
    expect(await st.apply(sm)).toBeNull();
  }
  return { st, ka, kb };
}

describe("a match as a chain of signed moves", () => {
  test("a whole match is 50 moves: 9 + 16 + 25", async () => {
    const { st } = await playRandom(); expect(TOTAL_MOVES).toBe(50); expect(st.moves.length).toBe(50); expect(st.done).toBe(true);
    expect(st.boards.every((b) => b.cells.every((c) => c !== 0))).toBe(true);
  });
  test("the starting player alternates correctly on each board (X moves first)", async () => {
    const { st } = await playRandom(3);
    // board 1: A has X, so A makes moves 0,2,4,6,8; board 2: B has X, so B moves first on move 9
    expect(st.moves[0]!.m.p).toBe("A"); expect(st.moves[1]!.m.p).toBe("B"); expect(st.moves[9]!.m.p).toBe("B"); expect(st.moves[25]!.m.p).toBe("A");
  });
  test("anyone can replay the chain and get the same score the players saw", async () => {
    const { st, ka, kb } = await playRandom(5);
    const v = await verifyTranscript("m1", XA, ka.pubJwk, kb.pubJwk, st.moves);
    expect(v.ok).toBe(true); if (v.ok) expect(v.score).toEqual(st.score());
  });
  test("changing a cell breaks the chain", async () => {
    const { st, ka, kb } = await playRandom(7);
    const forged: SignedMove[] = st.moves.map((x, i) => (i === 10 ? { ...x, m: { ...x.m, c: (x.m.c + 1) % 16 } } : x));
    const v = await verifyTranscript("m1", XA, ka.pubJwk, kb.pubJwk, forged); expect(v.ok).toBe(false);
  });
  test("removing or reordering a move is refused", async () => {
    const { st, ka, kb } = await playRandom(9);
    const missing = st.moves.filter((_, i) => i !== 20); expect((await verifyTranscript("m1", XA, ka.pubJwk, kb.pubJwk, missing)).ok).toBe(false);
    const swapped = [...st.moves]; [swapped[4], swapped[5]] = [swapped[5]!, swapped[4]!]; expect((await verifyTranscript("m1", XA, ka.pubJwk, kb.pubJwk, swapped)).ok).toBe(false);
  });
  test("a move signed by the wrong key is refused (nobody can move for the opponent)", async () => {
    const ka = await newDeviceKeys(), kb = await newDeviceKeys(); const st = new MatchState("m1", XA, ka.pubJwk, kb.pubJwk);
    const sm = await signMove(kb, st.nextMove("A", 0)); expect(await st.apply(sm)).toBe("bad signature");
  });
  test("moving out of turn, onto a taken cell, off the board, or in another match is refused", async () => {
    const ka = await newDeviceKeys(), kb = await newDeviceKeys(); const st = new MatchState("m1", XA, ka.pubJwk, kb.pubJwk);
    expect(await st.apply(await signMove(kb, st.nextMove("B", 0)))).toBe("not this player's turn");
    expect(await st.apply(await signMove(ka, st.nextMove("A", 99)))).toBe("cell not free");
    expect(await st.apply(await signMove(ka, { ...st.nextMove("A", 0), k: "other" }))).toBe("wrong match");
    expect(await st.apply(await signMove(ka, st.nextMove("A", 0)))).toBeNull();
    expect(await st.apply(await signMove(kb, st.nextMove("B", 0)))).toBe("cell not free");
  });
  test("replaying an old move is refused (out of order)", async () => {
    const ka = await newDeviceKeys(), kb = await newDeviceKeys(); const st = new MatchState("m1", XA, ka.pubJwk, kb.pubJwk);
    const first = await signMove(ka, st.nextMove("A", 0)); expect(await st.apply(first)).toBeNull(); expect(await st.apply(first)).toContain("out of order");
  });
  test("an unfinished chain does not verify as a finished match", async () => {
    const { st, ka, kb } = await playRandom(11);
    expect((await verifyTranscript("m1", XA, ka.pubJwk, kb.pubJwk, st.moves.slice(0, 40))).ok).toBe(false);
  });
  test("two phones that each apply the same signed moves reach exactly the same state", async () => {
    const { st, ka, kb } = await playRandom(13); const other = new MatchState("m1", XA, ka.pubJwk, kb.pubJwk);
    for (const m of st.moves) expect(await other.apply(m)).toBeNull();
    expect(other.boards).toEqual(st.boards); expect(other.lastHash).toBe(st.lastHash); expect(other.score()).toEqual(st.score());
  });
  test("a key pair is made on the device and never leaves it (only the public part is exported)", async () => {
    const k: DeviceKeys = await newDeviceKeys(); expect(k.pubJwk.d).toBeUndefined(); expect(k.pubJwk.kty).toBe("EC");
  });
});
