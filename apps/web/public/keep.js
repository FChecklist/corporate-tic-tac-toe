/* Corporate Tambola: staying signed in. Signing in proves the e-mail once; after that this phone or laptop stays signed in (no timeout) until the person taps "Sign out".
   Only the keys named below are kept on the device (they are listed in the storage notice); everything else stays per-visit. If the browser blocks long-term storage,
   the visit-only store is used, and the person simply signs in again with their e-mail. */
(function () {
  if (window.CTK) return;
  var KEEP = { "cbz-org": 1, "cbz-alt": 1, "cbz-email": 1 };
  function lget(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function sget(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
  window.CTK = {
    get: function (k) {
      if (!KEEP[k]) return sget(k);
      var v = lget(k); if (v !== null && v !== "") return v;
      var s = sget(k); if (s !== null && s !== "") { try { localStorage.setItem(k, s); } catch (e) {} return s; } // a visit-only value from before: keep it from now on
      return v !== null ? v : s;
    },
    set: function (k, v) { if (KEEP[k]) { try { localStorage.setItem(k, v); } catch (e) {} } try { sessionStorage.setItem(k, v); } catch (e) {} },
    remove: function (k) { try { localStorage.removeItem(k); } catch (e) {} try { sessionStorage.removeItem(k); } catch (e) {} },
    signOut: function () { ["cbz-org", "cbz-alt"].forEach(function (k) { window.CTK.remove(k); }); try { localStorage.removeItem("tb_org_token"); } catch (e) {} }
  };
})();
