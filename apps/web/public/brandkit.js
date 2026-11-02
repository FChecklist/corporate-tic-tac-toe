/* Corporate Games brand kit. Load with defer. Does three small jobs, with no outside request and no inline code:
   1. the phone menu button (#ck-menu opens and closes #ck-nav),
   2. the three theme dots in the header (blue, maroon, emerald),
   3. the Dark / Light button (any button with data-ck-mode). */
(function () {
  var d = document.documentElement;
  function store(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* blocked */ } }

  var menu = document.getElementById("ck-menu"), nav = document.getElementById("ck-nav");
  if (menu && nav) {
    var setOpen = function (o) { nav.classList.toggle("open", o); menu.setAttribute("aria-expanded", String(o)); menu.textContent = o ? "Close" : "Menu"; };
    menu.addEventListener("click", function () { setOpen(!nav.classList.contains("open")); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && nav.classList.contains("open")) { setOpen(false); menu.focus(); } });
  }

  var dots = [].slice.call(document.querySelectorAll(".ck-dots button"));
  function paintDots() { var t = d.getAttribute("data-theme") || "blue"; dots.forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-t") === t)); }); }
  dots.forEach(function (b) { b.addEventListener("click", function () { var t = b.getAttribute("data-t"); d.setAttribute("data-theme", t); store("ct-theme", t); paintDots(); }); });
  paintDots();

  var modeBtns = [].slice.call(document.querySelectorAll("[data-ck-mode]"));
  function isDark() { var m = d.getAttribute("data-mode") || (d.getAttribute("data-theme") === "dark" ? "dark" : d.getAttribute("data-theme") === "light" ? "light" : ""); return m ? m === "dark" : !!(window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches); }
  function paintMode() { modeBtns.forEach(function (b) { b.textContent = isDark() ? "Light" : "Dark"; b.setAttribute("aria-pressed", String(isDark())); }); }
  modeBtns.forEach(function (b) { b.addEventListener("click", function () { var next = isDark() ? "light" : "dark"; d.setAttribute("data-mode", next); if (d.getAttribute("data-theme") === "dark" || d.getAttribute("data-theme") === "light") d.setAttribute("data-theme", "blue"); store("cg-theme", next); paintMode(); }); });
  paintMode();
})();
