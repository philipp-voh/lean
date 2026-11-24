// Offline cache. Each release bumps VERSION here and in js/config.js; install checks both match.
const VERSION = '1.1.1';
const CACHE = 'lean-' + VERSION;
const FILES = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'fonts/onest-latin.woff2', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
  'js/app.js', 'js/db.js', 'js/logic.js', 'js/ai.js', 'js/photos.js', 'js/ui.js', 'js/backup.js',
  'js/screens/setup.js', 'js/screens/summary.js', 'js/screens/today.js', 'js/screens/add.js',
  'js/screens/check.js', 'js/screens/progress.js', 'js/screens/settings.js',
  'js/config.js',   // last: a release landing during the install changes the file that is checked
];

// GitHub Pages caches files for 10 minutes: fetch around the HTTP cache and refuse a mix of two releases.
self.addEventListener('install', e => e.waitUntil((async () => {
  const c = await caches.open(CACHE);
  for (const f of FILES) {
    const r = await fetch(new Request(f, { cache: 'reload' }));
    if (!r.ok) throw new Error(f);
    await c.put(f, r);
  }
  if (!(await (await c.match('js/config.js')).text()).includes(`'${VERSION}'`)) throw new Error('mixed');
})()));

self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k.startsWith('lean-') && k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));

// The new version waits until the owner taps Reload on Today.
self.addEventListener('message', e => { if (e.data === 'skip') self.skipWaiting(); });

// Same-origin GET only, cache first, so an offline cold start works. Other pages come from the network,
// and offline any page load gets the start page. Google's API is never cached.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith((async () => {
    // The tests must check the code on disk, not the installed release.
    const client = e.clientId ? await self.clients.get(e.clientId) : null;
    if (client?.url.includes('/tests/')) return fetch(e.request, { cache: 'no-cache' });
    const c = await caches.open(CACHE);
    const hit = await c.match(e.request, { ignoreSearch: true });
    if (hit) return hit;
    if (e.request.mode !== 'navigate') return fetch(e.request);
    return fetch(e.request).catch(async () => (await c.match('./')) ?? Response.error());
  })());
});
