/* lexi-sw.js - simple, robust service worker for Lexi
   - precaches app shell + kitten chime
   - cache-first for shell, stale-while-revalidate for APIs
   - skipWaiting & clients.claim for immediate activation
   - communicates via postMessage with clients (play-chime, background-sync)
*/

const CACHE_VERSION = 'v1';
const APP_CACHE = `lexi-shell-${CACHE_VERSION}`;
const RUNTIME_CACHE = `lexi-runtime-${CACHE_VERSION}`;

const PRECACHE = [
  '/',
  '/index.html',
  '/lexi-sw.js',
  '/assets/kitten-chime.mp3'
];

async function broadcast(msg){
  const clientsList = await self.clients.matchAll({ includeUncontrolled: true });
  for(const c of clientsList) c.postMessage(msg);
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    self.skipWaiting();
    const cache = await caches.open(APP_CACHE);
    try{ await cache.addAll(PRECACHE); } catch(e){ console.warn('Failed to precache some assets', e); }
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    await self.clients.claim();
    const keys = await caches.keys();
    await Promise.all(keys.map(k => { if (![APP_CACHE, RUNTIME_CACHE].includes(k)) return caches.delete(k); }));
    broadcast({ type:'sw-ready', version: CACHE_VERSION });
  })());
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);

  // Serve precached shell
  if (PRECACHE.includes(url.pathname) || PRECACHE.includes(event.request.url)) {
    event.respondWith(caches.open(APP_CACHE).then(async cache => {
      const cached = await cache.match(event.request);
      return cached || fetch(event.request).then(resp => { if(resp && resp.ok) cache.put(event.request, resp.clone()); return resp; }).catch(()=>cached || new Response('Offline', {status:503}));
    }));
    return;
  }

  // Runtime caching for external APIs (open-meteo, nager.date) or cross-origin
  const isApi = url.hostname.includes('open-meteo.com') || url.hostname.includes('date.nager.at') || url.origin !== self.origin;
  if (isApi) {
    event.respondWith(caches.open(RUNTIME_CACHE).then(async cache => {
      const cached = await cache.match(event.request);
      const network = fetch(event.request).then(resp => { if(resp && resp.ok) cache.put(event.request, resp.clone()); return resp; }).catch(()=>null);
      return cached || (await network) || new Response(null, { status:504 });
    }));
    return;
  }

  // Default: network-first, fallback to cache
  event.respondWith((async () => {
    try{
      const net = await fetch(event.request);
      return net;
    } catch(e){
      const c = await caches.match(event.request);
      if (c) return c;
      if (event.request.mode === 'navigate') return new Response('<h1>Offline</h1><p>Lexi is offline</p>', { headers: { 'Content-Type':'text/html' }});
      return new Response(null, { status:504 });
    }
  })());
});

self.addEventListener('message', event => {
  const data = event.data;
  if(!data) return;
  if(data.type === 'skip-waiting') self.skipWaiting();
  if(data.type === 'play-chime') broadcast({ type:'play-chime' });
  if(data.type === 'clear-cache') (async ()=> { const keys = await caches.keys(); await Promise.all(keys.map(k=>caches.delete(k))); broadcast({ type:'cache-cleared' }); })();
});

self.addEventListener('sync', event => {
  event.waitUntil((async () => { await broadcast({ type:'background-sync', tag: event.tag }); })());
});

self.addEventListener('push', event => {
  let title = 'Lexi 🐾'; let body = 'You have a notification';
  try{ if(event.data){ const d = event.data.json(); title = d.title || title; body = d.body || body; } }catch(e){ if(event.data) body = event.data.text(); }
  event.waitUntil(self.registration.showNotification(title, { body, icon:'/icons/icon-192.png', badge:'/icons/badge-72.png' }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async ()=> {
    const all = await clients.matchAll({ includeUncontrolled: true });
    if(all.length) { all[0].focus(); all[0].postMessage({ type:'notification-click', data: event.notification.data }); }
    else clients.openWindow('/');
  })());
});
