const C = 'nix-app-v1';
// Live price services used by the calculator are never cached, so prices are always fresh.
const LIVE = /(^|\.)(gold-api\.com|frankfurter\.dev|frankfurter\.app|jsdelivr\.net|pages\.dev)$/;
self.addEventListener('install', e => {
  e.waitUntil(caches.open(C).then(c => c.addAll(['./', 'index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'calc/', 'calc/index.html', 'calc/logo.png'])));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== C).map(x => caches.delete(x)))));
  self.clients.claim();
});
// Network first, so edits show up; cached copy is the offline fallback (same behaviour as the old launcher)
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (LIVE.test(new URL(e.request.url).hostname)) return;
  e.respondWith(
    fetch(e.request).then(r => { const cp = r.clone(); caches.open(C).then(c => c.put(e.request, cp)); return r; })
      .catch(() => caches.match(e.request))
  );
});
