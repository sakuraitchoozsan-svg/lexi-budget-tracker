// lexi-sw.js - Auto-updating Service Worker for Lexi's Budget Tracker
// Place at repo root: /lexi-sw.js

const CACHE_VERSION = 'v2-2025-08-19';
const CACHE_NAME = `lexi-cache-${CACHE_VERSION}`;
const PRECACHE = [
  '/', '/index.html',
  // CDN assets used in index.html - service worker will cache them on install
  'https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js'
];

// Install -> precache
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

// Activate -> cleanup old caches, claim clients
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
    .then(() => self.clients.claim())
  );
});

// Listen to messages (allow clients to trigger skipWaiting if desired)
self.addEventListener('message', event => {
  if(!event.data) return;
  if(event.data === 'skipWaiting') self.skipWaiting();
});

// Fetch strategy:
// - HTML navigation: network-first, fallback to cached index.html
// - Other assets: cache-first with background update
self.addEventListener('fetch', event => {
  const req = event.request;
  if(req.method !== 'GET') return;

  const accept = req.headers.get('Accept') || '';

  if(accept.includes('text/html')){
    event.respondWith(
      fetch(req).then(networkResp => {
        caches.open(CACHE_NAME).then(cache => { try { cache.put(req, networkResp.clone()); } catch(e){} });
        return networkResp;
      }).catch(() => caches.match('/index.html').then(r => r || Promise.reject('no-cache')))
    );
    return;
  }

  // For others: try cache first
  event.respondWith(
    caches.match(req).then(cached => {
      if(cached) {
        // update in background
        fetch(req).then(networkResp => {
          if(networkResp && networkResp.status === 200){
            caches.open(CACHE_NAME).then(cache => { try { cache.put(req, networkResp.clone()); } catch(e){} });
          }
        }).catch(()=>{});
        return cached;
      }
      return fetch(req).then(networkResp => {
        if(networkResp && networkResp.status === 200){
          caches.open(CACHE_NAME).then(cache => { try { cache.put(req, networkResp.clone()); } catch(e){} });
        }
        return networkResp;
      }).catch(() => caches.match('/index.html'));
    })
  );
});

// When a new SW becomes active, let clients know so they can refresh immediately (we also call skipWaiting in install)
self.addEventListener('controllerchange', () => {
  // Not all clients will be reachable here; we notify via postMessage when new SW activates
  self.clients.matchAll().then(clients => {
    clients.forEach(c => {
      try { c.postMessage('reload'); } catch(e){}
    });
  });
});

