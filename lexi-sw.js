// lexi-sw.js - Auto-updating Service Worker for Lexi's Budget Tracker
// Place at repo root: /lexi-sw.js

const CACHE_VERSION = 'v3-2025-08-19';
const CACHE_NAME = `lexi-cache-${CACHE_VERSION}`;
const PRECACHE = [
  '/', '/index.html',
  // CDN assets used in index.html - cached on install
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
  if(event.data === 'skipWaiting'){ self.skipWaiting(); }
});

// Network-first for HTML; cache-first for static
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  if(req.method !== 'GET') return; // only cache GET

  // HTML pages: network-first with fallback to cache
  if(req.headers.get('accept')?.includes('text/html')){
    event.respondWith(
      fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then(c=>c.put(req, copy)).catch(()=>{});
        return res;
      }).catch(()=> caches.match(req))
    );
    return;
  }

  // others: cache-first
  event.respondWith(
    caches.match(req).then(cached => {
      if(cached) return cached;
      return fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then(c=>c.put(req, copy)).catch(()=>{});
        return res;
      });
    })
  );
});
