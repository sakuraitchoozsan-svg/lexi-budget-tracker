// sw.js - Lexi Budget Tracker 🐾 Service Worker
const CACHE_NAME = "lexi-budget-tracker-v1";
const OFFLINE_URL = "/index.html"; // fallback

// Files to pre-cache (adjust if needed)
const PRECACHE_ASSETS = [
  "/",
  "/index.html",
  "/sw.js",
  "/manifest.json",
  "https://cdn.jsdelivr.net/npm/chart.js", 
  "https://cdn.tailwindcss.com"
];

// ===== Install Event =====
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS);
    })
  );
  self.skipWaiting();
});

// ===== Activate Event =====
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// ===== Fetch Event =====
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const networkFetch = fetch(event.request)
        .then((res) => {
          if (!res || res.status !== 200 || res.type === "opaque") {
            return res;
          }
          let resClone = res.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, resClone);
          });
          return res;
        })
        .catch(() => {
          // offline fallback
          if (event.request.mode === "navigate") {
            return caches.match(OFFLINE_URL);
          }
        });

      return cached || networkFetch;
    })
  );
});

// ===== Message Listener (for skipWaiting / manual trigger) =====
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
