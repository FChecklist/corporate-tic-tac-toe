/* Prize planner (note 370, frozen 30 Oct 2026). PURE and GAME-NEUTRAL: no Tambola imports, no DOM, no network, so it can be vendored into the shared organizer pack for every game.
   plan(tickets, count, budget)   -> the prizes of one of the eight approved splits, each with its percent and its amount (whole units, leftover to the biggest prize)
   shareOut(amount, winners)      -> the equal share of one prize between the players who won it (floored; the leftover stays with the organizer)
   validateManual(prizes)         -> the problems of an organizer's own prize list (at least 1, an amount for each, no duplicate id, at most 30)
   hint(plan)                     -> a plain hint (never a block) when the average prize is small
   Nothing here pays anybody: the software shows and records prizes only. The prize "id" is "<ticket>:<pattern>:<ordinal>" (ticket 0 = a prize for both tickets together or a 1-ticket game).
   Patterns are the game's own words: top, mid, bot (Line 1, 2, 3), corners, early5, full (Full House), full2 (Super Bumper). */
(function (root) {
  "use strict";
  var MAX_MANUAL = 30;
  var COUNTS = { 1: [4, 6, 8, 10], 2: [12, 14, 16, 20] };
  var DEFAULT_COUNT = { 1: 6, 2: 14 };
  var LINES = [["top", "Line 1"], ["mid", "Line 2"], ["bot", "Line 3"]];
  var NAMES = { top: "Line 1", mid: "Line 2", bot: "Line 3", corners: "Corners", early5: "Early 5", full: "Full House", full2: "Super Bumper" };
  var ORD = ["1st", "2nd", "3rd", "4th", "5th"];

  // The eight splits, in percent of the budget (each adds to exactly 100). p = [pattern, ordinal, percent]; ticket-specific prizes are repeated per ticket by the builder below.
  var ONE = {
    4: { lines: 20, corners: 0, early5: [], full: [40], full2: [] },
    6: { lines: 15, corners: 10, early5: [], full: [30, 15], full2: [] },
    8: { lines: 12, corners: 8, early5: [8], full: [24, 14, 10], full2: [] },
    10: { lines: 9, corners: 7, early5: [7, 5], full: [24, 14, 9, 7], full2: [] }
  };
  // two tickets: the same prizes for ticket 1 and ticket 2, Early 5 for ticket 1 only, Super Bumper for both tickets together
  var TWO = {
    12: { lines: 5, corners: 4, early5: [], full: [8], full2: [30, 16] },
    14: { lines: 4.5, corners: 3.5, early5: [], full: [8, 4], full2: [26, 16] },
    16: { lines: 4, corners: 3, early5: [5], full: [7, 4], full2: [22, 12, 9] },
    20: { lines: 3.5, corners: 3, early5: [4, 3], full: [6, 4, 2.5], full2: [20, 11, 6, 4] }
  };

  var label = function (pattern, ordinal, ofTotal, ticket) {
    var base = NAMES[pattern] || pattern;
    var t = ticket ? "Ticket " + ticket + ": " : "";
    return t + (ofTotal > 1 ? (ORD[ordinal - 1] || ordinal + "th") + " " : "") + base;
  };
  var make = function (ticket, pattern, ordinal, ofTotal, pct) {
    return { id: ticket + ":" + pattern + ":" + ordinal, ticket: ticket, pattern: pattern, ordinal: ordinal, label: label(pattern, ordinal, ofTotal, ticket), pct: pct };
  };

  /** The percent table of one split: [{id, ticket, pattern, ordinal, label, pct}], in display order. Throws nothing; an unknown count gives []. */
  function split(tickets, count) {
    var t = tickets === 2 ? 2 : 1, c = Number(count), S = t === 2 ? TWO[c] : ONE[c];
    if (!S) return [];
    var out = [];
    var per = function (ticket) {
      LINES.forEach(function (l) { out.push(make(ticket, l[0], 1, 1, S.lines)); });
      if (S.corners) out.push(make(ticket, "corners", 1, 1, S.corners));
      if (t === 1) S.early5.forEach(function (p, i) { out.push(make(0, "early5", i + 1, S.early5.length, p)); });
      S.full.forEach(function (p, i) { out.push(make(ticket, "full", i + 1, S.full.length, p)); });
    };
    if (t === 1) per(0);
    else {
      per(1);
      S.early5.forEach(function (p, i) { out.push(make(1, "early5", i + 1, S.early5.length, p)); }); // Early 5 belongs to ticket 1 only
      per(2);
      S.full2.forEach(function (p, i) { out.push(make(0, "full2", i + 1, S.full2.length, p)); });
    }
    return out;
  }

  /** Whole units: floor each prize; the leftover goes to the biggest prize (the first one on a tie). */
  function amounts(rows, budget) {
    var b = Math.floor(Number(budget));
    if (!(b > 0)) return rows.map(function (r) { return Object.assign({}, r, { amount: 0 }); });
    var out = rows.map(function (r) { return Object.assign({}, r, { amount: Math.floor(b * r.pct / 100 + 1e-9) }); });
    var sum = out.reduce(function (s, r) { return s + r.amount; }, 0), big = 0;
    out.forEach(function (r, i) { if (r.pct > out[big].pct) big = i; });
    out[big].amount += b - sum; // the leftover rupees (never negative: every prize was floored)
    return out;
  }

  /** The plan for a budget: prize count chosen from the approved counts of the ticket count (default 6 / 14). */
  function plan(tickets, count, budget) {
    var t = tickets === 2 ? 2 : 1, c = COUNTS[t].indexOf(Number(count)) >= 0 ? Number(count) : DEFAULT_COUNT[t];
    var rows = amounts(split(t, c), budget);
    return { tickets: t, count: c, budget: Math.floor(Number(budget)) > 0 ? Math.floor(Number(budget)) : 0, total: rows.reduce(function (s, r) { return s + r.amount; }, 0), prizes: rows };
  }

  /** The equal share of one prize between the players who won it. Floored to whole units; what is left over stays with the organizer. */
  function shareOut(prizeAmount, winners) {
    var a = Math.max(0, Math.floor(Number(prizeAmount) || 0)), n = Math.floor(Number(winners) || 0);
    if (n < 1) return { share: 0, leftover: a, winners: 0 };
    var share = Math.floor(a / n);
    return { share: share, leftover: a - share * n, winners: n };
  }

  /** The problems of a Manual list (empty = fine): at least 1 prize, an amount for each (the gift name is optional), no duplicate id, at most 30. */
  function validateManual(prizes) {
    var bad = [], list = Array.isArray(prizes) ? prizes : [], seen = {};
    if (list.length < 1) bad.push("Add at least one prize.");
    if (list.length > MAX_MANUAL) bad.push("A game can have up to " + MAX_MANUAL + " prizes.");
    list.forEach(function (p, i) {
      var n = i + 1;
      if (!p || typeof p.id !== "string" || !p.id) { bad.push("Prize " + n + " has no name."); return; }
      if (seen[p.id]) bad.push("Prize " + n + " is listed twice."); seen[p.id] = true;
      var a = Number(p.amount);
      if (!(a > 0) || Math.floor(a) !== a) bad.push("Prize " + n + " needs an amount (a whole number above 0).");
      if (p.gift != null && String(p.gift).length > 60) bad.push("Prize " + n + ": the gift name can have up to 60 characters.");
    });
    return bad;
  }

  /** A friendly hint (never a block) when the prizes are small: the average prize of the plan is under 100 units. */
  function hint(p) {
    if (!p || !p.prizes || !p.prizes.length || !(p.budget > 0)) return "";
    var avg = p.total / p.prizes.length;
    return avg < 100 ? "Your prizes are small. Most teams give more, but this is entirely your choice. You can raise the budget, choose fewer prizes, or give a gift or a voucher." : "";
  }

  var API = { COUNTS: COUNTS, DEFAULT_COUNT: DEFAULT_COUNT, MAX_MANUAL: MAX_MANUAL, split: split, plan: plan, shareOut: shareOut, validateManual: validateManual, hint: hint, label: label };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (root) root.ZPRIZE = API;
})(typeof window !== "undefined" ? window : typeof globalThis !== "undefined" ? globalThis : this);
