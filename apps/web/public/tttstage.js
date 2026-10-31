/* Corporate Tic Tac Toe, the new flow (stages): the player's screen. Loaded only with ?flow=new (ttt.js). The server only stores and relays the public log;
   the stage clock, the pairing, the cuts and the ranking are computed here, on every phone, by the same pure functions (tttengine.js), from the published start and the log. */
(function () {
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const mmss = (n) => Math.floor(Math.max(0, n) / 60) + ":" + String(Math.max(0, n) % 60).padStart(2, "0");
  window.TTTSTAGE = function (ctx) {
    const api = ctx.api, EID = ctx.EID, E = () => window.TTTENG;
    let setup = null, setupAt = 0, skew = 0, results = [], lastId = 0, resultsAt = 0, slotKey = "", moves = [], movesAt = 0, wrote = {}, prevPlace = 0, prevOut = false, prevSlotWon = "";
    const post = async (slot, kind, seq, body) => { const k = `${slot}|${kind}|${seq}`; if (wrote[k]) return; wrote[k] = 1; try { await api("POST", `/api/z/${EID}/ttt/stagelog`, { pid: ctx.pid(), device: ctx.device(), slot, kind, seq, body }); } catch (e) { delete wrote[k]; } };
    const load = async () => {
      if (Date.now() - setupAt < 15000 && setup) return;
      setupAt = Date.now();
      try { const j = await api("GET", `/api/z/${EID}/ttt/setup`); skew = (j.serverNow || Date.now()) - Date.now(); setup = j; } catch (e) { /* the next look tries again */ }
    };
    const pollResults = async () => {
      if (Date.now() - resultsAt < 1500) return; resultsAt = Date.now();
      try { for (let i = 0; i < 5; i++) { const j = await api("GET", `/api/z/${EID}/ttt/stagelog?after=${lastId}`); const es = j.entries || []; for (const e of es) { results.push(e); lastId = Math.max(lastId, e.id); } if (es.length < 1000) break; } } catch (e) { /* later */ }
    };
    const pollMoves = async (key) => {
      if (key !== slotKey) { slotKey = key; moves = []; movesAt = 0; }
      if (Date.now() - movesAt < 800) return; movesAt = Date.now();
      try { const j = await api("GET", `/api/z/${EID}/ttt/stagelog?slot=${encodeURIComponent(key)}&after=0`); moves = j.entries || []; } catch (e) { /* later */ }
    };
    const names = () => { const m = {}; for (const r of setup.roster || []) m[r.pid] = r.name; return m; };
    const boardHtml = (g, mine, over) => `<div class="tboard" role="grid" aria-label="Board">${g.board.map((m, i) => `<button class="tsq${m ? " " + m.toLowerCase() : ""}" data-sq="${i}" ${m || !mine || over ? "disabled" : ""} aria-label="Square ${i + 1}${m ? ", " + m : ""}">${m || ""}</button>`).join("")}</div>`;
    /** One look: returns the html to show, or null when the normal screens should be used (the game has not started, or this game is not on the new flow). */
    const look = async () => {
      await load();
      if (!setup || !setup.opts || !setup.opts.stages) return null;
      if (setup.state === "open" || setup.state === "starting" || !setup.startedMs) return null;
      await pollResults();
      const R = E(); if (!R) return null;
      const now = Date.now() + skew, pid = ctx.pid(), pauses = setup.pauses || [];
      let paused = 0; for (const [a, b] of pauses) paused += Math.max(0, Math.min(b == null ? now : b, now) - a);
      const stillPaused = pauses.some(([, b]) => b == null);
      const roster = (setup.roster || []).map((r) => r.pid), fate = {}; for (const p of roster) fate[p] = R.fateOf(setup.seed, p);
      const clock = R.clockAt(setup.startedMs, now, paused);
      const st = R.settleStages({ gameId: EID, startMs: setup.startedMs, nowMs: now, pausedMs: paused, players: roster, fate, results: R.agreed(results) });
      const v = R.viewFor(st, pid, fate), nm = names();
      const strip = stillPaused ? "Paused" : clock.phase === "waiting" ? "Waiting room. The first stage starts in " + mmss(clock.secondsToStart) : clock.phase === "done" ? "The stages are over." : `Stage ${clock.stage} of ${R.STAGES}, slot ${clock.slot} of ${R.SLOTS_PER_STAGE}. ${mmss(clock.secondsLeftInStage)} left in this stage.`;
      let place = "";
      if (v.place > 0) place = st.over ? `You finished ${v.place} of ${v.of}.` : v.isOut ? `You are out. You finished this stage in place ${v.place}.` : v.safe ? `You are ${v.place} of ${v.of}. ${v.placesToLine} place${v.placesToLine === 1 ? "" : "s"} above the cut line.` : `You are ${v.place} of ${v.of}. ${v.placesToLine} place${v.placesToLine === 1 ? "" : "s"} below the cut line.`;
      else if (v.isOut) place = "You are out. You can follow the standing here.";
      // reactions at fitting moments (the scheduler decides what really shows)
      if (v.isOut && !prevOut && prevPlace) ctx.rx("out", true);
      else if (prevPlace && v.place && v.place !== prevPlace && !st.over && clock.phase === "slot") { if (v.safe && v.place < prevPlace && prevPlace - v.place >= 3) ctx.rx("comeback"); else if (!v.safe && v.placesToLine <= 2) ctx.rx("close_call"); }
      prevOut = v.isOut; if (v.place) prevPlace = v.place;
      if (st.over) {
        if (st.winners && st.winners.includes(pid) && prevSlotWon !== "final") { prevSlotWon = "final"; ctx.rx("win", true); }
        const top = (st.winners || []).map((p, i) => `<li><b>${esc(nm[p] || "Player")}</b> <small>${["1st", "2nd", "3rd", "4th", "5th"][i]}</small></li>`).join("");
        const won = st.winners && st.winners.includes(pid) ? `<div class="zcard tchamp" role="status"><h2>You won</h2><p>${esc(["1st", "2nd", "3rd", "4th", "5th"][st.winners.indexOf(pid)])} place.</p></div>` : "";
        return `${won}<div class="zcard" role="status"><h2>Final result</h2><ol class="trank">${top}</ol><p class="zsmall">${esc(place)}</p></div>`;
      }
      let body = "";
      const pair = st.pairsNow.find(([a, b]) => a === pid || b === pid);
      if (clock.phase === "slot" && !v.isOut && pair) {
        const [a, b] = pair, key = R.slotKey(clock.stage, clock.slot, a, b);
        await pollMoves(key);
        const g = R.gameFrom(moves, a, b), opp = a === pid ? b : a, myMark = g.xIs === pid ? "X" : "O";
        if (!g.done && !stillPaused) {
          const dl = R.deadlineOf(g, clock.slotStartMs, pauses, now);
          if (now > dl) post(key, "move", g.entries, "-"); // the clock ran out for whoever was to move: a missed move, the turn goes to the opponent
        }
        if (g.done) { post(key, "result", 0, g.winner); if (prevSlotWon !== key) { prevSlotWon = key; const mine = g.winner === (a === pid ? "a" : "b"); ctx.rx(g.winner === "draw" ? "tie" : mine ? "yay" : "ouch"); } }
        else if (clock.secondsLeftInStage >= 0 && now >= clock.slotEndMs - 500) post(key, "result", 0, "draw"); // still running at the end of its slot: a draw
        const turn = g.done ? (g.winner === "draw" ? "Draw." : g.winner === (a === pid ? "a" : "b") ? "You won this game (2 points)." : "You lost this game.") : g.next === pid ? "Your move." : "Waiting for " + esc(nm[opp] || "the other player") + ".";
        body = `<div class="zcard" role="status"><h2>You play ${esc(myMark)} against ${esc(nm[opp] || "a player")}</h2>${boardHtml(g, g.next === pid && !stillPaused, g.done)}<p class="zsmall" id="tturn" data-key="${esc(key)}" data-seq="${g.entries}">${turn}</p></div>`;
      } else if (clock.phase === "slot" && st.bye === pid) body = `<div class="zcard" role="status"><h2>You sit out this slot</h2><p class="zsmall">You get 1 point. Your next game starts in the next slot.</p></div>`;
      else if (clock.phase === "slot" && !v.isOut) body = `<div class="zcard" role="status"><h2>Waiting for the next game</h2></div>`;
      else if (clock.phase === "waiting") body = `<div class="zcard" role="status"><h2>You are in</h2><p class="zsmall">The first game starts when the waiting room ends.</p></div>`;
      else if (v.isOut) body = `<div class="zcard" role="status"><h2>You are out</h2><p class="zsmall">You can keep this page open to follow the standing and the final result.</p></div>`;
      return `<div class="zcard" role="status"><p><b>${esc(strip)}</b></p><p class="zsmall">${esc(place)}</p></div>${body}`;
    };
    // a tap on a square writes the move (the log never changes an entry that is written)
    document.addEventListener("click", (ev) => {
      const t = ev.target && ev.target.closest ? ev.target.closest("[data-sq]") : null; if (!t || t.disabled) return;
      const info = document.getElementById("tturn"); if (!info) return;
      t.disabled = true; post(info.dataset.key, "move", Number(info.dataset.seq), String(t.dataset.sq));
    });
    return { look };
  };
})();
