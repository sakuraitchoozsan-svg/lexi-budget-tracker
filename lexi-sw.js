// lexi-sw.js
// Service Worker for Lexi — Pastel Pink Kitten Budget Tracker
// - Precache app shell
// - Runtime caching (assets -> cache-first, navigation -> network-first fallback to cache)
// - IndexedDB queue for offline autosave/actions, background sync
// - Message handling for save-state / queue-action / notify / skipWaiting
// - Notification display + click handling

const CACHE_VERSION = 'v2-2025-08-19';
const CACHE_NAME = `lexi-cache-${CACHE_VERSION}`;
const PRECACHE_URLS = [
  '/', '/index.html',
  // CDN assets (these match the index.html usage)
  'https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js'
];

// ==================== IndexedDB helpers (used by SW) ====================
const IDB_DB = 'lexi_sw_db';
const IDB_STORE = 'queue';

// small wrapper to open idb
function idbOpen(){
  return new Promise((resolve, reject) => {
    const rq = indexedDB.open(IDB_DB, 1);
    rq.onupgradeneeded = (e) => {
      const db = e.target.result;
      if(!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE, { keyPath: 'id' });
    };
    rq.onsuccess = () => resolve(rq.result);
    rq.onerror = () => reject(rq.error);
  });
}

async function idbAdd(item){
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    const st = tx.objectStore(IDB_STORE);
    st.put(item);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

async function idbGetAll(){
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const st = tx.objectStore(IDB_STORE);
    const rq = st.getAll();
    rq.onsuccess = () => res(rq.result || []);
    rq.onerror = () => rej(rq.error);
  });
}

async function idbDelete(id){
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    const st = tx.objectStore(IDB_STORE);
    st.delete(id);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

// ==================== Install / Activate ====================
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

// ==================== Fetch strategy ====================
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const accept = req.headers.get('Accept') || '';

  // Navigation requests -> network-first, fallback to cached index.html
  if (accept.includes('text/html')) {
    event.respondWith(
      fetch(req).then(networkResp => {
        // update cache in background
        caches.open(CACHE_NAME).then(cache => {
          try { cache.put(req, networkResp.clone()); } catch (e) {}
        });
        return networkResp;
      }).catch(() => caches.match('/index.html').then(r => r || Promise.reject('no-match')))
    );
    return;
  }

  // For other assets -> cache-first with background update
  event.respondWith(
    caches.match(req).then(cached => {
      const networkFetch = fetch(req).then(networkResp => {
        if (networkResp && networkResp.status === 200) {
          caches.open(CACHE_NAME).then(cache => {
            try { cache.put(req, networkResp.clone()); } catch (e) {}
          });
        }
        return networkResp;
      }).catch(() => null);

      // Return cached if exists, else wait for network
      return cached || networkFetch.then(resp => resp || Promise.reject('no-match'));
    })
  );
});

// ==================== Message handling from clients ====================
self.addEventListener('message', (ev) => {
  if (!ev.data) return;
  const data = ev.data;

  // Skip waiting (activate immediately)
  if (data === 'skipWaiting' || data?.type === 'skipWaiting') {
    self.skipWaiting();
    return;
  }

  // Save state sent by client (autosave). Store into SW IndexedDB queue
  if (data.type === 'save-state' && data.state) {
    const item = { id: 'state-' + Date.now(), type: 'state', payload: data.state, ts: Date.now() };
    idbAdd(item).then(()=> notifyClients({ type: 'sw-saved', id: item.id })).catch(()=>{});
    return;
  }

  // Queue arbitrary action (e.g., offline action to sync later)
  if (data.type === 'queue-action' && data.action) {
    const item = { id: 'act-' + Date.now() + '-' + Math.floor(Math.random()*10000), type: 'action', payload: data.action, ts: Date.now() };
    idbAdd(item).then(()=> notifyClients({ type: 'sw-queued', id: item.id })).catch(()=>{});
    return;
  }

  // Request to register background sync tag
  if (data.type === 'registerSync' && data.tag) {
    self.registration.sync.register(data.tag).then(()=> notifyClients({ type: 'sync-registered', tag: data.tag })).catch(()=> notifyClients({ type: 'sync-failed', tag: data.tag }));
    return;
  }

  // Direct notification request
  if (data.type === 'notify' && data.title) {
    showNotification(data.title, data.options || {});
    return;
  }
});

// Helper: postMessage to all clients
async function notifyClients(message) {
  const clientsList = await self.clients.matchAll({ includeUncontrolled: true });
  for (const c of clientsList) {
    try { c.postMessage(message); } catch (e) {}
  }
}

// ==================== Background Sync ====================
// Try to flush queued actions/state to server (if you have a backend).
// Here we attempt a best-effort: if an action contains a 'url' field we POST it.
// Otherwise, we just mark as synced and inform clients.
// Tag names can be 'lexi-sync' or custom tags from client.
self.addEventListener('sync', (event) => {
  if (!event.tag) return;
  if (event.tag.startsWith('lexi-sync')) {
    event.waitUntil(flushQueue());
  }
});

async function flushQueue(){
  try {
    const items = await idbGetAll();
    if (!items || !items.length) {
      await notifyClients({ type: 'sync-success', detail: 'nothing-to-sync' });
      return;
    }

    for (const it of items) {
      // If payload contains a `url` and `method`, attempt a network sync
      try {
        if (it.payload && it.payload.url && it.payload.method) {
          // attempt network request
          const resp = await fetch(it.payload.url, {
            method: it.payload.method,
            headers: it.payload.headers || { 'Content-Type': 'application/json' },
            body: it.payload.body ? JSON.stringify(it.payload.body) : null
          });
          if (!resp.ok) throw new Error('Bad response');
          // synced -> delete from idb
          await idbDelete(it.id);
          await notifyClients({ type: 'sync-item-success', id: it.id });
        } else {
          // No server URL: just treat as local-state backup; mark as synced and delete
          await idbDelete(it.id);
          await notifyClients({ type: 'sync-item-dequeued', id: it.id });
        }
      } catch (err) {
        // leave it in the queue for next sync
        await notifyClients({ type: 'sync-item-failed', id: it.id, reason: String(err) });
      }
    }
    await notifyClients({ type: 'sync-success', detail: 'queue-processed' });
    return;
  } catch (err) {
    await notifyClients({ type: 'sync-failed', reason: String(err) });
    throw err;
  }
}

// ==================== Notifications ====================
function showNotification(title, options = {}) {
  const opt = Object.assign({
    body: options.body || '',
    icon: options.icon || '/assets/kitten-icon-192.png',
    badge: options.badge || '/assets/kitten-badge.png',
    tag: options.tag || 'lexi-notify',
    renotify: options.renotify || false,
    data: options.data || {}
  }, options);

  return self.registration.showNotification(title, opt);
}

self.addEventListener('push', (ev) => {
  let data = {};
  try { data = ev.data ? ev.data.json() : {}; } catch (e) { data = { text: ev.data?.text || String(ev.data) }; }
  const title = data.title || 'Lexi';
  const opts = Object.assign({ body: data.body || 'You have a new event', data: data }, data.options || {});
  ev.waitUntil(showNotification(title, opts));
});

self.addEventListener('notificationclick', (ev) => {
  ev.notification.close();
  const url = ev.notification.data && ev.notification.data.url ? ev.notification.data.url : '/';
  ev.waitUntil(self.clients.matchAll({ type: 'window' }).then(clientsArr => {
    const hadWindow = clientsArr.some(win => { if (win.url === url) { win.focus(); return true; } return false; });
    if (!hadWindow) self.clients.openWindow(url);
  }));
});

// ==================== Fallback: periodic cleanup (optional) ====================
self.addEventListener('periodicsync', (ev) => {
  // if you register Periodic Sync, you can handle here (Chrome origin-trial / specific support)
  if (ev.tag === 'lexi-periodic-cleanup') {
    ev.waitUntil(flushQueue());
  }
});
