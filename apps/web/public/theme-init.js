/* Corporate Games brand kit. Load in <head> WITHOUT defer so it runs before the page is drawn:
   marks the page as script-capable (class "js") and applies the saved colour theme and light/dark choice. The choice lives on this device only. */
(function () {
  var d = document.documentElement;
  d.classList.add("js");
  try {
    var c = localStorage.getItem("ct-theme");
    if (c === "blue" || c === "maroon" || c === "emerald" || c === "indigo") d.setAttribute("data-theme", c);
    var m = localStorage.getItem("cg-theme");
    if (m === "dark" || m === "light") d.setAttribute("data-mode", m);
  } catch (e) { /* storage blocked: follow the page default and the device */ }
})();
