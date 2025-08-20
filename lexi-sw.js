// lexi-sw.js - Service Worker for Lexi’s Budget Tracker 🐾
const CACHE_NAME = "lexi-cache-v2";
const OFFLINE_URL = "/index.html";

const PRECACHE_ASSETS = [
  "/",
  "/index.html",
  "/manifest.json",
  "/assets/kitten-chime.mp3"
];

// ===== Install =====
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_ASSETS))
  );
  self.skipWaiting();
});

// ===== Activate =====
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ===== Fetch =====
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((res) => {
          if (!res || res.status !== 200) return res;
          let resClone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, resClone));
          return res;
        })
        .catch(() => cached || caches.match(OFFLINE_URL));

      return cached || network;
    })
  );
});

// ===== Background Sync (demo) =====
self.addEventListener("sync", (event) => {
  if (event.tag === "sync-data") {
    event.waitUntil(
      self.registration.showNotification("🐾 Lexi Tracker", {
        body: "Your data was synced successfully!",
        icon: "/assets/icon-192.png",
        badge: "/assets/icon-192.png",
        sound: "/assets/kitten-chime.mp3"
      })
    );
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
