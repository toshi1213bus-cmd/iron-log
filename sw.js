/* ============================================================
   PPL（iron-log）用サービスワーカー sw.js
   役割：アプリのファイル一式をスマホ内に保存し、
         オフラインでも開けるようにする。
   方針：「ネットがある時は最新を取りに行き、保存も更新する。
          ネットが無い時だけ、保存済みを使う」
         → ファイルを新しくしても、古い版に固定されない。
   ※ このファイルはリポジトリの一番上（index.html と同じ場所）に置くこと。
   ============================================================ */

const CACHE_NAME = 'ppl-cache-v1';

/* 最初に保存しておくアプリ本体のファイル */
const CORE_FILES = [
  './',
  './index.html',
  './extras.js',
  './theme.css',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png'
];

/* インストール時：本体ファイルをまとめて保存する */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(CORE_FILES))
      .then(() => self.skipWaiting())
  );
});

/* 有効化時：古い名前の保存庫を片付ける */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

/* 通信時：まずネットから最新を取り、成功したら保存も更新。
   失敗（オフライン等）したら保存済みを返す。 */
self.addEventListener('fetch', (event) => {
  const request = event.request;

  /* GET 以外（送信など）はそのままネットへ */
  if (request.method !== 'GET') return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        /* 正常に取れたものは、次回のオフライン用に保存を更新する
           （Tailwind やフォント等の外部ファイルも対象） */
        if (response && (response.status === 200 || response.type === 'opaque')) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => {
        /* オフライン時：保存済みを探す。
           theme.css?v=20 のような「?v=数字」の違いは無視して探す */
        const cached = await caches.match(request, { ignoreSearch: true });
        if (cached) return cached;
        /* ページ遷移で何も無ければ、保存済みのトップ画面を返す */
        if (request.mode === 'navigate') {
          const top = await caches.match('./index.html', { ignoreSearch: true });
          if (top) return top;
        }
        throw new Error('offline and no cache');
      })
  );
});
