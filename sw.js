/* ═══════════════════════════════════════════
   HandScript Pro — Service Worker
   Caches app shell + CDN assets for offline use
═══════════════════════════════════════════ */

const CACHE     = 'handscript-v1';
const FONT_CACHE= 'handscript-fonts-v1';

// App shell — always cache these
const SHELL = [
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

// CDN assets — cache on first fetch, serve offline after
const CDN_HOSTS = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdnjs.cloudflare.com',
  'cdn.jsdelivr.net',
  'tessdata.projectnaptha.com',
];

/* ── INSTALL: pre-cache the app shell ── */
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

/* ── ACTIVATE: clean up old caches ── */
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE && k !== FONT_CACHE)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

/* ── FETCH: smart caching strategy ── */
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Never intercept API calls to Anthropic — let them fail naturally when offline
  if (url.hostname === 'api.anthropic.com') return;

  // Fonts: cache-first (they never change)
  if (url.hostname === 'fonts.gstatic.com' || url.hostname === 'fonts.googleapis.com') {
    e.respondWith(cacheFirst(e.request, FONT_CACHE));
    return;
  }

  // CDN libraries: stale-while-revalidate (serve cached, update in background)
  if (CDN_HOSTS.some(h => url.hostname.includes(h))) {
    e.respondWith(staleWhileRevalidate(e.request, CACHE));
    return;
  }

  // App files: cache-first
  if (url.origin === self.location.origin) {
    e.respondWith(cacheFirst(e.request, CACHE));
    return;
  }

  // Everything else: network with cache fallback
  e.respondWith(networkWithCacheFallback(e.request));
});

/* ── STRATEGIES ── */
async function cacheFirst(req, cacheName) {
  const cached = await caches.match(req);
  if (cached) return cached;
  try {
    const fresh = await fetch(req);
    if (fresh.ok) {
      const c = await caches.open(cacheName);
      c.put(req, fresh.clone());
    }
    return fresh;
  } catch {
    return new Response('Offline — resource not cached', { status: 503 });
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const c     = await caches.open(cacheName);
  const cached= await c.match(req);
  const fetchPromise = fetch(req).then(res => {
    if (res.ok) c.put(req, res.clone());
    return res;
  }).catch(() => null);
  return cached || await fetchPromise || new Response('Offline', { status: 503 });
}

async function networkWithCacheFallback(req) {
  try {
    const res = await fetch(req);
    if (res.ok) {
      const c = await caches.open(CACHE);
      c.put(req, res.clone());
    }
    return res;
  } catch {
    const cached = await caches.match(req);
    return cached || new Response('Offline', { status: 503 });
  }
}

/* ── MESSAGE: force update ── */
self.addEventListener('message', e => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});
