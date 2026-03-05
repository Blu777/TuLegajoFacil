// Service Worker Básico para PWA
const CACHE_NAME = "legajo-app-v1";
const ASSETS_TO_CACHE = [
  "/",
  "/static/index.html",
  "/static/style.css",
  "/static/app.js",
  "/static/manifest.json",
  "/static/icon.svg"
];

// Instalación: guardamos los estáticos
self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
});

// Interceptar peticiones
self.addEventListener("fetch", event => {
  // Ignoramos consultas a la API (backend directo)
  if (event.request.method !== "GET" || event.request.url.includes("/api/")) {
    return;
  }

  // Network falling back to cache
  event.respondWith(
    fetch(event.request)
      .catch(() => caches.match(event.request))
  );
});

// Limpiar caches viejas al activarse
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME)
            .map(key => caches.delete(key))
      );
    })
  );
});
