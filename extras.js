/* iron-log extras: index.html のスクリプトの後ろに読み込む */
(function () {
const buzz = ms => { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) {} };
const pad = n => String(n).padStart(2, '0');
const dstr = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const fmtD = s => { const p = s.split('-'); return parseInt(p[1], 10) + '/' + parseInt(p[2], 10); };

/* ===== トースト / 確認ダイアログ ===== */
const toastEl = document.createElement('div');
toastEl.id = 'toast';
toastEl.setAttribute('role', 'status');
toastEl.setAttribute('aria-live', 'polite');
document.body.appendChild(toastEl);
let toastTimer;
/* kind: 'ok'（保存できた）／'err'（失敗）。省略時は文言から判定 */
window.alert = function (msg, ms, kind) {
  const m = String(msg);
  toastEl.textContent = m;
  toastEl.className = 'show' + (kind ? ' ' + kind : /できません|失敗/.test(m) ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms || 2200);
};
function ask(msg, ok) {
  return new Promise(resolve => {
    const o = document.createElement('div');
    o.id = 'modal';
    o.innerHTML = '<div class="modal-box"><p>' + msg + '</p><div class="modal-actions">' +
      '<button type="button" data-v="0">キャンセル</button>' +
      '<button type="button" data-v="1" class="modal-danger">' + (ok || '削除') + '</button></div></div>';
    o.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (b || e.target === o) { o.remove(); resolve(!!b && b.dataset.v === '1'); }
    });
    document.body.appendChild(o);
  });
}
window.askConfirm = ask;

/* ===== テーマ切替（黒金／深海ブルー／森林グリーン）：localStorage に保存。グラフの色は変えない ===== */
const THEME_KEY = 'iron_theme';
const THEMES = ['gold', 'ocean', 'forest'];
const THEME_COLOR = { gold: '#0a0a0b', ocean: '#060d16', forest: '#0a110d' };
function getTheme() {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return THEMES.indexOf(t) >= 0 ? t : 'gold';
  } catch (e) { return 'gold'; }
}
function applyTheme(t) {
  if (THEMES.indexOf(t) < 0) t = 'gold';
  document.documentElement.setAttribute('data-theme', t);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', THEME_COLOR[t]);
  document.querySelectorAll('.th-btn').forEach(b => {
    const on = b.dataset.theme === t;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}
window.setTheme = function (t) {
  if (THEMES.indexOf(t) < 0) return;
  let ok = true;
  try { localStorage.setItem(THEME_KEY, t); } catch (e) { ok = false; }
  applyTheme(t);
  if (!ok) window.alert('保存できませんでした');
};

/* ===== ヘルプ（アコーディオン。初期は閉じる） ===== */
window.toggleHelp = function () {
  const body = document.getElementById('helpBody');
  const btn = document.getElementById('helpToggle');
  if (!body || !btn) return;
  const open = body.classList.toggle('hidden') === false;
  btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  const chev = btn.querySelector('.help-chev');
  if (chev) chev.classList.toggle('is-open', open);
};

/* ===== 月間サマリー（今月／先月／今週。週は月曜始まり） ===== */
function updateSummary() {
  const wEl = document.getElementById('compareWorkoutPoints');
  const cEl = document.getElementById('compareCardioPoints');
  if (!wEl && !cEl) return;
  const n = new Date();
  const ym = n.getFullYear() + '-' + pad(n.getMonth() + 1);
  const lm = new Date(n.getFullYear(), n.getMonth() - 1, 1);
  const lym = lm.getFullYear() + '-' + pad(lm.getMonth() + 1);
  const dow = (n.getDay() + 6) % 7;
  const mon = new Date(n.getFullYear(), n.getMonth(), n.getDate() - dow);
  const sun = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 6);
  const ws = dstr(mon), we = dstr(sun);
  let tm = 0, lmN = 0, wk = 0;
  new Set(workouts.map(w => w.dateStr)).forEach(d => {
    if (d.startsWith(ym)) tm++;
    else if (d.startsWith(lym)) lmN++;
    if (d >= ws && d <= we) wk++;
  });
  let cm = 0, cl = 0, cw = 0;
  cardios.forEach(c => {
    if (c.dateStr.startsWith(ym)) cm += c.minutes;
    else if (c.dateStr.startsWith(lym)) cl += c.minutes;
    if (c.dateStr >= ws && c.dateStr <= we) cw += c.minutes;
  });
  if (wEl) wEl.textContent = '今月トレ ' + tm + '日（先月 ' + lmN + '日）／ 今週 ' + wk + '日';
  if (cEl) cEl.textContent = '今月有酸素 ' + cm + '分・約' + Math.round(cm * 3.5) + 'kcal（先月 ' +
    cl + '分）／ 今週 ' + cw + '分';
}

/* ===== 画面更新の入口（ここだけが描画を呼ぶ）
   ・同じ操作の中で何度 renderWorkouts / renderCardios が呼ばれても、終わったあとに1回ずつだけ描く
   ・見えていない画面（ホーム／月間・設定）は描かず、タブを開いたときに描く ===== */
const rCore = window.renderWorkouts; /* 履歴リスト＋トレのポイント */
const rInner = function () { rCore(); decorateHistory(); }; /* 描いたあとに「グラフ推移」ボタンとグラフ枠を足す */
const cInner = window.renderCardios; /* 有酸素リスト＋比較ポイント */
const isShown = id => { const e = document.getElementById(id); return !!e && !e.classList.contains('hidden'); };
function paint(w, c, all) {
  if (w || all) rInner();
  if (c || all) cInner();
  updateSummary(); /* 月間サマリーの2行は、内側の描画のあとに上書きする */
  if (isShown('tabContentSettings')) { renderCalendar(); if (all) renderMenuSummary(); }
  if ((w || all) && isShown('tabContentHome')) renderHome();
  if (sheetEl) renderSheet(); /* 日付ボトムシートが開いていれば最新化 */
}
let depth = 0, dirtyW = false, dirtyC = false, dirtyAll = false;
function request(w, c, all) {
  if (depth) { dirtyW = dirtyW || w; dirtyC = dirtyC || c; dirtyAll = dirtyAll || all; return; }
  paint(w, c, all);
}
/* 中の描画要求をためておき、抜けるときにまとめて1回だけ描く */
function batch(fn) {
  depth++;
  try { return fn(); }
  finally {
    if (!--depth && (dirtyW || dirtyC || dirtyAll)) {
      const w = dirtyW, c = dirtyC, a = dirtyAll;
      dirtyW = dirtyC = dirtyAll = false;
      paint(w, c, a);
    }
  }
}
window.renderWorkouts = function () { request(true, false, false); };
window.renderCardios = function () { request(false, true, false); };
window.refreshAll = function () { request(true, true, true); };
/* メニュー（テンプレ）だけが変わったとき：見えている画面だけ更新 */
function paintMenu() {
  if (isShown('tabContentSettings')) renderMenuSummary();
  if (isShown('tabContentHome')) renderHome();
}

/* ===== 保存ボタンの連打防止（保存に成功したら少しの間だけ押せない） ===== */
const LOCK_MS = 700;
function lockButton(btn) {
  if (!btn) return;
  btn.disabled = true;
  btn.classList.add('is-busy');
  setTimeout(() => { btn.disabled = false; btn.classList.remove('is-busy'); }, LOCK_MS);
}
function savedFeedback(btn) {
  buzz(25);
  window.alert('保存しました', 0, 'ok');
  lockButton(btn);
}
window.deleteWorkout = async function (id) {
  if (!(await ask('この記録を削除しますか？'))) return;
  if (editingId === id) resetForm();
  const prevW = workouts;
  const gone = workouts.find(i => i.id === id);
  workouts = workouts.filter(i => i.id !== id);
  if (!safeSave('simple_workouts', workouts)) { workouts = prevW; renderWorkouts(); return; }
  /* その日の記録が0件になったら、部位の情報も消す */
  if (gone && !workouts.some(i => i.dateStr === gone.dateStr) && dayPplMap[gone.dateStr] !== undefined) {
    const nextP = Object.assign({}, dayPplMap);
    delete nextP[gone.dateStr];
    if (safeSave('simple_day_ppl', nextP)) dayPplMap = nextP;
  }
  renderWorkouts();
};
window.deleteCardio = async function (id) {
  if (!(await ask('この有酸素記録を削除しますか？'))) return;
  const prevC = cardios;
  cardios = cardios.filter(i => i.id !== id);
  if (!safeSave('simple_cardios', cardios)) cardios = prevC;
  renderCardios();
};

/* ===== 履歴の開閉（シェブロン） ===== */
function toggle(h, sel) {
  const hidden = h.nextElementSibling.classList.toggle('hidden');
  h.querySelector(sel).classList.toggle('is-open', !hidden);
}
/* 日付行：種目一覧を開いたらグラフは閉じる（排他） */
window.toggleDayAccordion = h => {
  toggle(h, '.day-toggle-icon');
  const row = h.closest('[data-day]');
  if (row && !h.nextElementSibling.classList.contains('hidden')) hideGraph(row);
};
window.toggleExerciseAccordion = h => toggle(h, '.ex-toggle-icon');

/* ===== 履歴の「グラフ推移」（その日以前の記録日のうち直近5回分の総負荷 Σ weight × reps）
   ・日付ヘッダーの PUSH/PULL/LEGS/OTHER の横にボタン。大きさはホームの展開グラフと同じ（320×138・日付あり）
   ・グラフを開く → その日の種目一覧（.day-content）を閉じる。種目一覧を開く → グラフを閉じる ===== */
const graphOpen = new Set();
function graphHtml(d) {
  const per = {};
  workouts.forEach(w => {
    if (w.dateStr <= d) per[w.dateStr] = (per[w.dateStr] || 0) + w.setList.reduce((a, x) => a + x.weight * x.reps, 0);
  });
  const ds = Object.keys(per).sort().slice(-5);
  if (ds.length < 2) return '<div class="hm-sub">2回以上の記録でグラフが出ます。</div>';
  return '<div class="hm-leg"><span class="lg-g">総負荷</span></div>' + line(ds.map(x => Math.round(per[x])), 320, 138, ds);
}
function hideGraph(row) {
  const g = row.querySelector('.day-graph'), b = row.querySelector('.gr-btn');
  graphOpen.delete(row.dataset.day);
  if (g) { g.classList.add('hidden'); g.innerHTML = ''; }
  if (b) { b.classList.remove('on'); b.setAttribute('aria-pressed', 'false'); }
}
function showGraph(row) {
  const g = row.querySelector('.day-graph'), b = row.querySelector('.gr-btn'), c = row.querySelector('.day-content');
  if (!g) return;
  graphOpen.add(row.dataset.day);
  g.innerHTML = graphHtml(row.dataset.day);
  g.classList.remove('hidden');
  if (b) { b.classList.add('on'); b.setAttribute('aria-pressed', 'true'); }
  if (c) c.classList.add('hidden'); /* 種目一覧（セット内訳・編集・削除）は隠す */
  const ic = row.querySelector('.day-toggle-icon');
  if (ic) ic.classList.remove('is-open');
}
window.toggleDayGraph = function (d) {
  const list = document.getElementById('workoutList');
  const row = list && list.querySelector('[data-day="' + d + '"]');
  if (!row) return;
  const g = row.querySelector('.day-graph');
  if (g && g.classList.contains('hidden')) showGraph(row); else hideGraph(row);
};
function decorateHistory() {
  const list = document.getElementById('workoutList');
  if (!list) return;
  const days = new Set();
  list.querySelectorAll('[data-day]').forEach(row => {
    const d = row.dataset.day;
    days.add(d);
    const sel = row.querySelector('select');
    if (sel && !row.querySelector('.gr-btn')) {
      sel.insertAdjacentHTML('afterend', '<button type="button" class="gr-btn" aria-pressed="false" onclick="event.stopPropagation(); toggleDayGraph(\'' + d + '\')">グラフ推移</button>');
    }
    if (!row.querySelector('.day-graph')) {
      const c = row.querySelector('.day-content');
      if (c) c.insertAdjacentHTML('afterend', '<div class="day-graph hm-big2 hidden"></div>');
    }
    if (graphOpen.has(d)) showGraph(row);
  });
  [...graphOpen].forEach(d => { if (!days.has(d)) graphOpen.delete(d); }); /* 一覧に出ていない日は忘れる */
}
/* 別ページへ移動したら、履歴の種目一覧・セット内訳・グラフをすべて閉じる */
function closeHistory() {
  const list = document.getElementById('workoutList');
  if (!list) return;
  list.querySelectorAll('.day-content, .ex-content').forEach(e => e.classList.add('hidden'));
  list.querySelectorAll('.day-toggle-icon, .ex-toggle-icon').forEach(e => e.classList.remove('is-open'));
  list.querySelectorAll('[data-day]').forEach(hideGraph);
  graphOpen.clear();
}

/* ===== タイマー：残り時間バー・終了時の発光・振動 ===== */
const disp = document.getElementById('timerDisplay');
const card = disp.closest('.bg-gray-800');
disp.closest('#timerRow').insertAdjacentHTML('afterend', '<div id="timerTrack"><div id="timerBar"></div></div>');
const bar = document.getElementById('timerBar');
let total = 0;
const origStart = window.startTimer, origStop = window.stopTimer, origAdjust = window.adjustTimer;
window.startTimer = function () { origStart(); total = targetEndTime ? lastTimerSec * 1000 : 0; };
window.stopTimer = function () { origStop(); total = 0; };
window.adjustTimer = function (d) { origAdjust(d); total = 0; };
setInterval(() => {
  bar.style.width = (targetEndTime && total) ? Math.max(0, (targetEndTime - Date.now()) / total * 100) + '%' : '0%';
  card.classList.toggle('timer-done', !!alarmInterval);
}, 200);
const origBeep = window.playSingleBeep;
window.playSingleBeep = function () { origBeep(); buzz(150); };
document.addEventListener('click', e => { if (e.target.closest('button')) buzz(10); });

/* ===== 専用テンキー（kg／回／有酸素の分。OSのキーボードは出さない） =====
   ・入力欄は readonly。タップで金枠ハイライト＋画面下にテンキー
   ・.5 は kg のときだけ有効（付与／すでに付いていれば外すトグル）
   ・完了：kg → 同じ行の回へ移動（テンキーは開いたまま）／回・分 → 閉じる ===== */
const PAD_SEL = '.weight-input, .reps-input, #cardioMinutes';
const CARDIO_MAX = 1440;
const padEl = document.createElement('div');
padEl.id = 'numpad';
padEl.setAttribute('aria-hidden', 'true');
padEl.innerHTML =
  '<button type="button" class="np-k" data-k="1">1</button>' +
  '<button type="button" class="np-k" data-k="2">2</button>' +
  '<button type="button" class="np-k" data-k="3">3</button>' +
  '<button type="button" class="np-k np-fn" data-k="back" aria-label="1文字削除">⌫</button>' +
  '<button type="button" class="np-k" data-k="4">4</button>' +
  '<button type="button" class="np-k" data-k="5">5</button>' +
  '<button type="button" class="np-k" data-k="6">6</button>' +
  '<button type="button" class="np-k np-fn" data-k="clear" aria-label="クリア">C</button>' +
  '<button type="button" class="np-k" data-k="7">7</button>' +
  '<button type="button" class="np-k" data-k="8">8</button>' +
  '<button type="button" class="np-k" data-k="9">9</button>' +
  '<button type="button" class="np-k np-fn" data-k="half">.5</button>' +
  '<button type="button" class="np-k np-w2" data-k="0">0</button>' +
  '<button type="button" class="np-k np-w2 np-ok" data-k="ok">完了</button>';
document.body.appendChild(padEl);
let padInput = null;
const padKind = el => el.id === 'cardioMinutes' ? 'min' : el.classList.contains('weight-input') ? 'kg' : 'rep';
function padLimitOk(kind, str) {
  const n = parseFloat(str);
  if (!isFinite(n)) return false;
  return kind === 'kg' ? n <= LIMITS.weight : kind === 'rep' ? n <= LIMITS.reps : n <= CARDIO_MAX;
}
function syncPad() {
  const half = padEl.querySelector('[data-k="half"]');
  half.disabled = !padInput || padKind(padInput) !== 'kg';
}
/* 下タブ(#bottomNav)は出したまま、その上にテンキーを載せる。高さを測って CSS 変数に渡す（本文の下余白に使う） */
const navEl = document.getElementById('bottomNav');
function padMetrics() {
  const st = document.documentElement.style;
  st.setProperty('--nav-h', (navEl ? navEl.offsetHeight : 0) + 'px');
  st.setProperty('--np-h', padEl.offsetHeight + 'px');
}
window.addEventListener('resize', () => { if (padInput) padMetrics(); });
function openPad(el) {
  if (padInput && padInput !== el) padInput.classList.remove('np-active');
  padInput = el;
  padMetrics();
  el.classList.add('np-active');
  padEl.classList.add('show');
  padEl.setAttribute('aria-hidden', 'false');
  document.body.classList.add('np-open');
  syncPad();
  setTimeout(() => {
    if (padInput === el && el.scrollIntoView) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, 30);
}
function closePad() {
  if (padInput) padInput.classList.remove('np-active');
  padInput = null;
  padEl.classList.remove('show');
  padEl.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('np-open');
}
function padPress(k) {
  if (!padInput || !padInput.isConnected) { closePad(); return; }
  const kind = padKind(padInput);
  let v = padInput.value;
  if (/^\d$/.test(k)) {
    if (v.indexOf('.') >= 0) return; /* .5 が付いているときは先に ⌫ で外す */
    const nx = v === '0' ? k : v + k;
    if (!padLimitOk(kind, nx)) return;
    v = nx;
  } else if (k === 'half') {
    if (kind !== 'kg') return;
    if (v.endsWith('.5')) v = v.slice(0, -2);
    else {
      const nx = (v === '' ? '0' : v) + '.5';
      if (!padLimitOk('kg', nx)) return;
      v = nx;
    }
  } else if (k === 'back') {
    v = v.endsWith('.5') ? v.slice(0, -2) : v.slice(0, -1);
  } else if (k === 'clear') {
    v = '';
  } else if (k === 'ok') {
    if (kind === 'kg') {
      const row = padInput.closest('.set-row');
      const next = row && row.querySelector('.reps-input');
      if (next) { openPad(next); return; }
    }
    closePad();
    return;
  }
  padInput.value = v;
  padInput.dispatchEvent(new Event('input', { bubbles: true }));
}
document.addEventListener('click', e => {
  const t = e.target.closest(PAD_SEL);
  if (t) { openPad(t); return; }
  const k = e.target.closest('#numpad [data-k]');
  if (k && !k.disabled) padPress(k.dataset.k);
});
/* ＋セット：テンキーが開いていれば、追加した行の kg へ移す（古い行や画面外に残さない）。開いていなければ何もしない
   ※引数なしの呼び出し＝ボタン。履歴や候補からの自動追加（引数あり）では動かさない */
const addRowCore = window.addSetRow;
window.addSetRow = function () {
  addRowCore.apply(this, arguments);
  if (arguments.length || !padInput) return;
  const rows = document.querySelectorAll('#setsContainer .set-row');
  const next = rows.length && rows[rows.length - 1].querySelector('.weight-input');
  if (next) openPad(next); else closePad();
};
const rmRowCore = window.removeSetRow;
window.removeSetRow = function (btn) {
  const row = btn && btn.closest('.set-row');
  if (row && padInput && row.contains(padInput)) closePad();
  return rmRowCore.apply(this, arguments);
};
/* 種目名など、通常のキーボードを使う欄に触れたらテンキーは閉じる */
document.addEventListener('focusin', e => {
  const t = e.target;
  if (t && t.closest && !t.closest(PAD_SEL) && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) closePad();
});

/* ===== 折れ線グラフ（金の線＝総合・赤の実線＝推定1RM）。色はテーマで変えない ===== */
let gid = 0;
function curvePath(P) {
  const f = x => x.toFixed(1);
  let d = 'M' + f(P[0][0]) + ',' + f(P[0][1]);
  for (let i = 1; i < P.length - 1; i++) {
    d += ' Q' + f(P[i][0]) + ',' + f(P[i][1]) + ' ' + f((P[i][0] + P[i + 1][0]) / 2) + ',' + f((P[i][1] + P[i + 1][1]) / 2);
  }
  return d + ' L' + f(P[P.length - 1][0]) + ',' + f(P[P.length - 1][1]);
}
function line(v, w, h, dates, rm) {
  const n = v.length;
  if (n < 2) return '';
  const big = !!dates;
  const hasRm = big && Array.isArray(rm) && rm.length === n && rm.some(x => x > 0);
  const px = big ? 22 : 5, pt = big ? 26 : 8, pb = big ? (hasRm ? 36 : 24) : 8;
  const toPts = arr => {
    const mn = Math.min(...arr), mx = Math.max(...arr), r = (mx - mn) || 1;
    return arr.map((y, i) => [px + i * (w - 2 * px) / (n - 1), h - pb - (y - mn) / r * (h - pt - pb)]);
  };
  const f = x => x.toFixed(1);
  const P = toPts(v), d = curvePath(P);
  const id = 'g' + (++gid), L = P[n - 1];
  let s = (hasRm ? '<div class="hm-leg"><span class="lg-g">総合</span><span class="lg-r">推定1RM</span></div>' : '') +
    '<svg ' + (big ? 'width="100%"' : 'width="' + w + '" height="' + h + '"') + ' viewBox="0 0 ' + w + ' ' + h + '">' +
    '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c9a96a" stop-opacity=".3"/><stop offset="1" stop-color="#c9a96a" stop-opacity="0"/></linearGradient></defs>' +
    '<path d="' + d + ' L' + f(L[0]) + ',' + (h - pb) + ' L' + f(P[0][0]) + ',' + (h - pb) + ' Z" fill="url(#' + id + ')"/>' +
    '<path class="ln" pathLength="1" d="' + d + '" fill="none" stroke="#c9a96a" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>';
  let P2 = null;
  if (hasRm) {
    P2 = toPts(rm);
    const d2 = curvePath(P2), L2 = P2[n - 1];
    s += '<path class="ln-rm" pathLength="1" d="' + d2 + '" fill="none" stroke="#d96b66" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<circle cx="' + f(L2[0]) + '" cy="' + f(L2[1]) + '" r="8" fill="#d96b66" opacity=".18"/>' +
      '<circle cx="' + f(L2[0]) + '" cy="' + f(L2[1]) + '" r="3.2" fill="#e58984"/>';
  }
  s += '<circle cx="' + f(L[0]) + '" cy="' + f(L[1]) + '" r="' + (big ? 9 : 7) + '" fill="#c9a96a" opacity=".18"/>' +
    '<circle cx="' + f(L[0]) + '" cy="' + f(L[1]) + '" r="' + (big ? 3.5 : 2.5) + '" fill="#dcc28a"/>';
  if (big) {
    s += '<line x1="' + px + '" y1="' + (h - pb + 6) + '" x2="' + (w - px) + '" y2="' + (h - pb + 6) + '" stroke="#2a2a2c"/>';
    P.forEach((q, i) => {
      const last = i === n - 1;
      s += '<text x="' + f(q[0]) + '" y="' + f(q[1] - 10) + '" text-anchor="middle" font-size="11" fill="' +
        (last ? '#ece8dd' : '#b8b2a2') + '" font-family="Barlow Condensed,sans-serif">' + v[i] + '</text>' +
        '<text x="' + f(q[0]) + '" y="' + (h - 5) + '" text-anchor="middle" font-size="11" fill="#b8b2a2" font-family="Barlow Condensed,sans-serif">' + fmtD(dates[i]) + '</text>';
      if (P2) {
        const y2 = Math.min(h - pb - 2, P2[i][1] + 15);
        s += '<text x="' + f(P2[i][0]) + '" y="' + f(y2) + '" text-anchor="middle" font-size="10.5" fill="' +
          (last ? '#f29b96' : '#d96b66') + '" font-family="Barlow Condensed,sans-serif">' + rm[i] + '</text>';
      }
    });
  }
  return s + '</svg>';
}

/* ===== 現行の推移と同じ計算式（重量あり＝Σ(重量+回数×0.1)、重量なし＝回数合計） ===== */
function metric(sets) {
  if (!sets.some(s => s.weight > 0)) return sets.reduce((a, s) => a + s.reps, 0);
  return Number(sets.reduce((a, s) => a + s.weight + s.reps * 0.1, 0).toFixed(1));
}

/* ===== 推定1RM（その日の全セット中の最大値：重量 × (1 + 回数 / 30)） ===== */
function est1RM(sets) {
  let max = 0;
  sets.forEach(s => {
    if (s.weight > 0 && s.reps > 0) {
      const v = s.weight * (1 + s.reps / 30);
      if (v > max) max = v;
    }
  });
  return Number(max.toFixed(1));
}
function series(name) {
  const map = {};
  workouts.filter(w => w.name.trim() === name).forEach(w => { (map[w.dateStr] = map[w.dateStr] || []).push(...w.setList); });
  return Object.keys(map).sort().slice(-5).map(d => ({ d, v: metric(map[d]), rm: est1RM(map[d]) }));
}

/* ===== 調子ラベル（日別推移 v の末尾で判定。同日は series() で合算済み。上から順に最初に当てはまったものを出す）
   プラトー検知！！：3回連続横ばい（n>=3 かつ a=b=c）                   plat（文字赤・枠金）
   絶好調！！　　　：2回連続で上昇（n>=3 かつ a>b>c）                   hot （金文字・金枠）
   上昇傾向　　　　：直近が上昇（a>b）                                  up  （金文字・金枠）
   停滞注意　　　　：2回横ばい（a=b。3回連続は上でプラトー）            flat（赤文字・赤枠）
   下降傾向　　　　：直近が下降（a<b）                                  down（赤文字・赤枠）
   記録なし　　　　：その種目の記録が1件もない                          none（白系・枠なし）
   記録が1回だけのときは比べる相手がないのでラベルは出さない ===== */
function trendOf(v) {
  const n = v.length;
  if (n === 0) return { cls: 'none', txt: '記録なし' };
  if (n < 2) return null;
  const a = v[n - 1], b = v[n - 2];
  if (n >= 3) {
    const c = v[n - 3];
    if (a === b && b === c) return { cls: 'plat', txt: 'プラトー検知！！' };
    if (a > b && b > c) return { cls: 'hot', txt: '絶好調！！' };
  }
  if (a > b) return { cls: 'up', txt: '上昇傾向' };
  if (a === b) return { cls: 'flat', txt: '停滞注意' };
  return { cls: 'down', txt: '下降傾向' };
}

/* ===== PR判定：今日（同日全セット合算）の metric が、昨日以前の1日単位の最高値を上回ったら true。
   過去記録がゼロ（初回）なら対象外 ===== */
function isPR(name, today) {
  const prev = {};
  workouts.filter(w => w.name.trim() === name && w.dateStr < today)
    .forEach(w => { (prev[w.dateStr] = prev[w.dateStr] || []).push(...w.setList); });
  const days = Object.keys(prev);
  if (!days.length) return false;
  const todaySets = [];
  workouts.filter(w => w.name.trim() === name && w.dateStr === today).forEach(w => todaySets.push(...w.setList));
  if (!todaySets.length) return false;
  const best = Math.max(...days.map(d => metric(prev[d])));
  return metric(todaySets) > best;
}
const fmtSet = s => (s.weight ? s.weight + 'kg × ' + s.reps + '回' : s.reps + '回');
const bestSet = sets => sets.reduce((b, s) => (!b || s.weight > b.weight || (s.weight === b.weight && s.reps > b.reps)) ? s : b, null);

/* ===== ホーム ===== */
const TYPES = ['PUSH', 'PULL', 'LEGS', 'OTHER'];
const pplOf = d => dayPplMap[d] || 'PUSH';
let override = null;
const dayList = () => [...new Set(workouts.map(w => w.dateStr))].sort();
function todayType() {
  const today = dstr(new Date());
  if (override && override.day === today) return override.type;
  const days = dayList();
  if (days.includes(today)) return pplOf(today);
  const last = days.filter(d => d < today).pop();
  return last ? TYPES[(TYPES.indexOf(pplOf(last)) + 1) % 4] : 'PUSH';
}
window.homeType = function (t) { override = { day: dstr(new Date()), type: t }; homeOpen = null; renderHome(); };

/* ===== 固定メニュー・テンプレート
   各部位に4枠（名前＋種目リスト on/off）。選択中の枠の中身を menuData（simple_menu）へ常に同期する ===== */
const SLOT_N = 4, TPL_KEY = 'simple_menu_tpl', NAME_W = 10;
let tplData = null;
/* テンプレート名：全角=2・半角=1として合計10まで（全角5文字／半角10文字） */
function fitName(s) {
  let w = 0, out = '';
  for (const ch of String(s == null ? '' : s)) {
    const c = ch.charCodeAt(0);
    const a = (c <= 0x7e || (c >= 0xff61 && c <= 0xff9f)) ? 1 : 2;
    if (w + a > NAME_W) break;
    w += a;
    out += ch;
  }
  return out;
}
function cleanList(a) {
  const out = [];
  (Array.isArray(a) ? a : []).forEach(v => {
    const n = String(v == null ? '' : v).trim();
    if (n && n.length <= LIMITS.name && !out.includes(n)) out.push(n);
  });
  return out;
}
function normMenu(m) {
  const out = {};
  TYPES.forEach(t => {
    const x = (m && m[t]) || {};
    const on = cleanList(x.on);
    out[t] = { on: on, off: cleanList(x.off).filter(n => !on.includes(n)) };
  });
  return out;
}
function normTpl(raw) {
  const out = {};
  TYPES.forEach(t => {
    const x = (raw && typeof raw === 'object' && raw[t]) || {};
    const src = Array.isArray(x.slots) ? x.slots : [];
    const slots = [];
    for (let i = 0; i < SLOT_N; i++) {
      const s = (src[i] && typeof src[i] === 'object') ? src[i] : {};
      const l = normMenu({ [t]: s })[t];
      slots.push({ name: fitName(String(s.name == null ? '' : s.name).trim()) || ('枠' + (i + 1)), on: l.on, off: l.off });
    }
    let idx = parseInt(x.idx, 10);
    if (!(idx >= 0 && idx < SLOT_N)) idx = 0;
    out[t] = { idx: idx, slots: slots };
  });
  return out;
}
const activeSlot = t => tplData[t].slots[tplData[t].idx];
function syncMenuFromTpl() {
  const m = {};
  TYPES.forEach(t => { const s = activeSlot(t); m[t] = { on: s.on.slice(), off: s.off.slice() }; });
  menuData = m;
}
function saveMenu() { return safeSave('simple_menu', menuData); }
/* テンプレートと simple_menu をまとめて保存 */
function persistTpl() {
  syncMenuFromTpl();
  const a = safeSave(TPL_KEY, tplData);
  const b = saveMenu();
  return a && b;
}
function buildFromHistory() {
  const m = normMenu(null), days = dayList();
  TYPES.forEach(t => {
    const d = days.filter(x => pplOf(x) === t).pop();
    if (d) workouts.filter(w => w.dateStr === d).forEach(w => { const n = w.name.trim(); if (!m[t].on.includes(n)) m[t].on.push(n); });
  });
  return m;
}
function ensureMenu() {
  if (tplData) return;
  const raw = loadJson(TPL_KEY, null);
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    tplData = normTpl(raw);
  } else {
    /* 旧データ（simple_menu だけ／何も無い）は各部位の1枠目へ */
    const base = menuData ? normMenu(menuData) : buildFromHistory();
    tplData = normTpl(null);
    TYPES.forEach(t => { const s = tplData[t].slots[0]; s.on = base[t].on; s.off = base[t].off; });
  }
  persistTpl();
}
window.tplExport = function () { ensureMenu(); return JSON.parse(JSON.stringify(tplData)); };
/* 復元：新形式はそのまま、旧形式（menuのみ）は各部位の1枠目へ。保存に失敗したら例外（呼び出し側で巻き戻し） */
window.tplImport = function (rawTpl, rawMenu) {
  if (rawTpl && typeof rawTpl === 'object' && !Array.isArray(rawTpl)) {
    tplData = normTpl(rawTpl);
  } else if (rawMenu && typeof rawMenu === 'object') {
    tplData = normTpl(null);
    const b = normMenu(rawMenu);
    TYPES.forEach(t => { const s = tplData[t].slots[0]; s.on = b[t].on; s.off = b[t].off; });
  } else {
    tplData = null;
    localStorage.removeItem(TPL_KEY);
    menuData = null;
    ensureMenu();
    return;
  }
  syncMenuFromTpl();
  localStorage.setItem(TPL_KEY, JSON.stringify(tplData));
  localStorage.setItem('simple_menu', JSON.stringify(menuData));
};
window.tplReload = function () { tplData = null; };
window.tplSelect = function (t, i) {
  ensureMenu();
  if (!TYPES.includes(t) || !(i >= 0 && i < SLOT_N)) return;
  const prev = tplData[t].idx;
  if (prev === i) return;
  tplData[t].idx = i;
  if (!persistTpl()) { tplData[t].idx = prev; syncMenuFromTpl(); }
  paintMenu();
};
function lastRec(name, today) {
  return workouts.filter(w => w.name.trim() === name && w.dateStr < today).sort((a, b) => (a.dateStr < b.dateStr ? -1 : 1)).pop() || null;
}

/* ===== ホーム ===== */
let homeOpen = null, homeNames = [];
/* ===== トレーニングのフォーム上部（#formHeaderContainer）をここで組み立てる
   ・日付指定（formDate）がある → 「○/○ の記録を追加（解除）」
   ・ホームの「入力」から来た → 「入力中（キャンセル）」を、日付指定の下に並べる（上書きしない）
   ・編集中 → 「編集中（キャンセル）」（日付指定は裏で保持し、編集が終わると戻る） ===== */
let homeInput = false, homeInputName = null;
function hdrRow(title, fn, label) {
  return '<div class="flex justify-between items-center mb-2.5"><h2 class="text-sm font-semibold text-orange-400 uppercase tracking-wider">' + title +
    '</h2><button type="button" onclick="' + fn + '" class="text-xs text-gray-400 hover:text-white">' + label + '</button></div>';
}
function renderFormHeader() {
  const h = document.getElementById('formHeaderContainer');
  if (!h) return;
  let html = '';
  if (editingId !== null) html = hdrRow('編集中', 'cancelEdit()', 'キャンセル');
  else {
    if (formDate) html += hdrRow(formatDate(formDate) + ' の記録を追加', 'setFormDate(null)', '解除');
    if (homeInput) html += hdrRow('入力中', 'cancelEdit()', 'キャンセル');
  }
  h.innerHTML = html;
}
function hideSuggest() {
  const box = document.getElementById('suggestionBox');
  if (box) { box.classList.add('hidden'); box.innerHTML = ''; }
}
window.setFormDate = function (ds) { formDate = ds || null; renderFormHeader(); };
/* リセット：保存（追加）のあとは日付指定も解除。キャンセル／編集の終了では日付指定を維持する */
const resetCore = window.resetForm;
window.resetForm = function (keep) {
  const keepDate = (keep === true || editingId !== null) ? formDate : null;
  resetCore();
  formDate = keepDate;
  homeInput = false;
  homeInputName = null;
  hideSuggest();
  closePad();
  renderFormHeader();
};
window.cancelEdit = function () { window.resetForm(true); };
/* 編集の開始：日付指定（formDate）は消さない */
const editCore = window.editWorkout;
window.editWorkout = function (id) {
  const keep = formDate;
  editCore.apply(this, arguments);
  formDate = keep;
  if (editingId === id) { homeInput = false; homeInputName = null; }
  hideSuggest();
  renderFormHeader();
};
/* 種目名を別の名前に書き換えたら、前回のセット内容と「入力中」の紐づきを外す。入力に合う候補は常に最新化 */
const suggestCore = window.checkExerciseSuggestion;
window.checkExerciseSuggestion = function () {
  const inp = document.getElementById('exerciseName');
  if (homeInput && inp && inp.value.trim() !== homeInputName) {
    const v = inp.value, keep = formDate;
    resetCore(); /* セット行・候補・ヘッダーを初期状態に（種目名と日付指定は戻す） */
    inp.value = v;
    formDate = keep;
    homeInput = false;
    homeInputName = null;
    renderFormHeader();
  }
  return suggestCore.apply(this, arguments);
};
window.homeFill = function (i) {
  const name = homeNames[i];
  if (name === undefined) return;
  if (editingId !== null) window.resetForm(true); /* 編集は中断（日付指定は維持） */
  switchTab('workout');
  const rec = lastRec(name, dstr(new Date()));
  if (rec) applySuggestion(rec.id);
  else { window.resetForm(true); document.getElementById('exerciseName').value = name; }
  homeInput = true;
  homeInputName = name;
  hideSuggest();
  renderFormHeader();
};
function renderHome() {
  const el = document.getElementById('tabContentHome');
  if (!el) return;
  ensureMenu();
  const today = dstr(new Date()), type = todayType();
  const days = dayList(), last = days.filter(d => d < today).pop();
  const yday = dstr(new Date(Date.now() - 864e5));
  const sub = days.includes(today) ? '今日は ' + pplOf(today) + ' を記録中'
    : last ? (last === yday ? '昨日' : '前回') + 'は ' + pplOf(last) + '（' + fmtD(last) + '）' : 'まだ記録がありません';
  const chips = TYPES.map(t => '<button type="button" class="' + (t === type ? 'cur' : '') + '" onclick="homeType(\'' + t + '\')">' + t + '</button>').join('');
  let h = '<div class="hm-card"><div class="hm-pad"><div class="hm-lb">今日のおすすめ</div><div class="hm-big">' + type +
    '</div><div class="hm-sub">' + sub + '</div><div class="hm-ord">' + chips + '</div></div></div>';
  const names = menuData[type].on;
  homeNames = names;
  if (!names.length) {
    el.innerHTML = h + '<div class="hm-card"><div class="hm-pad hm-sub">' + type + ' のメニューが空です。「月間/設定」の「種目の編集」から追加できます。</div></div>';
    return;
  }
  const todays = workouts.filter(w => w.dateStr === today);
  const doneN = names.filter(n => todays.some(t => t.name.trim() === n)).length;
  const allDone = doneN === names.length;
  /* 全完了のときは右上のバッジを出さず、代わりに画面中央のスタンプ（#homeStamp）を出す */
  h += '<div class="hm-card"><div class="hm-pad" style="padding-bottom:12px"><div class="hm-exh"><div class="hm-lb">今日のメニュー</div><div class="hm-lb hm-gold">' +
    doneN + ' / ' + names.length + ' 完了</div></div><div class="hm-prog"><div style="width:' +
    Math.round(doneN / names.length * 100) + '%"></div></div></div>';
  names.forEach((n, i) => {
    const t = todays.find(x => x.name.trim() === n);
    const rec = t || lastRec(n, today);
    const b = rec ? bestSet(rec.setList) : null;
    const s = series(n);
    const open = homeOpen === n;
    const pr = !!t && isPR(n, today);
    const tr = trendOf(s.map(x => x.v));
    h += '<div class="hm-ex' + (open ? ' open' : '') + '" data-i="' + i + '"><div class="hm-exh"><div class="hm-row2"><span class="hm-chk' + (t ? ' f' : '') + '"></span><div class="hm-en' + (t ? ' dn' : '') + '">' +
      escapeHtml(n) + '</div>' + (pr ? '<span class="hm-pr">PR達成！！</span>' : '') + '</div><div class="hm-act">' + (t ? '' : '<button type="button" class="hm-in" onclick="homeFill(' + i + ')">入力</button>') +
      '<span class="hm-chev"></span></div></div><div class="hm-mini"><div class="hm-st">' +
      (b ? (t ? '今日 ' : '前回 ') + fmtSet(b) : '') +
      (tr ? (tr.cls === 'plat' && open
        ? '<span class="hm-trw"><span class="hm-tr plat">' + tr.txt + '</span><span class="hm-tip">レスト+1分or重量-10%</span></span>'
        : '<span class="hm-tr ' + tr.cls + '">' + tr.txt + '</span>') : '') + '</div>' +
      (open || s.length < 2 ? '' : '<div class="hm-ch">' + line(s.map(x => x.v), 110, 34) + '</div>') +
      '</div>' +
      (open ? '<div class="hm-big2">' + (s.length > 1 ? line(s.map(x => x.v), 320, 138, s.map(x => x.d), s.map(x => x.rm)) : '<div class="hm-sub">2回以上の記録でグラフが出ます。</div>') +
        '</div>' : '') +
      '</div>';
  });
  el.innerHTML = h + '</div>' + (allDone ? '<div id="homeStamp" aria-hidden="true">COMPLETE!!</div>' : '');
}
document.addEventListener('click', e => {
  const r = e.target.closest('.hm-ex');
  if (!r || e.target.closest('.hm-in')) return;
  const n = homeNames[parseInt(r.dataset.i, 10)];
  if (n === undefined) return;
  homeOpen = homeOpen === n ? null : n; renderHome(); });

/* ===== 種目の編集（画面全体。保存まで確定しない。戻る操作＝キャンセル）
   各部位で「現在オンの枠」を開く。種目リストとテンプレート名をまとめて保存 ===== */
let draft = null, editType = 'PUSH', pastCache = [];
function renderEditor() {
  const o = document.getElementById('menuEditor');
  if (!o || !draft) return;
  const keep = (document.getElementById('meInput') || {}).value || '';
  const m = draft[editType];
  const seen = new Set();
  pastCache = [];
  [...workouts].sort((a, b) => (a.dateStr < b.dateStr ? 1 : -1)).forEach(w => {
    const n = w.name.trim();
    if (seen.has(n)) return;
    seen.add(n);
    if (!m.on.includes(n) && !m.off.includes(n)) pastCache.push(n);
  });
  pastCache = pastCache.slice(0, 12);
  const tabs = TYPES.map(t => '<button type="button" data-act="type" data-t="' + t + '" class="' + (t === editType ? 'cur' : '') + '">' + t + '</button>').join('');
  const rows = m.on.map((n, i) => '<div class="me-row"><div class="me-name">' + escapeHtml(n) + '</div><div class="me-ops">' +
    '<button type="button" data-act="up" data-i="' + i + '"' + (i === 0 ? ' disabled' : '') + '>▲</button>' +
    '<button type="button" data-act="down" data-i="' + i + '"' + (i === m.on.length - 1 ? ' disabled' : '') + '>▼</button>' +
    '<button type="button" data-act="hide" data-i="' + i + '" class="me-del">非表示</button></div></div>').join('') || '<div class="hm-sub me-pad">種目がありません。</div>';
  const offs = m.off.map((n, i) => '<div class="me-row"><div class="me-name dn">' + escapeHtml(n) + '</div><div class="me-ops"><button type="button" data-act="restore" data-i="' + i + '">戻す</button></div></div>').join('');
  const past = pastCache.map((n, i) => '<button type="button" class="me-chip" data-act="addpast" data-i="' + i + '">' + escapeHtml(n) + '</button>').join('');
  o.innerHTML = '<div class="me-head"><div class="hm-lb">種目の編集</div><div class="me-tabs">' + tabs + '</div></div><div class="me-body">' +
    '<div class="me-sec">テンプレート名（全角5文字まで）</div><div class="me-add"><input type="text" id="meName" placeholder="枠の名前" autocomplete="off" value="' +
    escapeHtml(m.name) + '"></div>' +
    '<div class="me-sec">メニュー（上から順に表示）</div>' + rows +
    '<div class="me-sec">種目を追加</div><div class="me-add"><input type="text" id="meInput" placeholder="種目名を入力" autocomplete="off" value="' + escapeHtml(keep) +
    '"><button type="button" data-act="add">追加</button></div>' +
    (past ? '<div class="me-chips">' + past + '</div>' : '') +
    (offs ? '<div class="me-sec">非表示の種目</div>' + offs : '') +
    '</div><div class="me-foot"><button type="button" data-act="cancel">キャンセル</button><button type="button" data-act="save" class="primary">保存</button></div>';
}
function addName(raw) {
  const n = String(raw || '').trim(), m = draft[editType];
  if (!n) return;
  if (n.length > LIMITS.name) { window.alert('種目名は' + LIMITS.name + '文字以内で入力してください'); return; }
  if (m.on.includes(n)) { window.alert('すでにメニューにあります'); return; }
  const k = m.off.indexOf(n);
  if (k >= 0) m.off.splice(k, 1);
  m.on.push(n);
}
function closeEditor() {
  const o = document.getElementById('menuEditor');
  if (o) o.remove();
  draft = null;
}
function leaveEditor() {
  if (history.state && history.state.me) history.back(); else closeEditor();
}
window.addEventListener('popstate', closeEditor);
/* テンプレート名の入力：変換中は触らず、確定したら文字数を超えた分を切って下書きへ */
function onEditorInput(e) {
  if (!draft || !e.target || e.target.id !== 'meName' || e.isComposing) return;
  const v = fitName(e.target.value);
  if (v !== e.target.value) e.target.value = v;
  draft[editType].name = v;
}
function onEditorClick(e) {
  const b = e.target.closest('button');
  if (!b || !draft) return;
  const act = b.dataset.act, m = draft[editType], i = parseInt(b.dataset.i, 10);
  if (act === 'cancel') { leaveEditor(); return; }
  if (act === 'save') {
    const prevTpl = JSON.stringify(tplData);
    TYPES.forEach(t => {
      const s = activeSlot(t), d = draft[t];
      s.name = fitName(String(d.name || '').trim()) || ('枠' + (tplData[t].idx + 1));
      const l = normMenu({ [t]: d })[t];
      s.on = l.on;
      s.off = l.off;
    });
    if (!persistTpl()) { tplData = JSON.parse(prevTpl); syncMenuFromTpl(); return; }
    leaveEditor();
    paintMenu();
    window.alert('メニューを保存しました', 0, 'ok');
    return;
  }
  if (act === 'type') editType = b.dataset.t;
  else if (act === 'up' && i > 0) { const t = m.on[i - 1]; m.on[i - 1] = m.on[i]; m.on[i] = t; }
  else if (act === 'down' && i < m.on.length - 1) { const t = m.on[i + 1]; m.on[i + 1] = m.on[i]; m.on[i] = t; }
  else if (act === 'hide') m.off.push(m.on.splice(i, 1)[0]);
  else if (act === 'restore') m.on.push(m.off.splice(i, 1)[0]);
  else if (act === 'addpast') addName(pastCache[i]);
  else if (act === 'add') { const inp = document.getElementById('meInput'); addName(inp.value); inp.value = ''; }
  renderEditor();
}
window.openMenuEditor = function () {
  closePad();
  ensureMenu();
  draft = {};
  TYPES.forEach(t => { const s = activeSlot(t); draft[t] = { name: s.name, on: s.on.slice(), off: s.off.slice() }; });
  editType = 'PUSH';
  const o = document.createElement('div');
  o.id = 'menuEditor';
  o.addEventListener('click', onEditorClick);
  o.addEventListener('input', onEditorInput);
  o.addEventListener('compositionend', onEditorInput);
  document.body.appendChild(o);
  history.pushState({ me: 1 }, '');
  renderEditor();
};
/* 「月間/設定」タブ：各部位の4枠ボタン（オン＝ゴールド塗り、オフ＝金枠）。タップで即切り替え */
function renderMenuSummary() {
  const el = document.getElementById('menuSummary');
  if (!el) return;
  ensureMenu();
  el.innerHTML = TYPES.map(t => '<div class="ms-row"><span class="ms-t">' + t + '</span><div class="ms-slots">' +
    tplData[t].slots.map((s, i) => '<button type="button" class="ms-slot' + (i === tplData[t].idx ? ' on' : '') + '" onclick="tplSelect(\'' + t + '\',' + i + ')">' + escapeHtml(s.name) +
      '</button>').join('') +
    '</div></div>').join('');
}

/* ===== カレンダー（月間/設定タブの一番上） ===== */
let cal = (() => { const n = new Date(); return { y: n.getFullYear(), m: n.getMonth() }; })();
window.calShift = function (d) {
  const n = new Date(), t = cal.y * 12 + cal.m + d;
  if (t > n.getFullYear() * 12 + n.getMonth()) return;
  cal = { y: Math.floor(t / 12), m: t % 12 };
  renderCalendar();
};
function renderCalendar() {
  const el = document.getElementById('calendarCard');
  if (!el) return;
  const tDays = new Set(workouts.map(w => w.dateStr)), cDays = new Set(cardios.map(c => c.dateStr));
  const n = new Date(), today = dstr(n);
  const first = new Date(cal.y, cal.m, 1).getDay(), len = new Date(cal.y, cal.m + 1, 0).getDate();
  const atCur = cal.y * 12 + cal.m >= n.getFullYear() * 12 + n.getMonth();
  let g = '日月火水木金土'.split('').map(w => '<div class="cal-w">' + w + '</div>').join('') +
    '<div></div>'.repeat(first);
  for (let d = 1; d <= len; d++) {
    const s = cal.y + '-' + pad(cal.m + 1) + '-' + pad(d);
    g += '<div class="cal-d' + (s === today ? ' today' : '') + '" data-d="' + s + '" role="button"><span>' + d + '</span><span class="cal-m">' +
      (tDays.has(s) ? '<i class="cal-dot"></i>' : '') + (cDays.has(s) ? '<i class="cal-ring"></i>' : '') +
      '</span></div>';
  }
  el.innerHTML = '<div class="cal-head"><button type="button" onclick="calShift(-1)">‹</button><div class="cal-title">' + cal.y + '年' + (cal.m + 1) +
    '月</div><button type="button" onclick="calShift(1)"' + (atCur ? ' disabled' : '') + '>›</button></div><div class="cal-grid">' + g +
    '</div><div class="cal-legend"><span><i class="cal-dot"></i>トレーニング</span><span><i class="cal-ring"></i>有酸素</span></div>';
}

/* ===== 日付タップ：ボトムシート
   上＝日付＋PUSH/PULL/LEGS/OTHER、中＝トレ種目アコーディオン、下＝有酸素、最下部＝追加ボタン（未来日なし）
   閉じる：背景タップ／✕／ブラウザの戻る ===== */
let sheetEl = null, sheetDate = null;
function sheetHtml(d) {
  const today = dstr(new Date());
  const items = workouts.filter(w => w.dateStr === d);
  const cs = cardios.filter(c => c.dateStr === d);
  const cur = pplOf(d);
  const opts = TYPES.map(t => '<option value="' + t + '"' + (t === cur ? ' selected' : '') + '>' + t + '</option>').join('');
  let h = '<div class="sh-head"><span class="text-sm font-bold text-orange-400">' + fmtD(d) + '</span>' +
    '<select onchange="updateDayPpl(\'' + d + '\', this)" class="text-xs bg-gray-900 border border-gray-700 text-gray-200 font-bold rounded-lg px-2 py-1 focus:outline-none focus:border-orange-500">' + opts + '</select>' +
    '<button type="button" class="sh-x" data-sh="close" aria-label="閉じる">✕</button></div><div class="sh-body">';
  h += '<div class="sh-sec">トレーニング</div>';
  if (items.length) {
    h += '<div class="space-y-2">' + items.map(item => {
      const sets = item.setList.map((s, i) => '<div class="text-xs text-gray-300 font-semibold flex items-center gap-2"><span class="text-gray-500 w-4">' + (i + 1) +
        '.</span><span class="text-white">' + s.weight + ' kg</span> × <span class="text-white">' + s.reps + ' 回</span></div>').join('');
      return '<div class="bg-gray-900 border border-gray-700 rounded-xl p-3" data-id="' + item.id + '">' +
        '<div class="flex justify-between items-center cursor-pointer select-none" onclick="toggleExerciseAccordion(this)">' +
        '<div class="flex items-center gap-2"><span class="text-sm font-bold text-white">' + escapeHtml(item.name) + '</span><span class="text-xs text-gray-500">(' + item.setList.length + 'セット)</span></div>' +
        '<div class="flex items-center gap-2"><span class="text-xs text-gray-400 ex-toggle-icon">▼</span>' +
        '<button type="button" onclick="event.stopPropagation(); sheetEdit(\'' + item.id + '\')" class="text-xs text-gray-400 hover:text-white px-2 py-1 bg-gray-800 border border-gray-700 rounded-lg font-medium">編集</button>' +
        '<button type="button" onclick="event.stopPropagation(); deleteWorkout(\'' + item.id + '\')" class="text-gray-500 hover:text-red-400 p-1">✕</button></div></div>' +
        '<div class="ex-content hidden mt-2 pt-2 border-t border-gray-800 space-y-1">' + sets + '</div></div>';
    }).join('') + '</div>';
  } else {
    h += '<div class="hm-sub">記録なし</div>';
  }
  h += '<div class="sh-sec">有酸素</div>';
  if (cs.length) {
    h += '<div class="space-y-2">' + cs.map(c => '<div class="flex justify-between items-center bg-gray-900 border border-gray-700 rounded-xl p-3"><span class="text-xs text-white">' +
      c.minutes + '分 / 約' + Math.round(c.minutes * 3.5) + 'kcal</span><button type="button" onclick="deleteCardio(\'' + c.id + '\')" class="text-gray-500 hover:text-red-400 p-1">✕</button></div>').join('') + '</div>';
  } else {
    h += '<div class="hm-sub">記録なし</div>';
  }
  h += '</div>';
  if (d <= today) {
    h += '<div class="sh-foot"><button type="button" data-sh="addw">この日にトレを追加</button><button type="button" data-sh="addc">この日に有酸素を追加</button></div>';
  }
  return h;
}
function renderSheet() {
  if (!sheetEl || !sheetDate) return;
  const box = sheetEl.firstElementChild;
  const openIds = [...box.querySelectorAll('.ex-content:not(.hidden)')].map(e => e.closest('[data-id]').dataset.id);
  const oldBody = box.querySelector('.sh-body');
  const top = oldBody ? oldBody.scrollTop : 0;
  box.innerHTML = sheetHtml(sheetDate);
  openIds.forEach(id => {
    const c = box.querySelector('[data-id="' + id + '"]');
    if (!c) return;
    c.querySelector('.ex-content').classList.remove('hidden');
    c.querySelector('.ex-toggle-icon').classList.add('is-open');
  });
  const nb = box.querySelector('.sh-body');
  if (nb) nb.scrollTop = top;
}
function removeSheet() {
  if (sheetEl) sheetEl.remove();
  sheetEl = null;
  sheetDate = null;
}
function closeSheet() {
  if (!sheetEl) return;
  if (history.state && history.state.sheet) history.back(); else removeSheet();
}
window.addEventListener('popstate', removeSheet);
function openSheet(d) {
  if (sheetEl) return;
  closePad();
  sheetDate = d;
  sheetEl = document.createElement('div');
  sheetEl.id = 'daySheet';
  sheetEl.innerHTML = '<div class="sheet-box"></div>';
  sheetEl.addEventListener('click', e => {
    if (e.target === sheetEl) { closeSheet(); return; }
    const b = e.target.closest('[data-sh]');
    if (!b) return;
    const day = sheetDate, a = b.dataset.sh;
    if (a === 'close') closeSheet();
    else if (a === 'addw') { closeSheet(); switchTab('workout'); if (editingId !== null) resetForm(); setFormDate(day); }
    else if (a === 'addc') { closeSheet(); switchTab('cardio'); setCardioDate(day); }
  });
  document.body.appendChild(sheetEl);
  history.pushState({ sheet: 1 }, '');
  renderSheet();
}
/* 編集：シートを閉じてトレーニングタブの編集状態へ */
window.sheetEdit = function (id) {
  closeSheet();
  switchTab('workout');
  editWorkout(id);
};
document.addEventListener('click', e => {
  const c = e.target.closest('.cal-d[data-d]');
  if (c) openSheet(c.dataset.d);
});

/* ===== 保存（1か所に集約）
   core（index.html の saveWorkout）→ 部位の記録／新種目の追加 → 画面更新1回 → 振動・通知・連打ロック の順
   保存後はフォーカスを当てない（キーボード・テンキーとも勝手に開かない） ===== */
const saveCore = window.saveWorkout;
window.saveWorkout = function () {
  const btn = document.getElementById('saveBtn');
  if (btn && btn.disabled) return;
  const today = dstr(new Date());
  const day = (editingId === null && formDate) || today; /* 「この日にトレを追加」の日付 */
  const type = day === today ? todayType() : pplOf(day);
  const name = document.getElementById('exerciseName').value.trim();
  const before = localStorage.getItem('simple_workouts');
  let saved = false;
  batch(() => {
    saveCore.apply(this, arguments); /* 検証・保存・フォームのリセット（描画はためられる） */
    saved = localStorage.getItem('simple_workouts') !== before;
    if (!saved) return;
    if (dayPplMap[day] === undefined && workouts.some(w => w.dateStr === day)) {
      dayPplMap[day] = type;
      if (!safeSave('simple_day_ppl', dayPplMap)) delete dayPplMap[day];
    }
    ensureMenu();
    const s = activeSlot(dayPplMap[day] || type);
    if (name && workouts.some(w => w.dateStr === day && w.name.trim() === name) && !s.on.includes(name) && !s.off.includes(name)) {
      s.on.push(name);
      persistTpl();
    }
  }); /* ← ここで必要な画面を1回ずつ描く */
  if (saved) {
    closePad();
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    savedFeedback(btn);
  }
};
const saveCardioCore = window.saveCardio;
window.saveCardio = function () {
  const btn = document.querySelector('button[onclick="saveCardio()"]');
  if (btn && btn.disabled) return;
  const before = localStorage.getItem('simple_cardios');
  saveCardioCore.apply(this, arguments);
  if (localStorage.getItem('simple_cardios') !== before) {
    closePad();
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    savedFeedback(btn);
  }
};

/* ===== 下タブ ===== */
const TABS = { home: 'tabContentHome', workout: 'tabContentWorkout', cardio: 'tabContentCardio', settings: 'tabContentSettings' };
window.switchTab = function (name) {
  if (alarmInterval) stopTimer();
  closePad(); /* 下タブが前面にあっても、移動先にテンキーを残さない */
  if (name !== 'workout') closeHistory(); /* 別ページへ移動したら履歴の種目一覧・セット内訳・グラフを閉じる */
  /* 画面を切り替えたら、履歴の表示件数は5件に戻す */
  if (visibleDaysCount !== 5 || visibleCardioDaysCount !== 5) {
    visibleDaysCount = 5;
    visibleCardioDaysCount = 5;
    renderWorkouts();
    renderCardios();
  }
  Object.keys(TABS).forEach(k =>
    document.getElementById(TABS[k]).classList.toggle('hidden', k !== name));
  document.querySelectorAll('#bottomNav button').forEach(b => b.classList.toggle('on', b.dataset.t === name));
  /* 見えていなかった画面は、開くときに最新の内容で描く */
  if (name === 'home') renderHome();
  if (name === 'settings') { updateSummary(); renderCalendar(); renderMenuSummary(); }
  window.scrollTo(0, 0);
};

/* 起動：保存済みのテーマを適用し、履歴と有酸素を1回ずつ描き、ホームはタブ表示のときに1回描く */
applyTheme(getTheme());
rInner();
cInner();
updateSummary();
switchTab('home');
if (storageWarn) window.alert('保存データの一部を読み込めませんでした。バックアップから復元してください。', 7000);
})();
