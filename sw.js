// Service Worker — オフライン対応のためのキャッシュ
// CSS/JS は ?v= 付きURLで読み込まれるため、URL単位でキャッシュし、同じパスの古い版は削除する
const CACHE = 'make15-v2';
const PRECACHE = [
  './',
  './index.html',
  './manifest.json',
  './assets/favicon.svg',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/apple-touch-icon-120.png',
  './assets/apple-touch-icon-152.png',
  './assets/apple-touch-icon-167.png',
  './assets/apple-touch-icon-180.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// 同じパスで別バージョン（?v=）のエントリを削除
function pruneOldVersions(cache, url) {
  return cache.keys().then((reqs) => Promise.all(
    reqs.filter((r) => {
      const u = new URL(r.url);
      return u.pathname === url.pathname && u.search !== url.search;
    }).map((r) => cache.delete(r))
  ));
}

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;

  // HTML はネットワーク優先（更新をすぐ反映）、オフライン時はキャッシュ
  if (e.request.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('.html')) {
    e.respondWith(
      fetch(e.request).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      }).catch(() => caches.match(e.request).then((r) => r || caches.match('./index.html')))
    );
    return;
  }

  // それ以外はキャッシュ優先（URLにバージョンが入っているので安全）
  e.respondWith(
    caches.match(e.request).then((cached) => {
      if (cached) return cached;
      return fetch(e.request).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) =>
            c.put(e.request, copy).then(() => (url.search ? pruneOldVersions(c, url) : null))
          );
        }
        return res;
      });
    })
  );
});
