/* lexi-sw.js
   Service Worker for Lexi — Budget Tracker
   - Caches app shell + assets (including /assets/kitten-chime.mp3)
   - Stale-while-revalidate runtime caching for external APIs
   - Sends messages to clients for updates, chime play, and background-sync
   - Handles skipWaiting / clients.claim for updates
*/

/* Cache versioning */
const CACHE_VERSION = 'v1';
const APP_SHELL_CACHE = `lexi-shell-${CACHE_VERSION}`;
const RUNTIME_CACHE = `lexi-runtime-${CACHE_VERSION}`;

/* Assets to precache (add other static files as needed) */
const PRECACHE_URLS = [
  '/', // root
  '/index.html',
  '/lexi-sw.js',
  '/assets/kitten-chime.mp3', // referenced in index doc (kitten chime audio).
  // CSS / CDN fallbacks (if you bundle or want to cache CDN assets)
  'https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js',
  // Add other local static resources (icons, images) here
];

/* Utility: broadcast message to all clients */
async function broadcastToClients(message) {
  const clientsList = await self.clients.matchAll({ includeUncontrolled: true });
  for (const client of clientsList) {
    client.postMessage(message);
  }
}

/* Install: precache app shell */
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      self.skipWaiting(); // activate as soon as installed
      const cache = await caches.open(APP_SHELL_CACHE);
      try {
        await cache.addAll(PRECACHE_URLS);
      } catch (err) {
        // best-effort: continue even if some resources failed to cache
        console.warn('lexi-sw: precache addAll failed', err);
      }
    })()
  );
});

/* Activate: clean up old caches */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // claim clients so SW starts controlling pages immediately
      await self.clients.claim();
      const keys = await caches.keys();
      await Promise.all(
        keys.map((k) => {
          if (![APP_SHELL_CACHE, RUNTIME_CACHE].includes(k)) return caches.delete(k);
          return Promise.resolve();
        })
      );
      // Inform pages that SW is ready (optional)
      broadcastToClients({ type: 'sw-ready', version: CACHE_VERSION });
    })()
  );
});

/* Fetch strategy:
   - For precached (shell) items: cache-first
   - For runtime / API calls: stale-while-revalidate
   - Fallback to offline response for navigation requests
*/
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only handle GET requests
  if (req.method !== 'GET') return;

  // App shell / precached exact-match: respond from cache first
  if (PRECACHE_URLS.includes(url.pathname) || PRECACHE_URLS.includes(req.url)) {
    event.respondWith(
      caches.open(APP_SHELL_CACHE).then(async (cache) => {
        const cached = await cache.match(req);
        if (cached) return cached;
        // fallback: try network and then cache it
        try {
          const net = await fetch(req);
          if (net && net.ok) cache.put(req, net.clone());
          return net;
        } catch (err) {
          return cached || new Response('Offline', { status: 503, statusText: 'Offline' });
        }
      })
    );
    return;
  }

  // Runtime caching for third-party APIs and other resources (stale-while-revalidate)
  // Example: open-meteo, date.nager.at — the app fetches these endpoints.
  const isApiCall =
    url.hostname.includes('open-meteo.com') ||
    url.hostname.includes('date.nager.at') ||
    url.pathname.startsWith('/api/') ||
    url.pathname.endsWith('.json');

  if (isApiCall || url.origin !== self.origin) {
    event.respondWith(
      caches.open(RUNTIME_CACHE).then(async (cache) => {
        const cached = await cache.match(req);
        const networkFetch = fetch(req)
          .then((res) => {
            // Only cache successful responses
            if (res && res.ok) cache.put(req, res.clone());
            return res;
          })
          .catch(() => null);
        // Return cached response immediately if available, otherwise wait for network
        return cached ? Promise.resolve(cached) : networkFetch.then((r) => r || new Response(null, { status: 504 }));
      })
    );
    return;
  }

  // Default: try network first, fallback to cache (useful for app JS, navs)
  event.respondWith(
    (async () => {
      try {
        const networkResponse = await fetch(req);
        // Optionally cache navigations or other resources on successful fetch
        if (req.mode === 'navigate' && networkResponse && networkResponse.ok) {
          const cache = await caches.open(APP_SHELL_CACHE);
          cache.put(req, networkResponse.clone());
        }
        return networkResponse;
      } catch (err) {
        // network failed — try cache
        const cached = await caches.match(req);
        if (cached) return cached;

        // If navigation and no cache, return a minimal offline page
        if (req.mode === 'navigate') {
          return new Response(
            `<!doctype html><html><head><meta charset="utf-8"><title>Offline</title></head><body><h1>Offline</h1><p>Lexi is offline.</p></body></html>`,
            { headers: { 'Content-Type': 'text/html' } }
          );
        }
        return new Response(null, { status: 504, statusText: 'Offline' });
      }
    })()
  );
});

/* Message from client pages:
   - {type: 'skip-waiting'} -> activate new SW immediately
   - {type: 'play-chime'} -> broadcast 'play-chime' to all clients (page can play audio)
   - {type: 'clear-cache'} -> clear caches (for debugging)
*/
self.addEventListener('message', (event) => {
  const payload = event.data;
  if (!payload) return;

  if (payload.type === 'skip-waiting') {
    self.skipWaiting();
  }

  if (payload.type === 'play-chime') {
    // Post a message to clients to instruct playing the chime (media playback must be handled in page)
    broadcastToClients({ type: 'play-chime' });
  }

  if (payload.type === 'clear-cache') {
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      broadcastToClients({ type: 'cache-cleared' });
    })();
  }
});

/* Background Sync handling:
   - When a sync with tag 'lexi-sync' fires, notify clients to perform whatever background sync logic they have.
   - Also provide general sync message to clients for custom tags.
*/
self.addEventListener('sync', (event) => {
  // Example: event.tag === 'lexi-sync'
  event.waitUntil(
    (async () => {
      // Notify clients so the app can run its own sync routines (e.g., push local transactions to server)
      await broadcastToClients({ type: 'background-sync', tag: event.tag });
      // Optionally, you could perform network requests here from the SW if needed
    })()
  );
});

/* Push event (optional): show notification if push payload arrives */
self.addEventListener('push', (event) => {
  let title = 'Lexi 🐾';
  let body = 'You have a notification from Lexi';
  try {
    if (event.data) {
      const data = event.data.json();
      title = data.title || title;
      body = data.body || body;
    }
  } catch (err) {
    // not JSON
    if (event.data) body = event.data.text();
  }
  const options = {
    body,
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-72.png',
    data: { date: Date.now() },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

/* Notification click */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const all = await clients.matchAll({ includeUncontrolled: true });
      if (all.length) {
        all[0].focus();
        all[0].postMessage({ type: 'notification-click', data: event.notification.data });
      } else {
        clients.openWindow('/');
      }
    })()
  );
});

/* Optional: periodic sync / push subscription management could be added later */

/* End of lexi-sw.js */
