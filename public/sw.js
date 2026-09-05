// Service worker: hace que la app abra sin señal.
// Sin esto la cola de pendientes no serviria de nada, porque sin conexion no se
// podria ni abrir la pantalla para anotar el gasto.
//
// Regla simple:
//   - /api/*        -> siempre a la red, nunca del cache (son datos, no pantalla)
//   - lo demas      -> se intenta la red primero y se guarda copia; si no hay
//                      señal, se sirve la copia guardada
const CACHE = 'gastos-v2';
const BASE = ['/', '/index.html', '/manifest.json', '/icon.svg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(BASE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;   // datos: siempre red

  e.respondWith(
    fetch(req)
      .then(res => {
        // Solo se guarda lo que salio bien, para no cachear un error.
        if (res && res.ok) {
          const copia = res.clone();
          caches.open(CACHE).then(c => c.put(req, copia)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req).then(r => r || caches.match('/index.html')))
  );
});
