// The offline page: "Try again" reloads; the page also reloads by itself the moment the phone is back online.
(function () {
  var b = document.getElementById("again");
  if (b) b.addEventListener("click", function () { location.reload(); });
  window.addEventListener("online", function () { location.reload(); });
})();
