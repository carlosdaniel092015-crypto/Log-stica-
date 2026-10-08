/* Service Worker — Entregas RD
 * - Caché básico del "app shell" para abrir la app sin conexión (modo limitado).
 * - Nunca guarda en caché respuestas privadas de la API, salvo la lista de entregas
 *   del mensajero (para consultarla sin señal), siempre con estrategia "red primero".
 * - Notificaciones Web Push y apertura del enlace al tocarlas.
 */
const VERSION = 'v1';
const SHELL_CACHE = `shell-${VERSION}`;
const ASSET_CACHE = `assets-${VERSION}`;
const DATA_CACHE = `data-${VERSION}`;
const SHELL = ['/', '/manifest.webmanifest', '/icons/icon.svg', '/icons/icon-192.png', '/offline.html'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => !k.endsWith(VERSION)).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

const OFFLINE_API = ['/api/courier/orders', '/api/courier/me', '/api/public/config'];

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/socket.io')) return;

  if (url.pathname.startsWith('/api/')) {
    if (OFFLINE_API.includes(url.pathname)) {
      event.respondWith(
        fetch(req)
          .then((res) => {
            if (res.ok) caches.open(DATA_CACHE).then((c) => c.put(req, res.clone()));
            return res;
          })
          .catch(() => caches.match(req).then((r) => r || new Response(JSON.stringify({ error: 'Sin conexión' }), { status: 503, headers: { 'Content-Type': 'application/json' } })))
      );
    }
    return;
  }

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          caches.open(SHELL_CACHE).then((c) => c.put('/', res.clone()));
          return res;
        })
        .catch(() => caches.match('/').then((r) => r || caches.match('/offline.html')))
    );
    return;
  }

  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.match(req).then(
        (cached) =>
          cached ||
          fetch(req).then((res) => {
            if (res.ok) caches.open(ASSET_CACHE).then((c) => c.put(req, res.clone()));
            return res;
          })
      )
    );
  }
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'Entregas RD', body: event.data && event.data.text() };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Entregas RD', {
      body: data.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: data.tag,
      renotify: !!data.tag,
      data: { url: data.url || '/' },
      lang: 'es-DO',
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url === target && 'focus' in client) return client.focus();
      }
      return self.clients.openWindow(target);
    })
  );
});

// Sincronización en segundo plano: avisa a las pestañas abiertas para reenviar acciones pendientes.
self.addEventListener('sync', (event) => {
  if (event.tag === 'outbox') {
    event.waitUntil(self.clients.matchAll({ type: 'window' }).then((list) => list.forEach((c) => c.postMessage({ type: 'flush-outbox' }))));
  }
});
