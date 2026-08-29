/* VSBIL production service worker */
"use strict";

const VERSION = "vsbil-pwa-v2";
const STATIC_CACHE = `${VERSION}-static`;
const APP_SHELL = [
  "/",
  "/index.html",
  "/css/style.css",
  "/css/brand.css",
  "/css/site-shell.css",
  "/css/theme-fixes.css",
  "/js/site-shell.js",
  "/js/app.js",
  "/js/pwa.js",
  "/assets/vsbil-logo.svg",
  "/manifest.webmanifest"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(STATIC_CACHE).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith("vsbil-pwa-") && key !== STATIC_CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("message", event => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).then(response => { if (response.ok) caches.open(STATIC_CACHE).then(cache => cache.put(request, response.clone())); return response; }).catch(() => caches.match(request).then(cached => cached || caches.match("/index.html"))));
    return;
  }

  event.respondWith(caches.match(request).then(cached => {
    if (cached) return cached;
    return fetch(request).then(response => { if (response.ok && response.type === "basic") caches.open(STATIC_CACHE).then(cache => cache.put(request, response.clone())); return response; });
  }));
});
