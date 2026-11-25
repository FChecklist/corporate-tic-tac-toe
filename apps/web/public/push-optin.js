/*! corporate-push client 0.2.0 | one file, same on every site | no libraries
 *
 * Put this on a page:
 *   <link rel="stylesheet" href="/push-optin.css">
 *   <div data-push-optin
 *        data-push-api="https://REPLACE-WITH-PUSH-SERVICE-ADDRESS"
 *        data-push-site="game"            <!-- home | console | game -->
 *        data-push-game-id="abc123"       <!-- game links only -->
 *        data-push-expires-at="1764000000000"  <!-- optional, game links: an EARLIER end than 24 hours (epoch ms). Never later: the service keeps game rows 24 hours at most -->
 *        data-push-sw="/sw.js"            <!-- optional: only used if the site has no service worker yet -->
 *        data-push-privacy="/privacy"     <!-- REQUIRED: link to the site's privacy page. Without it nothing is shown -->
 *        data-push-ended="false"></div>   <!-- "true" after the game: offers "Keep notifying me about new games" -->
 *   <script src="/push-optin.js" defer></script>
 *
 * Rules this file keeps:
 *   - The browser permission prompt is opened ONLY by a tap on the button. Never on page load.
 *   - We save only the browser's push address and keys, plus the site and game id.
 *   - "Stop notifications" is ALWAYS shown next to the button, with no condition. It also clears anything saved
 *     in this browser, and retries the server delete on the next page load if the server could not be reached.
 */
(function () {
  'use strict';

  var VERSION = '0.2.0';

  // Exact wording decided by the owner and BOSS (SPEC.md). Do not change without a new decision.
  var TEXT = {
    game: 'Yes, notify me when this game begins',
    console: 'Yes, notify me when my game begins',
    home: 'Yes, notify me about new games and offers',
    stop: 'Stop notifications',
    keep: 'Keep notifying me about new games',
    iphone: 'On iPhone and iPad: Add to Home Screen first, then open this site from your Home Screen and tap the button.',
    iphoneOld: 'Notifications on iPhone and iPad need iOS 16.4 or newer.',
    privacy: 'We save only a browser address, not your name, e-mail or phone.',
    carriers: 'Google, Apple, Mozilla or Microsoft carry the message to your browser. Game alerts are deleted with the game, within 24 hours. You can stop any time.',
    privacyLink: 'Privacy',
    on: 'Notifications are on. We will tell you when it starts.',
    onHome: 'Notifications are on. We will tell you about new games and offers.',
    off: 'Notifications are off.',
    offNoServer: 'Notifications are off in this browser. We could not reach our server just now, so we will try again the next time you open this site.',
    blocked: 'Notifications are blocked in your browser settings. Allow them there, then tap the button again.',
    dismissed: 'No problem. You can tap the button whenever you like.',
    failed: 'Sorry, that did not work. Please try again later.',
    notReady: 'This site is not ready for notifications yet.',
    kept: 'Done. We will tell you about new games and offers.',
  };

  var FLAG_PREFIX = 'corporatePush.v1.';
  var PENDING_KEY = 'corporatePush.v1pending'; // push addresses whose server delete failed: retried on the next page load
  var REQUEST_TIMEOUT_MS = 10000;

  function supports() {
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  }

  function isIOS() {
    var ua = navigator.userAgent || '';
    return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  function isStandalone() {
    return navigator.standalone === true || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  }

  // The only thing kept in this browser is a yes/no flag per scope, so the page can show the right button.
  function flagGet(scope) {
    try {
      return window.localStorage.getItem(FLAG_PREFIX + scope) === '1';
    } catch (e) {
      return false;
    }
  }
  function flagSet(scope, on) {
    try {
      if (on) window.localStorage.setItem(FLAG_PREFIX + scope, '1');
      else window.localStorage.removeItem(FLAG_PREFIX + scope);
    } catch (e) {}
  }
  function pendingGet() {
    try {
      var v = JSON.parse(window.localStorage.getItem(PENDING_KEY) || '[]');
      return Array.isArray(v) ? v.filter(function (x) { return typeof x === 'string'; }).slice(0, 5) : [];
    } catch (e) {
      return [];
    }
  }
  function pendingSet(list) {
    try {
      if (list.length) window.localStorage.setItem(PENDING_KEY, JSON.stringify(list.slice(0, 5)));
      else window.localStorage.removeItem(PENDING_KEY);
    } catch (e) {}
  }
  function flagsClear() {
    try {
      var keys = [];
      for (var i = 0; i < window.localStorage.length; i++) {
        var k = window.localStorage.key(i);
        if (k && k.indexOf(FLAG_PREFIX) === 0) keys.push(k);
      }
      keys.forEach(function (k) {
        window.localStorage.removeItem(k);
      });
    } catch (e) {}
  }

  function urlBase64ToBytes(b64u) {
    var pad = '='.repeat((4 - (b64u.length % 4)) % 4);
    var raw = atob((b64u + pad).replace(/-/g, '+').replace(/_/g, '/'));
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  function sameKey(buffer, bytes) {
    if (!buffer) return false;
    var a = new Uint8Array(buffer);
    if (a.length !== bytes.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i] !== bytes[i]) return false;
    return true;
  }

  function api(base, path, options) {
    var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, REQUEST_TIMEOUT_MS) : null;
    var init = {
      method: options && options.body ? 'POST' : 'GET',
      credentials: 'omit', // no cookies, ever
      referrerPolicy: 'no-referrer',
      headers: options && options.body ? { 'Content-Type': 'application/json' } : {},
      body: options && options.body ? JSON.stringify(options.body) : undefined,
      signal: ctrl ? ctrl.signal : undefined,
    };
    return fetch(base + path, init)
      .then(function (res) {
        if (!res.ok) throw new Error('http');
        return res.json();
      })
      .then(
        function (v) { if (timer) clearTimeout(timer); return v; },
        function (e) { if (timer) clearTimeout(timer); throw e; }
      );
  }

  function withTimeout(promise, ms) {
    return Promise.race([
      promise,
      new Promise(function (_, reject) { setTimeout(function () { reject(new Error('timeout')); }, ms); }),
    ]);
  }

  // Use the site's own service worker. Register one only if the page says where it is and none exists.
  function getRegistration(swUrl, allowRegister) {
    return navigator.serviceWorker.getRegistration().then(function (reg) {
      if (reg) return withTimeout(navigator.serviceWorker.ready, 10000);
      if (allowRegister && swUrl) {
        return navigator.serviceWorker.register(swUrl).then(function () {
          return withTimeout(navigator.serviceWorker.ready, 10000);
        });
      }
      throw new Error('no-service-worker');
    });
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text; // text only, never HTML
    return node;
  }

  function mount(root, options) {
    if (!root || root.__corporatePush) return root && root.__corporatePush;
    options = options || {};
    var d = root.dataset || {};
    var cfg = {
      api: String(options.api || d.pushApi || '').replace(/\/+$/, ''),
      site: options.site || d.pushSite || 'home',
      gameId: options.gameId || d.pushGameId || '',
      expiresAt: Number(options.expiresAt || d.pushExpiresAt || 0) || 0,
      sw: options.sw || d.pushSw || '',
      privacy: options.privacy || d.pushPrivacy || '',
      ended: options.ended === true || d.pushEnded === 'true',
    };
    if (!/^https:\/\//.test(cfg.api) && !/^http:\/\/localhost[:/]/.test(cfg.api + '/')) return null;
    if (cfg.site !== 'home' && cfg.site !== 'console' && cfg.site !== 'game') return null;
    if (cfg.site === 'game' && !/^[A-Za-z0-9_-]{1,128}$/.test(cfg.gameId)) return null;
    // The privacy link is required: a button that collects a browser address must always sit next to the explanation.
    if (!/^(\/(?!\/)|https:\/\/)/.test(cfg.privacy)) return null;

    var scope = cfg.site === 'game' ? 'game:' + cfg.gameId : cfg.site;
    var label = TEXT[cfg.site];

    // ----- build the small block -----
    var box = el('div', 'cp-optin');
    var enable = el('button', 'cp-optin__btn', label);
    enable.type = 'button';
    var stop = el('button', 'cp-optin__stop', TEXT.stop);
    stop.type = 'button';
    stop.hidden = false; // never hidden (M4)
    var keep = el('button', 'cp-optin__btn cp-optin__keep', TEXT.keep);
    keep.type = 'button';
    keep.hidden = true;
    var note = el('p', 'cp-optin__note');
    note.hidden = true;
    var status = el('p', 'cp-optin__status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    var privacy = el('p', 'cp-optin__privacy', TEXT.privacy + ' ' + TEXT.carriers + ' ');
    var link = el('a', '', TEXT.privacyLink);
    link.setAttribute('href', cfg.privacy);
    link.setAttribute('rel', 'noopener');
    privacy.appendChild(link);
    box.appendChild(enable);
    box.appendChild(keep);
    box.appendChild(stop);
    box.appendChild(note);
    box.appendChild(status);
    box.appendChild(privacy);
    root.appendChild(box);

    function say(text) { status.textContent = text || ''; }
    function show(state) {
      box.setAttribute('data-state', state);
      enable.hidden = state === 'on' || state === 'kept';
      enable.disabled = state === 'busy' || state === 'ios-install';
      enable.setAttribute('aria-disabled', enable.disabled ? 'true' : 'false');
      stop.hidden = false; // M4: always available, in every state, no condition
      keep.hidden = !(state === 'on' && cfg.ended && cfg.site === 'game');
    }

    var ctl = {
      version: VERSION,
      setGameEnded: function () {
        cfg.ended = true;
        show(box.getAttribute('data-state'));
      },
    };
    root.__corporatePush = ctl;
    root.addEventListener('corporatepush:game-ended', ctl.setGameEnded);

    // ----- iPhone and iPad: web push only works from the Home Screen -----
    if (isIOS() && !isStandalone()) {
      note.textContent = TEXT.iphone;
      note.hidden = false;
      show('ios-install');
      return ctl;
    }
    if (!supports()) {
      if (isIOS()) {
        note.textContent = TEXT.iphoneOld;
        note.hidden = false;
        show('ios-install');
      } else {
        root.hidden = true; // quietly show nothing in browsers that cannot do it
      }
      return ctl;
    }

    // ----- already on? (only if the browser still holds a subscription) -----
    // Stop is shown in every state. "On" needs this scope's flag AND a live browser subscription. After
    // "Keep notifying me" the game flag is cleared on purpose, so an ended game page also looks at the home flag.
    show('idle');
    retryPending();
    if (Notification.permission === 'granted' && (flagGet(scope) || (cfg.site === 'game' && flagGet('home')))) {
      getRegistration(cfg.sw, false)
        .then(function (reg) { return reg.pushManager.getSubscription(); })
        .then(function (sub) {
          if (sub && flagGet(scope)) {
            show('on');
            say(cfg.site === 'home' ? TEXT.onHome : TEXT.on);
          } else if (sub && cfg.site === 'game' && cfg.ended && flagGet('home')) {
            show('kept');
            say(TEXT.kept);
          } else if (!sub) {
            flagSet(scope, false);
          }
        })
        .catch(function () {});
    }

    // A "Stop" whose server call failed is tried again here, silently, on the next page load.
    function retryPending() {
      pendingGet().forEach(function (endpoint) {
        api(cfg.api, '/unsubscribe', { body: { endpoint: endpoint } }).then(function () {
          pendingSet(pendingGet().filter(function (e) { return e !== endpoint; }));
        }, function () {});
      });
    }

    // ----- the tap that turns it on -----
    // The permission request is the FIRST thing that happens in the tap: browsers only allow the
    // prompt as a direct answer to a tap, and it must never be opened any other way.
    enable.addEventListener('click', function () {
      var asked = Notification.requestPermission();
      show('busy');
      say('');
      Promise.resolve(asked).then(function (permission) {
        if (permission === 'denied') { show('idle'); say(TEXT.blocked); return; }
        if (permission !== 'granted') { show('idle'); say(TEXT.dismissed); return; }
        return subscribeNow();
      }).catch(function () {
        show('idle');
        say(TEXT.failed);
      });
    });

    function subscribeNow() {
      var created = false;
      var theSub = null;
      return Promise.all([getRegistration(cfg.sw, true), api(cfg.api, '/vapid-public')])
        .then(function (r) {
          var reg = r[0];
          var keyBytes = urlBase64ToBytes(r[1].key);
          return reg.pushManager.getSubscription().then(function (existing) {
            if (existing && !sameKey(existing.options && existing.options.applicationServerKey, keyBytes)) {
              return existing.unsubscribe().then(function () { return null; });
            }
            return existing;
          }).then(function (sub) {
            if (sub) return sub;
            created = true;
            return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes });
          });
        })
        .then(function (sub) {
          theSub = sub;
          return postSubscribe(sub, scope);
        })
        .then(function () {
          flagSet(scope, true);
          show('on');
          say(cfg.site === 'home' ? TEXT.onHome : TEXT.on);
        })
        .catch(function (err) {
          // Roll back, so the browser and our server never disagree about what is saved.
          var undo = created && theSub ? theSub.unsubscribe().catch(function () {}) : Promise.resolve();
          return undo.then(function () {
            show('idle');
            say(err && err.message === 'no-service-worker' ? TEXT.notReady : TEXT.failed);
          });
        });
    }

    function postSubscribe(sub, forScope) {
      var j = sub.toJSON();
      var body = {
        subscription: { endpoint: j.endpoint, keys: { p256dh: j.keys.p256dh, auth: j.keys.auth } },
        scope: forScope,
      };
      if (forScope.indexOf('game:') === 0 && cfg.expiresAt) body.expires_at = cfg.expiresAt;
      return api(cfg.api, '/subscribe', { body: body });
    }

    // ----- Stop notifications: always available, no condition -----
    // Deletes our copy (every scope of this browser address), then removes the browser's own subscription,
    // then clears what this page remembers. With no subscription there is nothing to tell the server, and it still works.
    // If the server cannot be reached the address is remembered here and the delete is retried on the next page load.
    stop.addEventListener('click', function () {
      stop.disabled = true;
      say('');
      var serverFailed = false;
      var registrationStep = navigator.serviceWorker ? getRegistration(cfg.sw, false) : Promise.reject(new Error('none'));
      registrationStep
        .then(function (reg) { return reg.pushManager.getSubscription(); })
        .then(function (sub) {
          if (!sub) return null;
          return api(cfg.api, '/unsubscribe', { body: { endpoint: sub.endpoint } })
            .then(function () {}, function () {
              serverFailed = true;
              pendingSet(pendingGet().concat([sub.endpoint]));
            })
            .then(function () { return sub.unsubscribe().catch(function () {}); });
        })
        .catch(function () {})
        .then(function () {
          flagsClear();
          stop.disabled = false;
          show('idle');
          say(serverFailed ? TEXT.offNoServer : TEXT.off);
        });
    });

    // ----- after the game: one more tap moves it to "new games" and keeps it -----
    keep.addEventListener('click', function () {
      keep.disabled = true;
      getRegistration(cfg.sw, false)
        .then(function (reg) { return reg.pushManager.getSubscription(); })
        .then(function (sub) {
          if (!sub) throw new Error('none');
          return postSubscribe(sub, 'home').then(function () {
            return api(cfg.api, '/unsubscribe', { body: { endpoint: sub.endpoint, scope: scope } }).catch(function () {});
          });
        })
        .then(function () {
          flagSet('home', true);
          flagSet(scope, false);
          cfg.ended = false;
          cfg.site = 'home';
          scope = 'home';
          keep.disabled = false;
          show('kept');
          say(TEXT.kept);
        })
        .catch(function () {
          keep.disabled = false;
          say(TEXT.failed);
        });
    });

    return ctl;
  }

  function mountAll() {
    var nodes = document.querySelectorAll('[data-push-optin]');
    for (var i = 0; i < nodes.length; i++) mount(nodes[i]);
  }

  window.CorporatePush = { version: VERSION, mount: mount, text: TEXT };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountAll);
  else mountAll();
})();
