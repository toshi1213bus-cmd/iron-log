/* ============================================================
   PPL（iron-log）用サービスワーカー sw.js
   役割：アプリのファイル一式をスマホ内に保存し、
         オフラインでも開けるようにする。
   方針：「ネットがある時は最新を取りに行き、保存も更新する。
          ネットが無い時・遅い時（4秒）は、保存済みを使う」
         → ファイルを新しくしても、古い版に固定されない。
   ※ このファイルはリポジトリの一番上（index.html と同じ場所）に置くこと。

   【v3 の変更点】
   ① 保存の名前から「?v=45」のような版番号を外し、1ファイル＝1つだけ保存する。
      （以前は版ごとに別々に残り、オフライン時に古い版が選ばれる恐れがあった）
   ② ネットが4秒たっても返事をしない時は、保存済みを先に使う。
      （電波が弱い場所で起動が固まらない。取得は裏で続き、次回に反映される）
   ③ 最初の保存で、ファイルが1つ欠けていても全体が失敗しない。
   ============================================================ */

const CACHE_NAME = 'ppl-cache-v38';   /* ← 名前を変えると、古い保存が全部消える */
const NET_TIMEOUT_MS = 4000;         /* ネットを待つ最大時間（ミリ秒） */

/* 最初に保存しておくアプリ本体のファイル */
const CORE_FILES = [
  './',
  './index.html',
  './app-core.js',
  './extras.js',
  './theme.css',
  './bg.css',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png'
];

/* 保存の名前（キー）を決める。
   同じサイトのファイルだけ「?」以降を外す（extras.js?v=45 → extras.js）。
   他サイト（Tailwind・フォント）は、?以降が中身を決めるので外さない */
function keyOf(request) {
  const u = new URL(request.url);
  if (u.origin === self.location.origin) u.search = '';
  return u.href;
}

/* インストール時：本体ファイルを1つずつ保存する。
   ただし必須ファイルが1つでも欠けたら、この版は使わず前の版のままにする
   （不完全な保存で前の版を消してしまうと、オフラインで開けなくなるため） */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => Promise.all(CORE_FILES.map((file) => {
        const req = new Request(file, { cache: 'reload' });
        return fetch(req)
          .then((res) => (res && res.status === 200) ? cache.put(keyOf(req), res).then(() => true) : false)
          .catch(() => false);
      })))
      .then((results) => {
        if (results.some((ok) => !ok)) {
          return caches.delete(CACHE_NAME).then(() => { throw new Error('core files incomplete'); });
        }
        return self.skipWaiting();
      })
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
   失敗（オフライン等）や4秒たっても返事がない時は、保存済みを返す。 */
self.addEventListener('fetch', (event) => {
  const request = event.request;

  /* GET 以外（送信など）や、http(s) 以外はそのままネットへ */
  if (request.method !== 'GET') return;
  if (request.url.indexOf('http') !== 0) return;

  const key = keyOf(request);

  event.respondWith((async () => {
    /* ネットから取得。成功したら保存も更新（待たされても裏で続く） */
    const net = fetch(request).then((response) => {
      if (response && (response.status === 200 || response.type === 'opaque')) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(key, copy)).catch(() => {});
      }
      return response;
    });
    net.catch(() => {}); /* 4秒で見切った後に失敗しても、エラーを出さない */

    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), NET_TIMEOUT_MS);
    });

    try {
      const response = await Promise.race([net, timeout]);
      clearTimeout(timer);
      return response;
    } catch (e) {
      clearTimeout(timer);
      /* オフライン・遅い時：保存済みを探す */
      const cached = await caches.match(key);
      if (cached) return cached;
      /* ページ遷移で何も無ければ、保存済みのトップ画面を返す */
      if (request.mode === 'navigate') {
        const top = await caches.match(keyOf(new Request('./index.html')));
        if (top) return top;
      }
      /* 保存も無い（初回など）：ネットの結果を最後まで待つ */
      return net;
    }
  })());
});
