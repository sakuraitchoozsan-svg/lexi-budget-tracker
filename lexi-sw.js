// START lexi-sw.js
const CACHE = 'lexi-cache-v1';
const PRECACHE_URLS = [
  '/', '/index.html',
  'https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(PRECACHE_URLS)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  // Navigation requests => network-first then fallback
  if(req.mode === 'navigate'){
    event.respondWith(fetch(req).then(resp => { const copy = resp.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return resp; }).catch(()=> caches.match('/index.html')));
    return;
  }
  // For other assets: cache-first
  event.respondWith(caches.match(req).then(resp => resp || fetch(req).then(r=>{ caches.open(CACHE).then(c=>c.put(req, r.clone())); return r; } ).catch(()=> caches.match('/index.html'))));
});
// END lexi-sw.js
