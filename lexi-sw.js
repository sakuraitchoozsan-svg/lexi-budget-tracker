// lexi-sw.js
// Service Worker for Lexi's Budget Tracker
// Place this file at the site root (e.g., repo root) so it registers at '/lexi-sw.js'

const CACHE_VERSION = 'v1.2025-08-19';
const CACHE_NAME = `lexi-cache-${CACHE_VERSION}`;

const PRECACHE_URLS = [
  '/', 
  '/index.html',
  // CDN assets used by the app (adjust versions if you change them in index.html)
  'https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js'
];

// Optionally add other static assets you reference (icons, images, fonts).
// Example:
// PRECACHE_URLS.push('/assets/logo-192.png', '/assets/icons/kitten.png');

self.addEventListener('install', (event) => {
  // Precache app shell
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_URLS);
    }).then(() => {
      // Activate immediately after install
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', (event) => {
  // Remove old caches
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      );
    }).then(() => {
      // Take control of uncontrolled clients immediately
      return self.clients.claim();
    })
  );
});

// Listen for messages from the page (e.g., to skipWaiting)
self.addEventListener('message', (event) => {
  if (!event.data) return;
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
});

/**
 * Fetch strategy:
 * - Navigation requests (HTML pages): network-first, fallback to cached index.html
 * - Other static assets: cache-first, then network, then fallback to cache
 * This gives good offline behaviour while keeping pages fresh.
 */
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only handle GET requests
  if (req.method !== 'GET') return;

  const acceptHeader = req.headers.get('Accept') || '';

  // NAVIGATIONS: serve index.html (network-first) to support SPA & offline fallback
  if (acceptHeader.includes('text/html')) {
    event.respondWith(
      fetch(req)
        .then((networkResponse) => {
          // Put a copy in cache for offline fallback
          caches.open(CACHE_NAME).then(cache => {
            try { cache.put(req, networkResponse.clone()); } catch (e) { /* ignore quota errors */ }
          });
          return networkResponse;
        })
        .catch(() => {
          // On failure (offline), return cached index.html or root
          return caches.match('/index.html').then(cached => cached || caches.match('/'));
        })
    );
    return;
  }

  // For other requests (CSS/JS/images): cache-first then network
  event.respondWith(
    caches.match(req).then(cachedResp => {
      if (cachedResp) {
        // Also, try to update the cache in the background
        fetch(req).then(networkResp => {
          if (networkResp && networkResp.status === 200) {
            caches.open(CACHE_NAME).then(cache => {
              try { cache.put(req, networkResp.clone()); } catch (e) { /* ignore */ }
            });
          }
        }).catch(()=>{ /* network fail — ignore */ });
        return cachedResp;
      }

      // Not cached — fetch from network and cache it
      return fetch(req)
        .then(networkResponse => {
          // Only cache valid responses
          if (!networkResponse || networkResponse.status !== 200 || networkResponse.type === 'opaque') {
            return networkResponse;
          }
          const copy = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => {
            try { cache.put(req, copy); } catch (e) { /* ignore quota errors */ }
          });
          return networkResponse;
        })
        .catch(() => {
          // As final fallback, try to return index.html for navigation-like requests,
          // or nothing for assets (could also return a placeholder image if you add one).
          if (req.destination === 'image') {
            // optional: return a data URI 1x1 pixel or cached placeholder if you added one
            return new Response('', { status: 504, statusText: 'Offline' });
          }
          return caches.match('/index.html');
        });
    })
  );
});

// Optional: periodically update precache resources (you can bump CACHE_VERSION to force a refresh).
// Tip: update CACHE_VERSION when you deploy new builds so clients fetch the new service worker and assets.
