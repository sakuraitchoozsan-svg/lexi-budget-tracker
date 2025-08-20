/* lexi-sw.js - Service Worker for Lexi's Budget Tracker
   - Precache app shell + kitten chime
   - Cache-first for shell, stale-while-revalidate for runtime/API
   - skipWaiting / clients.claim
   - messages to clients: play-chime, background-sync, sw-update
*/

const CACHE_VERSION = 'v1';
const APP_SHELL_CACHE = `lexi-shell-${CACHE_VERSION}`;
const RUNTIME_CACHE = `lexi-runtime-${CACHE_VERSION}`;

const PRECACHE_URLS = [
  '/', '/index.html',
  '/lexi-sw.js',
  '/assets/kitten-chime.mp3',
  // Add other assets you want precached (icons, CSS)
];

async function broadcastToClients(msg){
  const list = await self.clients.matchAll({ includeUncontrolled: true });
  for(const c of list) c.postMessage(msg);
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    self.skipWaiting();
    const cache = await caches.open(APP_SHELL_CACHE);
    try { await cache.addAll(PRECACHE_URLS); } catch(e){ console.warn('lexi-sw: precache failed', e); }
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    await self.clients.claim();
    const keys = await caches.keys();
    await Promise.all(keys.map(k => { if (![APP_SHELL_CACHE, RUNTIME_CACHE].includes(k)) return caches.delete(k); return Promise.resolve(); }));
    broadcastToClients({ type:'sw-ready', version: CACHE_VERSION });
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Serve precached shell (cache-first)
  if (PRECACHE_URLS.includes(url.pathname) || PRECACHE_URLS.includes(req.url)) {
    event.respondWith(caches.open(APP_SHELL_CACHE).then(async cache => {
      const cached = await cache.match(req);
      if (cached) return cached;
      try {
        const net = await fetch(req);
        if (net && net.ok) cache.put(req, net.clone());
        return net;
      } catch (err) {
        return cached || new Response('Offline', { status: 503, statusText: 'Offline' });
      }
    }));
    return;
  }

  // Runtime: API calls (open-meteo / date.nager.at) stale-while-revalidate
  const isApiCall = url.hostname.includes('open-meteo.com') || url.hostname.includes('date.nager.at') || url.pathname.startsWith('/api/') || url.pathname.endsWith('.json');

  if (isApiCall || url.origin !== self.origin) {
    event.respondWith(caches.open(RUNTIME_CACHE).then(async cache => {
      const cached = await cache.match(req);
      const networkFetch = fetch(req).then(res => { if(res && res.ok) cache.put(req, res.clone()); return res; }).catch(()=>null);
      return cached ? cached : (await networkFetch) || new Response(null, { status:504 });
    }));
    return;
  }

  // Default: network first, fallback to cache
  event.respondWith((async () => {
    try {
      const networkResponse = await fetch(req);
      if (req.mode === 'navigate' && networkResponse && networkResponse.ok) {
        const c = await caches.open(APP_SHELL_CACHE);
        c.put(req, networkResponse.clone());
      }
      return networkResponse;
    } catch (err) {
      const cached = await caches.match(req);
      if (cached) return cached;
      if (req.mode === 'navigate') {
        return new Response(`<!doctype html><html><head><meta charset="utf-8"><title>Offline</title></head><body><h1>Offline</h1><p>Lexi is offline.</p></body></html>`, { headers: { 'Content-Type': 'text/html' }});
      }
      return new Response(null, { status:504, statusText:'Offline' });
    }
  })());
});

self.addEventListener('message', (event) => {
  const payload = event.data;
  if (!payload) return;
  if (payload.type === 'skip-waiting') self.skipWaiting();
  if (payload.type === 'play-chime') broadcastToClients({ type:'play-chime' });
  if (payload.type === 'clear-cache') (async ()=>{ const keys = await caches.keys(); await Promise.all(keys.map(k=>caches.delete(k))); broadcastToClients({ type:'cache-cleared' }); })();
});

self.addEventListener('sync', (event) => {
  event.waitUntil((async ()=>{ await broadcastToClients({ type:'background-sync', tag: event.tag }); })());
});

self.addEventListener('push', (event) => {
  let title = 'Lexi 🐾', body = 'You have a notification from Lexi';
  try{ if(event.data){ const data = event.data.json(); title = data.title || title; body = data.body || body; } }catch(e){ if(event.data) body = event.data.text(); }
  const options = { body, icon: '/icons/icon-192.png', badge: '/icons/badge-72.png', data: { date: Date.now() } };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async ()=>{
    const all = await clients.matchAll({ includeUncontrolled: true });
    if (all.length) { all[0].focus(); all[0].postMessage({ type:'notification-click', data: event.notification.data }); }
    else clients.openWindow('/');
  })());
});
