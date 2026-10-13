(function () {
  var T = [["maroon", "#117A77", "Maroon"], ["blue", "#1553B8", "Studio blue"], ["emerald", "#127A6F", "Emerald"]];
  function get() { try { return localStorage.getItem("cb-theme") || "blue"; } catch (e) { return "blue"; } }
  function apply(n) {
    document.documentElement.setAttribute("data-theme", n);
    try { localStorage.setItem("cb-theme", n); } catch (e) {}
    [].forEach.call(document.querySelectorAll(".tdots button"), function (b) { b.setAttribute("aria-pressed", String(b.dataset.t === n)); });
  }
  document.documentElement.setAttribute("data-theme", get());
  function mount() {
    var d = document.createElement("div"); d.className = "tdots"; d.setAttribute("role", "group"); d.setAttribute("aria-label", "Colour theme");
    T.forEach(function (t) {
      var b = document.createElement("button"); b.type = "button"; b.dataset.t = t[0]; b.style.background = t[1]; b.title = t[2]; b.setAttribute("aria-label", t[2] + " theme");
      b.onclick = function () { apply(t[0]); }; d.appendChild(b);
    });
    document.body.appendChild(d); apply(get());
  }
  if (document.body) mount(); else document.addEventListener("DOMContentLoaded", mount);
})();
