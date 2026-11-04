// Offline-Cache für Monitor-Rücknahme. Bei Updates VERSION hochzählen.
const VERSION = "ruecknahme-v29";
const FILES = ["./", "index.html", "app.css", "app.js", "vendor/zxing.min.js", "vendor/xlsx.mini.min.js", "vendor/qrcode.js",
  "manifest.webmanifest", "icon-192.png", "icon-512.png", "icon-maskable-512.png", "apple-touch-icon.png", "dplan-logo.png", "anleitung.html", "installieren.html"];
self.addEventListener("install", e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
// Nur eigene Dateien cachen; Supabase-Aufrufe gehen immer direkt ans Netz.
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match("index.html"))));
});
