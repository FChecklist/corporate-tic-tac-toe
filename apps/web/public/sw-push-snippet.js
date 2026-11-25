/* corporate-push: the two handlers a site's service worker needs.
 *
 * HOW TO USE (pick one):
 *   A) Paste everything below into the site's existing service worker file, at the top level.
 *   B) Save this file next to the service worker and add this line at the TOP of it:
 *        importScripts('/sw-push-snippet.js');
 *
 * It does not touch caching or any other fetch handling. A site can keep its own 'install',
 * 'activate' and 'fetch' code exactly as it is.
 *
 * What a message looks like (sent by the service, encrypted, JSON):
 *   { "title": "Your game is starting", "body": "Tap to join now.", "url": "https://...", "tag": "game:abc" }
 */

// Links in a notification may open on this site, or on these exact company hosts (the same list the service
// accepts). Anything else opens '/'. Add a host here only when it is also in ALLOWED_ORIGINS_EXTRA on the service.
var CP_ALLOWED_HOSTS = ['home', 'console', 'housie', 'luck', 'bingo', 'tictactoe'].map(function (s) { return s + '.corporatetambola.com'; });

self.addEventListener('push', function (event) {
  var data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = {};
  }
  // A browser requires every push to show a notification, so there is always a safe fallback text.
  var title = typeof data.title === 'string' && data.title ? data.title.slice(0, 80) : 'Corporate Tambola';
  var body = typeof data.body === 'string' ? data.body.slice(0, 200) : 'Open the app to see what is new.';
  var options = {
    body: body,
    tag: typeof data.tag === 'string' ? data.tag.slice(0, 100) : undefined,
    data: { url: typeof data.url === 'string' ? data.url : '/' },
    // Optional: icon: '/icons/icon-192.png', badge: '/icons/badge-72.png',
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var target = self.location.origin + '/';
  try {
    var u = new URL(event.notification.data && event.notification.data.url, self.location.origin);
    var sameSite = u.origin === self.location.origin;
    var company = u.protocol === 'https:' && u.port === '' && CP_ALLOWED_HOSTS.indexOf(u.hostname) !== -1;
    if (sameSite || company) target = u.href;
  } catch (e) {}
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        if (list[i].url === target && 'focus' in list[i]) return list[i].focus();
      }
      return self.clients.openWindow(target);
    })
  );
});
