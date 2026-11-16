const CACHE_NAME = "formation-admin-pwa-v47";
const APP_SHELL = [
  "./admin.html",
  "./admin-versions.html",
  "./agent-calendar.html",
  "./index.html",
  "./calendrier.html",
  "./styles.css",
  "./public.css",
  "./app.js",
  "./catalog-review-workflow.js",
  "./catalog-versions.js",
  "./catalog-versions.css",
  "./agent-calendar.js",
  "./agent-calendar.css",
  "./public.js",
  "./public-maintenance.js",
  "./calendar.js",
  "./calendar-tooltip.js",
  "./venue-calendar-stats.js",
  "./pwa-update.js",
  "./firebase-config.js",
  "./firebase-environment.js",
  "./relecture.html",
  "./relecture.js",
  "./manifest.webmanifest",
  "./logo.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => Promise.all(
        cacheNames
          .filter((cacheName) =>
            (cacheName.startsWith("formation-pwa-") ||
              cacheName.startsWith("formation-admin-pwa-")) &&
            cacheName !== CACHE_NAME
          )
          .map((cacheName) => caches.delete(cacheName))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          if (response.ok) {
            await caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()));
          }
          return response;
        } catch (error) {
          const cachedResponse = await caches.match(request);
          if (cachedResponse) return cachedResponse;
          return caches.match(url.pathname.endsWith("/admin.html") ? "./admin.html" : "./index.html");
        }
      })()
    );
    return;
  }

  const isAppResource = /\.(?:css|js|webmanifest)$/.test(url.pathname);
  if (isAppResource) {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          if (response.ok) {
            await caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()));
          }
          return response;
        } catch (error) {
          const cachedResponse = await caches.match(request);
          if (cachedResponse) return cachedResponse;
          throw error;
        }
      })()
    );
    return;
  }

  event.respondWith((async () => {
    try {
      const response = await fetch(request);
      if (response.ok) {
        await caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()));
      }
      return response;
    } catch (error) {
      const cachedResponse = await caches.match(request);
      if (cachedResponse) return cachedResponse;
      throw error;
    }
  })());
});
