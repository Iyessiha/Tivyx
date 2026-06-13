// TivyX Service Worker v1.0
// Cache strategy: Network First for API, Cache First for assets

const CACHE_VERSION = 'tivyx-v1.3.0';
const STATIC_CACHE  = `${CACHE_VERSION}-static`;
const DYNAMIC_CACHE = `${CACHE_VERSION}-dynamic`;
const IMAGE_CACHE   = `${CACHE_VERSION}-images`;

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/offline.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

const CACHE_STRATEGIES = {
  static:  ['/icons/', '/fonts/', '/manifest.json'],
  network: ['/api/', 'supabase.co', 'geniuspay.ci', 'elevenlabs.io', 'replicate.com'],
  image:   ['.jpg', '.jpeg', '.png', '.webp', '.gif'],
};

// ─── INSTALL ────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then(cache => {
      console.log('[SW] Caching static assets');
      return cache.addAll(STATIC_ASSETS).catch(err => {
        console.warn('[SW] Some static assets failed to cache:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// ─── ACTIVATE ───────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key.startsWith('tivyx-') && key !== STATIC_CACHE && key !== DYNAMIC_CACHE && key !== IMAGE_CACHE)
          .map(key => { console.log('[SW] Deleting old cache:', key); return caches.delete(key); })
      )
    ).then(() => self.clients.claim())
  );
});

// ─── FETCH ──────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET
  if (request.method !== 'GET') return;

  // Skip chrome-extension and other non-http
  if (!request.url.startsWith('http')) return;

  // API / Supabase → Network First
  if (CACHE_STRATEGIES.network.some(p => request.url.includes(p))) {
    event.respondWith(networkFirst(request, DYNAMIC_CACHE, 5000));
    return;
  }

  // Images → Cache First with expiry
  if (CACHE_STRATEGIES.image.some(ext => url.pathname.endsWith(ext))) {
    event.respondWith(cacheFirst(request, IMAGE_CACHE));
    return;
  }

  // Static assets → Cache First
  if (CACHE_STRATEGIES.static.some(p => url.pathname.startsWith(p))) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  // HTML pages → Network First with offline fallback
  if (request.headers.get('Accept')?.includes('text/html')) {
    event.respondWith(
      networkFirst(request, DYNAMIC_CACHE, 3000).catch(() =>
        caches.match('/offline.html')
      )
    );
    return;
  }

  // Default → Network First
  event.respondWith(networkFirst(request, DYNAMIC_CACHE, 5000));
});

// ─── STRATEGIES ─────────────────────────────────────────
async function networkFirst(request, cacheName, timeout = 5000) {
  const cache = await caches.open(cacheName);
  try {
    const networkResponse = await Promise.race([
      fetch(request.clone()),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeout))
    ]);
    if (networkResponse.ok) {
      cache.put(request, networkResponse.clone()).catch(() => {});
    }
    return networkResponse;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw new Error('No network and no cache');
  }
}

async function cacheFirst(request, cacheName) {
  const cache  = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone()).catch(() => {});
    return response;
  } catch {
    return new Response('Resource unavailable offline', { status: 503 });
  }
}

// ─── PUSH NOTIFICATIONS ─────────────────────────────────
self.addEventListener('push', event => {
  let data = { title: 'TivyX', body: 'Nouveau contenu disponible !', icon: '/icons/icon-192.png' };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {}

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body:    data.body,
      icon:    data.icon || '/icons/icon-192.png',
      badge:   '/icons/icon-96.png',
      image:   data.image,
      tag:     data.tag || 'tivyx-notification',
      renotify: true,
      vibrate: [200, 100, 200],
      data:    { url: data.url || '/' },
      actions: [
        { action: 'watch', title: '▶ Regarder' },
        { action: 'dismiss', title: 'Plus tard' },
      ]
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  if (event.action === 'dismiss') return;
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.postMessage({ type: 'NAVIGATE', url });
          return client.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});

// ─── BACKGROUND SYNC ────────────────────────────────────
self.addEventListener('sync', event => {
  if (event.tag === 'sync-viewing-progress') {
    event.waitUntil(syncViewingProgress());
  }
  if (event.tag === 'sync-mylist') {
    event.waitUntil(syncMyList());
  }
});

async function syncViewingProgress() {
  try {
    const db = await openDB();
    const tx = db.transaction('pending-sync', 'readonly');
    const items = await getAllFromStore(tx, 'pending-sync');
    for (const item of items) {
      await fetch('/api/progress', { method: 'POST', body: JSON.stringify(item), headers: {'Content-Type':'application/json'} });
    }
    console.log('[SW] Synced viewing progress:', items.length, 'items');
  } catch(e) { console.warn('[SW] Sync failed:', e); }
}

async function syncMyList() {
  console.log('[SW] Syncing my list...');
}

// ─── MESSAGES ───────────────────────────────────────────
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'CACHE_URLS') {
    caches.open(DYNAMIC_CACHE).then(cache => cache.addAll(event.data.urls || []));
  }
  if (event.data?.type === 'CLEAR_CACHE') {
    caches.delete(DYNAMIC_CACHE).then(() => console.log('[SW] Dynamic cache cleared'));
  }
});

// ─── UTILS ──────────────────────────────────────────────
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('tivyx-offline', 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore('pending-sync', { keyPath: 'id', autoIncrement: true });
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}
function getAllFromStore(tx, storeName) {
  return new Promise((resolve, reject) => {
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}
