/* ==================================================================
   Service Worker — يجعل التطبيق يعمل بدون إنترنت
   عند تعديل أي ملف: غيّر رقم CACHE ليأخذ المستخدم النسخة الجديدة
   ================================================================== */

const CACHE = 'mushaf-v1';

const ASSETS = [
  './',
  './index.html',
  './app.css',
  './app.js',
  './manifest.webmanifest',
  './data/quran.json',
  './fonts/AmiriQuran-Regular.woff',
  './fonts/AmiriQuran-Regular.ttf',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

// عند التثبيت: نحمّل كل ملفات التطبيق ونخزّنها
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

// عند التفعيل: نحذف النسخ القديمة من الكاش
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// عند أي طلب: نعطي الملف من الكاش أولاً (أسرع وبدون إنترنت)
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(hit => {
      if (hit) return hit;
      return fetch(e.request).then(res => {
        // نخزّن نسخة من أي ملف جديد
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        return res;
      }).catch(() => caches.match('./index.html'));
    })
  );
});
