const C = 'nix-app-v10';
// Never cached: live price services (calculator) and the Apps Script web app (its address carries the access code).
const LIVE = /(^|\.)(gold-api\.com|frankfurter\.dev|frankfurter\.app|jsdelivr\.net|pages\.dev|script\.google\.com|script\.googleusercontent\.com)$/;
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'calc.js', 'inventory.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'logo.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(C).then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {})))));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== C).map(x => caches.delete(x)))));
  self.clients.claim();
});
// Network first, so updates show up straight away; the cached copy is only the offline fallback
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (LIVE.test(new URL(e.request.url).hostname)) return;
  e.respondWith(
    fetch(e.request).then(r => { const cp = r.clone(); caches.open(C).then(c => c.put(e.request, cp)); return r; })
      .catch(() => caches.match(e.request))
  );
});
