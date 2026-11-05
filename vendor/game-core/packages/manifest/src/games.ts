import type { GameId, Manifest } from "./schema";
const both = ["auto", "manual"] as const;
const claimGame = (id: "tambola" | "bingo", title: string): Manifest => ({
  id, title, labels: ["Claim"], caps: { auto: 100_000, manual: 1_000 }, startModes: [...both], playModes: ["auto-called", "host-called"],
  goldenButton: "Claim", name: id, pauseSupport: true, claimType: "player-presses", prizePositions: ["early5", "top", "mid", "bot", "full"], prizeModes: [...both], rehearsalMax: 20, lateJoin: { kind: "until-end" }, organizerFinalSay: true,
});
const eliminationGame = (id: "tictactoe" | "snakes" | "luck", title: string): Manifest => ({
  id, title, labels: ["Elimination"], caps: { auto: 2_000 }, startModes: [...both], playModes: ["start-only"],
  goldenButton: "You won", name: id, pauseSupport: true, claimType: "auto", prizePositions: ["1st", "2nd", "3rd", "4th", "5th"],
  prizeModes: [...both], rehearsalMax: 10, lateJoin: { kind: "none-after-round-1" }, organizerFinalSay: false,
});
export const MANIFESTS: Record<GameId, Manifest> = {
  tambola: claimGame("tambola", "Corporate Tambola"),
  bingo: claimGame("bingo", "Corporate Bingo"),
  tictactoe: eliminationGame("tictactoe", "Tic Tac Toe"),
  snakes: eliminationGame("snakes", "Snakes and Ladders"),
  luck: eliminationGame("luck", "Luck by Chance"),
  luckydraw: {
    id: "luckydraw", title: "Lucky Draw", labels: ["Lucky Draw"], caps: { auto: 100_000 }, startModes: [...both], playModes: ["start-only"],
    goldenButton: "You won", name: "luckydraw", pauseSupport: true, claimType: "auto", prizePositions: ["1st", "2nd", "3rd"], prizeModes: [...both], rehearsalMax: 10, lateJoin: { kind: "until-draw" }, organizerFinalSay: false,
  },
};
export const GAME_IDS = Object.keys(MANIFESTS) as GameId[];
