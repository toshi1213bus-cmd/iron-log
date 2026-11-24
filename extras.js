/* =====================================================================
   extras.js：画面（ホーム／カレンダー／日付シート／メニュー編集／テンキー／テーマ／タブ）と、描画の入口
   index.html のスクリプトの後ろに読み込む。index.html の関数は上書き（ラップ）しない

   ■ extras.js が index.html に公開するもの（index.html はこれ以外の中身を知らない）
     requestRender(scope)  … 画面更新の唯一の入口（下の paint）
     askConfirm / alert    … 確認ダイアログ・トースト
     todayType / menuAddExercise / tplExport / tplImport … 部位・メニュー（PARTS.menu もここで登録）
     Numpad                … テンキーの窓口（close / followNewRow / release）
   ■ PR演出：prSnap / prCheck / showPRModal（保存時の判定と、金色の NEW RECORD!! モーダル＋バイブ。初回記録は出さない）
   ■ ホームの種目行には開閉にかかわらず常に「詳細」ボタンがあり、種目別の詳細ページ（全画面）へ移動できる（openDetail）
     switchTab / switchSettingsSub / setTheme / toggleHelp など … HTML の onclick から呼ばれるもの
   ===================================================================== */
(function () {
const pad = pad2, dstr = toDateStr, fmtD = formatDate; /* index.html の共通関数 */

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

/* ===== 部位分類の選択モーダル（履歴・日付シート共通。ブラウザ標準の <select> は使わない）
   確認ダイアログ（#modal）と同じ黒×金。現在の部位は金文字＋チェック。タップで即反映して閉じる／キャンセル・背景タップで閉じる ===== */
window.pickPpl = function (d) {
  if (document.getElementById('pplPicker')) return; /* 二重表示しない */
  const cur = pplOf(d);
  const o = document.createElement('div');
  o.id = 'pplPicker';
  o.setAttribute('role', 'dialog');
  o.setAttribute('aria-modal', 'true');
  o.innerHTML = '<div class="modal-box"><p>部位を選択</p><div class="pk-list">' +
    PPL_TYPES.map(t => '<button type="button" class="pk-opt' + (t === cur ? ' cur' : '') + '" data-v="' + t + '"' +
      (t === cur ? ' aria-current="true"' : '') + '>' + t + '</button>').join('') +
    '</div><div class="modal-actions"><button type="button" data-v="">キャンセル</button></div></div>';
  o.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b && e.target !== o) return;
    const v = b ? b.dataset.v : '';
    o.remove();
    if (v && v !== cur) updateDayPpl(d, v); /* 変えたときだけ保存して再描画 */
  });
  document.body.appendChild(o);
};

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
  const prev = document.documentElement.getAttribute('data-theme') || 'gold';
  let ok = true;
  try { localStorage.setItem(THEME_KEY, t); } catch (e) { ok = false; }
  if (!ok) { applyTheme(prev); window.alert('保存できませんでした'); return; } /* 保存できなければ見た目も元のまま */
  applyTheme(t);
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

/* ===== 編集・分析（「編集・分析/設定」タブの上サブタブ「編集・分析」）
   週は月曜始まり、月は YYYY-MM 単位。既存の workouts / dayPplMap（pplOf）/ cardios から毎回算出し、新しい保存キーは作らない。
   差分は「+1日／-400kg／+30分」の形だけ（％は使わない）。0件・比較元なしでも NaN は出さず「記録なし」または差分で表示する ===== */
let anMode = 'days'; /* 月間推移グラフの表示：'days'＝トレ回数 ／ 'cardio'＝有酸素 ／ 'vol'＝総負荷量 */
let anPeriod = 'week'; /* 分析カードの期間：'week'＝週間分析（初期） ／ 'month'＝月間分析 */
const nf = n => Math.round(n).toLocaleString();
const sgn = (v, u) => v === 0 ? '±0' + u : (v > 0 ? '+' : '-') + Math.abs(v).toLocaleString() + u;
function bdg(cur, prev, u) {
  if (!cur && !prev) return '<span class="an-bd none">記録なし</span>';
  const v = Math.round(cur - prev);
  return '<span class="an-bd ' + (v > 0 ? 'up' : v < 0 ? 'down' : 'same') + '">' + sgn(v, u) + '</span>';
}
/* 日付ごとの総負荷（OTHER の日も含む） */
function volByDay() {
  const m = {};
  workouts.forEach(w => { m[w.dateStr] = (m[w.dateStr] || 0) + w.setList.reduce((a, s) => a + s.weight * s.reps, 0); });
  return m;
}
/* 期間 test(dateStr) 内のトレ集計：全体と PUSH/PULL/LEGS/OTHER 別の日数・総負荷（部位別を丸めてから全体へ足す＝内訳と合計が必ず合う） */
function trainIn(vol, test) {
  const r = { days: 0, vol: 0, by: {} };
  PPL_TYPES.forEach(t => { r.by[t] = { days: 0, vol: 0 }; });
  Object.keys(vol).forEach(d => {
    if (!test(d)) return;
    const t = r.by[pplOf(d)] ? pplOf(d) : 'OTHER';
    r.by[t].days++;
    r.by[t].vol += vol[d];
  });
  PPL_TYPES.forEach(t => { const b = r.by[t]; b.vol = Math.round(b.vol); r.days += b.days; r.vol += b.vol; });
  return r;
}
function cardioIn(test) {
  let min = 0;
  cardios.forEach(c => { if (test(c.dateStr)) min += c.minutes; });
  return { min: min, kcal: Math.round(min * 3.5) };
}
function anCell(k, v, u, bd) {
  return '<div class="dt-cell"><div class="hm-lb">' + k + '</div><div class="dt-v">' + v + '<span class="dt-u">' + u + '</span></div>' + bd + '</div>';
}
function anSection(note, cur, prev, cc, cp) {
  let h = '<div class="bg-gray-800 border border-gray-700 rounded-2xl"><div class="hm-sub dt-pad an-note">' + note + '</div>' +
    '<div class="dt-grid">' + anCell('全部位 トレ回数', cur.days, '日', bdg(cur.days, prev.days, '日')) +
    anCell('全部位 総負荷量', nf(cur.vol), 'kg', bdg(cur.vol, prev.vol, 'kg')) + '</div>' +
    '<div class="an-hd"><span class="hm-lb">部位別</span><span class="hm-lb">回数</span><span class="hm-lb">総負荷量</span></div>';
  PPL_TYPES.forEach(t => {
    const a = cur.by[t], b = prev.by[t];
    h += '<div class="an-part"><span class="an-t">' + t + '</span>' +
      '<div class="an-c"><span class="dt-v">' + a.days + '<span class="dt-u">日</span></span>' + bdg(a.days, b.days, '日') + '</div>' +
      '<div class="an-c"><span class="dt-v">' + nf(a.vol) + '<span class="dt-u">kg</span></span>' + bdg(a.vol, b.vol, 'kg') + '</div></div>';
  });
  h += '<div class="an-hd"><span class="hm-lb">有酸素</span></div>' +
    '<div class="dt-grid">' + anCell('合計時間', nf(cc.min), '分', bdg(cc.min, cp.min, '分')) +
    anCell('消費（約）', nf(cc.kcal), 'kcal', bdg(cc.kcal, cp.kcal, 'kcal')) + '</div></div>';
  return h;
}
/* 直近6か月（当月を含む）の月別：トレ実施日数・有酸素の合計分・総負荷量（全記録の1日あたり合計 weight × reps を月ごとに合算） */
function anSeries() {
  const n = new Date(), vol = volByDay(), out = [];
  for (let i = 5; i >= 0; i--) {
    const dt = new Date(n.getFullYear(), n.getMonth() - i, 1), ym = dt.getFullYear() + '-' + pad(dt.getMonth() + 1);
    let dn = 0, min = 0, vl = 0;
    Object.keys(vol).forEach(d => { if (d.slice(0, 7) === ym) { dn++; vl += vol[d]; } });
    cardios.forEach(c => { if (c.dateStr.slice(0, 7) === ym) min += c.minutes; });
    out.push({ ym: ym, days: dn, min: min, vol: Math.round(vl) });
  }
  return out;
}
/* モードごとのグラフ設定：凡例（単位入り）・縦軸の最小値（0固定）・最大値の下限（floor）と上限（cap） */
const AN_MODES = {
  days: { label: 'トレ回数', leg: 'トレーニング日数（日）', floor: 10, cap: 31, get: x => x.days },
  cardio: { label: '有酸素', leg: '有酸素 合計時間（分）', floor: 60, cap: Infinity, get: x => x.min },
  vol: { label: '総負荷量', leg: '総負荷量（kg）', floor: 1000, cap: Infinity, get: x => x.vol }
};
/* 縦軸の最大値：データの最大（floor 以上）をキリのよい数（1・2・4・5・10 × 10のべき乗）に切り上げる */
function niceMax(x, floor, cap) {
  const t = Math.max(x, floor), p = Math.pow(10, Math.floor(Math.log10(t)));
  let r = 10 * p;
  for (const k of [1, 2, 4, 5, 10]) { if (k * p >= t) { r = k * p; break; } }
  return Math.min(r, cap);
}
function anGraphHtml() {
  const md = AN_MODES[anMode] || AN_MODES.days, s = anSeries(), v = s.map(md.get);
  if (v.filter(x => x > 0).length < 2) return '<div class="hm-sub">2か月以上の記録で推移グラフを表示</div>';
  return '<div class="hm-leg"><span class="lg-g">' + md.leg + '</span></div>' +
    line(v, 320, 138, s.map(x => x.ym), null, ym => parseInt(ym.slice(5), 10) + '月',
      { min: 0, max: niceMax(Math.max(...v), md.floor, md.cap), fmtV: nf });
}
/* グラフだけ描き直す（切替ボタン）。分析カード全体や画面のスクロールは触らない */
function paintAnGraph() {
  const g = document.getElementById('anGraph');
  if (g) g.innerHTML = anGraphHtml();
  document.querySelectorAll('#analysisBody [data-an="mode"]').forEach(b => {
    const on = b.dataset.m === anMode;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}
/* 今週（月曜始まり）・前週・今月・前月の範囲 */
function anRanges() {
  const n = new Date(), y = n.getFullYear(), m = n.getMonth(), dd = n.getDate();
  const mon = new Date(y, m, dd - (n.getDay() + 6) % 7); /* 今週の月曜 */
  const pl = new Date(y, m - 1, 1);
  return {
    ws: dstr(mon), we: dstr(new Date(y, m, mon.getDate() + 6)),
    pws: dstr(new Date(y, m, mon.getDate() - 7)), pwe: dstr(new Date(y, m, mon.getDate() - 1)),
    ms: dstr(new Date(y, m, 1)), me: dstr(new Date(y, m + 1, 0)),
    ym: y + '-' + pad(m + 1), pym: pl.getFullYear() + '-' + pad(pl.getMonth() + 1)
  };
}
/* 分析カード（週間／月間）。期間の日付は上のタブに出るのでカード内には出さない */
function anCardHtml() {
  const r = anRanges(), vol = volByDay();
  if (anPeriod === 'month') {
    const mo = d => d.slice(0, 7) === r.ym, pmo = d => d.slice(0, 7) === r.pym;
    return anSection('差分は前月比（有酸素は先月比）', trainIn(vol, mo), trainIn(vol, pmo), cardioIn(mo), cardioIn(pmo));
  }
  const wk = d => d >= r.ws && d <= r.we, pwk = d => d >= r.pws && d <= r.pwe;
  return anSection('週は月曜始まり・差分は前週比', trainIn(vol, wk), trainIn(vol, pwk), cardioIn(wk), cardioIn(pwk));
}
/* 週間分析／月間分析の下線タブ（上サブタブと同じ .hm-ord）。分析の横に対象の日だけを同じ文字サイズで並べる */
function anTabsHtml() {
  const r = anRanges();
  return '<div class="hm-pad"><div class="hm-ord an-tabs" id="anPeriodTabs" role="tablist">' +
    [['week', '週間分析', fmtD(r.ws) + '〜' + fmtD(r.we)], ['month', '月間分析', fmtD(r.ms) + '〜' + fmtD(r.me)]].map(x =>
      '<button type="button" role="tab" data-an="period" data-p="' + x[0] + '" class="' + (x[0] === anPeriod ? 'cur' : '') +
      '" aria-selected="' + (x[0] === anPeriod ? 'true' : 'false') + '">' + x[1] + ' ' + x[2] + '</button>').join('') + '</div></div>';
}
/* 分析カードだけ描き直す（週間／月間の切替）。月間推移グラフ・スクロール位置は触らない */
function paintAnCard() {
  const c = document.getElementById('anCard');
  if (c) c.innerHTML = anCardHtml();
  document.querySelectorAll('#analysisBody [data-an="period"]').forEach(b => {
    const on = b.dataset.p === anPeriod;
    b.classList.toggle('cur', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
}
function renderAnalysis() {
  const el = document.getElementById('analysisBody');
  if (!el) return;
  const trend = '<div class="bg-gray-800 border border-gray-700 rounded-2xl"><div class="dt-sec">月間推移（直近6か月）</div><div class="dt-n an-modes">' +
    Object.keys(AN_MODES).map(k => '<button type="button" class="gr-btn' + (k === anMode ? ' on' : '') + '" data-an="mode" data-m="' + k +
      '" aria-pressed="' + (k === anMode ? 'true' : 'false') + '">' + AN_MODES[k].label + '</button>').join('') +
    '</div><div class="dt-graph" id="anGraph">' + anGraphHtml() + '</div></div>';
  el.innerHTML = anTabsHtml() + '<div id="anCard">' + anCardHtml() + '</div>' + trend; /* 月間推移は週間・月間どちらでも常時表示 */
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-an]');
  if (!b || !b.closest('#analysisBody')) return;
  if (b.dataset.an === 'mode') {
    const md = b.dataset.m;
    if (!AN_MODES[md] || md === anMode) return;
    anMode = md;
    paintAnGraph();
  } else if (b.dataset.an === 'period') {
    const p = b.dataset.p;
    if ((p !== 'week' && p !== 'month') || p === anPeriod) return;
    anPeriod = p;
    paintAnCard();
  }
});
/* 上サブタブ（編集・分析・設定）。「編集・分析/設定」を開くたびに showTab が最初の「編集・分析」へ戻す */
function setSub(k) {
  const a = document.getElementById('subAnalysis'), s = document.getElementById('subSettings');
  if (a) a.classList.toggle('hidden', k !== 'analysis');
  if (s) s.classList.toggle('hidden', k !== 'settings');
  document.querySelectorAll('#setSubTabs button').forEach(b => {
    const on = b.dataset.s === k;
    b.classList.toggle('cur', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
}
window.switchSettingsSub = function (k) {
  if (k !== 'analysis' && k !== 'settings') return;
  closePad();
  setSub(k);
};

/* ===== 画面更新の入口（描画はここだけ。データを変える側は requestRender を1操作につき1回呼ぶ）
   scope … 文字列 'w' | 'c' | 'menu' | 'all'、または { w, c, menu, view }
     w … トレ記録・部位が変わった ／ c … 有酸素が変わった ／ menu … メニュー（テンプレート）が変わった
     view … データは変えず、その画面の表示だけ更新する（'home' | 'settings' | 'calendar'）
   どの変更でどの画面を描くか（見えていないホーム／月間・設定は描かず、タブを開いたとき view 付きで描く）
     履歴リスト＋「グラフ推移」ボタン … w ／ 有酸素リスト … c ／ 編集・分析（今週・今月・月間推移） … w, c, view=settings
     カレンダー … w, c, view=settings|calendar ／ メニュー表示 … menu, view=settings
     ホーム … w, menu, view=home ／ 開いている日付シート … w, c
   描く順は固定（リスト → 分析 → カレンダー → メニュー → ホーム → シート）。1つ失敗しても後続は描く ===== */
const isShown = id => { const e = document.getElementById(id); return !!e && !e.classList.contains('hidden'); };
const safe = fn => { try { fn(); } catch (e) { console.log(e); } };
const SCOPES = { w: { w: true }, c: { c: true }, menu: { menu: true }, all: { w: true, c: true, menu: true } };
function paint(s) {
  const data = !!(s.w || s.c);
  if (s.w) safe(() => { drawWorkoutList(); decorateHistory(); }); /* 描いたあとに「グラフ推移」ボタンとグラフ枠を足す */
  if (s.c) safe(drawCardioList);
  if (isShown('tabContentSettings')) {
    if (data || s.view === 'settings') safe(renderAnalysis);
    if (data || s.view === 'settings' || s.view === 'calendar') safe(renderCalendar);
    if (s.menu || s.view === 'settings') safe(renderMenuSummary);
  }
  if ((s.w || s.menu || s.view === 'home') && isShown('tabContentHome')) safe(renderHome);
  if (data && sheetEl) safe(renderSheet); /* 日付ボトムシートが開いていれば最新化 */
}
window.requestRender = function (scope) {
  paint(typeof scope === 'string' ? (SCOPES[scope] || {}) : (scope || {}));
};

/* ===== 履歴の開閉（シェブロン） ===== */
function toggle(h, sel) {
  const body = h && h.nextElementSibling;
  if (!body) return;
  const hidden = body.classList.toggle('hidden');
  const ic = h.querySelector(sel);
  if (ic) ic.classList.toggle('is-open', !hidden);
}
/* シェブロンの向きを、開閉の実際の状態（.hidden の有無）に必ず合わせる（日付行・種目行とも ∨＝閉 / ∧＝開） */
function syncChev(root) {
  if (!root) return;
  const all = sel => [...(root.matches(sel) ? [root] : []), ...root.querySelectorAll(sel)]; /* root 自身も対象に含める */
  all('[data-day]').forEach(r => {
    const c = r.querySelector('.day-content'), ic = r.querySelector('.day-toggle-icon');
    if (c && ic) ic.classList.toggle('is-open', !c.classList.contains('hidden'));
  });
  all('[data-id]').forEach(r => {
    const c = r.querySelector('.ex-content'), ic = r.querySelector('.ex-toggle-icon');
    if (c && ic) ic.classList.toggle('is-open', !c.classList.contains('hidden'));
  });
}
/* 日付行：種目一覧を開いたらグラフは閉じる（排他） */
window.toggleDayAccordion = h => {
  toggle(h, '.day-toggle-icon');
  const row = h.closest('[data-day]');
  if (row && h.nextElementSibling && !h.nextElementSibling.classList.contains('hidden')) hideGraph(row);
  if (row) syncChev(row);
};
window.toggleExerciseAccordion = h => {
  toggle(h, '.ex-toggle-icon');
  syncChev(h.closest('[data-id]'));
};

/* ===== 履歴の「グラフ推移」（対象日の部位と同じ部位の記録日だけを集め、その日以前の直近5回分の総負荷 Σ weight × reps）
   ・部位（PUSH/PULL/LEGS/OTHER）をカレンダーの日付シートで変えると、開いているグラフもその新しい部位の直近5回分に追従する
   ・日付ヘッダーの総負荷量・部位（文字表示）の横にボタン。大きさはホームの展開グラフと同じ（320×138・日付あり）
   ・グラフを開く → その日の種目一覧（.day-content）を閉じる。種目一覧を開く → グラフを閉じる ===== */
const graphOpen = new Set();
function graphHtml(d) {
  const t = pplOf(d), per = {};
  workouts.forEach(w => {
    if (w.dateStr <= d && pplOf(w.dateStr) === t) per[w.dateStr] = (per[w.dateStr] || 0) + w.setList.reduce((a, x) => a + x.weight * x.reps, 0);
  });
  const ds = Object.keys(per).sort().slice(-5);
  if (ds.length < 2) return '<div class="hm-sub">' + t + ' が2回以上の記録でグラフが出ます。</div>';
  return '<div class="hm-leg"><span class="lg-g">' + t + ' 総負荷</span></div>' + line(ds.map(x => Math.round(per[x])), 320, 138, ds);
}
function hideGraph(row) {
  const g = row.querySelector('.day-graph'), b = row.querySelector('.gr-btn');
  graphOpen.delete(row.dataset.day);
  if (g) { g.classList.add('hidden'); g.innerHTML = ''; }
  if (b) { b.classList.remove('on'); b.setAttribute('aria-pressed', 'false'); }
  syncChev(row);
}
function showGraph(row) {
  const g = row.querySelector('.day-graph'), b = row.querySelector('.gr-btn'), c = row.querySelector('.day-content');
  if (!g) return;
  graphOpen.add(row.dataset.day);
  g.innerHTML = graphHtml(row.dataset.day);
  g.classList.remove('hidden');
  if (b) { b.classList.add('on'); b.setAttribute('aria-pressed', 'true'); }
  if (c) c.classList.add('hidden'); /* 種目一覧（セット内訳）は隠す */
  syncChev(row); /* 種目一覧を閉じたので日付行のシェブロンも ∨ に戻す */
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
    const sel = row.querySelector('.day-ppl');
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
  syncChev(list); /* 再描画・グラフ復元のあとも、開閉とシェブロンの向きを揃える */
}
/* 別ページへ移動したら、履歴の種目一覧・セット内訳・グラフをすべて閉じる */
function closeHistory() {
  const list = document.getElementById('workoutList');
  if (!list) return;
  list.querySelectorAll('.day-content, .ex-content').forEach(e => e.classList.add('hidden'));
  list.querySelectorAll('.day-toggle-icon, .ex-toggle-icon').forEach(e => e.classList.remove('is-open'));
  list.querySelectorAll('[data-day]').forEach(hideGraph);
  graphOpen.clear();
  syncChev(list);
}

/* ===== タイマー：終了時の発光・振動／時間表示を左右ボタンのギリギリまで拡大（要素が無くても止まらない） ===== */
const disp = document.getElementById('timerDisplay');
const card = disp ? disp.closest('.bg-gray-800') : null;
const tmCenter = disp ? disp.closest('.tm-center') : null;
if (card) setInterval(() => { card.classList.toggle('timer-done', !!alarmInterval); }, 200);
/* 中央の枠いっぱいに '00:00' が収まる文字サイズを測って決める（画面が見えているときだけ測れる） */
let fitW = 0;
function fitTimer(force) {
  if (!disp || !tmCenter) return;
  const w = tmCenter.clientWidth;
  if (!w || (!force && w === fitW)) return;
  const keep = disp.textContent;
  disp.textContent = '00:00';
  disp.style.fontSize = '100px';
  const base = disp.getBoundingClientRect().width;
  disp.textContent = keep;
  if (!base) return;
  fitW = w;
  disp.style.fontSize = Math.floor(Math.max(24, Math.min(140, 100 * (w - 2) / base))) + 'px';
}
if (tmCenter) {
  window.addEventListener('resize', () => fitTimer(true));
  if (typeof ResizeObserver === 'function') {
    try { new ResizeObserver(() => fitTimer()).observe(tmCenter); } catch (e) {}
  }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => fitTimer(true)).catch(() => {});
}
document.addEventListener('click', e => { if (e.target.closest('button')) buzz(10); });

/* ===== タイマー：数字の背後の円形・放射状の目盛りリング（計器風）
   残り時間 ÷ セット時間 に合わせて目盛りが点灯。START で12時の位置から時計回りに消えていく（待機中＝全点灯／0秒・アラーム中＝全消灯）
   数字の大きさ・タイマーの動作・音・バイブには触らない（index.html の変数 targetEndTime / lastTimerSec / alarmInterval を読むだけ） ===== */
const RING_N = 60;
let ringTicks = [], ringLit = -1;
function buildRing() {
  if (!tmCenter) return;
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'tm-ring');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('aria-hidden', 'true');
  const rc = document.createElementNS(NS, 'circle');
  rc.setAttribute('class', 'tm-rc');
  rc.setAttribute('cx', '50'); rc.setAttribute('cy', '50'); rc.setAttribute('r', '39');
  svg.appendChild(rc);
  for (let i = 0; i < RING_N; i++) {
    const a = i / RING_N * Math.PI * 2, major = i % 5 === 0, r0 = major ? 42 : 45, r1 = 48.5;
    const t = document.createElementNS(NS, 'line');
    t.setAttribute('class', 'tm-tk' + (major ? ' mj' : ''));
    t.setAttribute('x1', (50 + Math.sin(a) * r0).toFixed(2)); t.setAttribute('y1', (50 - Math.cos(a) * r0).toFixed(2));
    t.setAttribute('x2', (50 + Math.sin(a) * r1).toFixed(2)); t.setAttribute('y2', (50 - Math.cos(a) * r1).toFixed(2));
    svg.appendChild(t);
    ringTicks.push(t);
  }
  tmCenter.insertBefore(svg, tmCenter.firstChild);
}
function paintRing() {
  if (!ringTicks.length || !isShown('tabContentWorkout')) return;
  let frac = 0;
  if (targetEndTime && lastTimerSec > 0) frac = Math.max(0, Math.min(1, (targetEndTime - Date.now()) / (lastTimerSec * 1000)));
  else if (!alarmInterval && lastTimerSec > 0) frac = 1;
  const lit = frac > 0 ? Math.max(1, Math.ceil(frac * RING_N - 1e-9)) : 0;
  if (lit === ringLit) return;
  ringLit = lit;
  const off = RING_N - lit;
  ringTicks.forEach((t, i) => { const on = i >= off; t.classList.toggle('on', on); t.classList.toggle('hd', on && i === off); });
}
safe(buildRing);
setInterval(() => safe(paintRing), 100);

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
/* テンキーの窓口（index.html のフォームから呼ばれる）
   ・followNewRow … ＋セットのボタン：テンキーが開いていれば、追加した行の kg へ移す（古い行や画面外に残さない）。開いていなければ何もしない
   ・release … 行を削除するとき、テンキーがその行を指していれば閉じる */
window.Numpad = {
  close: closePad,
  followNewRow: function () {
    if (!padInput) return;
    const rows = document.querySelectorAll('#setsContainer .set-row');
    const next = rows.length && rows[rows.length - 1].querySelector('.weight-input');
    if (next) openPad(next); else closePad();
  },
  release: function (row) {
    if (row && padInput && row.contains(padInput)) closePad();
  }
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
function line(v, w, h, dates, rm, lab, ax) {
  const n = v.length;
  if (n < 2) return '';
  const big = !!dates, fmtL = lab || fmtD; /* lab … x軸ラベルの整形（省略時は M/D） */
  const hasRm = big && Array.isArray(rm) && rm.length === n && rm.some(x => x > 0);
  const useAx = big && !!ax && ax.max > ax.min, fv = (ax && ax.fmtV) || (x => x); /* ax … 縦軸 { min, max, fmtV }。指定時は最小〜最大を固定し、左に目盛りを出す */
  const px = big ? (useAx ? 38 : 22) : 5, pt = big ? 26 : 8, pb = big ? (hasRm ? 36 : 24) : 8;
  const toPts = arr => {
    const mn = useAx ? ax.min : Math.min(...arr), mx = useAx ? ax.max : Math.max(...arr), r = (mx - mn) || 1;
    return arr.map((y, i) => [px + i * (w - 2 * px) / (n - 1), h - pb - (y - mn) / r * (h - pt - pb)]);
  };
  const f = x => x.toFixed(1);
  const P = toPts(v), d = curvePath(P);
  const id = 'g' + (++gid), L = P[n - 1];
  let grid = '';
  if (useAx) { /* 最小・中間・最大の目盛り線とラベル（単位は凡例側に出す） */
    [ax.min, (ax.min + ax.max) / 2, ax.max].forEach(t => {
      const y = h - pb - (t - ax.min) / (ax.max - ax.min) * (h - pt - pb);
      grid += '<line x1="' + px + '" y1="' + f(y) + '" x2="' + (w - px) + '" y2="' + f(y) + '" stroke="#2a2a2c"/>' +
        '<text x="' + (px - 6) + '" y="' + f(y + 3.5) + '" text-anchor="end" font-size="10.5" fill="#b8b2a2" font-family="Barlow Condensed,sans-serif">' + fv(t) + '</text>';
    });
  }
  let s = (hasRm ? '<div class="hm-leg"><span class="lg-g">総合</span><span class="lg-r">推定1RM</span></div>' : '') +
    '<svg ' + (big ? 'width="100%"' : 'width="' + w + '" height="' + h + '"') + ' viewBox="0 0 ' + w + ' ' + h + '">' +
    '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c9a96a" stop-opacity=".3"/><stop offset="1" stop-color="#c9a96a" stop-opacity="0"/></linearGradient></defs>' + grid +
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
    const step = Math.max(1, Math.ceil(n / Math.max(1, Math.floor((w - 2 * px) / 26)))); /* 点が多いときは数字・日付を間引く（最新は必ず出す） */
    P.forEach((q, i) => {
      const last = i === n - 1;
      if ((n - 1 - i) % step !== 0) return;
      s += '<text x="' + f(q[0]) + '" y="' + f(q[1] - 10) + '" text-anchor="middle" font-size="11" fill="' +
        (last ? '#ece8dd' : '#b8b2a2') + '" font-family="Barlow Condensed,sans-serif">' + fv(v[i]) + '</text>' +
        '<text x="' + f(q[0]) + '" y="' + (h - 5) + '" text-anchor="middle" font-size="11" fill="#b8b2a2" font-family="Barlow Condensed,sans-serif">' + fmtL(dates[i]) + '</text>';
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
function seriesAll(name) {
  const map = {};
  workouts.filter(w => w.name.trim() === name).forEach(w => { (map[w.dateStr] = map[w.dateStr] || []).push(...w.setList); });
  return Object.keys(map).sort().map(d => ({ d, v: metric(map[d]), rm: est1RM(map[d]) }));
}
function series(name) { return seriesAll(name).slice(-5); } /* ホームの展開グラフは直近5回 */

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
/* ===== 保存時のPR演出（saveWorkout から呼ばれる）
   prSnap(name, dateStr) … 保存の前に呼ぶ。「その日以外の記録日があるか」「その最高値」「その日の保存前の値」を控える
   prCheck(snap)         … 保存の後に呼ぶ。他の日の記録があり、その日の値が過去最高を超え、かつ保存前より上がっていれば true（初回記録は false） */
function dayMetrics(name) {
  const map = {};
  workouts.filter(w => w.name.trim() === name).forEach(w => { (map[w.dateStr] = map[w.dateStr] || []).push(...w.setList); });
  return map;
}
window.prSnap = function (name, dateStr) {
  const map = dayMetrics(name);
  const others = Object.keys(map).filter(d => d !== dateStr).map(d => metric(map[d]));
  return { name: name, dateStr: dateStr, hasPrev: others.length > 0, best: others.length ? Math.max(...others) : 0, before: map[dateStr] ? metric(map[dateStr]) : 0 };
};
window.prCheck = function (snap) {
  if (!snap || !snap.hasPrev) return false;
  const sets = dayMetrics(snap.name)[snap.dateStr];
  if (!sets) return false;
  const now = metric(sets);
  return now > snap.best && now > snap.before;
};
/* 金色のモーダル（画面中央）＋バイブ。余計な数値や差分は出さない。タップか約2.4秒で閉じる */
window.showPRModal = function () {
  if (document.getElementById('prModal')) return;
  const o = document.createElement('div');
  o.id = 'prModal';
  o.setAttribute('role', 'alert');
  o.innerHTML = '<div class="pr-box">NEW RECORD!!</div>';
  const close = () => { clearTimeout(t); o.remove(); };
  const t = setTimeout(close, 2400);
  o.addEventListener('click', close);
  document.body.appendChild(o);
  try { navigator.vibrate && navigator.vibrate([80, 50, 80, 50, 160]); } catch (err) {}
};
const fmtSet = s => (s.weight ? s.weight + 'kg × ' + s.reps + '回' : s.reps + '回');
const bestSet = sets => sets.reduce((b, s) => (!b || s.weight > b.weight || (s.weight === b.weight && s.reps > b.reps)) ? s : b, null);

/* ===== ホーム ===== */
const TYPES = PPL_TYPES;
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
window.todayType = todayType; /* index.html の saveWorkout が、保存前に今日の部位を決めるのに使う */
window.homeType = function (t) { override = { day: dstr(new Date()), type: t }; homeOpen = null; requestRender({ view: 'home' }); };

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
/* 旧データ（simple_menu だけ／何も無い）の取り込み：各部位の1枠目へ入れる */
function tplFromMenu(base) {
  const t = normTpl(null);
  TYPES.forEach(k => { const s = t[k].slots[0]; s.on = base[k].on; s.off = base[k].off; });
  return t;
}
function buildFromHistory() {
  const m = normMenu(null), days = dayList();
  TYPES.forEach(t => {
    const d = days.filter(x => pplOf(x) === t).pop();
    if (d) workouts.filter(w => w.dateStr === d).forEach(w => { const n = w.name.trim(); if (!m[t].on.includes(n)) m[t].on.push(n); });
  });
  return m;
}
/* メモリ上のテンプレートを作る（保存はしない）：保存済みの枠データ → 無ければ simple_menu → 無ければ履歴から */
function loadTpl() {
  const raw = loadJson(TPL_KEY, null);
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return normTpl(raw);
  return tplFromMenu(menuData ? normMenu(menuData) : buildFromHistory());
}
function ensureMenu() {
  if (tplData) return;
  tplData = loadTpl();
  syncMenuFromTpl();
  persistParts(['menu']); /* 失敗しても動作は続ける（保存領域は元のまま） */
}
/* メニュー（テンプレート simple_menu_tpl ＋ simple_menu）を、index.html の保存の窓口（transact）へ登録。
   2つの保存はセット：片方でも失敗したら persistParts が保存領域の2つとも元の中身に戻す */
PARTS.menu = {
  keys: [TPL_KEY, 'simple_menu'],
  get: () => { ensureMenu(); return { tpl: tplData, menu: menuData }; },
  set: v => { tplData = v.tpl; menuData = v.menu; },
  save: () => { syncMenuFromTpl(); return writeJson(TPL_KEY, tplData) && writeJson('simple_menu', menuData); }
};
window.tplExport = function () { ensureMenu(); return JSON.parse(JSON.stringify(tplData)); };
/* 復元：新形式はそのまま、旧形式（menuのみ）は各部位の1枠目へ。メモリ上に作るだけ（保存は呼び出し側の transact） */
window.tplImport = function (rawTpl, rawMenu) {
  if (rawTpl && typeof rawTpl === 'object' && !Array.isArray(rawTpl)) tplData = normTpl(rawTpl);
  else if (rawMenu && typeof rawMenu === 'object') tplData = tplFromMenu(normMenu(rawMenu));
  else tplData = tplFromMenu(buildFromHistory()); /* どちらも無ければ、復元後の履歴から作る */
  syncMenuFromTpl();
};
/* 保存した種目がメニューに無ければ、部位 type の選択中の枠へ足す（saveWorkout の transact の中で呼ぶ。保存は transact） */
window.menuAddExercise = function (type, name) {
  ensureMenu();
  const s = activeSlot(type);
  if (!s.on.includes(name) && !s.off.includes(name)) s.on.push(name);
};
/* 枠（1〜4）の切り替え。保存できなければ元の枠のまま */
window.tplSelect = function (t, i) {
  ensureMenu();
  if (!TYPES.includes(t) || !(i >= 0 && i < SLOT_N)) return;
  if (tplData[t].idx === i) return;
  transact(['menu'], () => { tplData[t].idx = i; });
  requestRender('menu');
};
function lastRec(name, today) {
  return workouts.filter(w => w.name.trim() === name && w.dateStr < today).sort((a, b) => (a.dateStr < b.dateStr ? -1 : 1)).pop() || null;
}

/* ===== ホーム：表示の状態（ホームの「入力」からのフォーム操作は homeFill のみ。フォームの状態は index.html） ===== */
let homeOpen = null, homeNames = [];
window.homeFill = function (i) {
  const name = homeNames[i];
  if (name === undefined) return;
  if (editingId !== null) resetForm(true); /* 編集は中断（日付指定は維持） */
  switchTab('workout');
  const rec = lastRec(name, dstr(new Date()));
  if (rec) applySuggestion(rec.id);
  else {
    resetForm(true);
    const nameEl = document.getElementById('exerciseName');
    if (nameEl) nameEl.value = name;
  }
  homeInput = true;
  homeInputName = name;
  hideSuggest();
  renderFormHeader();
};
/* ===== 勲章バッジ（選択中の部位のメニューを全完了したときだけ、部位文字の右横に出す）
   放射光条（金）・月桂樹（銀）・帯（青のエナメル）・中央メダリオン（深い赤＋金の星）の多色。実物らしさのため色は固定（テーマでは変えない） ===== */
function medalSvg(uid, label) { /* uid … 複数の勲章を並べても gradient の id が重ならないようにする接尾辞 */
  const C = 32, f = x => x.toFixed(2);
  const pt = (a, r) => f(C + Math.sin(a) * r) + ',' + f(C - Math.cos(a) * r);
  let rays = '', leaves = '', star = '';
  for (let i = 0; i < 16; i++) {
    const a = i / 16 * Math.PI * 2;
    rays += '<polygon points="' + pt(a - 0.13, 18) + ' ' + pt(a, i % 2 ? 27.5 : 31.5) + ' ' + pt(a + 0.13, 18) + '" fill="url(#mdG)"/>';
  }
  for (let k = 0; k < 8; k++) { /* 下から上へ向かう月桂樹の枝（左右対称）。葉は外向きに少し傾ける */
    const deg = 172 - k * 20, th = deg * Math.PI / 180;
    const x = C + Math.sin(th) * 22.6, y = C - Math.cos(th) * 22.6, x2 = 64 - x;
    leaves += '<ellipse cx="' + f(x) + '" cy="' + f(y) + '" rx="3.9" ry="1.6" transform="rotate(' + f(deg + 32) + ' ' + f(x) + ' ' + f(y) + ')" fill="url(#mdS)" stroke="#4b5260" stroke-width=".25"/>' +
      '<ellipse cx="' + f(x2) + '" cy="' + f(y) + '" rx="3.9" ry="1.6" transform="rotate(' + f(-(deg + 32)) + ' ' + f(x2) + ' ' + f(y) + ')" fill="url(#mdS)" stroke="#4b5260" stroke-width=".25"/>';
  }
  for (let i = 0; i < 10; i++) star += (i ? ' ' : '') + pt(i * Math.PI / 5, i % 2 ? 2.9 : 7);
  return ('<svg class="md" viewBox="0 0 64 64" role="img" aria-label="' + label + '"><defs>' +
    '<linearGradient id="mdG" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f6e3a6"/><stop offset=".5" stop-color="#d1a847"/><stop offset="1" stop-color="#8a6420"/></linearGradient>' +
    '<linearGradient id="mdS" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f4f6f9"/><stop offset=".55" stop-color="#aab1bd"/><stop offset="1" stop-color="#6c7482"/></linearGradient>' +
    '<linearGradient id="mdB" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4b7bc4"/><stop offset="1" stop-color="#1a3470"/></linearGradient>' +
    '<radialGradient id="mdR" cx=".38" cy=".32" r=".8"><stop offset="0" stop-color="#e0434b"/><stop offset=".55" stop-color="#a3202a"/><stop offset="1" stop-color="#5a0b14"/></radialGradient></defs>' +
    rays +
    '<circle cx="32" cy="32" r="20.4" fill="#10182b" stroke="url(#mdG)" stroke-width=".9"/>' +
    leaves +
    '<circle cx="32" cy="32" r="17" fill="none" stroke="url(#mdB)" stroke-width="3.6"/>' +
    '<circle cx="32" cy="32" r="18.9" fill="none" stroke="url(#mdG)" stroke-width=".7"/>' +
    '<circle cx="32" cy="32" r="15.1" fill="none" stroke="url(#mdG)" stroke-width=".7"/>' +
    '<circle cx="32" cy="32" r="12.4" fill="url(#mdR)" stroke="url(#mdG)" stroke-width="1.3"/>' +
    '<polygon points="' + star + '" fill="url(#mdG)"/>' +
    '<path class="md-shine" d="M' + pt(-1.9, 10.4) + ' A10.4 10.4 0 0 1 ' + pt(-0.35, 10.4) + '" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="1.1" stroke-linecap="round"/>' +
    '</svg>').replace(/mdG|mdS|mdB|mdR/g, m => m + uid);
}
const MEDAL_HTML = '<div class="hm-medal">' + medalSvg('', '今日のメニュー全完了') + '<div class="hm-medal-lb">COMPLETE</div></div>';
/* PRミニ勲章（種目名の右。CSS で約24px。下に小さく PR） */
const prMedal = i => '<span class="hm-pr">' + medalSvg('p' + i, 'PR更新') + '<span class="hm-medal-lb">PR</span></span>';

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
  const names = menuData[type].on;
  homeNames = names;
  const todays = workouts.filter(w => w.dateStr === today);
  const doneN = names.filter(n => todays.some(t => t.name.trim() === n)).length;
  const allDone = names.length > 0 && doneN === names.length;
  /* 選択中の部位のメニューを全完了したときだけ、部位文字（.hm-big）の右横に勲章を出す */
  let h = '<div class="hm-card"><div class="hm-pad"><div class="hm-lb">今日のおすすめ</div><div class="hm-top"><div class="hm-big">' + type +
    '</div>' + (allDone ? MEDAL_HTML : '') + '</div><div class="hm-sub">' + sub + '</div><div class="hm-ord">' + chips + '</div></div></div>';
  if (!names.length) {
    el.innerHTML = h + '<div class="hm-card"><div class="hm-pad hm-sub">' + type + ' のメニューが空です。「編集・分析/設定」→「設定」の「種目の編集」から追加できます。</div></div>';
    return;
  }
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
      escapeHtml(n) + '</div>' + (pr ? prMedal(i) : '') + '</div><div class="hm-act">' + (t ? '' : '<button type="button" class="hm-in" onclick="homeFill(' + i + ')">入力</button>') +
      '<button type="button" class="hm-dt">詳細</button>' +
      '<span class="hm-chev"></span></div></div><div class="hm-mini"><div class="hm-st">' +
      (b ? (t ? '今日 ' : '前回 ') + fmtSet(b) : '') +
      (tr ? (tr.cls === 'plat' && open
        ? '<span class="hm-trw"><span class="hm-tr plat">' + tr.txt + '</span><span class="hm-tip">レスト+1分or重量-10%</span></span>'
        : '<span class="hm-tr ' + tr.cls + '">' + tr.txt + '</span>') : '') + '</div>' +
      '</div>' +
      (open && s.length ? '<div class="hm-past">' + detailDaysHtml(detailStats(n), 3) + '</div>' : '') +
      '</div>';
  });
  el.innerHTML = h + '</div>';
}
/* シェブロンの動き：ホームは開閉のたびに描き直すので、描き直し後に「開く／閉じる」の動きを付ける（履歴のシェブロンと同じ 0.2 秒） */
function animateChevs(prev, cur) {
  const root = document.getElementById('tabContentHome');
  if (!root) return;
  const mark = (name, cls) => {
    const i = homeNames.indexOf(name);
    const c = i < 0 ? null : root.querySelector('.hm-ex[data-i="' + i + '"] .hm-chev');
    if (c) c.classList.add(cls);
  };
  if (prev !== null && prev !== cur) mark(prev, 'hm-chev-close');
  if (cur !== null && cur !== prev) mark(cur, 'hm-chev-open');
}
document.addEventListener('click', e => {
  const r = e.target.closest('.hm-ex');
  if (!r) return;
  const n = homeNames[parseInt(r.dataset.i, 10)];
  if (n === undefined) return;
  if (e.target.closest('.hm-dt')) { openDetail(n); return; } /* 詳細：別ページ（全画面）へ。ホームの展開状態はそのまま（閉じるのは戻ったとき） */
  const dh = e.target.closest('.dt-dh');
  if (dh) { /* 過去記録の日タップ：セット内訳だけ開閉する（アコーディオンは閉じない） */
    const body = dh.nextElementSibling, ic = dh.querySelector('.ex-toggle-icon');
    if (body) { const hidden = body.classList.toggle('hidden'); if (ic) ic.classList.toggle('is-open', !hidden); }
    return;
  }
  if (e.target.closest('.hm-in')) return;
  const prev = homeOpen;
  homeOpen = prev === n ? null : n;
  requestRender({ view: 'home' });
  animateChevs(prev, homeOpen);
});

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
const editorOpen = () => !!document.getElementById('menuEditor');

/* ===== 画面の重なり防止（メニュー編集／日付シート）と履歴スタックの同期
   ・重なる画面は同時に1つだけ。履歴の重なり用エントリ（state: {me:1} か {sheet:1}）も常に1つだけ
   ・閉じる操作（✕／キャンセル／保存／背景タップ）は画面をすぐ消して履歴を1つ戻す。ブラウザの戻る操作は popstate で画面を消す
   ・history.back() の完了（popstate）を待つあいだに開く操作が来たら、完了後に実行する ===== */
let navBusy = false, navQueue = [], navTimer = null;
let detailEl = null, detailState = null; /* 種目別の詳細ページ（全画面）と、その表示状態（開くたびに初期状態から作る） */
function navDone() {
  navBusy = false;
  clearTimeout(navTimer);
  const q = navQueue;
  navQueue = [];
  q.forEach(f => { try { f(); } catch (e) { console.log(e); } });
}
function layerFlagged() { const s = history.state; return !!(s && (s.sheet || s.me || s.ex)); }
function enterLayer(flag) {
  try {
    if (layerFlagged()) history.replaceState({ [flag]: 1 }, ''); /* すでに重なり用の履歴があれば差し替え（増やさない） */
    else history.pushState({ [flag]: 1 }, '');
  } catch (e) {}
}
function leaveLayer() {
  if (!layerFlagged()) return;
  navBusy = true;
  clearTimeout(navTimer);
  navTimer = setTimeout(navDone, 600); /* popstate が来なくても止まらないように */
  try { history.back(); } catch (e) { navDone(); }
}
function afterNav(fn) { if (navBusy) navQueue.push(fn); else fn(); }
/* 重なる画面（メニュー編集／日付シート）を開く共通の入口
   ・canOpen() が false なら何もしない（同時に開かない）。戻る操作の完了待ちなら、完了後にもう一度確かめて開く
   ・開く前にテンキーを閉じ、build()（画面を作って取り付け、描画関数を返す）→ 履歴の重なり用エントリ → 描画 の順 */
function openLayer(flag, canOpen, build) {
  if (!canOpen()) return;
  afterNav(() => {
    if (!canOpen()) return;
    closePad();
    const paintLayer = build();
    enterLayer(flag);
    if (paintLayer) paintLayer();
  });
}
window.addEventListener('popstate', () => {
  const s = history.state || {};
  if (!s.sheet) removeSheet();
  if (!s.me) closeEditor();
  if (!s.ex) removeDetail();
  navDone();
});
function leaveEditor() {
  closeEditor();
  leaveLayer();
}
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
    /* 保存できなければ、メモリ・保存領域とも元に戻し、編集画面は開いたまま（成功の通知は出さない） */
    const ok = transact(['menu'], () => {
      TYPES.forEach(t => {
        const s = activeSlot(t), d = draft[t];
        s.name = fitName(String(d.name || '').trim()) || ('枠' + (tplData[t].idx + 1));
        const l = normMenu({ [t]: d })[t];
        s.on = l.on;
        s.off = l.off;
      });
    });
    if (!ok) return;
    leaveEditor();
    requestRender('menu');
    window.alert('メニューを保存しました', 0, 'ok');
    return;
  }
  if (act === 'type') editType = b.dataset.t;
  else if (act === 'up' && i > 0) { const t = m.on[i - 1]; m.on[i - 1] = m.on[i]; m.on[i] = t; }
  else if (act === 'down' && i < m.on.length - 1) { const t = m.on[i + 1]; m.on[i + 1] = m.on[i]; m.on[i] = t; }
  else if (act === 'hide') m.off.push(m.on.splice(i, 1)[0]);
  else if (act === 'restore') m.on.push(m.off.splice(i, 1)[0]);
  else if (act === 'addpast') addName(pastCache[i]);
  else if (act === 'add') { const inp = document.getElementById('meInput'); if (inp) { addName(inp.value); inp.value = ''; } }
  renderEditor();
}
window.openMenuEditor = function () {
  openLayer('me', () => !editorOpen() && !detailEl, () => { /* 二重表示しない */
    removeSheet(); /* 日付シートが開いていれば、先に閉じてから開く（履歴は差し替えるので増えない） */
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
    return renderEditor;
  });
};
/* 「編集・分析/設定」タブ：各部位の4枠ボタン（オン＝ゴールド塗り、オフ＝金枠）。タップで即切り替え */
function renderMenuSummary() {
  const el = document.getElementById('menuSummary');
  if (!el) return;
  ensureMenu();
  el.innerHTML = TYPES.map(t => '<div class="ms-row"><span class="ms-t">' + t + '</span><div class="ms-slots">' +
    tplData[t].slots.map((s, i) => '<button type="button" class="ms-slot' + (i === tplData[t].idx ? ' on' : '') + '" onclick="tplSelect(\'' + t + '\',' + i + ')">' + escapeHtml(s.name) +
      '</button>').join('') +
    '</div></div>').join('');
}

/* ===== カレンダー（編集・分析/設定タブの一番上。記録の編集・削除はここから開く日付シートに一本化） ===== */
let cal = (() => { const n = new Date(); return { y: n.getFullYear(), m: n.getMonth() }; })();
window.calShift = function (d) {
  const n = new Date(), t = cal.y * 12 + cal.m + d;
  if (t > n.getFullYear() * 12 + n.getMonth()) return;
  cal = { y: Math.floor(t / 12), m: t % 12 };
  requestRender({ view: 'calendar' });
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
  let h = '<div class="sh-head"><span class="text-sm font-bold text-orange-400">' + fmtD(d) + '</span>' +
    '<button type="button" class="ppl-btn" aria-haspopup="dialog" onclick="pickPpl(\'' + d + '\')">' + cur + '</button>' +
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
        '<button type="button" onclick="event.stopPropagation(); sheetEdit(\'' + item.id + '\')" class="ex-edit">編集</button>' +
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
  if (!box) return;
  const openIds = [...box.querySelectorAll('.ex-content:not(.hidden)')].map(e => { const c = e.closest('[data-id]'); return c ? c.dataset.id : null; }).filter(Boolean);
  const oldBody = box.querySelector('.sh-body');
  const top = oldBody ? oldBody.scrollTop : 0;
  box.innerHTML = sheetHtml(sheetDate);
  openIds.forEach(id => {
    const c = box.querySelector('[data-id="' + id + '"]');
    const content = c && c.querySelector('.ex-content'), icon = c && c.querySelector('.ex-toggle-icon');
    if (content) content.classList.remove('hidden');
    if (icon) icon.classList.add('is-open');
  });
  const nb = box.querySelector('.sh-body');
  if (nb) nb.scrollTop = top;
  syncChev(box);
}
function removeSheet() {
  const pk = document.getElementById('pplPicker'); /* 部位選択モーダルが開いたままシートが閉じても残さない */
  if (pk) pk.remove();
  if (sheetEl) sheetEl.remove();
  sheetEl = null;
  sheetDate = null;
}
function closeSheet() {
  if (!sheetEl) return;
  removeSheet();
  leaveLayer();
}
function openSheet(d) {
  /* メニュー編集が開いている間は開かない（編集中の内容を守る） */
  openLayer('sheet', () => !sheetEl && !editorOpen() && !detailEl, () => {
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
    return renderSheet;
  });
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

/* ===== 種目別の詳細ページ（ホームの種目行を開いて「詳細」→ 独立した全画面。右上の金の「✕」／戻る操作／余白タップで閉じる）
   ・閉じるとホームの種目の展開は閉じた状態に戻る。もう一度開くと、グラフの件数（5件）は初期状態から始まる（状態は開くたびに作り直す）
   ・内容：基本サマリー（総実施回数・累計総負荷）／自己ベスト（PR）／グラフ・推移（5・10・20件）と前回比
   ・グラフは既存の line()（金＝総合・赤＝推定1RM。色は固定）をそのまま使う ===== */
const DETAIL_COUNTS = [5, 10, 20];
function detailStats(name) {
  const map = {};
  workouts.filter(w => w.name.trim() === name).forEach(w => { (map[w.dateStr] = map[w.dateStr] || []).push(...w.setList); });
  const days = Object.keys(map).sort();
  const st = { days, map, vol: 0, pw: null, p1: null, ps: null };
  days.forEach(d => { /* 古い日から順に見て「より大きい」ときだけ更新する＝同値なら最初に達成した日 */
    const sets = map[d];
    sets.forEach(s => {
      st.vol += s.weight * s.reps;
      if (s.weight > 0 && (!st.pw || s.weight > st.pw.v)) st.pw = { v: s.weight, d };
    });
    const rm = est1RM(sets), mt = metric(sets);
    if (rm > 0 && (!st.p1 || rm > st.p1.v)) st.p1 = { v: rm, d };
    if (!st.ps || mt > st.ps.v) st.ps = { v: mt, d };
  });
  return st;
}
const r1 = x => Math.round(x * 10) / 10;
function diffHtml(d, unit) {
  const v = r1(d);
  if (v === 0) return '<div class="dt-d same">±0</div>';
  return '<div class="dt-d ' + (v > 0 ? 'up' : 'down') + '">' + (v > 0 ? '+' : '−') + Math.abs(v) + unit + '</div>';
}
function detailGraphHtml(name, n) {
  const s = seriesAll(name).slice(-n);
  if (s.length < 2) return '<div class="hm-sub">2回以上の記録でグラフが出ます。</div>';
  return line(s.map(x => x.v), 320, 138, s.map(x => x.d), s.map(x => x.rm));
}
function detailCompareHtml(st) {
  const n = st.days.length;
  if (n < 2) return '<div class="hm-sub dt-pad">2回以上の記録で前回との比較が出ます。</div>';
  const a = st.map[st.days[n - 1]], b = st.map[st.days[n - 2]], ba = bestSet(a), bb = bestSet(b);
  const cell = (k, cur, d, u) => '<div class="dt-cell"><div class="hm-lb">' + k + '</div><div class="dt-v">' + cur + '<span class="dt-u">' + u + '</span></div>' + diffHtml(d, u) + '</div>';
  return '<div class="hm-sub dt-pad">' + fmtD(st.days[n - 2]) + ' → ' + fmtD(st.days[n - 1]) + '（ベストセット）</div><div class="dt-cmp">' +
    cell('重量', ba.weight, ba.weight - bb.weight, 'kg') + cell('回数', ba.reps, ba.reps - bb.reps, '回') +
    cell('推定1RM', est1RM(a), est1RM(a) - est1RM(b), 'kg') + '</div>';
}
/* 種目名の横：最終実施日と今日との日数差（当日＝今日／未実施＝未実施） */
function lastDoneHtml(st) {
  if (!st.days.length) return '<span class="hm-sub">未実施</span>';
  const d = st.days[st.days.length - 1], p = d.split('-').map(Number), n = new Date();
  const diff = Math.round((new Date(n.getFullYear(), n.getMonth(), n.getDate()) - new Date(p[0], p[1] - 1, p[2])) / 864e5);
  return '<span class="hm-sub">最終実施: ' + fmtD(d) + '（' + (diff <= 0 ? '今日' : diff + '日前') + '）</span>';
}
/* 過去記録（ホームの開いた行に表示。新しい日から visible 件。タップでセット内訳） */
function detailDaysHtml(st, visible) {
  return st.days.slice().reverse().slice(0, visible).map(d => {
    const sets = st.map[d], b = bestSet(sets), vol = sets.reduce((a, s) => a + s.weight * s.reps, 0);
    return '<div class="dt-day" data-d="' + d + '"><div class="dt-dh" data-dt="day"><span class="dt-dd">' + fmtD(d) + '</span><span class="dt-sum">' +
      '<span><i>ベスト</i>' + fmtSet(b) + '</span><span><i>1RM</i>' + est1RM(sets) + 'kg</span><span><i>総負荷</i>' + Math.round(vol).toLocaleString() + 'kg</span></span>' +
      '<span class="ex-toggle-icon"></span></div><div class="dt-sets hidden">' +
      sets.map((s, i) => '<div class="dt-set"><span class="dt-sn">' + (i + 1) + '.</span><span>' + fmtSet(s) + '</span></div>').join('') + '</div></div>';
  }).join('');
}
function renderDetail() {
  if (!detailEl || !detailState) return;
  const st = detailStats(detailState.name);
  let h = '<div class="dt-head"><div class="dt-ttl"><span class="hm-en">' + escapeHtml(detailState.name) + '</span>' + lastDoneHtml(st) + '</div>' +
    '<button type="button" class="dt-x" data-dt="close" aria-label="閉じる">✕</button></div><div class="dt-body">';
  if (!st.days.length) {
    detailEl.innerHTML = h + '<div class="hm-sub dt-pad">この種目の記録がまだありません。</div></div>';
    return;
  }
  const best = x => x ? '<div class="dt-row"><div class="hm-lb">' + x.k + '</div><div><span class="dt-v">' + x.v + '</span><span class="dt-date">' + fmtD(x.d) + '</span></div></div>' : '';
  const cellv = (k, v, u) => '<div class="dt-cell"><div class="hm-lb">' + k + '</div><div class="dt-v">' + v + '<span class="dt-u">' + u + '</span></div></div>';
  h += '<div class="dt-sec">基本サマリー</div><div class="dt-grid">' +
    cellv('総実施回数', st.days.length, '回') + cellv('累計総負荷', Math.round(st.vol).toLocaleString(), 'kg') + '</div>' +
    '<div class="dt-sec">自己ベスト（PR）</div>' +
    best(st.pw && { k: '最大重量', v: st.pw.v + 'kg', d: st.pw.d }) +
    best(st.p1 && { k: '推定1RM', v: st.p1.v + 'kg', d: st.p1.d }) +
    best(st.ps && { k: '1日スコア', v: st.ps.v, d: st.ps.d }) +
    '<div class="dt-sec dt-sec-row"><span>グラフ・推移</span><div class="dt-n">' +
    DETAIL_COUNTS.map(n => '<button type="button" class="gr-btn' + (n === detailState.n ? ' on' : '') + '" data-dt="n" data-n="' + n + '" aria-pressed="' + (n === detailState.n ? 'true' : 'false') + '">' + n + '件</button>').join('') +
    '</div></div><div class="dt-graph" id="dtGraph">' + detailGraphHtml(detailState.name, detailState.n) + '</div>' +
    '<div class="dt-sec">前回との比較</div>' + detailCompareHtml(st) +
    '</div>';
  detailEl.innerHTML = h;
}
/* グラフだけ描き直す（件数ボタン）。ページのスクロール位置や過去記録の開閉は触らない */
function paintDetailGraph() {
  if (!detailEl || !detailState) return;
  const g = detailEl.querySelector('#dtGraph');
  if (g) g.innerHTML = detailGraphHtml(detailState.name, detailState.n);
  detailEl.querySelectorAll('[data-dt="n"]').forEach(b => {
    const on = parseInt(b.dataset.n, 10) === detailState.n;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}
function onDetailClick(e) {
  /* 余白（ページ本体・見出しのタイトル部分）をタップしたら閉じる。ボタンや日付行のタップはそのまま */
  if (e.target === detailEl || e.target.classList.contains('dt-body') || e.target.closest('.dt-ttl')) { leaveDetail(); return; }
  const b = e.target.closest('[data-dt]');
  if (!b || !detailState) return;
  const a = b.dataset.dt;
  if (a === 'close') leaveDetail();
  else if (a === 'n') {
    const n = parseInt(b.dataset.n, 10);
    if (DETAIL_COUNTS.includes(n) && n !== detailState.n) { detailState.n = n; paintDetailGraph(); }
  } else if (a === 'day') {
    const body = b.nextElementSibling, ic = b.querySelector('.ex-toggle-icon');
    if (!body) return;
    const hidden = body.classList.toggle('hidden');
    if (ic) ic.classList.toggle('is-open', !hidden);
  }
}
function openDetail(name) {
  if (name === undefined) return;
  openLayer('ex', () => !detailEl && !sheetEl && !editorOpen(), () => {
    detailState = { name: name, n: DETAIL_COUNTS[0] }; /* グラフ件数は 5 件から */
    detailEl = document.createElement('div');
    detailEl.id = 'exDetail';
    detailEl.setAttribute('role', 'dialog');
    detailEl.setAttribute('aria-modal', 'true');
    detailEl.addEventListener('click', onDetailClick);
    document.body.appendChild(detailEl);
    return renderDetail;
  });
}
/* 閉じる：ホームで開いていた種目は閉じた状態に戻す（ホームを描き直す） */
function removeDetail() {
  if (!detailEl) return;
  detailEl.remove();
  detailEl = null;
  detailState = null;
  homeOpen = null;
  requestRender({ view: 'home' });
}
function leaveDetail() {
  if (!detailEl) return;
  removeDetail();
  leaveLayer();
}

/* ===== 下タブ ===== */
const TABS = { home: 'tabContentHome', workout: 'tabContentWorkout', cardio: 'tabContentCardio', settings: 'tabContentSettings' };
/* 画面の切り替え。extra … 同時に描き直すもの（起動時の { w, c } など） */
function showTab(name, extra) {
  if (alarmInterval) stopTimer();
  closePad(); /* 下タブが前面にあっても、移動先にテンキーを残さない */
  if (name !== 'workout') closeHistory(); /* 別ページへ移動したら履歴の種目一覧・セット内訳・グラフを閉じる */
  if (name !== 'home') homeOpen = null; /* ホームの種目の展開（グラフ）も閉じる。次にホームへ戻ったときは閉じた状態で描く */
  const paging = resetPaging(); /* 履歴の表示件数は基準に戻す（トレーニング＝4件、有酸素＝5件） */
  Object.keys(TABS).forEach(k => {
    const el = document.getElementById(TABS[k]);
    if (el) el.classList.toggle('hidden', k !== name);
  });
  document.querySelectorAll('#bottomNav button').forEach(b => b.classList.toggle('on', b.dataset.t === name));
  if (name === 'settings') { anPeriod = 'week'; setSub('analysis'); } /* 「編集・分析/設定」を開いたときは、最初に「編集・分析」（分析カードは週間分析から） */
  /* 件数を戻した履歴と、見えるようになった画面（ホーム／月間・設定）を、最新の内容で1回だけ描く */
  const e = extra || {};
  requestRender({ w: !!e.w || paging.w, c: !!e.c || paging.c, view: name });
  fitTimer(); /* トレーニング画面が見えるようになったとき、タイマーの文字サイズを合わせる */
  safe(paintRing); /* 目盛りリングも最新の状態に */
  window.scrollTo(0, 0);
}
window.switchTab = function (name) { showTab(name); };

/* 起動：1手順ずつ実行し、要素が無いなどで1つ失敗しても後続の初期化を止めない
   （保存済みテーマを適用 → 履歴・有酸素・ホームを showTab で1回ずつ描く） */
function step(fn) { try { fn(); } catch (e) { console.log(e); } }
step(() => { if (layerFlagged()) history.replaceState(null, ''); }); /* 再読み込みで残った重なり用の履歴状態を消す */
step(() => applyTheme(getTheme()));
step(() => showTab('home', { w: true, c: true })); /* 履歴・有酸素・ホームを1回ずつ描く */
step(() => fitTimer(true));
step(() => { if (storageWarn) window.alert('保存データの一部を読み込めませんでした。バックアップから復元してください。', 7000); });
})();
