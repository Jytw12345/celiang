/* 现场测量 PWA 离线缓存
   版本号：发布新版本时改这里（CACHE），旧缓存会自动清理 */
const CACHE = 'admeasure-v2';
const ASSETS = [
  './',
  'index.html',
  'css/style.css',
  'js/util.js', 'js/db.js', 'js/editor.js', 'js/counter.js', 'js/ruler.js',
  'js/ar.js', 'js/sensor.js', 'js/report.js', 'js/app.js',
  'vendor/three.min.js',
  'manifest.webmanifest', 'icon.svg', 'icon-maskable.svg'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // 页面导航：始终回退到缓存的 index.html（hash 路由 SPA）
  if (req.mode === 'navigate') {
    e.respondWith(caches.match('index.html').then(r => r || fetch(req)));
    return;
  }

  // 静态资源：cache-first，未命中再走网络并回填缓存
  e.respondWith(
    caches.match(req).then(r => {
      if (r) return r;
      return fetch(req).then(resp => {
        if (resp && resp.ok && url.origin === self.location.origin) {
          const copy = resp.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        }
        return resp;
      }).catch(() => caches.match('index.html'));
    })
  );
});
