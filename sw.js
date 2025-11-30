const CACHE_NAME = 'eliza-pwa-v1';
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/app.js',
  '/cartesia-init.js',
  '/icon-192.png',
  '/manifest.json'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE_URLS))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);

  // Always bypass caching for known external SDK assets (Cartesia CDN)
  if (url.hostname.includes('cartesia.ai') || url.hostname.includes('cdn.cartesia.ai')) {
    event.respondWith(fetch(request));
    return;
  }

  // For navigations and page requests: serve cache-first with network fallback
  if (request.mode === 'navigate' || (request.method === 'GET' && request.headers.get('accept') && request.headers.get('accept').includes('text/html'))) {
    event.respondWith(
      caches.match('/index.html').then(resp => resp || fetch(request).then(networkResp => {
        return networkResp;
      })).catch(() => caches.match('/index.html'))
    );
    return;
  }

  // Same-origin, GET requests: cache-first, then network and update cache
  if (url.origin === location.origin && request.method === 'GET') {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;
        return fetch(request).then(networkResp => {
          // Avoid caching opaque responses (cross-origin) and POSTs
          if (networkResp && networkResp.status === 200) {
            caches.open(CACHE_NAME).then(cache => cache.put(request, networkResp.clone()));
          }
          return networkResp;
        }).catch(() => {
          // fallback for images or other assets: try to return something from cache
          return caches.match('/index.html');
        });
      })
    );
    return;
  }

  // Cross-origin requests (non-Cartesia): network-first, fallback to cache
  event.respondWith(
    fetch(request).then(networkResp => {
      return networkResp;
    }).catch(() => caches.match(request))
  );
});
