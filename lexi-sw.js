// lexi-sw.js - Service Worker for Lexi’s Budget Tracker 🐾
const CACHE_NAME = "lexi-cache-v1";
const PRECACHE_ASSETS = [
  "/",
  "/index.html",
  "/manifest.json",
  "/assets/kitten-chime.mp3"
];

// ===== Install Event =====
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_ASSETS))
  );
  self.skipWaiting();
});

// ===== Activate Event =====
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ===== Fetch Event =====
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetchPromise = fetch(event.request)
        .then((response) => {
          if (!response || response.status !== 200) return response;
          const resClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, resClone));
          return response;
        })
        .catch(() => cached);

      return cached || fetchPromise;
    })
  );
});

// ===== Background Sync (placeholder) =====
self.addEventListener("sync", (event) => {
  if (event.tag === "sync-data") {
    event.waitUntil(self.registration.showNotification("🐾 Data synced!"));
  }
});

// ===== Notifications =====
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: "window" }).then((clientsArr) => {
      if (clientsArr.length > 0) {
        clientsArr[0].focus();
      } else {
        clients.openWindow("/");
      }
    })
  );
});
