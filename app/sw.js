/* 離線快取：把整個網站殼（HTML／JS／CSS／圖示）放進快取，沒網路也能打開。
 * 只快取網站程式；食物庫與紀錄在 IndexedDB，這個檔案完全不碰，更新版本也不會清掉。
 * 下面 STAMP 區塊由 tools/stamp-version.js 產生，請不要手改；程式有改動後執行 npm run stamp。 */

/* STAMP:BEGIN */
const VERSION = 'b03ec6e1a6';
const PRECACHE = ["./","css/app.css","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon-maskable-512.png","index.html","js/core/backup.js","js/core/constants.js","js/core/day.js","js/core/days.js","js/core/format.js","js/core/gptParse.js","js/core/gptSummary.js","js/core/ids.js","js/core/ledger.js","js/core/library.js","js/core/summary.js","js/core/validate.js","js/main.js","js/state.js","js/store/idb.js","js/store/schema.js","js/ui/home.js","js/ui/index.js","js/ui/pages.js","js/ui/sheets.js","js/ui/util.js","manifest.webmanifest"];
/* STAMP:END */

const CACHE_PREFIX = 'kouda-shell-';
const CACHE = `${CACHE_PREFIX}${VERSION}`;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // cache: 'reload' 避開瀏覽器／主機的 HTTP 快取，確保抓到的是這一版的檔案
    await cache.addAll(PRECACHE.map((url) => new Request(url, { cache: 'reload' })));
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n.startsWith(CACHE_PREFIX) && n !== CACHE).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    if (req.mode === 'navigate') {
      const shell = await cache.match('./', { ignoreSearch: true });
      if (shell) return shell;
    }
    return fetch(req);
  })());
});
