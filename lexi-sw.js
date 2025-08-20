// lexi-sw.js
// Service Worker for Lexi’s Budget Tracker
// Supports: offline caching, IndexedDB autosave, cross-tab sync,
// background sync of queued actions, notifications (due dates/paydays/events),
// kitten chime sounds, and update messaging.

const CACHE_VERSION = 'v3-2025-08-19';
const CACHE_NAME = `lexi-cache-${CACHE_VERSION}`;
const PRECACHE_URLS = [
  '/', '/index.html',
  '/assets/kitten-chime.mp3',
  'https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js'
];

// IndexedDB setup
const IDB_DB = 'lexi_sw_db';
const IDB_STORE = 'queue';

function idbOpen() {
  return new Promise((resolve, reject) => {
    const rq = indexedDB.open(IDB_DB, 1);
    rq.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE, { keyPath: 'id' });
      }
    };
    rq.onsuccess = () => resolve(rq.result);
    rq.onerror = () => reject(rq.error);
  });
}
async function idbAdd(item) {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(item);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}
async function idbGetAll() {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const rq = tx.objectStore(IDB_STORE).getAll();
    rq.onsuccess = () => res(rq.result || []);
    rq.onerror = () => rej(rq.error);
  });
}
async function idbDelete(id) {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).delete(id);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

// Install / Activate
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch strategy
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const accept = req.headers.get('Accept') || '';

  if (accept.includes('text/html')) {
    event.respondWith(
      fetch(req).then(r => {
        caches.open(CACHE_NAME).then(c => c.put(req, r.clone()));
        return r;
      }).catch(() => caches.match('/index.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(cached => {
      const net = fetch(req).then(r => {
        if (r && r.status === 200) {
          caches.open(CACHE_NAME).then(c => c.put(req, r.clone()));
        }
        return r;
      }).catch(() => null);
      return cached || net;
    })
  );
});

// Messaging
self.addEventListener('message', (ev) => {
  const d = ev.data;
  if (!d) return;

  if (d === 'skipWaiting' || d?.type === 'skipWaiting') {
    self.skipWaiting();
    return;
  }
  if (d.type === 'save-state' && d.state) {
    const item = { id: 'state-' + Date.now(), type: 'state', payload: d.state, ts: Date.now() };
    idbAdd(item).then(() => notifyClients({ type: 'sw-saved', id: item.id }));
  }
  if (d.type === 'queue-action' && d.action) {
    const item = { id: 'act-' + Date.now(), type: 'action', payload: d.action, ts: Date.now() };
    idbAdd(item).then(() => notifyClients({ type: 'sw-queued', id: item.id }));
  }
  if (d.type === 'registerSync' && d.tag) {
    self.registration.sync.register(d.tag)
      .then(() => notifyClients({ type: 'sync-registered', tag: d.tag }))
      .catch(() => notifyClients({ type: 'sync-failed', tag: d.tag }));
  }
  if (d.type === 'notify' && d.title) {
    showNotification(d.title, d.options || {});
  }
});

// Background Sync
self.addEventListener('sync', (event) => {
  if (!event.tag) return;
  event.waitUntil(flushQueue());
});
async function flushQueue() {
  const items = await idbGetAll();
  for (const it of items) {
    try {
      if (it.payload && it.payload.url) {
        await fetch(it.payload.url, {
          method: it.payload.method || 'POST',
          headers: it.payload.headers || { 'Content-Type': 'application/json' },
          body: it.payload.body ? JSON.stringify(it.payload.body) : null
        });
      }
      await idbDelete(it.id);
      notifyClients({ type: 'sync-item-success', id: it.id });
    } catch (e) {
      notifyClients({ type: 'sync-item-failed', id: it.id });
    }
  }
}

// Notifications
function showNotification(title, options = {}) {
  const opt = Object.assign({
    body: options.body || '',
    icon: options.icon || '/assets/kitten-icon-192.png',
    badge: options.badge || '/assets/kitten-badge.png',
    sound: options.sound || '/assets/kitten-chime.mp3',
    tag: options.tag || 'lexi-notify',
    data: options.data || {}
  }, options);
  return self.registration.showNotification(title, opt);
}
self.addEventListener('push', (ev) => {
  let data = {};
  try { data = ev.data.json(); } catch (e) { data = { body: ev.data.text() }; }
  const title = data.title || 'Lexi Reminder';
  ev.waitUntil(showNotification(title, data));
});
self.addEventListener('notificationclick', (ev) => {
  ev.notification.close();
  const url = ev.notification.data?.url || '/';
  ev.waitUntil(
    self.clients.matchAll({ type: 'window' }).then(clientsArr => {
      for (const c of clientsArr) {
        if (c.url === url && 'focus' in c) return c.focus();
      }
      return self.clients.openWindow(url);
    })
  );
});

// Helpers
async function notifyClients(msg) {
  const clientsArr = await self.clients.matchAll({ includeUncontrolled: true });
  for (const c of clientsArr) c.postMessage(msg);
}
