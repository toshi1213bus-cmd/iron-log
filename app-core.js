
/* =====================================================================
   index.html のスクリプト：データ・保存・フォーム・履歴リスト・バックアップ
   （ホーム／カレンダー／日付シート／メニュー編集／テンキー／テーマ／タブの画面は extras.js）

   ■ データの流れ（どこで変わり、どこで描かれるか）
     1. 操作（onclick など）→ 下の「操作（アクション）」の関数
        saveWorkout / saveCardio / deleteWorkout / deleteCardio / updateDayPpl / importFromJsonText
        （メニューの変更は extras.js の tplSelect・メニュー編集の保存。どちらも同じ transact を通る）
        PR更新の判定・演出（金色モーダル＋バイブ）は extras.js の prSnap / prCheck / showPRModal を saveWorkout から呼ぶ
     2. 記録・有酸素・部位・メニューの変更は必ず transact() を通す。
        メモリと保存領域をまとめて退避 → 変更 → 保存し、失敗・例外のときは両方を元へ戻して false を返す
     3. 画面の更新は requestRender(scope) だけ（実体は extras.js の paint）。1つの操作につき1回だけ呼ぶ
        scope … 'w'：トレ記録・部位 ／ 'c'：有酸素 ／ 'menu'：メニュー ／ 'all'：すべて
   ===================================================================== */
const ID_RE = /^[A-Za-z0-9._-]{1,40}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PPL_TYPES = ['PUSH', 'PULL', 'LEGS', 'OTHER'];
/* 入力上限（入力画面・復元・メニュー編集で共通） */
const LIMITS = { name: 60, weight: 1000, reps: 999 };
const KCAL_PER_MIN = 3.5; /* 有酸素1分あたりの消費カロリー係数（kcal/分）。集計・表示はすべてこれを使う */
/* 履歴の表示件数（＋ / −）
   トレーニング履歴：1回のタップで4件ずつ。初期・下限は4件（PAGE_STEP）
   有酸素履歴：従来どおり5件ずつ（CARDIO_PAGE_STEP） */
const PAGE_STEP = 4;
const CARDIO_PAGE_STEP = 5;
const LOCK_MS = 700;
/* バックアップJSONの版番号と運用ポリシー
   ・項目の追加は「任意項目（無いデータでも読み込める形）」で行い、版番号は上げない
   ・版番号を上げるのは、既存項目の意味や型を変える／必須項目を増やすなど、古い版では正しく読めなくなる変更の時だけ
   ・読み込み側は知らない項目を無視し、自分より新しい版のデータは受け付けない（現在の実装のまま） */
const BACKUP_VERSION = 1;
let storageWarn = false;

/* ===================== 共通ユーティリティ ===================== */
/* 要素の取得（無ければ null。呼び出し側で null を確認して安全にスキップする） */
const byId = id => document.getElementById(id);
const pad2 = n => String(n).padStart(2, '0');
const toDateStr = d => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
const todayStr = () => toDateStr(new Date());
const buzz = ms => { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) {} };
function formatDate(dateStr) {
  const parts = dateStr.split('-');
  return `${parseInt(parts[1])}/${parseInt(parts[2])}`;
}
function escapeHtml(str) {
  return str.replace(/[&<>'"]/g, t => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[t] || t));
}
function blurActive() {
  const a = document.activeElement;
  if (a && a !== document.body && a.blur) a.blur();
}
/* テンキー（extras.js）の操作窓口。extras.js が読み込まれていなくても止まらない */
const padClose = () => { if (window.Numpad) window.Numpad.close(); };

/* ===================== 保存領域（localStorage） ===================== */
/* 保存データの読み込み：壊れていても起動できる（壊れた中身は「キー名_broken」に退避） */
function loadJson(key, fallback) {
  const raw = localStorage.getItem(key);
  if (raw === null) return fallback;
  try {
    const v = JSON.parse(raw);
    return v === null ? fallback : v;
  } catch (e) {
    storageWarn = true;
    try { localStorage.setItem(key + '_broken', raw); } catch (e2) {}
    return fallback;
  }
}
/* 書き込み。通知は出さず、成否だけ返す（通知は transact がまとめて1回出す） */
function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    return false;
  }
}
/* 保存領域の生の値の退避／復元。読めなかったときは undefined（復元しない） */
function readRaw(key) {
  try { return localStorage.getItem(key); } catch (e) { return undefined; }
}
function restoreRaw(key, raw) {
  if (raw === undefined) return;
  try {
    if (raw === null) localStorage.removeItem(key);
    else localStorage.setItem(key, raw);
  } catch (e) {}
}

/* ===================== 値の検証 ===================== */
/* IDは英数字のみ、日付は実在するYYYY-MM-DD、数値は上限内 */
function cleanId(v) {
  const s = String(v == null ? '' : v);
  return ID_RE.test(s) ? s : String(Date.now()) + String(Math.floor(Math.random() * 1e6));
}
function isRealDate(v) {
  const s = String(v == null ? '' : v);
  if (!DATE_RE.test(s)) return false;
  const p = s.split('-').map(Number);
  const d = new Date(p[0], p[1] - 1, p[2]);
  return d.getFullYear() === p[0] && d.getMonth() === p[1] - 1 && d.getDate() === p[2];
}
function isValidSet(w, r) {
  return isFinite(w) && w >= 0 && w <= LIMITS.weight &&
    Number.isInteger(r) && r >= 1 && r <= LIMITS.reps;
}
function cleanNum(v, int) {
  const n = Number(v);
  if (!isFinite(n) || n < 0) return 0;
  return int ? Math.round(n) : n;
}
function sanitizeDayPpl(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  Object.keys(raw).forEach(k => {
    if (isRealDate(k) && PPL_TYPES.includes(raw[k])) out[k] = raw[k];
  });
  return out;
}
/* 目標（{ 種目名: 目標kg }）の検証：名前と数値の範囲が正しいものだけ通す */
function sanitizeGoals(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  Object.keys(raw).forEach(k => {
    const name = String(k).trim().slice(0, LIMITS.name);
    const v = typeof raw[k] === 'number' ? raw[k] : parseFloat(raw[k]);
    if (name && isFinite(v) && v > 0 && v <= LIMITS.weight) out[name] = Math.round(v * 10) / 10;
  });
  return out;
}

/* 数値化の正：文字列・数値どちらでも受け、数値にできない値は null。身体設定の保存側（extras）と検証側で共用する */
function numVal(v) { const n = typeof v === 'number' ? v : parseFloat(v); return isFinite(n) ? n : null; }

/* 身体設定の検証：使える項目だけを残す（未入力の項目は省く） */
function sanitizeBody(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const num = numVal;
  const h = num(raw.heightCm); if (h !== null && h >= 100 && h <= 230) out.heightCm = Math.round(h);
  const a = num(raw.age); if (a !== null && a >= 10 && a <= 100) out.age = Math.round(a);
  if (raw.sex === 'm' || raw.sex === 'f') out.sex = raw.sex;
  if (raw.goal === 'cut' || raw.goal === 'bulk' || raw.goal === 'recomp') out.goal = raw.goal;
  if (raw.life === 'low' || raw.life === 'mid' || raw.life === 'high') out.life = raw.life;
  const t = num(raw.targetKg); if (t !== null && t >= 30 && t <= 300) out.targetKg = Math.round(t * 10) / 10;
  const k = num(raw.kcalManual); if (k !== null && k >= 800 && k <= 6000) out.kcalManual = Math.round(k);
  const adj = num(raw.adjKcal); if (adj !== null && adj !== 0 && adj >= -600 && adj <= 600) out.adjKcal = Math.round(adj);
  if (isRealDate(raw.adjDate)) out.adjDate = String(raw.adjDate);
  return out;
}
/* 体重ログの検証：日付と体重が正しいものだけ。同日は後のものを優先し、日付順に並べる */
function sanitizeWeightLog(raw) {
  if (!Array.isArray(raw)) return [];
  const map = new Map();
  raw.forEach(x => {
    if (!x || typeof x !== 'object' || !isRealDate(x.d)) return;
    const kg = typeof x.kg === 'number' ? x.kg : parseFloat(x.kg);
    if (!isFinite(kg) || kg < 30 || kg > 300) return;
    map.set(String(x.d), { d: String(x.d), kg: Math.round(kg * 10) / 10 });
  });
  return Array.from(map.values()).sort((a, b) => a.d < b.d ? -1 : a.d > b.d ? 1 : 0);
}
/* 不正な記録は取り込まず、stat.skipped に件数を数える */
function sanitizeWorkouts(rawWorkouts, stat) {
  if (!Array.isArray(rawWorkouts)) return [];
  const uniqueMap = new Map();
  rawWorkouts.forEach(item => {
    const bad = () => { if (stat) stat.skipped++; };
    if (!item || typeof item !== 'object') return bad();
    if (!isRealDate(item.dateStr)) return bad();
    const name = String(item.name == null ? '' : item.name).trim() || '不明な種目';
    if (name.length > LIMITS.name) return bad();
    const rawSets = Array.isArray(item.setList) ? item.setList : [];
    const setList = [];
    for (const s of rawSets) {
      if (!s || typeof s !== 'object') return bad();
      const w = Number(s.weight), r = Math.round(Number(s.reps));
      if (!isValidSet(w, r)) return bad();
      setList.push({ weight: w, reps: r });
    }
    if (setList.length === 0) return bad();
    const id = cleanId(item.id);
    uniqueMap.set(id, { id: id, name: name, dateStr: String(item.dateStr), setList: setList });
  });
  return Array.from(uniqueMap.values());
}
function sanitizeCardios(rawCardios, stat) {
  if (!Array.isArray(rawCardios)) return [];
  const uniqueMap = new Map();
  rawCardios.forEach(item => {
    if (!item || typeof item !== 'object' || !isRealDate(item.dateStr)) {
      if (stat) stat.skipped++;
      return;
    }
    const id = cleanId(item.id);
    uniqueMap.set(id, { id: id, minutes: cleanNum(item.minutes, true), dateStr: String(item.dateStr) });
  });
  return Array.from(uniqueMap.values());
}
/* HIIT実施日（simple_hiit_days：{ d: 日付, name: プリセット名 } の配列）の検証。
   分数・kcalは保存しない。旧形式（日付文字列だけ）の要素は name 空で取り込む */
/* HIITの設定（運動w秒/休憩r秒/n周）の検証。そろっていなければ null（設定なしの記録として扱う） */
function hiitCfgOf(x) {
  if (!x || typeof x !== 'object') return null;
  const w = Math.floor(Number(x.w)), r = Math.floor(Number(x.r)), n = Math.floor(Number(x.n));
  if (!(w >= 1 && w <= 3600 && r >= 0 && r <= 3600 && n >= 1 && n <= 99)) return null;
  return { w: w, r: r, n: n };
}
/* セットの時間（秒）。準備10秒は含まない。設定がなければ null */
function hiitSeconds(e) {
  const c = hiitCfgOf(e);
  return c ? c.n * c.w + (c.n - 1) * c.r : null;
}
function sanitizeHiitDays(raw, stat) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  raw.forEach(x => {
    const d = typeof x === 'string' ? x : (x && typeof x === 'object' ? x.d : null);
    if (typeof d !== 'string' || !isRealDate(d)) { if (stat) stat.skipped++; return; }
    let name = '';
    if (x && typeof x === 'object' && typeof x.name === 'string') name = x.name.trim().slice(0, 20);
    const ent = { d: d, name: name };
    const cfg = hiitCfgOf(x);
    if (cfg) { ent.w = cfg.w; ent.r = cfg.r; ent.n = cfg.n; }
    out.push(ent); /* 同じ日に複数回やることもあるので、日付でまとめない（並びは日付順・同日は記録順） */
  });
  return out.sort((a, b) => a.d < b.d ? -1 : a.d > b.d ? 1 : 0);
}
/* 起動時の読み込み：除外があれば元の中身を「キー名_broken」に退避して警告 */
function loadChecked(key, sanitizer) {
  const raw = loadJson(key, []);
  const stat = { skipped: 0 };
  const out = sanitizer(raw, stat);
  if (stat.skipped > 0) {
    storageWarn = true;
    try { localStorage.setItem(key + '_broken', JSON.stringify(raw)); } catch (e) {}
  }
  return out;
}

/* ===================== 状態 ===================== */
/* ■ 保存されるデータ（変更は transact() だけ） */
let workouts = loadChecked('simple_workouts', sanitizeWorkouts);
let cardios = loadChecked('simple_cardios', sanitizeCardios);
let hiitDays = loadChecked('simple_hiit_days', sanitizeHiitDays);
let dayPplMap = sanitizeDayPpl(loadJson('simple_day_ppl', {}));
let menuData = loadJson('simple_menu', null); /* 固定メニュー。選択中の枠から extras.js が同期する */
/* ■ 画面の状態（保存しない。変更は下の「フォーム」「履歴の件数」の関数だけ） */
let editingId = null;       /* 編集中の記録ID */
let formDate = null;        /* 「この日にトレを追加」で指定された記録日（null＝今日） */
let cardioDate = null;      /* 「この日に有酸素を追加」で指定された記録日（null＝今日） */
let homeInput = false;      /* ホームの「入力」／サジェストから来た「入力中」 */
let homeInputName = null;
let warmupMode = false;     /* 「アップ」入力中（保存ボタンは無効。記録としては保存しない）。切り替えは setWarmup だけが行う */
let visibleDaysCount = PAGE_STEP;
let visibleCardioDaysCount = CARDIO_PAGE_STEP;
/* ■ タイマー（再読み込みで0に戻る。localStorageには保存しない） */
let timerInterval = null;
let alarmInterval = null;
let targetEndTime = null;
let sharedAudioCtx = null;
let lastTimerSec = 0;
const TIMER_MAX_SEC = 99 * 60;

const pplOf = d => dayPplMap[d] || 'PUSH';

/* ===================== 保存の窓口（transact） =====================
   parts … 変更しうるデータの名前。保存先のキーとメモリ上の変数を1組にしたもの
   menu（simple_menu_tpl と simple_menu のセット）は extras.js が登録する */
const PARTS = {
  workouts: { keys: ['simple_workouts'], get: () => workouts, set: v => { workouts = v; }, save: () => writeJson('simple_workouts', workouts) },
  cardios: { keys: ['simple_cardios'], get: () => cardios, set: v => { cardios = v; }, save: () => writeJson('simple_cardios', cardios) },
  hiit: { keys: ['simple_hiit_days'], get: () => hiitDays, set: v => { hiitDays = v; }, save: () => writeJson('simple_hiit_days', hiitDays) },
  dayPpl: { keys: ['simple_day_ppl'], get: () => dayPplMap, set: v => { dayPplMap = v; }, save: () => writeJson('simple_day_ppl', dayPplMap) }
};
/* 保存領域だけの取引：parts をまとめて書き込み、1つでも失敗・例外なら全部の保存領域を元の中身に戻して false */
function persistParts(parts) {
  const raws = [];
  parts.forEach(p => PARTS[p].keys.forEach(k => raws.push([k, readRaw(k)])));
  let ok = false;
  try { ok = parts.every(p => PARTS[p].save()); } catch (e) { console.log(e); ok = false; }
  if (!ok) raws.forEach(r => restoreRaw(r[0], r[1]));
  return ok;
}
/* 状態を変える取引：mutate() で parts を変更 → 変わった parts だけ保存。
   mutate が false を返す・失敗・例外のときは、メモリも保存領域も変更前へ戻して通知を1回出し、false を返す
   opts.force … 変わっていなくても全部保存する（復元用） ／ opts.failMsg … 失敗時の通知 */
function transact(parts, mutate, opts) {
  opts = opts || {};
  const before = parts.map(p => JSON.stringify(PARTS[p].get()));
  let ok = false;
  try {
    ok = mutate() !== false;
    if (ok) {
      const dirty = opts.force ? parts : parts.filter((p, i) => JSON.stringify(PARTS[p].get()) !== before[i]);
      ok = persistParts(dirty);
    }
  } catch (e) {
    console.log(e);
    ok = false;
  }
  if (!ok) {
    parts.forEach((p, i) => PARTS[p].set(JSON.parse(before[i])));
    alert(opts.failMsg || '保存できませんでした');
  }
  return ok;
}

/* ===================== タイマー ===================== */
function getAudioContext() {
  if (!sharedAudioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    sharedAudioCtx = new AudioContextClass();
  }
  if (sharedAudioCtx.state === 'suspended') {
    sharedAudioCtx.resume();
  }
  return sharedAudioCtx;
}
function fmtTimer(sec) {
  return String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0');
}
function setTimerDisplay(sec) {
  const display = document.getElementById('timerDisplay');
  if (display) display.textContent = fmtTimer(sec);
}
/* カウントダウンとアラームを止める（表示はここでは変えない） */
function clearTimerRun() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  if (alarmInterval) {
    clearInterval(alarmInterval);
    alarmInterval = null;
  }
  targetEndTime = null;
}
/* ＋/−：1分単位。動作中・アラーム中でも止めてセットし直し、STARTまで待機 */
function adjustTimer(deltaMin) {
  clearTimerRun();
  lastTimerSec = Math.max(0, Math.min(TIMER_MAX_SEC, lastTimerSec + deltaMin * 60));
  setTimerDisplay(lastTimerSec);
}
/* START：セット済みの時間からカウントダウン（0秒なら開始しない） */
function startTimer() {
  if (lastTimerSec <= 0) return;
  clearTimerRun();
  targetEndTime = Date.now() + lastTimerSec * 1000;
  updateTimerDisplay();
  timerInterval = setInterval(updateTimerDisplay, 200);
}
function updateTimerDisplay() {
  if (!targetEndTime) return;
  const now = Date.now();
  const diff = targetEndTime - now;
  if (diff <= 0) {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    targetEndTime = null;
    setTimerDisplay(0);
    if (!alarmInterval) {
      playSingleBeep();
      alarmInterval = setInterval(playSingleBeep, 400);
    }
    return;
  }
  setTimerDisplay(Math.ceil(diff / 1000));
}
/* STOP：カウントダウン・アラームを止め、表示をセット済みの時間に戻して待機 */
function stopTimer() {
  clearTimerRun();
  setTimerDisplay(lastTimerSec);
}
function playSingleBeep() {
  try {
    const ctx = getAudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.15);
  } catch (e) {
    console.log(e);
  }
  buzz(150);
}

/* ===================== 入力フォーム =====================
   フォームの状態（editingId / formDate / homeInput / homeInputName / warmupMode）はここの関数だけが変える
   ・resetForm … 入力欄と状態を初期化（保存後はすべて、キャンセル／編集の終了では日付指定を残す）
   ・editWorkout … 編集の開始（日付指定は残す） ／ applySuggestion … 過去の記録から入力（「入力中」） */
/* セット行のひな形（最初の行・「＋ セット」・過去の記録からの入力で共通）。入力欄は readonly（専用テンキーで入力）。
   見た目の色・角丸・高さは theme.css が持つ（ここには色系クラスを置かない） */
const SET_INPUT_ATTR = 'type="text" readonly inputmode="none" autocapitalize="off" autocomplete="off" autocorrect="off"';
function setRowHtml(num, w, r, hideX) {
  return '<div class="set-row">' +
    '<span class="set-label text-xs font-bold text-gray-400">' + num + '.</span>' +
    '<input ' + SET_INPUT_ATTR + ' placeholder="kg" value="' + w + '" class="weight-input w-full border px-3 text-center focus:outline-none">' +
    '<span class="text-gray-500 font-bold">×</span>' +
    '<input ' + SET_INPUT_ATTR + ' placeholder="回" value="' + r + '" class="reps-input w-full border px-3 text-center focus:outline-none">' +
    '<button type="button" onclick="removeSetRow(this)"' + (hideX ? ' style="visibility: hidden;"' : '') + ' class="text-gray-500 hover:text-red-400 p-2">✕</button>' +
    '</div>';
}
/* 「アップ」入力（ホームの「アップ」ボタン）：種目名の固定文字 */
const WARMUP_NAME = 'アップ';
const FIRST_ROW_HTML = setRowHtml(1, '', '', true);
(function () { const c = document.getElementById('setsContainer'); if (c) c.innerHTML = FIRST_ROW_HTML; })();
/* フォーム上部（#formHeaderContainer）は状態から組み立てる
   ・編集中 → 「編集中（キャンセル）」（日付指定は裏で保持し、編集が終わると戻る）
   ・日付指定（formDate）がある → 「○/○ の記録を追加（キャンセル）」
   ・ホームの「入力」／サジェストから来た → 「入力中（キャンセル）」を日付指定の下に並べる
   キャンセルは見出しのすぐ右（左詰め）に置き、右端のタイマー STOP との誤タップを防ぐ */
function hdrRow(title, fn, label) {
  return '<div class="flex items-center gap-3 mb-2.5"><h2 class="text-sm font-semibold text-orange-400 uppercase tracking-wider">' + title +
    '</h2><button type="button" onclick="' + fn + '" class="text-xs text-gray-400 hover:text-white">' + label + '</button></div>';
}
function renderFormHeader() {
  const h = byId('formHeaderContainer');
  if (!h) return;
  let html = '';
  if (editingId !== null) html = hdrRow('編集中', 'cancelEdit()', 'キャンセル');
  else {
    if (formDate) html += hdrRow(formatDate(formDate) + ' の記録を追加', 'setFormDate(null)', 'キャンセル');
    if (homeInput) html += hdrRow('入力中', 'cancelEdit()', 'キャンセル');
  }
  h.innerHTML = html;
}
/* 「この日にトレを追加」：記録日を指定（null で今日に戻す） */
function setFormDate(ds) {
  formDate = ds || null;
  if (ds && warmupMode) { /* 「この日にトレを追加」したら、アップ入力は終えて通常の空フォームへ */
    homeInput = false;
    homeInputName = null;
    resetFormFields();
  }
  renderFormHeader();
}
/* 「この日に有酸素を追加」 */
function setCardioDate(ds) {
  cardioDate = ds || null;
  const el = byId('cardioDateBanner');
  if (!el) return;
  el.innerHTML = cardioDate ? `
    <div class="flex items-center gap-3 mb-2.5">
      <h2 class="text-sm font-semibold text-orange-400 uppercase tracking-wider">${formatDate(cardioDate)} の有酸素を追加</h2>
      <button type="button" onclick="setCardioDate(null)" class="text-xs text-gray-400 hover:text-white">キャンセル</button>
    </div>
  ` : '';
}
function hideSuggest() {
  const box = byId('suggestionBox');
  if (box) { box.classList.add('hidden'); box.innerHTML = ''; }
}
/* 「アップ」状態の切り替えはここだけ（フラグと保存ボタンの無効／有効を必ずセットで変える）。
   フォームの各操作は、アップを始める／終えるを宣言するだけにして、ここ以外で warmupMode と保存ボタンを直接触らない */
function setWarmup(on) {
  warmupMode = on;
  const b = byId('saveBtn');
  if (b) b.disabled = on;
}
/* 「アップ」入力を終える */
function endWarmup() { setWarmup(false); }
/* ホームの「アップ」：種目名に「アップ」・セット欄に 30%/60%/80% の行（sets は {weight, reps} の配列）を入れ、
   「入力中＋キャンセル」を出して、保存ボタンを無効にする（トレーニング記録として保存させない） */
function startWarmup(sets) {
  const nameEl = byId('exerciseName'), container = byId('setsContainer'), saveBtn = byId('saveBtn');
  if (!nameEl || !container || !saveBtn || !sets || !sets.length) return;
  editingId = null;
  resetFormFields(); /* 入力欄を初期化（日付指定は残す）。ここで保存ボタンも一度元に戻る */
  padClose();
  nameEl.value = WARMUP_NAME;
  container.innerHTML = '';
  sets.forEach(s => addSetRow(s.weight, s.reps));
  homeInput = true;
  homeInputName = WARMUP_NAME;
  setWarmup(true);
  renderFormHeader();
}
/* 入力欄だけを初期状態に戻す（状態・ヘッダーは触らない） */
function resetFormFields() {
  const nameEl = byId('exerciseName'), saveBtn = byId('saveBtn'), container = byId('setsContainer');
  if (nameEl) nameEl.value = '';
  hideSuggest();
  if (saveBtn) saveBtn.textContent = '保存';
  if (container) container.innerHTML = FIRST_ROW_HTML;
  endWarmup(); /* 通常のリセット（キャンセル・別種目への切り替え・保存後など）では保存ボタンを元に戻す */
}
function resetForm(keep) {
  const keepDate = (keep === true || editingId !== null) ? formDate : null;
  editingId = null;
  formDate = keepDate;
  homeInput = false;
  homeInputName = null;
  resetFormFields();
  padClose();
  renderFormHeader();
}
/* キャンセル：フォームをリセットし、フォーカス（とテンキー）も外してキーボードが勝手に立ち上がらないようにする */
function cancelEdit() {
  resetForm(true);
  blurActive();
}
/* 編集の開始：日付指定（formDate）は消さない */
function editWorkout(id) {
  const target = workouts.find(i => i.id === id);
  if (!target) return;
  editingId = id;
  homeInput = false;
  homeInputName = null;
  hideSuggest();
  renderFormHeader();
  const saveBtn = byId('saveBtn'), nameEl = byId('exerciseName'), container = byId('setsContainer');
  endWarmup(); /* 編集を始めたら保存（更新）ボタンを有効に */
  if (saveBtn) saveBtn.textContent = '更新';
  if (nameEl) nameEl.value = target.name;
  if (container) {
    container.innerHTML = '';
    target.setList.forEach(set => addSetRow(set.weight, set.reps));
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (nameEl) nameEl.focus();
}

/* メニューで「非表示」にした種目は、入力候補に出さない（履歴のデータは残る） */
function isHiddenExercise(name) {
  if (!menuData) return false;
  const lists = Object.values(menuData);
  const off = lists.some(m => m && Array.isArray(m.off) && m.off.includes(name));
  const on = lists.some(m => m && Array.isArray(m.on) && m.on.includes(name));
  return off && !on;
}
/* 種目名の入力：別の名前に書き換えたら「入力中」の紐づき（前回のセット内容）を外し、入力に合う候補は常に最新化 */
function checkExerciseSuggestion() {
  const nameEl = byId('exerciseName');
  const box = byId('suggestionBox');
  if (!nameEl || !box) return;
  if (homeInput && nameEl.value.trim() !== homeInputName) {
    const v = nameEl.value;
    resetFormFields(); /* セット行・候補を初期状態に（種目名と日付指定は戻す） */
    nameEl.value = v;
    homeInput = false;
    homeInputName = null;
    renderFormHeader();
  }
  const query = nameEl.value.trim().toLowerCase();
  if (!query || editingId !== null) {
    box.classList.add('hidden');
    box.innerHTML = '';
    return;
  }
  const sortedWorkouts = [...workouts].sort((a, b) => Number(b.id) - Number(a.id));
  const matched = [];
  const seenNames = new Set();
  for (const workout of sortedWorkouts) {
    if (isHiddenExercise(workout.name)) continue;
    if (workout.name.toLowerCase().startsWith(query)) {
      if (!seenNames.has(workout.name)) {
        seenNames.add(workout.name);
        matched.push(workout);
      }
    }
  }
  if (matched.length === 0) {
    box.classList.add('hidden');
    box.innerHTML = '';
    return;
  }
  const displayItems = matched.slice(0, 5);
  let html = '';
  for (const item of displayItems) {
    html += `
      <button type="button" onclick="applySuggestion('${item.id}')" class="w-full px-4 py-3 text-left text-xs text-gray-200 hover:bg-gray-800 hover:text-orange-400 border-b border-gray-800 last:border-b-0 transition flex justify-between items-center">
        <span class="font-bold">${formatDate(item.dateStr)} ${escapeHtml(item.name)}</span>
        <span class="text-gray-500 text-[10px]">${item.setList.length}セット</span>
      </button>
    `;
  }
  box.classList.remove('hidden');
  box.innerHTML = html;
}
/* 過去の記録から入力（編集中は対象外）。「入力中」＋「キャンセル」を出す */
function applySuggestion(id) {
  const target = workouts.find(i => i.id === id);
  if (!target) return;
  const nameEl = byId('exerciseName');
  const container = byId('setsContainer');
  if (nameEl) nameEl.value = target.name;
  hideSuggest();
  endWarmup(); /* 過去の記録から入力するときは保存ボタンを有効に */
  if (container) {
    container.innerHTML = '';
    target.setList.forEach(set => addSetRow(set.weight, set.reps));
  }
  if (editingId !== null) return;
  homeInput = true;
  homeInputName = nameEl ? nameEl.value.trim() : null;
  renderFormHeader();
}
/* kg・回の欄は専用テンキー（extras.js）で入力するため readonly・OSキーボードなし */
function addSetRow(w = '', r = '') {
  const container = document.getElementById('setsContainer');
  if (!container) return;
  const rows = container.querySelectorAll('.set-row');
  const num = rows.length + 1;
  if (w === '' && rows.length > 0) {
    const lastInp = rows[rows.length - 1].querySelector('.weight-input');
    if (lastInp && lastInp.value) w = lastInp.value;
  }
  const div = document.createElement('div');
  div.innerHTML = setRowHtml(num, w, r, false);
  const row = div.firstElementChild;
  container.appendChild(row);
  updateNums();
  return row;
}
/* 「＋ セット」ボタン：行を足し、テンキーが開いていれば追加した行の kg へ移す（開いていなければ何もしない）
   ※履歴や候補からの自動追加は addSetRow を直接呼ぶのでテンキーは動かさない */
function addSetRowByButton() {
  const row = addSetRow();
  if (row) row.classList.add('row-in'); /* 追加した行だけ、ふわっと現れる（theme.css の rowIn） */
  if (window.Numpad) window.Numpad.followNewRow();
}
function removeSetRow(btn) {
  const container = document.getElementById('setsContainer');
  if (!container) return;
  const rows = container.querySelectorAll('.set-row');
  if (rows.length <= 1) return;
  const row = btn && btn.closest ? btn.closest('.set-row') : null;
  if (!row) return;
  if (window.Numpad) window.Numpad.release(row); /* テンキーがこの行を指していれば閉じる */
  row.remove();
  updateNums();
}
function updateNums() {
  const rows = document.querySelectorAll('.set-row');
  rows.forEach((row, idx) => {
    const label = row.querySelector('.set-label');
    const rm = row.querySelector('button');
    if (label) label.textContent = `${idx + 1}.`;
    if (rm) rm.style.visibility = rows.length === 1 ? 'hidden' : 'visible';
  });
}

/* ===================== 履歴の件数（表示件数の状態） ===================== */
const workoutDayTotal = () => new Set(workouts.map(i => i.dateStr)).size;
const cardioDayTotal = () => new Set(cardios.map(i => i.dateStr)).size;
/* 件数が総数を超えていたら、step 件単位で総数に収める */
const clampCount = (count, total, step) => count > total ? Math.max(step, Math.ceil(total / step) * step) : count;
function loadMoreDays() {
  if (visibleDaysCount >= workoutDayTotal()) return;
  visibleDaysCount += PAGE_STEP;
  requestRender('w');
}
function loadLessDays() {
  if (visibleDaysCount <= PAGE_STEP) return;
  visibleDaysCount = Math.max(PAGE_STEP, visibleDaysCount - PAGE_STEP);
  requestRender('w');
}
function loadMoreCardioDays() {
  if (visibleCardioDaysCount >= cardioDayTotal()) return;
  visibleCardioDaysCount += CARDIO_PAGE_STEP;
  requestRender('c');
}
function loadLessCardioDays() {
  if (visibleCardioDaysCount <= CARDIO_PAGE_STEP) return;
  visibleCardioDaysCount = Math.max(CARDIO_PAGE_STEP, visibleCardioDaysCount - CARDIO_PAGE_STEP);
  requestRender('c');
}
/* 画面を切り替えたら、履歴の表示件数は基準に戻す（トレーニング＝4件、有酸素＝5件）。戻したほうを true で返す */
function resetPaging() {
  const r = { w: visibleDaysCount !== PAGE_STEP, c: visibleCardioDaysCount !== CARDIO_PAGE_STEP };
  visibleDaysCount = PAGE_STEP;
  visibleCardioDaysCount = CARDIO_PAGE_STEP;
  return r;
}

/* ===================== 操作（アクション）：データを変える入口 =====================
   どれも「検証 → transact → 失敗なら画面を元の記録に揃えて false ／ 成功なら requestRender を1回」 */

/* 保存ボタン連打防止（保存に成功したら少しの間だけ押せない）と、成功の通知 */
function lockButton(btn) {
  if (!btn) return;
  btn.disabled = true;
  btn.classList.add('is-busy');
  setTimeout(() => { btn.disabled = (btn.id === 'saveBtn' && warmupMode); btn.classList.remove('is-busy'); }, LOCK_MS); /* アップ入力中は保存ボタンを無効のまま */
}
/* 空状態の「記録をつける」：そのタブの入力欄へ案内する */
function goFirstRecord(kind) {
  window.scrollTo({ top: 0, behavior: 'smooth' });
  setTimeout(() => {
    const i = document.getElementById(kind === 'cardio' ? 'cardioMinutes' : 'exerciseName');
    if (i) i.focus();
  }, 380);
}

function savedFeedback(btn) {
  buzz(25);
  alert('保存しました', 0, 'ok');
  lockButton(btn);
}

/* トレーニングの保存。成否を true / false で返す
   記録（simple_workouts）・部位（simple_day_ppl）・メニュー（simple_menu_tpl / simple_menu）を1つの取引で保存し、
   どれか1つでも失敗・例外なら全部を元へ戻す（フォームはそのまま残す）。成功のときだけ「保存しました」・連打ロック */
function saveWorkout() {
  const btn = byId('saveBtn');
  if (btn && btn.disabled) return false;
  if (warmupMode) return false; /* 「アップ」は記録として保存しない */
  const nameInput = byId('exerciseName');
  const container = byId('setsContainer');
  if (!nameInput || !container) return false;
  const name = nameInput.value.trim();
  if (!name) {
    alert('種目名を入力してください');
    nameInput.focus();
    return false;
  }
  if (name.length > LIMITS.name) {
    alert('種目名は' + LIMITS.name + '文字以内で入力してください');
    nameInput.focus();
    return false;
  }
  const rows = container.querySelectorAll('.set-row');
  const setList = [];
  let tooBig = false;
  rows.forEach(row => {
    const wEl = row.querySelector('.weight-input');
    const rEl = row.querySelector('.reps-input');
    if (!wEl || !rEl) return;
    const w = parseFloat(wEl.value);
    const r = parseInt(rEl.value);
    if (w > LIMITS.weight || r > LIMITS.reps) { tooBig = true; return; }
    if (isValidSet(w, r)) {
      setList.push({ weight: w, reps: r });
    }
  });
  if (tooBig) {
    alert('重量は' + LIMITS.weight + 'kg以下、回数は' + LIMITS.reps + '回以下で入力してください');
    return false;
  }
  if (setList.length === 0) {
    alert('有効な重量と回数を入力してください');
    return false;
  }
  if (editingId && !workouts.some(i => i.id === editingId)) {
    alert('編集する記録が見つかりません', 0, 'err');
    return false;
  }

  const today = todayStr();
  const day = (editingId === null && formDate) || today; /* 部位・メニューを決める日（「この日にトレを追加」の日付） */
  const type = day === today ? todayType() : pplOf(day);  /* 保存前に決める（保存すると今日の部位が変わるため） */
  /* PR判定用：保存前の「他の日の最高値」と「その日の保存前の値」を控える（保存後に比べる） */
  const prDate = editingId ? (workouts.find(i => i.id === editingId) || {}).dateStr || day : (formDate || today);
  let prBefore = null;
  try { if (typeof prSnap === 'function') prBefore = prSnap(name, prDate); } catch (e) { console.log(e); }
  if (typeof ensureDailySnapshot === 'function') ensureDailySnapshot(); /* スナップショットは保存「前」の状態で作る（その日1回だけ） */
  const ok = transact(['workouts', 'dayPpl', 'menu'], () => {
    if (editingId) {
      const target = workouts.find(i => i.id === editingId);
      target.name = name;
      target.setList = setList;
    } else {
      const dateStr = formDate || today;
      const existing = workouts.find(i => i.dateStr === dateStr && i.name === name);
      if (existing) {
        existing.setList = existing.setList.concat(setList);
      } else {
        workouts.push({ id: Date.now().toString(), name, dateStr, setList });
      }
    }
    /* その日の部位が未登録なら、保存前に決めた部位を登録する */
    if (dayPplMap[day] === undefined && workouts.some(w => w.dateStr === day)) dayPplMap[day] = type;
    /* メニューにまだ無い種目は、その日の部位の選択中の枠へ追加する */
    if (workouts.some(w => w.dateStr === day && w.name.trim() === name)) menuAddExercise(dayPplMap[day] || type, name);
  });
  if (!ok) {
    requestRender('w'); /* 通知は transact が出した。画面を元の記録に揃える */
    return false;
  }
  try {
    resetForm();
    requestRender({ w: true, menu: true });
    /* 保存後はフォーカスを当てない（キーボード・テンキーとも勝手に開かない） */
    nameInput.blur();
    blurActive();
  } catch (e) { console.log(e); }
  savedFeedback(btn);
  /* 2回目以降で過去最高を超えたときだけ、金色の「記録更新！！」モーダルとバイブ（初回記録は出さない） */
  try { if (prBefore && prCheck(prBefore)) showPRModal(); } catch (e) { console.log(e); }
  return true;
}

/* 有酸素の保存。成否を true / false で返す（失敗・例外は元に戻す） */
/* HIITを実施した日の判定と記録（残すのは日付とプリセット名だけ。分数・kcalは保存しない） */
const hiitDoneOn = d => hiitDays.some(x => x.d === d);
const hiitEntriesOn = d => hiitDays.filter(x => x.d === d);
function markHiitDay(dateStr, name, cfg) {
  if (!isRealDate(dateStr)) return false;
  const nm = typeof name === 'string' ? name.trim().slice(0, 20) : '';
  const c = hiitCfgOf(cfg);
  if (typeof ensureDailySnapshot === 'function') ensureDailySnapshot(); /* スナップショットは保存「前」の状態で作る（その日1回だけ） */
  return transact(['hiit'], () => {
    const ent = { d: dateStr, name: nm };
    if (c) { ent.w = c.w; ent.r = c.r; ent.n = c.n; }
    hiitDays = hiitDays.concat(ent).sort((a, b) => a.d < b.d ? -1 : a.d > b.d ? 1 : 0);
  });
}
/* 日付シートのHIIT欄から、その日の実施マークを1件だけ取り消す（同じ種類が複数あれば最初の1件） */
function removeHiitDay(dateStr, name) {
  const idx = hiitDays.findIndex(x => x.d === dateStr && x.name === name);
  if (idx < 0) return true;
  return transact(['hiit'], () => { hiitDays = hiitDays.filter((_, i) => i !== idx); });
}
function saveCardio() {
  const btn = byId('saveCardioBtn');
  if (btn && btn.disabled) return false;
  const minInput = byId('cardioMinutes');
  if (!minInput) return false;
  const minutes = parseInt(minInput.value);
  if (isNaN(minutes) || minutes <= 0) {
    alert('有効な時間を入力してください');
    return false;
  }
  const dateStr = cardioDate || todayStr();
  if (typeof ensureDailySnapshot === 'function') ensureDailySnapshot(); /* スナップショットは保存「前」の状態で作る（その日1回だけ） */
  const ok = transact(['cardios'], () => {
    const existingCardio = cardios.find(i => i.dateStr === dateStr);
    if (existingCardio) {
      existingCardio.minutes += minutes;
    } else {
      cardios.push({ id: Date.now().toString(), minutes: minutes, dateStr: dateStr });
    }
  });
  if (!ok) {
    requestRender('c');
    return false;
  }
  try {
    minInput.value = '';
    setCardioDate(null);
    requestRender('c');
    padClose();
    blurActive();
  } catch (e) { console.log(e); }
  savedFeedback(btn);
  return true;
}

/* 記録の削除。その日の記録が0件になったら、部位の情報もいっしょに消す（どちらかが保存できなければ両方元のまま） */
async function deleteWorkout(id) {
  if (!(await askConfirm('この記録を削除しますか？'))) return;
  const idx = workouts.findIndex(i => i.id === id);
  const gone = idx >= 0 ? workouts[idx] : null;
  const hadPpl = !!(gone && (gone.dateStr in dayPplMap));
  const oldPpl = hadPpl ? dayPplMap[gone.dateStr] : undefined;
  const ok = transact(['workouts', 'dayPpl'], () => {
    workouts = workouts.filter(i => i.id !== id);
    if (gone && !workouts.some(i => i.dateStr === gone.dateStr)) delete dayPplMap[gone.dateStr];
  });
  if (ok && editingId === id) resetForm(); /* 削除できたときだけ、編集中の入力を消す */
  requestRender('w');
  if (ok && gone && window.showUndoToast) { /* 削除直後だけ「元に戻す」を出す */
    showUndoToast('記録を削除しました', () => {
      transact(['workouts', 'dayPpl'], () => {
        if (!workouts.some(i => i.id === gone.id)) workouts.splice(Math.min(idx, workouts.length), 0, gone);
        if (hadPpl && !(gone.dateStr in dayPplMap)) dayPplMap[gone.dateStr] = oldPpl;
      });
      requestRender('all');
    });
  }
}
async function deleteCardio(id) {
  if (!(await askConfirm('この有酸素記録を削除しますか？'))) return;
  const idx = cardios.findIndex(i => i.id === id);
  const gone = idx >= 0 ? cardios[idx] : null;
  const ok = transact(['cardios'], () => { cardios = cardios.filter(i => i.id !== id); });
  requestRender('c');
  if (ok && gone && window.showUndoToast) { /* 削除直後だけ「元に戻す」を出す */
    showUndoToast('有酸素記録を削除しました', () => {
      transact(['cardios'], () => {
        if (!cardios.some(i => i.id === gone.id)) cardios.splice(Math.min(idx, cardios.length), 0, gone);
      });
      requestRender('all');
    });
  }
}
/* 履歴・日付シートの部位（PUSH/PULL/LEGS/OTHER）変更。失敗しても画面は保存結果（元の値）に揃える */
function updateDayPpl(dateStr, v) {
  const val = (v && typeof v === 'object') ? v.value : v; /* 部位名（PUSH/PULL/LEGS/OTHER）。要素が渡されても value を使う */
  if (!PPL_TYPES.includes(val)) return;
  transact(['dayPpl'], () => { dayPplMap[dateStr] = val; });
  requestRender('w');
}

/* ===================== 履歴リスト（描画だけ。呼ぶのは extras.js の paint） ===================== */
/* ===== 履歴の開閉状態（再描画しても維持する） ===== */
function captureOpen(list) {
  const o = { days: new Set(), exs: new Set() };
  list.querySelectorAll('.day-content:not(.hidden)').forEach(e => {
    const r = e.closest('[data-day]');
    if (r) o.days.add(r.dataset.day);
  });
  list.querySelectorAll('.ex-content:not(.hidden)').forEach(e => {
    const c = e.closest('[data-id]');
    if (c) o.exs.add(c.dataset.id);
  });
  return o;
}
function restoreOpen(list, o) {
  list.querySelectorAll('[data-day]').forEach(r => {
    if (!o.days.has(r.dataset.day)) return;
    r.querySelector('.day-content').classList.remove('hidden');
    r.querySelector('.day-toggle-icon').classList.add('is-open');
  });
  list.querySelectorAll('[data-id]').forEach(c => {
    if (!o.exs.has(c.dataset.id)) return;
    c.querySelector('.ex-content').classList.remove('hidden');
    c.querySelector('.ex-toggle-icon').classList.add('is-open');
  });
}

/* ===== 履歴の件数ボタン（− N件 / ＋ N件。＋ボタンを2分割した幅で横並び）
   N はトレーニング履歴＝PAGE_STEP（4件）、有酸素履歴＝CARDIO_PAGE_STEP（5件） ===== */
function renderPager(container, visible, total, step, onLess, onMore) {
  if (!container) return;
  container.innerHTML = '';
  if (total <= step && visible <= step) return;
  const wrap = document.createElement('div');
  wrap.className = 'grid grid-cols-2 border-b border-gray-700';
  const mk = (label, fn, disabled, extra) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.className = 'pager-btn w-full py-3 bg-gray-800 hover:bg-gray-700 text-gray-200 text-sm font-bold transition active:scale-[0.98]' + extra;
    b.disabled = disabled;
    b.onclick = fn;
    return b;
  };
  wrap.appendChild(mk('− ' + step + '件', onLess, visible <= step, ' border-r border-gray-700'));
  wrap.appendChild(mk('＋ ' + step + '件', onMore, visible >= total, ''));
  container.appendChild(wrap);
}

function drawWorkoutList() {
  const wrapper = document.getElementById('workoutListWrapper');
  const list = document.getElementById('workoutList');
  const moreContainer = document.getElementById('workoutMoreContainer');
  const empty = document.getElementById('emptyMessage');
  if (!list || !wrapper) return;
  const openState = captureOpen(list);
  list.innerHTML = '';
  if (moreContainer) moreContainer.innerHTML = '';
  if (workouts.length === 0) {
    wrapper.classList.add('hidden');
    if (empty) empty.classList.remove('hidden');
    return;
  }
  wrapper.classList.remove('hidden');
  if (empty) empty.classList.add('hidden');

  const grouped = {};
  workouts.forEach(item => {
    if (!grouped[item.dateStr]) grouped[item.dateStr] = [];
    grouped[item.dateStr].push(item);
  });
  const sortedDates = Object.keys(grouped).sort((a, b) => new Date(b) - new Date(a));
  visibleDaysCount = clampCount(visibleDaysCount, sortedDates.length, PAGE_STEP);
  const displayDates = sortedDates.slice(0, visibleDaysCount);

  displayDates.forEach(dateStr => {
    const dayItems = grouped[dateStr];
    let totalVolume = 0;
    dayItems.forEach(item => {
      item.setList.forEach(set => { totalVolume += (set.weight * set.reps); });
    });
    const formattedVolume = Math.round(totalVolume).toLocaleString();
    const currentPpl = pplOf(dateStr);
    const row = document.createElement('div');
    row.className = 'p-4';
    row.dataset.day = dateStr;
    let header = `
      <div class="flex justify-between items-center cursor-pointer select-none" onclick="toggleDayAccordion(this)">
        <div class="flex items-center gap-2.5 flex-wrap">
          <span class="text-sm font-bold text-orange-400">${formatDate(dateStr)}</span>
          <span class="text-xs text-white font-bold">総負荷: <span class="text-white">${formattedVolume}</span>kg</span>
          <span class="day-ppl text-xs text-white font-bold">${currentPpl}</span>
        </div>
        <span class="text-xs text-gray-400 day-toggle-icon">▼</span>
      </div>
    `;
    let body = '<div class="day-content hidden mt-3 pt-3 border-t border-gray-700 space-y-2">';
    dayItems.forEach(item => {
      const setsHtml = item.setList.map((s, idx) => `
        <div class="text-xs text-gray-300 font-semibold flex items-center gap-2">
          <span class="text-gray-500 w-4">${idx + 1}.</span>
          <span class="text-white">${s.weight} kg</span> ×
          <span class="text-white">${s.reps} 回</span>
        </div>
      `).join('');
      body += `
        <div class="bg-gray-900 border border-gray-700 rounded-xl p-3" data-id="${item.id}">
          <div class="flex justify-between items-center cursor-pointer select-none" onclick="toggleExerciseAccordion(this)">
            <div class="flex items-center gap-2">
              <span class="text-sm font-bold text-white">${escapeHtml(item.name)}</span>
              <span class="text-xs text-gray-500">(${item.setList.length}セット)</span>
            </div>
            <div class="flex items-center gap-2">
              <span class="text-xs text-gray-400 ex-toggle-icon">▼</span>
            </div>
          </div>
          <div class="ex-content hidden mt-2 pt-2 border-t border-gray-800 space-y-1">
            ${setsHtml}
          </div>
        </div>
      `;
    });
    body += '</div>';
    row.innerHTML = header + body;
    list.appendChild(row);
  });
  restoreOpen(list, openState);
  renderPager(moreContainer, visibleDaysCount, sortedDates.length, PAGE_STEP, loadLessDays, loadMoreDays);
  /* 履歴は閲覧専用（編集・削除・部位変更は、カレンダーの日付シートから）。「グラフ推移」ボタンの追加・分析・ホーム・カレンダーは extras.js の paint が続けて更新する */
}

/* 有酸素リスト。今月・今週の有酸素の集計は「編集・分析」（extras.js の renderAnalysis）が描く */
function drawCardioList() {
  const wrapper = document.getElementById('cardioListWrapper');
  const list = document.getElementById('cardioList');
  const moreContainer = document.getElementById('cardioMoreContainer');
  const empty = document.getElementById('emptyCardioMessage');
  if (!list || !wrapper) return;
  list.innerHTML = '';
  if (moreContainer) moreContainer.innerHTML = '';

  if (cardios.length === 0 && hiitDays.length === 0) {
    wrapper.classList.add('hidden');
    if (empty) empty.classList.remove('hidden');
    return;
  }
  wrapper.classList.remove('hidden');
  if (empty) empty.classList.add('hidden');

  const dateSet = new Set(cardios.map(i => i.dateStr));
  hiitDays.forEach(x => dateSet.add(x.d));
  const sortedDates = [...dateSet].sort((a, b) => new Date(b) - new Date(a));
  visibleCardioDaysCount = clampCount(visibleCardioDaysCount, sortedDates.length, CARDIO_PAGE_STEP);
  const displayDates = sortedDates.slice(0, visibleCardioDaysCount);

  displayDates.forEach(dateStr => {
    const dayCardio = cardios.find(i => i.dateStr === dateStr);
    const div = document.createElement('div');
    div.className = 'p-3.5 flex justify-between items-center';
    if (dayCardio) {
      const dayKcal = Math.round(dayCardio.minutes * KCAL_PER_MIN);
      div.innerHTML = `
      <div class="flex items-center gap-2.5">
        <span class="text-sm font-bold text-orange-400">${formatDate(dateStr)}</span>
        <span class="text-xs text-white">${dayCardio.minutes}分 / 約${dayKcal}kcal${hiitDoneOn(dateStr) ? ' 🔥' : ''}</span>
      </div>
    `;
    } else {
      div.innerHTML = `
      <div class="flex items-center gap-2.5">
        <span class="text-sm font-bold text-orange-400">${formatDate(dateStr)}</span>
        <span class="text-xs text-white">🔥 HIIT</span>
      </div>
    `;
    }
    list.appendChild(div);
  });
  renderPager(moreContainer, visibleCardioDaysCount, sortedDates.length, CARDIO_PAGE_STEP, loadLessCardioDays, loadMoreCardioDays);
}

/* ===================== バックアップ ===================== */
/* ファイルの保存。共有シート（保存先を選べる）が使えるときはそれを優先し、
   使えないときは通常のダウンロード。成功なら true、取りやめ・失敗なら false を返す。
   ※ iPhone などで「保存されず画面に表示されるだけ」になるのを避けるため。
   ※ 共有シートを使いたくない場合は、下の BACKUP_USE_SHARE を false にする */
const BACKUP_USE_SHARE = true;
async function saveBackupFile(fileName, json) {
  try {
    if (BACKUP_USE_SHARE && typeof File === 'function' && navigator.canShare && navigator.share) {
      const file = new File([json], fileName, { type: 'application/json' });
      if (navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: fileName });
          return true;
        } catch (e) {
          if (e && e.name === 'AbortError') return false; /* 本人が閉じた＝保存していない */
          /* それ以外の失敗は、下の通常ダウンロードへ進む */
        }
      }
    }
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return true;
  } catch (e) {
    console.log(e);
    return false;
  }
}
function buildBackupData() {
  /* バックアップとスナップショットで共用する、データ一式の組み立て（項目の追加・変更はここだけ直す） */
  return {
    version: BACKUP_VERSION,
    workouts: workouts,
    cardios: cardios,
    hiitDays: hiitDays,
    dayPplMap: dayPplMap,
    menu: menuData,
    menuTpl: window.tplExport ? window.tplExport() : null,
    goals: PARTS.goals ? PARTS.goals.get() : {}, /* 目標データは extras.js の中にあるので、登録窓口（PARTS）経由で受け取る */
    body: PARTS.body ? PARTS.body.get() : null,
    weight: PARTS.weight ? PARTS.weight.get() : null
  };
}
async function exportData() {
  const exportObj = buildBackupData();
  const fileName = `ppl_workout_backup_${new Date().toISOString().slice(0,10)}.json`;
  /* 注意：共有シートは「ボタンを押した直後」にしか開けないため、saveBackupFile の前に await を置かない */
  const saved = await saveBackupFile(fileName, JSON.stringify(exportObj));
  if (!saved) return; /* 取りやめ・失敗のときは「最終バックアップ日」を更新しない */
  try { localStorage.setItem('iron_last_backup', new Date().toISOString()); } catch (e) {}
  paintLastBackup();
  if (window.paintDataUsage) window.paintDataUsage(); /* 最終バックアップ日の保存でも使用量が変わる */
}

/* 最終バックアップ日の表示（14日以上あいていたら警告色で知らせる） */
function paintLastBackup() {
  const el = document.getElementById('lastBackupInfo');
  if (!el) return;
  let iso = null;
  try { iso = localStorage.getItem('iron_last_backup'); } catch (e) {}
  if (!iso) {
    el.textContent = '最終バックアップ：まだありません。記録を守るため、JSON出力をおすすめします。';
    el.style.color = '#f87171';
    return;
  }
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    el.textContent = '最終バックアップ：記録が読み取れませんでした。';
    el.style.color = '#f87171';
    return;
  }
  const dayStart = t => { const x = new Date(t); x.setHours(0, 0, 0, 0); return x.getTime(); };
  const days = Math.round((dayStart(Date.now()) - dayStart(d.getTime())) / 86400000);
  const label = d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate();
  if (days >= 14) {
    el.textContent = '⚠ 最終バックアップ：' + label + '（' + days + '日前）。14日以上たっています。そろそろJSON出力をおすすめします。';
    el.style.color = '#f87171';
  } else {
    el.textContent = '最終バックアップ：' + label + '（' + (days <= 0 ? '今日' : days + '日前') + '）';
    el.style.color = '';
  }
}

async function importFromJsonText() {
  const importEl = byId('importText');
  if (!importEl) return;
  const text = importEl.value.trim();
  if (!text) {
    alert('JSONテキストが入力されていません。');
    return;
  }
  /* 1) 先に全部検証する（ここまでは何も変更しない） */
  let imported;
  try {
    imported = JSON.parse(text);
  } catch (err) {
    alert('JSONの形式が正しくありません。入力内容を確認してください。');
    return;
  }
  let rawWorkouts, rawCardios = [], rawPpl = {}, rawMenu = null, rawTpl = null, rawGoals, rawBody, rawWeight, rawHiit; /* rawGoals が undefined の間は「バックアップに目標なし＝今の目標を残す」 */
  let oldVersionLabel = null; /* 古い版のバックアップのときだけ入る（警告に使う） */
  if (Array.isArray(imported)) {
    rawWorkouts = imported;
    oldVersionLabel = '版番号なし'; /* 記録だけの配列は古い形式 */
  } else if (imported && typeof imported === 'object' && Array.isArray(imported.workouts)) {
    /* 版番号の確認：現行(1)は通常どおり、版番号なし・現行より古い版は警告つきで復元、未来の版・不正な値は弾く */
    if ('version' in imported) {
      const v = imported.version;
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
        alert('バックアップの版番号が不正です。記録は変更していません。', 4000, 'err');
        return;
      }
      if (v > BACKUP_VERSION) {
        alert('このバックアップは新しい版（版' + v + '）のため復元できません。記録は変更していません。', 4000, 'err');
        return;
      }
      if (v < BACKUP_VERSION) oldVersionLabel = '版' + v;
    } else {
      oldVersionLabel = '版番号なし';
    }
    rawWorkouts = imported.workouts;
    rawCardios = Array.isArray(imported.cardios) ? imported.cardios : [];
    rawPpl = imported.dayPplMap || {};
    rawMenu = (imported.menu && typeof imported.menu === 'object') ? imported.menu : null;
    rawGoals = (imported.goals && typeof imported.goals === 'object' && !Array.isArray(imported.goals)) ? sanitizeGoals(imported.goals) : undefined;
    rawBody = (imported.body && typeof imported.body === 'object' && !Array.isArray(imported.body)) ? sanitizeBody(imported.body) : undefined;
    rawWeight = Array.isArray(imported.weight) ? sanitizeWeightLog(imported.weight) : undefined;
    rawHiit = Array.isArray(imported.hiitDays) ? sanitizeHiitDays(imported.hiitDays) : undefined;
    rawTpl = (imported.menuTpl && typeof imported.menuTpl === 'object' && !Array.isArray(imported.menuTpl)) ? imported.menuTpl : null;
  } else {
    alert('バックアップの形式が違います。記録は変更していません。');
    return;
  }
  const wStat = { skipped: 0 }, cStat = { skipped: 0 };
  const newWorkouts = sanitizeWorkouts(rawWorkouts, wStat);
  const newCardios = sanitizeCardios(rawCardios, cStat);
  const skipped = wStat.skipped + cStat.skipped;
  if (rawWorkouts.length > 0 && newWorkouts.length === 0) {
    alert('読み込める記録がありませんでした。記録は変更していません。');
    return;
  }
  /* 2) 件数を見せて確認（除外があればその件数も） */
  const msg = `トレーニング ${newWorkouts.length}件・有酸素 ${newCardios.length}件` + (rawGoals !== undefined ? `・目標 ${Object.keys(rawGoals).length}件` : '') + (rawWeight !== undefined ? `・体重 ${rawWeight.length}件` : '') + (rawHiit !== undefined ? `・HIIT ${rawHiit.length}件` : '') + (rawBody !== undefined ? '・身体設定' : '') + `で上書きします。` +
    (skipped > 0 ? `<br>不正なデータ ${skipped}件は除外されます。` : '') +
    (oldVersionLabel ? `<br>⚠ 古い版（${oldVersionLabel}）のバックアップです。内容を確認してください。` : '') + 'よろしいですか？';
  if (!(await askConfirm(msg, '復元'))) return;
  /* 3) 上書き前の状態を simple_pre_restore に控えてから、記録・有酸素・部位・メニューを1つの取引で入れ替える。
        失敗したらメモリ・保存領域とも全部元に戻す */
  const prevBackup = { workouts, cardios, hiitDays: hiitDays, dayPplMap, menu: menuData, goals: PARTS.goals ? PARTS.goals.get() : {}, body: PARTS.body ? PARTS.body.get() : null, weight: PARTS.weight ? PARTS.weight.get() : null };
  const restoreParts = ['workouts', 'cardios', 'dayPpl', 'menu'];
  if (rawGoals !== undefined && PARTS.goals) restoreParts.push('goals'); /* 目標入りのバックアップだけ、目標も入れ替える */
  if (rawBody !== undefined && PARTS.body) restoreParts.push('body');
  if (rawWeight !== undefined && PARTS.weight) restoreParts.push('weight');
  if (rawHiit !== undefined) restoreParts.push('hiit');
  const ok = transact(restoreParts, () => {
    if (!writeJson('simple_pre_restore', prevBackup)) return false;
    workouts = newWorkouts;
    cardios = newCardios;
    if (rawGoals !== undefined && PARTS.goals) PARTS.goals.set(rawGoals); /* 目標データは extras.js の中にあるので、登録窓口（PARTS）経由で差し替える */
    if (rawBody !== undefined && PARTS.body) PARTS.body.set(rawBody);
    if (rawWeight !== undefined && PARTS.weight) PARTS.weight.set(rawWeight);
    if (rawHiit !== undefined) hiitDays = rawHiit;
    dayPplMap = sanitizeDayPpl(rawPpl);
    /* テンプレート：新形式はそのまま、旧形式は各部位の1枠目へ取り込む（メモリ上に作るだけ。保存は transact） */
    tplImport(rawTpl, rawMenu);
  }, { force: true, failMsg: '復元に失敗しました。元のデータに戻しました。' });
  if (!ok) {
    requestRender('all');
    return;
  }
  try {
    resetForm();
    requestRender('all');
  } catch (e) { console.log(e); }
  alert('データを正常に復元しました！' + (skipped > 0 ? '（除外 ' + skipped + '件）' : ''), skipped > 0 ? 5000 : undefined);
  importEl.value = '';
}
/* ファイルから復元：選んだファイルの中身を貼り付け欄に入れて、そのまま既存の復元処理（検証・確認・控え）を使う */
function importFromFile(input) {
  const file = input && input.files && input.files[0];
  if (input) input.value = ''; /* 同じファイルを続けて選んでも反応するように戻す */
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const el = byId('importText');
    if (!el) return;
    el.value = String(reader.result || '');
    importFromJsonText();
  };
  reader.onerror = () => alert('ファイルを読み込めませんでした。', 4000, 'err');
  reader.readAsText(file);
}
paintLastBackup();
/* 起動時の描画・タブ切り替えは extras.js（showTab → requestRender）が1回だけ行う */
