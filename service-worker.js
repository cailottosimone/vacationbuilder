// service-worker.js — cache dell'app shell (HTML/CSS/JS/icone), per farla funzionare offline
// una volta installata sulla home screen. Le risorse esterne (Font Awesome, Leaflet, tile di
// OpenStreetMap, Openrouteservice) NON sono precaricate qui: restano "online-only" come da
// filosofia dell'app (mappe/routing richiedono comunque una connessione).

const CACHE_NAME = 'vacation-builder-shell-v5'; // <-- alza il numero ad ogni modifica dei file per invalidare la cache vecchia

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.css',
  './js/app.js',
  './js/db.js',
  './js/routing.js',
  './js/utils.js',
  './js/repository/index.js',
  './js/repository/archivio.js',
  './js/repository/vacanze.js',
  './js/repository/budget.js',
  './js/repository/liste-predefinite.js',
  './js/services/print.js',
  './js/data/config.js',
  './js/data/auth.js',
  './js/data/cloud.js',
  './js/data/sync.js',
  './js/components/card.js',
  './js/components/dialog.js',
  './js/components/prezzo-widget.js',
  './js/components/quantita-widget.js',
  './js/components/luogo-stoccaggio-select.js',
  './js/components/timeline.js',
  './js/components/sync-indicator.js',
  './js/views/vacanza.js',
  './js/views/archivio.js',
  './js/views/liste-predefinite.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-180.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((nomi) =>
      Promise.all(nomi.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Solo le risorse dello stesso dominio (l'app shell) passano dalla cache: tutto il resto
  // (CDN esterni, chiamate di mappe/routing) va sempre in rete, senza intercettarlo.
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((risposta) => {
        // Aggiorna la cache in background con le risposte valide, per restare al passo
        // se qualche file cambia senza dover reinstallare tutto il service worker.
        if (risposta && risposta.status === 200 && event.request.method === 'GET') {
          const clone = risposta.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return risposta;
      }).catch(() => cached);
    })
  );
});
