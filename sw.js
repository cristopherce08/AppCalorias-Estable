const CACHE_NAME = 'micalorias-estable-shell-v2';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      // Forzar obtención limpia desde el servidor evitando respuestas HTTP locales obsoletas
      const requests = ASSETS.map(url => new Request(url, { cache: 'reload' }));
      await cache.addAll(requests);
    })
  );
  // En primera instalación (sin controlador previo), activarse inmediatamente para habilitar modo offline
  if (!self.registration.active) {
    self.skipWaiting();
  }
});

self.addEventListener('activate', event => {
  event.waitUntil(
    Promise.all([
      // Eliminar únicamente cachés shell antiguas, preservando cualquier otro almacenamiento
      caches.keys().then(keys => {
        return Promise.all(
          keys
            .filter(key => key.startsWith('micalorias-estable-shell-') && key !== CACHE_NAME)
            .map(key => caches.delete(key))
        );
      }),
      self.clients.claim()
    ])
  );
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then(cached => {
      if (cached) return cached;
      return fetch(request).catch(() => {
        if (request.mode === 'navigate') {
          return caches.match('./index.html');
        }
        return (typeof Response.error === 'function')
          ? Response.error()
          : new Response(null, { status: 408 });
      });
    })
  );
});
