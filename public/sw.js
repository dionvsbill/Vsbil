/* VSBIL production service worker */
"use strict";

const VERSION = "vsbil-pwa-v1";
const STATIC_CACHE = `${VERSION}-static`;
const APP_SHELL = [
  "/",
  "/index.html",
  "/css/style.css",
  "/css/brand.css",
  "/assets/vsbil-logo.svg"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key.startsWith("vsbil-pwa-") && key !== STATIC_CACHE)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();
          caches.open(STATIC_CACHE).then(cache => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request).then(cached => cached || caches.match("/index.html")))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(response => {
        if (response.ok && response.type === "basic") {
          const copy = response.clone();
          caches.open(STATIC_CACHE).then(cache => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});
