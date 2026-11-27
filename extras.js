/* =====================================================================
   extras.js：画面（ホーム／カレンダー／日付シート／メニュー編集／テンキー／テーマ／タブ）と、描画の入口
   index.html のスクリプトの後ろに読み込む。index.html の関数は上書き（ラップ）しない

   ■ extras.js が index.html に公開するもの（index.html はこれ以外の中身を知らない）
     requestRender(scope)  … 画面更新の唯一の入口（下の paint）
     askConfirm / alert    … 確認ダイアログ・トースト
     todayType / menuAddExercise / tplExport / tplImport … 部位・メニュー（PARTS.menu もここで登録）
     Numpad                … テンキーの窓口（close / followNewRow / release）
     TextPad               … 文字パッドの窓口（close）。種目名などの文字入力欄にフリック／英字パッドを出す
   ■ PR演出：prSnap / prCheck / showPRModal（保存時の判定と、金色の「記録更新！！」モーダル＋ゴリ朱印の押印アニメ＋バイブ。初回記録は出さない）
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
let undoTick = null; /* 「元に戻す」の残り秒数を更新するタイマー */
const undoQueue = []; /* 取り消し待ち（削除ごとに1件積む。末尾が表示中で、新しいものから順に戻す） */
let undoShown = null; /* いまトーストに表示している取り消し */
let undoBtn = null; /* 表示中の「元に戻す」ボタン */
/* 取り消しの待ち行列とタイマーを止める（別の通知が出たときに必ず通す） */
function clearUndo() {
  undoQueue.length = 0;
  undoShown = null;
  undoBtn = null;
  if (undoTick) { clearInterval(undoTick); undoTick = null; }
}
/* kind: 'ok'（保存できた）／'err'（失敗）。省略時は文言から判定 */
window.alert = function (msg, ms, kind) {
  const m = String(msg);
  toastEl.textContent = m;
  toastEl.className = 'show' + (kind ? ' ' + kind : /できません|失敗/.test(m) ? ' err' : '');
  clearTimeout(toastTimer);
  clearUndo(); /* 別の通知が出たら、取り消しの残り時間表示も止める */
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms || 2200);
};
/* 削除の取り消し用トースト（「元に戻す (10s)」ボタンつき。残り秒数が減り、10秒で消える）
   連続で削除しても前の取り消しは消えない：削除ごとに待ち行列へ積み、新しいものから順に戻せる。
   期限は削除ごとに個別（押した時点から10秒）で、表示中のものが終わると前のものが残り時間つきで出る */
const UNDO_SEC = 10;
function paintUndo() {
  const cur = undoQueue[undoQueue.length - 1] || null;
  if (!cur) {
    if (undoTick) { clearInterval(undoTick); undoTick = null; }
    undoShown = null;
    undoBtn = null;
    toastEl.classList.remove('show', 'undoable');
    toastEl.innerHTML = '';
    return;
  }
  if (undoShown === cur) return; /* 表示中のものはそのまま（秒数だけ tick で更新） */
  undoShown = cur;
  toastEl.innerHTML = '';
  const span = document.createElement('span');
  span.textContent = cur.msg + (undoQueue.length > 1 ? '（あと' + (undoQueue.length - 1) + '件も戻せます）' : '');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'toast-undo';
  btn.textContent = '元に戻す (' + Math.max(1, Math.ceil((cur.endAt - Date.now()) / 1000)) + 's)';
  btn.addEventListener('click', () => {
    const i = undoQueue.indexOf(cur);
    if (i >= 0) undoQueue.splice(i, 1);
    undoShown = null;
    paintUndo();
    if (cur.onUndo) cur.onUndo();
  });
  undoBtn = btn;
  toastEl.appendChild(span);
  toastEl.appendChild(btn);
  toastEl.className = 'show undoable';
  if (!undoTick) {
    undoTick = setInterval(() => {
      const now = Date.now();
      for (let i = undoQueue.length - 1; i >= 0; i--) if (undoQueue[i].endAt <= now) undoQueue.splice(i, 1);
      const c = undoQueue[undoQueue.length - 1] || null;
      if (c !== undoShown) { paintUndo(); return; }
      if (c && undoBtn) undoBtn.textContent = '元に戻す (' + Math.max(1, Math.ceil((c.endAt - now) / 1000)) + 's)';
    }, 250);
  }
}
window.showUndoToast = function (msg, onUndo) {
  clearTimeout(toastTimer);
  undoQueue.push({ msg: msg, onUndo: onUndo, endAt: Date.now() + UNDO_SEC * 1000 });
  undoShown = null; /* 新しく積んだ末尾を必ず表示し直す */
  paintUndo();
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

/* ===== HIITの種類の選択モーダル（日付シートの「HIIT追加」用。部位選択と同じ黒×金。タップで即追加して閉じる） ===== */
window.pickHiit = function (d) {
  if (document.getElementById('hiitPicker')) return; /* 二重表示しない */
  const o = document.createElement('div');
  o.id = 'hiitPicker';
  o.setAttribute('role', 'dialog');
  o.setAttribute('aria-modal', 'true');
  o.innerHTML = '<div class="modal-box"><p>HIITの種類を選択</p><div class="pk-list">' +
    HIIT_PRESETS.map(p => '<button type="button" class="pk-opt" data-v="' + p.name + '">' + p.name + '</button>').join('') +
    '</div><div class="modal-actions"><button type="button" data-v="">キャンセル</button></div></div>';
  o.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b && e.target !== o) return;
    const v = b ? b.dataset.v : '';
    o.remove();
    if (v) {
      const pr = HIIT_PRESETS.find(p => p.name === v);
      markHiitDay(d, v, pr ? { w: pr.work, r: pr.rest, n: pr.rounds } : null);
      renderSheet();
      requestRender('all');
    }
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
/* ===== データ使用量（「設定」タブ：約◯KB／目安5MB）
   このアプリのキー（simple_ ＝記録・有酸素・部位・メニュー・復元前の控え など ／ iron_ ＝テーマ・最終バックアップ日）だけを数える。
   localStorage は文字を2バイト（UTF-16）で数えるため、（キー名＋中身）の文字数×2 を使う ===== */
const USAGE_PREFIXES = ['simple_', 'iron_'];
function dataUsageBytes() {
  let chars = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !USAGE_PREFIXES.some(p => k.indexOf(p) === 0)) continue;
    const v = localStorage.getItem(k);
    chars += k.length + (v == null ? 0 : v.length);
  }
  return chars * 2;
}
const USAGE_GUIDE_BYTES = 5 * 1024 * 1024; /* データ使用量の目安（5MB） */
function usageWarn(bytes) { return bytes >= USAGE_GUIDE_BYTES * 0.8; } /* 目安の8割で警告 */
function paintDataUsage() {
  const el = document.getElementById('dataUsageInfo');
  if (!el) return;
  try {
    const bytes = dataUsageBytes();
    const kb = bytes / 1024;
    let h = 'データ使用量：約' + (kb < 100 ? kb.toFixed(1) : Math.round(kb).toLocaleString()) + 'KB／目安5MB';
    if (usageWarn(bytes)) h += '<br><span style="color:#e5484d">⚠ 目安の8割を超えています。JSONバックアップを書き出して保存してください</span>';
    el.innerHTML = h;
  } catch (err) {
    el.textContent = 'データ使用量：取得できませんでした';
  }
}
window.paintDataUsage = paintDataUsage; /* index.html の exportData（最終バックアップ日の保存）からも呼ぶ */
window.setTheme = function (t) {
  if (THEMES.indexOf(t) < 0) return;
  const prev = document.documentElement.getAttribute('data-theme') || 'gold';
  let ok = true;
  try { localStorage.setItem(THEME_KEY, t); } catch (e) { ok = false; }
  if (!ok) { applyTheme(prev); window.alert('保存できませんでした'); return; } /* 保存できなければ見た目も元のまま */
  applyTheme(t);
  paintDataUsage(); /* テーマの保存でも使用量が変わる */
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
let anMonths = 6; /* 推移グラフの表示月数：3／6／12（初期は6） */
let anSel = null; /* 推移グラフで選択中の月（ym）。null＝最新月 */
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
  return { min: min, kcal: Math.round(min * KCAL_PER_MIN) };
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
function anSeries(months) {
  const n = new Date(), vol = volByDay(), out = [];
  for (let i = (months || 6) - 1; i >= 0; i--) {
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
  const md = AN_MODES[anMode] || AN_MODES.days, s = anSeries(anMonths), v = s.map(md.get);
  if (v.filter(x => x > 0).length < 2) return '<div class="hm-sub">2か月以上の記録で推移グラフを表示</div>';
  let si = anSel ? s.findIndex(x => x.ym === anSel) : s.length - 1;
  if (si < 0) si = s.length - 1;
  return '<div class="hm-leg"><span class="lg-g">' + md.leg + '</span></div>' +
    line(v, 320, 138, s.map(x => x.ym), null, ym => parseInt(ym.slice(5), 10) + '月',
      { min: 0, max: niceMax(Math.max(...v), md.floor, md.cap), fmtV: nf }, { a: 'an', sel: si });
}
/* 推移グラフ下の固定欄：選択中の月（初期は最新月）の3指標 */
function anInfoHtml() {
  const s = anSeries(anMonths);
  if (s.length < 2) return '';
  const x = (anSel && s.find(e => e.ym === anSel)) || s[s.length - 1], p = x.ym.split('-').map(Number);
  return '<span class="gr-d">' + p[0] + '年' + p[1] + '月</span><span>トレ <b>' + x.days + '日</b></span>' +
    '<span>総負荷 <b>' + nf(x.vol) + 'kg</b></span><span>有酸素 <b>' + nf(x.min) + '分</b></span>';
}
/* グラフだけ描き直す（切替ボタン）。分析カード全体や画面のスクロールは触らない */
function paintAnGraph() {
  const g = document.getElementById('anGraph');
  if (g) g.innerHTML = anGraphHtml();
  const inf = document.getElementById('anInfo');
  if (inf) inf.innerHTML = anInfoHtml();
  document.querySelectorAll('#analysisBody [data-an="span"]').forEach(b => {
    const on = parseInt(b.dataset.m, 10) === anMonths;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  const card = g && g.closest('.rounded-2xl'), tt = card && card.querySelector('.dt-sec');
  if (tt) tt.textContent = '月間推移（直近' + anMonths + 'か月）';
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
  const trend = '<div class="bg-gray-800 border border-gray-700 rounded-2xl"><div class="dt-sec">月間推移（直近' + anMonths + 'か月）</div><div class="dt-n an-modes">' +
    Object.keys(AN_MODES).map(k => '<button type="button" class="gr-btn' + (k === anMode ? ' on' : '') + '" data-an="mode" data-m="' + k +
      '" aria-pressed="' + (k === anMode ? 'true' : 'false') + '">' + AN_MODES[k].label + '</button>').join('') +
    '</div><div class="dt-n an-pers">' + [3, 6, 12].map(m => '<button type="button" class="gr-btn' + (m === anMonths ? ' on' : '') + '" data-an="span" data-m="' + m + '" aria-pressed="' + (m === anMonths ? 'true' : 'false') + '">' + m + 'か月</button>').join('') + '</div><div class="dt-graph" id="anGraph">' + anGraphHtml() + '</div><div class="gr-info" id="anInfo">' + anInfoHtml() + '</div></div>';
  const achCats = achievements();
  let achTotal = 0, achGot = 0;
  achCats.forEach(c => c.items.forEach(x => { achTotal++; if (x.got) achGot++; }));
  const pfLv = profileStats().lv;
  const newN = achNewCount(achCats);
  const achRow = '<button type="button" class="ach-entry ach-entry-gold" data-an="ach"><span>プロフィール</span><span class="ach-entry-r"><span class="ach-entry-n">Lv.' + pfLv + ' 達成 ' + achGot + '/' + achTotal + '</span>' + (newN > 0 ? '<span class="ach-new-badge">＋' + newN + '</span>' : '') + '<span class="ach-entry-ar">›</span></span></button>';
  el.innerHTML = achRow + anTabsHtml() + '<div id="anCard">' + anCardHtml() + '</div>' + trend + '<button type="button" class="ai-btn" data-an="ai">分析させる</button>'; /* プロフィールはカレンダー直下。分析させるはページ最下部。月間推移は週間・月間どちらでも常時表示 */
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-an]');
  if (!b || !b.closest('#analysisBody')) return;
  if (b.dataset.an === 'mode') {
    const md = b.dataset.m;
    if (!AN_MODES[md] || md === anMode) return;
    anMode = md;
    paintAnGraph();
  } else if (b.dataset.an === 'span') {
    const m = parseInt(b.dataset.m, 10);
    if (![3, 6, 12].includes(m) || m === anMonths) return;
    anMonths = m; anSel = null;
    paintAnGraph();
  } else if (b.dataset.an === 'pt') {
    const s = anSeries(anMonths), x = s[parseInt(b.dataset.gi, 10)];
    if (x && x.ym !== anSel) { anSel = x.ym; paintAnGraph(); }
  } else if (b.dataset.an === 'ach') {
    openAchievements();
  } else if (b.dataset.an === 'ai') {
    openAiAnalysis();
  } else if (b.dataset.an === 'period') {
    const p = b.dataset.p;
    if ((p !== 'week' && p !== 'month') || p === anPeriod) return;
    anPeriod = p;
    paintAnCard();
  }
});
/* ===== プロフィール（経験値・レベル・称号・得意種目。全部「記録から計算」する＝記録そのものが成長になる） =====
   経験値の式：トレ1日=100XP／総負荷100kgごとに1XP／PR更新=50XP／有酸素10分ごとに1XP */
const XP_RULE = { day: 100, volPer: 100, pr: 50, cardioPer: 10 };
const TITLES = [[1, '駆け出し'], [3, '鍛錬者'], [5, '鉄の挑戦者'], [7, '筋力の求道者'], [9, '鉄人'], [12, '鋼の番人'], [15, '伝説の鍛錬者'], [20, '神話級']];
const MASTERY_DAYS = [1, 3, 5, 10, 20, 35, 50, 75, 100]; /* 得意種目レベル：実施日数が届いた段の数 */
function levelFor(xp) { let lv = 1; while (500 * lv * (lv + 1) <= xp) lv++; return lv; } /* Lv.n の必要累計XP = 500×(n-1)×n */
function profileStats() {
  const byDateId = (a, b) => a.dateStr === b.dateStr ? Number(a.id) - Number(b.id) : (a.dateStr < b.dateStr ? -1 : 1);
  const ws = [...workouts].sort(byDateId);
  const dayList = [...new Set(ws.map(w => w.dateStr))].sort();
  let vol = 0;
  ws.forEach(w => w.setList.forEach(s => { vol += (s.weight || 0) * (s.reps || 0); }));
  const byName = {};
  ws.forEach(w => {
    const n = w.name.trim();
    (byName[n] = byName[n] || {});
    (byName[n][w.dateStr] = byName[n][w.dateStr] || []).push(...w.setList);
  });
  let prTotal = 0;
  const exList = Object.keys(byName).map(n => {
    const ds = Object.keys(byName[n]).sort();
    let best = null, pr = 0, rm = 0;
    ds.forEach(d => {
      const sets = byName[n][d];
      const v = metric(sets);
      rm = Math.max(rm, est1RM(sets));
      if (best === null) best = v;
      else if (v > best) { best = v; pr++; }
    });
    prTotal += pr;
    return { name: n, days: ds.length, pr: pr, rm: rm };
  });
  const monday = ds => { const p = ds.split('-').map(Number), d = new Date(p[0], p[1] - 1, p[2]); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return d; };
  const weekSet = new Set(dayList.map(d => monday(d).getTime()));
  const weekTimes = [...weekSet].sort((a, b) => a - b);
  let run = 0, maxRun = 0, lastRun = 0, prevT = null;
  weekTimes.forEach(t => {
    run = (prevT !== null && t - prevT === 7 * 864e5) ? run + 1 : 1;
    prevT = t;
    lastRun = run;
    if (run > maxRun) maxRun = run;
  });
  const thisMon = monday(toDateStr(new Date())).getTime();
  const curRun = weekTimes.length && weekTimes[weekTimes.length - 1] >= thisMon - 7 * 864e5 ? lastRun : 0;
  let mins = 0;
  cardios.forEach(c => { mins += c.minutes || 0; });
  const xp = dayList.length * XP_RULE.day + Math.floor(vol / XP_RULE.volPer) + prTotal * XP_RULE.pr + Math.floor(mins / XP_RULE.cardioPer);
  const lv = levelFor(xp);
  const title = TITLES.reduce((a, t) => lv >= t[0] ? t[1] : a, TITLES[0][1]);
  let ageDays = 0;
  if (dayList.length) {
    const p = dayList[0].split('-').map(Number), n = new Date();
    ageDays = Math.round((new Date(n.getFullYear(), n.getMonth(), n.getDate()) - new Date(p[0], p[1] - 1, p[2])) / 864e5) + 1;
  }
  const top = exList.slice().sort((a, b) => b.days - a.days || b.pr - a.pr).slice(0, 3);
  const ace = exList.reduce((a, x) => x.rm > 0 && (!a || x.rm > a.rm) ? x : a, null);
  return { days: dayList.length, vol: vol, prTotal: prTotal, mins: mins, xp: xp, lv: lv, title: title, curRun: curRun, maxRun: maxRun, ageDays: ageDays, top: top, ace: ace };
}
function shareGorillaCard() {
  try {
    const p = profileStats();
    const img = new Image();
    img.onload = () => {
      try {
        const cv = document.createElement('canvas'); cv.width = 1080; cv.height = 1350;
        const c = cv.getContext('2d');
        c.fillStyle = '#0a0a0b'; c.fillRect(0, 0, 1080, 1350);
        c.strokeStyle = '#c9a96a'; c.lineWidth = 3; c.strokeRect(36, 36, 1008, 1278);
        c.drawImage(img, 240, 90, 600, 600);
        c.textAlign = 'center'; c.fillStyle = '#ece8dd';
        c.font = '700 64px sans-serif'; c.fillText('ゴリラフィットネス', 540, 800);
        c.font = '400 44px sans-serif'; c.fillStyle = '#c9a96a';
        c.fillText('Lv.' + p.lv + ' ' + p.title, 540, 890);
        c.fillStyle = '#ece8dd'; c.font = '700 92px sans-serif';
        c.fillText('ゴリラ約' + gorillaHeads(p.vol) + '頭分', 540, 1030);
        c.font = '400 40px sans-serif'; c.fillStyle = '#b9b4a6';
        c.fillText('総負荷 ' + (Math.round(p.vol / 100) / 10) + 't ／ 通算 ' + p.days + '日 ／ PR ' + p.prTotal + '回', 540, 1120);
        c.font = '400 34px sans-serif';
        c.fillText(dstr(new Date()), 540, 1240);
        cv.toBlob(async b => {
          try {
            const f = new File([b], 'gorilla-card.png', { type: 'image/png' });
            if (navigator.canShare && navigator.canShare({ files: [f] })) { await navigator.share({ files: [f] }); return; }
            throw new Error('no-share');
          } catch (e) {
            if (e && e.name === 'AbortError') return;
            const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'gorilla-card.png';
            document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
          }
        }, 'image/png');
      } catch (e) { alert('カードを作れませんでした'); }
    };
    img.onerror = () => alert('カードを作れませんでした');
    img.src = 'icon-512.png';
  } catch (e) { alert('カードを作れませんでした'); }
}
function profileCardHtml() {
  const p = profileStats();
  const prev = 500 * (p.lv - 1) * p.lv, next = 500 * p.lv * (p.lv + 1);
  const pct = Math.min(100, Math.floor((p.xp - prev) / (next - prev) * 100));
  const stat = (k, v) => '<div><div class="hm-lb">' + k + '</div><div class="pf-sv">' + v + '</div></div>';
  let h = '<div class="pf-card"><div class="pf-top"><div class="pf-lv"><span class="pf-lvn">' + p.lv + '</span><span class="pf-lvl">LEVEL</span></div>' +
    '<div class="pf-main"><div class="pf-title">' + escapeHtml(p.title) + '</div>' +
    '<div class="pf-xp">経験値 ' + p.xp.toLocaleString() + ' XP（次のレベルまで あと' + (next - p.xp).toLocaleString() + '）</div>' +
    '<div class="pf-bar"><i style="width:' + pct + '%"></i></div></div></div>' +
    '<div class="pf-stats">' +
    stat('トレ歴', p.ageDays ? p.ageDays + '日' : '—') +
    stat('通算トレ日数', p.days + '日') +
    stat('総負荷', (Math.round(p.vol / 100) / 10) + 't') +
    stat('現在の連続週', p.curRun + '週') +
    stat('最長連続週', p.maxRun + '週') +
    stat('PR更新', p.prTotal + '回') +
    '</div>';
  if (p.vol > 0) h += '<div class="pf-line">総負荷はゴリラ約' + gorillaHeads(p.vol) + '頭分（1頭＝160kg）</div><button type="button" class="pf-share" data-ach="gcard">ゴリラカードを共有</button>';
  if (p.ace) h += '<div class="pf-line">看板種目：' + escapeHtml(p.ace.name) + '（推定1RM ' + p.ace.rm + 'kg）</div>';
  if (p.top.length) {
    h += '<div class="pf-sec">得意種目</div>' + p.top.map(x => {
      const mlv = MASTERY_DAYS.filter(t => x.days >= t).length;
      return '<div class="pf-ex"><span>' + escapeHtml(x.name) + '</span><span class="pf-exd">Lv.' + mlv + '（' + x.days + '日・PR ' + x.pr + '回）</span></div>';
    }).join('');
  }
  return h + '</div>';
}
/* ===== 実績（記録から計算するだけ。保存データは増やさない） =====
   各実績は { name, got（達成日 dateStr／未達成は null）, prog（未達成時の進み具合） } */
function achTierDates(pairs, tiers) {
  /* pairs … [dateStr, 累計値] を日付順に並べたもの。累計が各 tiers に初めて届いた日を返す */
  return tiers.map(t => {
    const hit = pairs.find(p => p[1] >= t);
    return hit ? hit[0] : null;
  });
}
function achievements() {
  const ws = [...workouts].sort((a, b) => a.dateStr === b.dateStr ? Number(a.id) - Number(b.id) : (a.dateStr < b.dateStr ? -1 : 1));
  const cs = [...cardios].sort((a, b) => a.dateStr === b.dateStr ? Number(a.id) - Number(b.id) : (a.dateStr < b.dateStr ? -1 : 1));
  /* トレーニング日数（累計） */
  const dayList = [...new Set(ws.map(w => w.dateStr))].sort();
  const dayPairs = dayList.map((d, i) => [d, i + 1]);
  /* 総負荷（累計 kg） */
  let vol = 0; const volPairs = [];
  ws.forEach(w => { vol += w.setList.reduce((s, x) => s + (x.weight || 0) * (x.reps || 0), 0); volPairs.push([w.dateStr, vol]); });
  /* 種目数（累計） */
  const seen = new Set(); const exPairs = [];
  ws.forEach(w => { const n = w.name.trim(); if (!seen.has(n)) { seen.add(n); exPairs.push([w.dateStr, seen.size]); } });
  /* PR更新回数（種目ごとに、日単位のスコアが過去最高を超えた回数。初回は数えない） */
  const byName = {};
  ws.forEach(w => {
    const n = w.name.trim();
    if (!byName[n]) byName[n] = {};
    (byName[n][w.dateStr] = byName[n][w.dateStr] || []).push(...w.setList);
  });
  /* PRが起きた日を全種目まとめて集め、日付順に並べてから累計にする（種目ごとに集めると日付順が崩れ、達成日がズレる） */
  const prDates = [];
  Object.keys(byName).forEach(n => {
    let best = null;
    Object.keys(byName[n]).sort().forEach(d => {
      const v = metric(byName[n][d]);
      if (best === null) { best = v; return; }
      if (v > best) { best = v; prDates.push(d); }
    });
  });
  prDates.sort();
  const prCount = prDates.length;
  const prPairs = prDates.map((d, i) => [d, i + 1]);
  /* 連続週（週1回以上トレした週の連続。週の始まりは月曜） */
  const monday = ds => { const p = ds.split('-').map(Number), d = new Date(p[0], p[1] - 1, p[2]); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return d; };
  const weekFirst = {};
  dayList.forEach(d => { const m = monday(d); const k = m.getFullYear() + '-' + String(m.getMonth() + 1).padStart(2, '0') + '-' + String(m.getDate()).padStart(2, '0'); if (!weekFirst[k]) weekFirst[k] = d; });
  const weekKeys = Object.keys(weekFirst).sort();
  let run = 0, prevT = null; const runPairs = [];
  weekKeys.forEach(k => {
    const t = monday(k).getTime();
    run = (prevT !== null && t - prevT === 7 * 864e5) ? run + 1 : 1;
    prevT = t;
    runPairs.push([weekFirst[k], run]);
  });
  const curRun = run;
  /* 有酸素：日数と累計分 */
  const cDayList = [...new Set(cs.map(c => c.dateStr))].sort();
  const cDayPairs = cDayList.map((d, i) => [d, i + 1]);
  let mins = 0; const minPairs = [];
  cs.forEach(c => { mins += c.minutes || 0; minPairs.push([c.dateStr, mins]); });
  /* HIIT：累計回数（hiitDays は日付順に整列済み） */
  const hPairs = hiitDays.map((x, i) => [x.d, i + 1]);
  const mk = (tiers, pairs, cur, fmtLeft) => tiers.map((t, i) => {
    const got = achTierDates(pairs, tiers)[i];
    return { name: '', got: got, prog: got ? '' : fmtLeft(t, cur) };
  });
  const left = u => (t, cur) => 'あと' + (t - cur) + u;
  const pct = (t, cur) => Math.floor(cur / t * 100) + '%';
  const cats = [
    { label: '継続', items: [
      ...mk([10, 30, 50, 100, 200, 365], dayPairs, dayList.length, left('日')).map((x, i) => ({ ...x, name: '通算' + [10, 30, 50, 100, 200, 365][i] + '日' })),
      ...mk([4, 8, 12], runPairs, curRun, () => '現在' + curRun + '週').map((x, i) => ({ ...x, name: '連続' + [4, 8, 12][i] + '週' }))
    ]},
    { label: '成長', items: [
      ...mk([10000, 50000, 100000, 500000, 1000000], volPairs, vol, pct).map((x, i) => ({ ...x, name: '総負荷' + [10, 50, 100, 500, 1000][i] + 't' })),
      ...mk([10, 30, 50, 100], prPairs, prCount, left('回')).map((x, i) => ({ ...x, name: 'PR更新' + [10, 30, 50, 100][i] + '回' }))
    ]},
    { label: '挑戦', items: [
      ...mk([10, 20, 30], exPairs, seen.size, left('種目')).map((x, i) => ({ ...x, name: '' + [10, 20, 30][i] + '種目制覇' })),
      ...mk([10, 30, 100], cDayPairs, cDayList.length, left('日')).map((x, i) => ({ ...x, name: '有酸素' + [10, 30, 100][i] + '日' })),
      ...mk([600, 3000, 10000], minPairs, mins, pct).map((x, i) => ({ ...x, name: '有酸素' + [600, 3000, 10000][i] + '分' }))
    ]},
    { label: 'HIIT', items: [
      ...mk([1, 10, 30, 100], hPairs, hiitDays.length, left('回')).map((x, i) => ({ ...x, name: ['初HIIT', 'HIIT10回', 'HIIT30回', 'HIIT100回'][i] }))
    ]}
  ];
  return cats;
}
/* 新着メダルの目印：最後にプロフィールを開いた時点の達成数を、数字1個だけ端末内に保存する（バックアップ・スナップショットには入れない） */
const ACH_SEEN_KEY = 'iron_ach_seen';
function achSeenGet() { try { const v = localStorage.getItem(ACH_SEEN_KEY); return v === null ? null : (parseInt(v, 10) || 0); } catch (e) { return null; } }
function achSeenSet(n) { try { localStorage.setItem(ACH_SEEN_KEY, String(n)); } catch (e) {} }
function achGotCount(cats) { let n = 0; cats.forEach(c => c.items.forEach(x => { if (x.got) n++; })); return n; }
/* 未見の新着数。初回（未保存）は今の数を保存して0。復元などで減っていたら合わせ直す */
function achNewCount(cats) {
  const got = achGotCount(cats), seen = achSeenGet();
  if (seen === null || got < seen) { achSeenSet(got); return 0; }
  return got - seen;
}
/* 新着メダルの名前（達成日の新しい順に newN 個。同日は元の並び順で安定） */
function achNewNames(cats, newN) {
  const got = [];
  cats.forEach(c => c.items.forEach(x => { if (x.got) got.push(x); }));
  got.sort((a, b) => a.got === b.got ? 0 : (a.got < b.got ? 1 : -1));
  return new Set(got.slice(0, newN).map(x => x.name));
}
let achNewSnapshot = null; /* この訪問で光らせる新着メダル名（プロフィールを開いた瞬間に確定） */
function achMedal(got) {
  /* 実績メダルはバナナ一房（ひでぴ提供のイラスト。画像は theme.css の .ach-medal に埋め込み） */
  return '<span class="ach-medal' + (got ? '' : ' off') + '" aria-hidden="true"></span>';
}
function achPageHtml() {
  const cats = achievements();
  let total = 0, gotN = 0;
  cats.forEach(c => c.items.forEach(x => { total++; if (x.got) gotN++; }));
  let h = '<div class="dt-head"><div class="dt-ttl"><span class="hm-en">プロフィール</span><span class="ach-count">実績 ' + gotN + '/' + total + '</span></div>' +
    '<button type="button" class="dt-x" data-ach="close" aria-label="閉じる">✕</button></div><div class="dt-body">' + profileCardHtml();
  const bc0 = bodyCalc(), bw0 = latestWeight();
  h += '<button type="button" class="ach-entry ach-entry-gold" data-ach="body"><span>身体データ</span><span class="ach-entry-r"><span class="ach-entry-n">' +
    (bw0 ? fmtKg(bw0.kg) + 'kg' + (bc0 ? '・目標 ' + nf(bc0.kcal) + 'kcal' : '') : '未入力') +
    '</span><span class="ach-entry-ar">›</span></span></button>';
  const newNames = achNewSnapshot || new Set();
  cats.forEach(c => {
    h += '<div class="dt-sec">' + c.label + '</div><div class="ach-grid">' + c.items.map(x =>
      '<div class="ach-item' + (x.got ? '' : ' off') + (newNames.has(x.name) ? ' new' : '') + '">' + achMedal(!!x.got) +
      '<div class="ach-name">' + escapeHtml(x.name) + '</div>' +
      '<div class="ach-sub">' + (x.got ? fmtD(x.got) + ' 達成' : x.prog) + '</div></div>').join('') + '</div>';
  });
  return h + '</div>';
}
/* ===== ローカル分析（「分析させる」）：端末内の記録だけから文章を組み立てる。外部AI・通信は一切なし ===== */
let aiEl = null; /* ローカル分析ページ（全画面） */
/* 種目の動き：調子ラベル（全種目）・目標・デビュー・長期空きを目立つ順に最大8件 */
function aiMoves(inCur, P) {
  const today = dstr(new Date());
  const B = { plat: [], hot: [], goalDone: [], goalNear: [], down: [], flat: [], up: [], debut: [], absent: [] };
  const names = [...new Set(workouts.map(w => w.name.trim()).filter(Boolean))];
  names.forEach(name => {
    const s = seriesAll(name);
    if (!s.length) return;
    const last = s[s.length - 1];
    const ago = Math.round((Date.parse(today) - Date.parse(last.d)) / 86400000);
    const tr = trendOf(s.map(x => x.v));
    if (tr) {
      if (tr.cls === 'plat') B.plat.push(escapeHtml(name) + '：プラトー検知！！（直近3回横ばい）');
      else if (tr.cls === 'hot') B.hot.push(escapeHtml(name) + '：絶好調！！ 推定1RM ' + fmtKg(last.rm) + 'kg');
      else if (tr.cls === 'down') B.down.push(escapeHtml(name) + '：下降傾向（直近でスコア低下）');
      else if (tr.cls === 'flat') B.flat.push(escapeHtml(name) + '：停滞注意（前回と横ばい）');
      else if (tr.cls === 'up') B.up.push(escapeHtml(name) + '：上昇傾向');
    }
    const g = goalsData[name];
    if (g) {
      const best = maxWeightOf(name);
      if (best >= g) B.goalDone.push(escapeHtml(name) + '：目標' + fmtKg(g) + 'kg達成済み！');
      else if (best > 0 && best / g >= 0.8) B.goalNear.push(escapeHtml(name) + '：目標まであと' + fmtKg(g - best) + 'kg（達成率' + Math.round(best / g * 100) + '%）');
    }
    if (inCur(s[0].d)) B.debut.push(escapeHtml(name) + '：' + P + 'デビュー');
    if (ago >= 14 && s.length >= 3) B.absent.push(escapeHtml(name) + '：' + ago + '日空いています（最終 ' + fmtD(last.d) + '）');
  });
  return [...B.plat, ...B.hot, ...B.goalDone, ...B.goalNear, ...B.down, ...B.flat, ...B.up, ...B.debut, ...B.absent].slice(0, 8);
}
/* ハイライト：期間内の自己ベスト更新と、推定1RMの伸び */
function aiHighlights(inCur, startStr) {
  const prs = [], gains = [];
  const names = [...new Set(workouts.map(w => w.name.trim()).filter(Boolean))];
  names.forEach(name => {
    const s = seriesAll(name);
    let runMax = -Infinity, prIn = false, rmBefore = 0, rmIn = 0;
    s.forEach((x, i) => {
      if (i > 0 && x.v > runMax && inCur(x.d)) prIn = true;
      if (x.v > runMax) runMax = x.v;
      if (x.d < startStr) rmBefore = Math.max(rmBefore, x.rm);
      else if (inCur(x.d)) rmIn = Math.max(rmIn, x.rm);
    });
    if (prIn) prs.push(escapeHtml(name) + 'で自己ベスト更新！');
    if (rmBefore > 0 && rmIn > rmBefore) gains.push({ name: name, d: rmIn - rmBefore });
  });
  const lines = prs.slice(0, 3);
  if (gains.length) {
    const best = gains.reduce((a, b) => b.d > a.d ? b : a, gains[0]);
    lines.push('推定1RMが最も伸びたのは' + escapeHtml(best.name) + '（+' + fmtKg(best.d) + 'kg）');
  }
  return lines;
}
/* 通算・節目：レベル・連続週・次の実績メダル（プロフィールと実績の計算を流用） */
function aiTotals() {
  const p = profileStats();
  if (!p.days) return [];
  const lines = [];
  const nextXp = 500 * p.lv * (p.lv + 1);
  lines.push('現在 Lv.' + p.lv + '「' + p.title + '」。あと' + nf(nextXp - p.xp) + 'XPで Lv.' + (p.lv + 1) + '。');
  const nt = TITLES.find(t => t[0] > p.lv);
  if (nt && nt[0] !== p.lv + 1) lines.push('Lv.' + nt[0] + 'で称号「' + nt[1] + '」。');
  if (p.curRun >= 2) lines.push('連続' + p.curRun + '週継続中（最長' + p.maxRun + '週）。');
  let bestPct = null, firstLeft = null, allGot = true;
  achievements().forEach(c => c.items.forEach(x => {
    if (x.got) return;
    allGot = false;
    if (!firstLeft) firstLeft = x;
    const m = /^(\d+)%$/.exec(x.prog || '');
    if (m && (!bestPct || +m[1] > bestPct.pct)) bestPct = { name: x.name, pct: +m[1] };
  }));
  if (bestPct) lines.push('次の実績メダル：' + bestPct.name + '（進捗' + bestPct.pct + '%）');
  else if (firstLeft) lines.push('次の実績メダル：' + firstLeft.name + '（' + firstLeft.prog + '）');
  else if (allGot) lines.push('実績メダルは全制覇！');
  return lines;
}
/* 分析レポート（セクション構成）。集計は分析カードと同じ trainIn / cardioIn を使う */
/* 分析の信頼度：通算トレ日数から（記録が増えるほど分析が当たる、の目安表示） */
function aiConfidence() {
  try {
    const days = profileStats().days;
    if (!days) return null;
    return { lv: days >= 30 ? '高' : days >= 10 ? '中' : '低', days: days };
  } catch (e) { return null; }
}
/* ゴリラの一言：今日の記録の状態に反応する一言。同じ日は同じ文（日付シードで選択） */
function plateauEx() {
  try {
    const byName = {};
    workouts.forEach(w => { const n = w.name.trim(); if (!byName[n]) byName[n] = {}; (byName[n][w.dateStr] = byName[n][w.dateStr] || []).push(...w.setList); });
    for (const n of Object.keys(byName)) {
      const ds = Object.keys(byName[n]).sort();
      if (ds.length < 3) continue;
      const top = d => { const ss = byName[n][d]; const mw = Math.max(...ss.map(x => x.weight || 0)); const rp = Math.max(...ss.filter(x => (x.weight || 0) === mw).map(x => x.reps || 0)); return mw + 'x' + rp; };
      const a = ds.slice(-3);
      if (top(a[0]) === top(a[1]) && top(a[1]) === top(a[2])) {
        const ss = byName[n][a[2]]; const mw = Math.max(...ss.map(x => x.weight || 0));
        const rp = Math.max(...ss.filter(x => (x.weight || 0) === mw).map(x => x.reps || 0));
        return { name: n, mw, rp };
      }
    }
    return null;
  } catch (e) { return null; }
}
function gorillaHeads(volKg) { return Math.round((volKg || 0) / 160); }
function trendWord(tr) {
  if (!tr) return '最初の一歩だ！';
  switch (tr.cls) {
    case 'hot': return '最高潮だ！';
    case 'up': return 'いい流れだ！';
    case 'down': return '這い上がれ！';
    case 'flat': return '壁を破れ！';
    case 'plat': return '限界突破だ！';
    default: return tr.txt;
  }
}
function gorillaWord() {
  try { return gorillaWordPick(); } catch (e) { return '今日も積む。それだけでいい。'; }
}
function gorillaWordPick() {
  const today = dstr(new Date());
  const days = dayList();
  const seed = today.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const pick = arr => arr[seed % arr.length];
  if (!days.length && !cardios.length) return pick(['最初の一歩が一番重い。軽い日でいい、始めよう。', '記録はゼロでも、やる気はここにある。']);
  if (days.includes(today)) {
    const names = [...new Set(workouts.filter(w => w.dateStr === today).map(w => w.name.trim()))];
    if (names.some(n => isPR(n, today))) return pick(['新記録だ。昨日の自分を超えた日は、静かに誇っていい。', '記録更新。積み上げてきた者だけが立てる場所だ。', '限界は昨日までの話。今日も強くなった。']);
    const vol = volByDay();
    const prevDay = days.filter(d => d < today).pop();
    if (prevDay && (vol[today] || 0) > (vol[prevDay] || 0)) return pick(['前回より重い一日だった。確実に前に進んでいる。', '総負荷アップ。地味だが、これが一番強い。']);
    return pick(['今日も積んだ。それだけで十分すごい。', '淡々とやる者が最後に残る。今日もその一日。', '派手さはいらない。続けることが力だ。']);
  }
  if (cardios.some(c => c.dateStr === today)) return pick(['有酸素の日。心臓も筋肉のうちだ。', '走る日も鍛える日。いいリズムだ。']);
  const pl = plateauEx();
  if (pl) return pick(['『' + escapeHtml(pl.name) + '』、3回つづけて ' + pl.mw + 'kg×' + pl.rp + '回。次は+1回か+2.5kg、いけるはず。', '『' + escapeHtml(pl.name) + '』が3回同じ数字で止まっている。壁は薄い。次に破ろう。']);
  const last = days[days.length - 1];
  if (!last) return pick(['有酸素からでもいい。体を動かす日を作ろう。']);
  const gap = Math.round((new Date(today) - new Date(last)) / 864e5);
  if (gap === 1) return pick(['昨日よくやった。今日は休んで育てる日。', '休むのも訓練のうち。食べて、寝て、育て。']);
  if (gap >= 4) return pick(['少し空いたな。でも戻ってくれば、それで続いていることになる。', '間が空いても終わりじゃない。軽い日から再開しよう。']);
  return pick(['今日はどうする？ 動くなら軽くてもいい。', '整える日。次の一回のために体を休めよう。']);
}
/* AI分析のHIITセクション：有酸素・活動量には混ぜず、セットの内容と回数だけを材料にする（kcal換算はしない） */
function aiHiit(inCur, inPrev, P, PP) {
  try {
    const cur = hiitDays.filter(x => inCur(x.d)), prev = hiitDays.filter(x => inPrev(x.d));
    if (!cur.length && !prev.length) return [];
    if (!cur.length) return ['HIITは' + P + 'まだ実施なし（' + PP + 'は' + prev.length + '回）。'];
    const days = new Set(cur.map(x => x.d)).size;
    let s = 'HIITは' + P + ' ' + cur.length + '回・' + days + '日。';
    if (prev.length) { const df = cur.length - prev.length; s += PP + '比 ' + (df >= 0 ? '+' : '') + df + '回。'; }
    const secs = cur.map(hiitSeconds).filter(v => v !== null);
    if (secs.length) {
      const tot = secs.reduce((a, b) => a + b, 0);
      s += 'セット時間の合計は約' + Math.max(1, Math.round(tot / 60)) + '分';
      s += secs.length === cur.length ? '。' : '（設定の記録がある' + secs.length + '回分）。';
    }
    const lines = [s];
    const groups = new Map();
    cur.forEach(x => {
      const label = (x.name || 'HIIT') + (typeof x.w === 'number' ? '（' + x.w + '秒/' + x.r + '秒×' + x.n + '）' : '');
      groups.set(label, (groups.get(label) || 0) + 1);
    });
    const det = Array.from(groups.entries()).sort((a, b) => b[1] - a[1]).map(([label, c]) => escapeHtml(label) + ' ×' + c + '回');
    lines.push('内訳：' + det.join('、') + '。');
    return lines;
  } catch (e) { return []; }
}
function aiReport() {
  if (!workouts.length && !cardios.length) {
    const out0 = [];
    if (!hiitDays.length) out0.push({ t: '', lines: ['まだ記録がありません。トレーニングか有酸素を記録すると、ここに分析が出ます。'] });
    const r0 = anRanges(), wk0 = anPeriod === 'week';
    const hi0 = aiHiit(wk0 ? (d => d >= r0.ws && d <= r0.we) : (d => d.slice(0, 7) === r0.ym),
      wk0 ? (d => d >= r0.pws && d <= r0.pwe) : (d => d.slice(0, 7) === r0.pym), wk0 ? '今週' : '今月', wk0 ? '前週' : '前月');
    if (hi0.length) out0.push({ t: 'HIIT', lines: hi0 });
    const bd0 = aiBody();
    if (bd0.length) out0.push({ t: '身体・栄養', lines: bd0 });
    return out0;
  }
  const r = anRanges(), vol = volByDay(), wk = anPeriod === 'week';
  const inCur = wk ? (d => d >= r.ws && d <= r.we) : (d => d.slice(0, 7) === r.ym);
  const inPrev = wk ? (d => d >= r.pws && d <= r.pwe) : (d => d.slice(0, 7) === r.pym);
  const cur = trainIn(vol, inCur), prev = trainIn(vol, inPrev), cc = cardioIn(inCur), cp = cardioIn(inPrev);
  const P = wk ? '今週' : '今月', PP = wk ? '前週' : '前月';
  const secs = [];
  const sum = [];
  const active = !(cur.days === 0 && cc.min === 0 && !hiitDays.some(x => inCur(x.d)));
  if (!active) {
    sum.push(P + 'はまだ記録がありません。最初の1回を記録すると分析が始まります。');
  } else if (cur.days === 0 && cc.min === 0) {
    sum.push(P + 'はHIITのみ実施しています。');
  } else {
    let s1 = P + 'はトレ' + cur.days + '日・総負荷' + nf(cur.vol) + 'kg。';
    if (prev.vol > 0) { const pc = Math.round((cur.vol - prev.vol) / prev.vol * 100); s1 += PP + '比 ' + (pc >= 0 ? '+' : '') + pc + '%。'; }
    else if (cur.vol > 0) s1 += PP + 'の記録はないため、比較は次回から。';
    sum.push(s1);
    let bd = null, bv = -1;
    Object.keys(vol).forEach(d => { if (inCur(d) && vol[d] > bv) { bv = vol[d]; bd = d; } });
    if (bd) sum.push((cur.days > 1 ? 'ベストデーは' : '実施日は') + fmtD(bd) + '（総負荷' + nf(Math.round(bv)) + 'kg）。');
  }
  secs.push({ t: '期間サマリー', lines: sum });
  if (active) {
    if (cur.days > 0) {
      const parts = ['PUSH', 'PULL', 'LEGS'].map(t => ({ t: t, d: cur.by[t].days }));
      const zeros = parts.filter(x => x.d === 0).map(x => x.t);
      const mx = parts.reduce((a, b) => b.d > a.d ? b : a, parts[0]);
      const mn = parts.reduce((a, b) => b.d < a.d ? b : a, parts[0]);
      const bl = [];
      if (zeros.length && zeros.length < 3) {
        bl.push('部位バランス：' + zeros.join('・') + 'は' + P + 'まだ実施なし。最多は' + mx.t + '（' + mx.d + '日）。');
        bl.push('次に' + zeros[0] + 'を入れると全体のバランスが整います。');
      } else if (mx.d === mn.d) bl.push('部位バランス：PUSH・PULL・LEGSを均等に回せています。');
      else bl.push('部位バランス：' + mx.t + 'が最多（' + mx.d + '日）、' + mn.t + 'が最少（' + mn.d + '日）。');
      secs.push({ t: '部位バランス', lines: bl });
    }
    const cl = [];
    if (cc.min > 0) {
      const cDays = new Set(cardios.filter(c => inCur(c.dateStr)).map(c => c.dateStr)).size;
      let s3 = '有酸素は合計' + nf(cc.min) + '分（約' + nf(cc.kcal) + 'kcal）・実施' + cDays + '日、1回平均' + Math.round(cc.min / Math.max(1, cDays)) + '分。';
      if (cp.min > 0) { const df = cc.min - cp.min; s3 += PP + '比 ' + (df >= 0 ? '+' : '') + df + '分。'; }
      cl.push(s3);
    } else {
      cl.push('有酸素は' + P + 'まだ実施なし。');
    }
    secs.push({ t: '有酸素', lines: cl });
    const mv = aiMoves(inCur, P);
    if (mv.length) secs.push({ t: '種目の動き', lines: mv });
    const hl = aiHighlights(inCur, wk ? r.ws : r.ms);
    if (hl.length) secs.push({ t: 'ハイライト', lines: hl });
  }
  const hi = aiHiit(inCur, inPrev, P, PP);
  if (hi.length) secs.push({ t: 'HIIT', lines: hi });
  const bd = aiBody();
  if (bd.length) secs.push({ t: '身体・栄養', lines: bd });
  const tt = aiTotals();
  if (tt.length) secs.push({ t: '通算・節目', lines: tt });
  return secs;
}
function aiPageHtml() {
  const r = anRanges(), wk = anPeriod === 'week';
  const cf = aiConfidence();
  const confHtml = cf ? '<div class="ai-conf">分析の信頼度<span class="ai-conf-b">' + cf.lv + '</span><span>記録' + cf.days + '日分をもとに判定</span></div>' : '';
  const range = wk ? fmtD(r.ws) + '〜' + fmtD(r.we) : fmtD(r.ms) + '〜' + fmtD(r.me);
  return '<div class="dt-head"><div class="dt-ttl"><div class="dt-name">AI分析</div><div class="hm-en">' + (wk ? '週間' : '月間') + ' ' + range + '</div></div>' +
    '<button type="button" class="dt-x" data-ai="close" aria-label="閉じる">✕</button></div>' +
    '<div class="dt-body"><div class="ai-per">' +
    ['week', 'month'].map(p => '<button type="button" class="gr-btn' + (anPeriod === p ? ' on' : '') + '" data-ai="per" data-p="' + p + '">' + (p === 'week' ? '週間' : '月間') + '</button>').join('') + '</div>' + confHtml +
    aiReport().map(s => (s.t ? '<div class="dt-sec">' + s.t + '</div>' : '') + '<div class="ai-card">' + s.lines.map(t => '<div class="ai-line"><span class="ai-dot">◆</span><span>' + t + '</span></div>').join('') + '</div>').join('') +
    '<div class="ai-note">この分析は端末内の記録だけから自動生成しています（外部AI・通信は使っていません）。</div></div>';
}
function openAiAnalysis() {
  openLayer('ai', () => !aiEl && !achEl && !detailEl && !sheetEl && !editorOpen(), () => {
    aiEl = document.createElement('div');
    aiEl.id = 'aiPage';
    aiEl.setAttribute('role', 'dialog');
    aiEl.setAttribute('aria-modal', 'true');
    aiEl.addEventListener('click', onAiClick);
    document.body.appendChild(aiEl);
    return () => { aiEl.innerHTML = aiPageHtml(); };
  });
}
function removeAiPage() {
  if (!aiEl) return;
  aiEl.remove();
  aiEl = null;
}
function leaveAiPage() {
  if (!aiEl) return;
  removeAiPage();
  leaveLayer();
}
function onAiClick(e) {
  const b = e.target.closest('[data-ai]');
  if (b && b.dataset.ai === 'close') { leaveAiPage(); return; }
  if (b && b.dataset.ai === 'per') {
    const p = b.dataset.p;
    if ((p === 'week' || p === 'month') && p !== anPeriod) { anPeriod = p; aiEl.innerHTML = aiPageHtml(); paintAnCard(); }
    return;
  }
  if (e.target === aiEl || e.target.classList.contains('dt-body') || e.target.closest('.dt-ttl')) leaveAiPage();
}
let achEl = null; /* 実績ページ（全画面） */
function openAchievements() {
  openLayer('ach', () => !achEl && !detailEl && !sheetEl && !editorOpen(), () => {
    achEl = document.createElement('div');
    achEl.id = 'achPage';
    achEl.setAttribute('role', 'dialog');
    achEl.setAttribute('aria-modal', 'true');
    achEl.addEventListener('click', onAchClick);
    document.body.appendChild(achEl);
    return () => {
      const cats = achievements(), gotN = achGotCount(cats), seen = achSeenGet();
      const newN = (seen === null || gotN < seen) ? 0 : gotN - seen;
      achNewSnapshot = newN > 0 ? achNewNames(cats, newN) : new Set();
      achEl.innerHTML = achPageHtml();
      achSeenSet(gotN);
    };
  });
}
function removeAch() {
  if (!achEl) return;
  achEl.remove();
  achEl = null;
  achNewSnapshot = null;
}
function leaveAch() {
  if (!achEl) return;
  removeAch();
  leaveLayer();
}
function onAchClick(e) {
  if (e.target.closest('[data-ach="gcard"]')) { shareGorillaCard(); return; }
  if (e.target.closest('[data-ach="body"]')) { openBodyPage(); return; }
  if (e.target.closest('[data-ach="close"]')) { leaveAch(); return; }
  if (e.target === achEl || e.target.classList.contains('dt-body') || e.target.closest('.dt-ttl')) leaveAch();
}
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
    if (data || s.menu || s.view === 'settings') safe(paintDataUsage); /* 保存・削除・復元・メニュー変更のたびに最新へ */
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
/* 中央の枠いっぱいに '00:00' が収まる文字サイズを決める。
   埋め込みフォント（DSEG7）で '00:00' を 100px 表示したときの幅は 346.4px（実測値）で固定のため、
   フォントの読み込み完了を待たず、最初からこの比率で計算する（待ち時間なし・はみ出しなし）。
   読み込み後に実測して、想定とズレていたら実測で決め直す（将来フォントを替えたときの保険） */
const DSEG_BASE = 346.4;
let fitW = 0, fitBase = 0;
function fitTimer(force) {
  if (!disp || !tmCenter) return;
  const w = tmCenter.clientWidth;
  if (!w) return;
  if (!force && w === fitW) return;
  fitW = w;
  disp.style.fontSize = Math.floor(Math.max(24, Math.min(140, 100 * (w - 2) / (fitBase || DSEG_BASE)))) + 'px';
}
function fitTimerVerify() {
  if (!disp || !tmCenter || !tmCenter.clientWidth) return;
  const prev = disp.style.fontSize;
  const keep = disp.textContent;
  disp.textContent = '00:00';
  disp.style.fontSize = '100px';
  const base = disp.getBoundingClientRect().width;
  disp.textContent = keep;
  disp.style.fontSize = prev;
  if (base && Math.abs(base - DSEG_BASE) / DSEG_BASE > 0.02) { fitBase = base; fitTimer(true); }
}
if (tmCenter) {
  window.addEventListener('resize', () => fitTimer(true));
  if (typeof ResizeObserver === 'function') {
    try {
      const ro = new ResizeObserver(() => fitTimer());
      ro.observe(tmCenter);
      if (disp) ro.observe(disp);
    } catch (e) {}
  }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => fitTimerVerify()).catch(() => {});
  if (document.fonts && document.fonts.load) { try { document.fonts.load('700 100px DSEG7', '00:00').then(() => fitTimerVerify()).catch(() => {}); } catch (e) {} }
  setTimeout(fitTimerVerify, 1500);
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
   ・. は kg のときだけ有効（1回だけ／小数点以下は2桁まで）
   ・完了：kg → 同じ行の回へ移動（テンキーは開いたまま）／回・分 → 閉じる ===== */
const PAD_SEL = '.weight-input, .reps-input, #cardioMinutes, #hiitWork, #hiitRest, #hiitRounds';
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
  '<button type="button" class="np-k np-fn" data-k="dot">.</button>' +
  '<button type="button" class="np-k np-w2" data-k="0">0</button>' +
  '<button type="button" class="np-k np-w2 np-ok" data-k="ok">完了</button>';
document.body.appendChild(padEl);
let padInput = null;
const padKind = el => el.id === 'cardioMinutes' ? 'min' : el.id === 'bdKcal' ? 'kcal' : (el.id === 'hiitWork' || el.id === 'hiitRest') ? 'sec' : el.id === 'hiitRounds' ? 'round' : el.classList.contains('weight-input') ? 'kg' : 'rep';
function padLimitOk(kind, str) {
  const n = parseFloat(str);
  if (!isFinite(n)) return false;
  return kind === 'kg' ? n <= LIMITS.weight : kind === 'rep' ? n <= LIMITS.reps : kind === 'kcal' ? n <= 6000 : kind === 'sec' ? n <= 3600 : kind === 'round' ? n <= 99 : n <= CARDIO_MAX;
}
function syncPad() {
  const dot = padEl.querySelector('[data-k="dot"]');
  dot.disabled = !padInput || padKind(padInput) !== 'kg';
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
  padEl.classList.toggle('np-over', !!(el.closest && el.closest('#exDetail, #achPage, #menuEditor, #bodyPage'))); /* 全画面ページの中の入力欄では、テンキーをページより手前に出す */
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
  padEl.classList.remove('np-over');
  padEl.classList.remove('show');
  padEl.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('np-open');
}
function padPress(k) {
  if (!padInput || !padInput.isConnected) { closePad(); return; }
  const kind = padKind(padInput);
  let v = padInput.value;
  if (/^\d$/.test(k)) {
    const di = v.indexOf('.');
    if (di >= 0 && v.length - di - 1 >= 2) return; /* 小数点以下は2桁まで */
    const nx = v === '0' && di < 0 ? k : v + k;
    if (!padLimitOk(kind, nx)) return;
    v = nx;
  } else if (k === 'dot') {
    if (kind !== 'kg') return;
    if (v.indexOf('.') >= 0) return; /* . は1回だけ */
    const nx = (v === '' ? '0' : v) + '.';
    if (!padLimitOk('kg', nx)) return;
    v = nx;
  } else if (k === 'back') {
    v = v.slice(0, -1);
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

/* ===== 文字パッド（種目名などの文字入力欄。OSのキーボードの代わりに出す）
   ・色と形は専用テンキー（.np-k）と共通：白地のパネル／黒キー／赤枠／金文字／赤の完了
   ・カナ面はフリック入力（タップ・左・上・右・下）。漢字変換はできないため、
     「キーボード」キーで通常のキーボードに切り替える逃げ道を用意する
   ・入力欄は readonly。タップで金枠ハイライト（input.np-active を流用）＋画面下にパッド ===== */
const TP_SEL = '#exerciseName, #meInput, #meName, #renInput';
const tpEl = document.createElement('div');
tpEl.id = 'textpad';
tpEl.setAttribute('aria-hidden', 'true');
tpEl.innerHTML =
  '<div class="tp-head">' +
    '<button type="button" class="tp-k tp-fn tp-tab on" data-tp-tab="kana">カナ</button>' +
    '<button type="button" class="tp-k tp-fn tp-tab" data-tp-tab="alpha">英字</button>' +
    '<button type="button" class="tp-k tp-fn tp-tab" data-tp-tab="hira">ひらがな</button>' +
    '<button type="button" class="tp-k tp-ok" data-tp-act="ok">完了</button>' +
  '</div>' +
  '<div class="tp-flick" id="tpFlick"></div>' +
  '<div class="tp-alpha" id="tpAlpha" style="display:none"></div>' +
  '<div class="tp-foot">' +
    '<button type="button" class="tp-k tp-fn" data-tp-act="kbd">キーボード</button>' +
    '<button type="button" class="tp-k tp-fn" data-tp-act="space">空白</button>' +
    '<button type="button" class="tp-k tp-fn" data-tp-act="clear">全消去</button>' +
  '</div>';
document.body.appendChild(tpEl);
const tpGuide = document.createElement('div');
tpGuide.id = 'tpguide';
tpGuide.innerHTML = '<div class="tg gc"></div><div class="tg gl"></div><div class="tg gu"></div><div class="tg gr"></div><div class="tg gd"></div>';
document.body.appendChild(tpGuide);

let tpInput = null;
let tpMode = 'kana';      /* kana | alpha */
let tpKana = 'kata';      /* kata | hira */
let tpShift = false;

const tpToHira = s => s.replace(/[\u30a1-\u30f6]/g, m => String.fromCharCode(m.charCodeAt(0) - 0x60));
const tpToKata = s => s.replace(/[\u3041-\u3096]/g, m => String.fromCharCode(m.charCodeAt(0) + 0x60));
const tpConv = s => tpKana === 'kata' ? tpToKata(s) : tpToHira(s);
const TP_DAKU = {'か':'が','き':'ぎ','く':'ぐ','け':'げ','こ':'ご','さ':'ざ','し':'じ','す':'ず','せ':'ぜ','そ':'ぞ','た':'だ','ち':'ぢ','つ':'づ','て':'で','と':'ど','は':'ば','ひ':'び','ふ':'ぶ','へ':'べ','ほ':'ぼ','う':'ゔ','ば':'ぱ','び':'ぴ','ぶ':'ぷ','べ':'ぺ','ぼ':'ぽ','ぱ':'は','ぴ':'ひ','ぷ':'ふ','ぺ':'へ','ぽ':'ほ','が':'か','ぎ':'き','ぐ':'く','げ':'け','ご':'こ','ざ':'さ','じ':'し','ず':'す','ぜ':'せ','ぞ':'そ','だ':'た','ぢ':'ち','づ':'つ','で':'て','ど':'と','ゔ':'う'};
const TP_SMALL = {'あ':'ぁ','い':'ぃ','う':'ぅ','え':'ぇ','お':'ぉ','や':'ゃ','ゆ':'ゅ','よ':'ょ','つ':'っ','ぁ':'あ','ぃ':'い','ぅ':'う','ぇ':'え','ぉ':'お','ゃ':'や','ゅ':'ゆ','ょ':'よ','っ':'つ'};
/* フリックの並び：[タップ, 左, 上, 右, 下] */
const TP_FLICK = {
  'あ': ['あ','い','う','え','お'], 'か': ['か','き','く','け','こ'], 'さ': ['さ','し','す','せ','そ'],
  'た': ['た','ち','つ','て','と'], 'な': ['な','に','ぬ','ね','の'], 'は': ['は','ひ','ふ','へ','ほ'],
  'ま': ['ま','み','む','め','も'], 'や': ['や','「','ゆ','」','よ'], 'ら': ['ら','り','る','れ','ろ'],
  'わ': ['わ','を','ん','ー','・']
};
const tpFlickBox = tpEl.querySelector('#tpFlick');
const tpAlphaBox = tpEl.querySelector('#tpAlpha');
const tgCells = { c: tpGuide.querySelector('.gc'), l: tpGuide.querySelector('.gl'), u: tpGuide.querySelector('.gu'), r: tpGuide.querySelector('.gr'), d: tpGuide.querySelector('.gd') };

function tpSetValue(v) {
  if (!tpInput) return;
  tpInput.value = v;
  tpInput.dispatchEvent(new Event('input', { bubbles: true }));
}
function tpCap() { return tpInput && tpInput.maxLength > 0 ? tpInput.maxLength : (typeof LIMITS !== 'undefined' ? LIMITS.name : 60); }
function tpAdd(ch) {
  if (!tpInput || !tpInput.isConnected) { closeTextPad(); return; }
  if (tpInput.value.length >= tpCap()) return;
  tpSetValue(tpInput.value + ch);
}
function tpDel() {
  if (!tpInput || !tpInput.isConnected) { closeTextPad(); return; }
  tpSetValue(tpInput.value.slice(0, -1));
}
function tpTransform() {
  if (!tpInput || !tpInput.isConnected) { closeTextPad(); return; }
  const v = tpInput.value;
  if (!v) return;
  const h = tpToHira(v.slice(-1));
  const out = TP_DAKU[h] || TP_SMALL[h];
  if (!out) return;
  tpSetValue(v.slice(0, -1) + (tpKana === 'kata' ? tpToKata(out) : out));
}
function tpShowGuide(keyEl, chars, dir) {
  const r = keyEl.getBoundingClientRect();
  let x = r.left + r.width / 2 - 66, y = r.top + r.height / 2 - 66;
  x = Math.max(2, Math.min(x, window.innerWidth - 134));
  y = Math.max(2, Math.min(y, window.innerHeight - 134));
  tpGuide.style.left = x + 'px';
  tpGuide.style.top = y + 'px';
  tpGuide.style.display = 'block';
  tgCells.c.textContent = tpConv(chars[0]);
  tgCells.l.textContent = tpConv(chars[1]);
  tgCells.u.textContent = tpConv(chars[2]);
  tgCells.r.textContent = tpConv(chars[3]);
  tgCells.d.textContent = tpConv(chars[4]);
  ['c','l','u','r','d'].forEach(k => tgCells[k].classList.toggle('on', k === dir));
}
function tpHideGuide() { tpGuide.style.display = 'none'; }
function tpAttachFlick(el, chars) {
  let sx = 0, sy = 0, dir = 'c', active = false;
  el.addEventListener('pointerdown', e => {
    e.preventDefault();
    active = true; sx = e.clientX; sy = e.clientY; dir = 'c';
    try { el.setPointerCapture(e.pointerId); } catch (err) {}
    tpShowGuide(el, chars, dir);
  });
  el.addEventListener('pointermove', e => {
    if (!active) return;
    const dx = e.clientX - sx, dy = e.clientY - sy, ax = Math.abs(dx), ay = Math.abs(dy);
    if (Math.max(ax, ay) < 20) dir = 'c';
    else if (ax > ay) dir = dx < 0 ? 'l' : 'r';
    else dir = dy < 0 ? 'u' : 'd';
    tpShowGuide(el, chars, dir);
  });
  const finish = commit => {
    if (!active) return;
    active = false; tpHideGuide();
    if (commit) tpAdd(tpConv(chars[{ c: 0, l: 1, u: 2, r: 3, d: 4 }[dir]]));
  };
  el.addEventListener('pointerup', () => finish(true));
  el.addEventListener('pointercancel', () => finish(false));
}
function tpBuildFlick() {
  tpFlickBox.innerHTML = '';
  ['あ','か','さ','た','な','は','ま','や','ら'].forEach(head => {
    const b = document.createElement('div');
    b.className = 'tp-k tp-fkey';
    b.textContent = tpConv(head);
    tpAttachFlick(b, TP_FLICK[head]);
    tpFlickBox.appendChild(b);
  });
  const daku = document.createElement('button');
  daku.type = 'button'; daku.className = 'tp-k tp-fkey tp-fn'; daku.textContent = '゛゜小';
  daku.addEventListener('click', tpTransform);
  tpFlickBox.appendChild(daku);
  const wa = document.createElement('div');
  wa.className = 'tp-k tp-fkey';
  wa.textContent = tpConv('わ');
  tpAttachFlick(wa, TP_FLICK['わ']);
  tpFlickBox.appendChild(wa);
  const del = document.createElement('button');
  del.type = 'button'; del.className = 'tp-k tp-fkey tp-fn'; del.textContent = '⌫';
  del.setAttribute('aria-label', '1文字削除');
  del.addEventListener('click', tpDel);
  tpFlickBox.appendChild(del);
}
function tpBuildAlpha() {
  tpAlphaBox.innerHTML = '';
  ['1234567890', 'QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'].forEach((row, ri) => {
    row.split('').forEach(ch => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'tp-k tp-akey';
      b.textContent = ri === 0 ? ch : (tpShift ? ch : ch.toLowerCase());
      b.addEventListener('click', () => {
        tpAdd(b.textContent);
        if (tpShift && ri > 0) { tpShift = false; tpBuildAlpha(); }
      });
      tpAlphaBox.appendChild(b);
    });
  });
  const sh = document.createElement('button');
  sh.type = 'button'; sh.className = 'tp-k tp-akey tp-fn tp-w2'; sh.textContent = tpShift ? '⇧ ON' : '⇧ 大文字';
  sh.addEventListener('click', () => { tpShift = !tpShift; tpBuildAlpha(); });
  tpAlphaBox.appendChild(sh);
  const un = document.createElement('button');
  un.type = 'button'; un.className = 'tp-k tp-akey'; un.textContent = '_';
  un.addEventListener('click', () => tpAdd('_'));
  tpAlphaBox.appendChild(un);
  const hy = document.createElement('button');
  hy.type = 'button'; hy.className = 'tp-k tp-akey'; hy.textContent = '-';
  hy.addEventListener('click', () => tpAdd('-'));
  tpAlphaBox.appendChild(hy);
}
function tpSetMode(m) {
  tpMode = m;
  tpEl.querySelectorAll('[data-tp-tab]').forEach(t => {
    const k = t.dataset.tpTab;
    t.classList.toggle('on', k === m || (k === 'hira' && tpKana === 'hira'));
  });
  tpFlickBox.style.display = m === 'kana' ? 'grid' : 'none';
  tpAlphaBox.style.display = m === 'alpha' ? 'grid' : 'none';
  if (tpInput) tpMetrics();
}
function tpMetrics() {
  const st = document.documentElement.style;
  st.setProperty('--nav-h', (navEl ? navEl.offsetHeight : 0) + 'px');
  st.setProperty('--tp-h', tpEl.offsetHeight + 'px');
}
function openTextPad(el) {
  closePad();
  if (tpInput && tpInput !== el) tpInput.classList.remove('np-active');
  tpInput = el;
  tpEl.classList.toggle('tp-over', !!(el.closest && el.closest('#exDetail, #menuEditor')));
  tpSetMode(tpMode);
  tpMetrics();
  el.classList.add('np-active');
  tpEl.classList.add('show');
  tpEl.setAttribute('aria-hidden', 'false');
  document.body.classList.add('tp-open');
  setTimeout(() => {
    if (tpInput === el && el.scrollIntoView) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, 30);
}
function closeTextPad() {
  if (tpInput) tpInput.classList.remove('np-active');
  tpInput = null;
  tpHideGuide();
  tpEl.classList.remove('tp-over');
  tpEl.classList.remove('show');
  tpEl.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('tp-open');
}
/* 「キーボード」：通常のキーボードに切り替える（漢字変換用）。欄から離れたら readonly に戻す */
function tpUseKeyboard() {
  const el = tpInput;
  if (!el) return;
  closeTextPad();
  el.removeAttribute('readonly');
  el.focus();
  el.addEventListener('blur', function h() {
    el.setAttribute('readonly', '');
    el.removeEventListener('blur', h);
  });
}
tpEl.addEventListener('click', e => {
  const tab = e.target.closest('[data-tp-tab]');
  if (tab) {
    const k = tab.dataset.tpTab;
    if (k === 'hira') { tpKana = tpKana === 'kata' ? 'hira' : 'kata'; tab.textContent = tpKana === 'kata' ? 'ひらがな' : 'カタカナ'; tpBuildFlick(); tpSetMode('kana'); }
    else tpSetMode(k);
    return;
  }
  const act = e.target.closest('[data-tp-act]');
  if (!act) return;
  const a = act.dataset.tpAct;
  if (a === 'ok') closeTextPad();
  else if (a === 'space') tpAdd(' ');
  else if (a === 'clear') { if (tpInput && tpInput.isConnected) tpSetValue(''); }
  else if (a === 'kbd') tpUseKeyboard();
});
document.addEventListener('click', e => {
  const t = e.target.closest(TP_SEL);
  if (t) { openTextPad(t); return; }
  if (e.target.closest('#textpad')) return;
  if (e.target.closest(PAD_SEL)) { closeTextPad(); return; }
  if (e.target.closest('#suggestionBox')) { closeTextPad(); return; }
  if (tpInput) closeTextPad();
});
document.addEventListener('focusin', e => {
  const t = e.target;
  if (t && t.closest && !t.closest(TP_SEL) && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) closeTextPad();
});
window.addEventListener('popstate', () => closeTextPad());
window.addEventListener('resize', () => { if (tpInput) tpMetrics(); });
tpBuildFlick();
tpBuildAlpha();
window.TextPad = { close: closeTextPad };

/* ===== 折れ線グラフ（金の線＝総合・赤の実線＝推定1RM）。色はテーマで変えない ===== */
let gid = 0;
function curvePath(P) {
  /* 折れ線：全データ点を直線で結ぶ（滑らかな曲線は実在しない値を描くため廃止。ひでぴ決定 2026-11-27） */
  const f = x => x.toFixed(1);
  return 'M' + P.map(p => f(p[0]) + ',' + f(p[1])).join(' L');
}
function line(v, w, h, dates, rm, lab, ax, tap, goal) {
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
        '<text x="' + (px - 6) + '" y="' + f(y + 3.5) + '" text-anchor="end" font-size="10.5" fill="#ddd6c4" font-family="Barlow Condensed,sans-serif">' + fv(t) + '</text>';
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
  if (big && goal > 0 && hasRm) { /* 目標ライン（推定1RMの目盛りに合わせた破線＋左端にラベル。範囲外は端に寄せる） */
    const mn = Math.min(...rm), mx = Math.max(...rm), r = (mx - mn) || 1;
    let gy = h - pb - (goal - mn) / r * (h - pt - pb);
    gy = Math.max(pt - 2, Math.min(h - pb + 2, gy));
    const gtxt = '目標' + (Math.round(goal * 10) / 10) + 'kg';
    const lw = [...gtxt].reduce((a, c) => a + (c.charCodeAt(0) > 255 ? 11 : 6.2), 0) + 10;
    const ly = gy - 15 < pt - 8 ? gy + 5 : gy - 16;
    s += '<line x1="' + px + '" y1="' + f(gy) + '" x2="' + (w - px) + '" y2="' + f(gy) + '" stroke="#ece8dd" stroke-width="1.2" stroke-dasharray="5 4" opacity=".85"/>' +
      '<rect x="' + f(px + 2) + '" y="' + f(ly) + '" width="' + f(lw) + '" height="15" rx="3" fill="#101012" opacity=".82"/>' +
      '<text x="' + f(px + 7) + '" y="' + f(ly + 11.5) + '" font-size="11" font-weight="700" fill="#dcc28a" font-family="Barlow Condensed,sans-serif">' + gtxt + '</text>';
  }
  if (big) {
    s += '<line x1="' + px + '" y1="' + (h - pb + 6) + '" x2="' + (w - px) + '" y2="' + (h - pb + 6) + '" stroke="#2a2a2c"/>';
    const step = Math.max(1, Math.ceil(n / Math.max(1, Math.floor((w - 2 * px) / 26)))); /* 点が多いときは数字・日付を間引く（最新は必ず出す） */
    P.forEach((q, i) => {
      const last = i === n - 1;
      if ((n - 1 - i) % step !== 0) return;
      s += '<text x="' + f(q[0]) + '" y="' + f(q[1] - 10) + '" text-anchor="middle" font-size="11" fill="' +
        (last ? '#ece8dd' : '#ddd6c4') + '" font-family="Barlow Condensed,sans-serif">' + fv(v[i]) + '</text>' +
        '<text x="' + f(q[0]) + '" y="' + (h - 5) + '" text-anchor="middle" font-size="11" fill="' + (tap && tap.sel === i ? '#dcc28a' : '#ddd6c4') + '" font-family="Barlow Condensed,sans-serif">' + fmtL(dates[i]) + '</text>';
      if (tap && tap.a) {
        const sp = (w - 2 * px) / (n - 1), hw = Math.min(48, sp);
        s += '<rect class="pt-hit" data-' + tap.a + '="pt" data-gi="' + i + '" x="' + f(q[0] - hw / 2) + '" y="' + (h - pb + 2) + '" width="' + f(hw) + '" height="' + (pb - 2) + '" fill="#fff" opacity="0"/>';
      }
      if (P2) {
        const y2 = Math.min(h - pb - 2, P2[i][1] + 15);
        s += '<text x="' + f(P2[i][0]) + '" y="' + f(y2) + '" text-anchor="middle" font-size="10.5" fill="' +
          (last ? '#f29b96' : '#e89a95') + '" font-family="Barlow Condensed,sans-serif">' + rm[i] + '</text>';
      }
    });
  }
  let hits = '';
  if (tap && big) {
    if (tap.sel != null && P[tap.sel]) {
      hits += '<circle class="pt-sel" cx="' + f(P[tap.sel][0]) + '" cy="' + f(P[tap.sel][1]) + '" r="7"/>';
      if (P2 && P2[tap.sel]) hits += '<circle class="pt-sel-rm" cx="' + f(P2[tap.sel][0]) + '" cy="' + f(P2[tap.sel][1]) + '" r="6"/>';
    }

  }
  return s + hits + '</svg>';
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
/* 金色のモーダル（画面中央）＋バイブ＋ゴリ朱印の押印アニメ。余計な数値や差分は出さない。タップか約2.4秒で閉じる */
window.showPRModal = function () {
  if (document.getElementById('prModal')) return;
  const o = document.createElement('div');
  o.id = 'prModal';
  o.setAttribute('role', 'alert');
  const prMsgs = ['自己ベスト更新！！ 昨日の自分を超えたな！！', '限界突破！！ その一回が全てを変える！！', 'よくやった！！ 積み重ねが実を結んだ！！'];
    const dust = Array.from({ length: 14 }, (_, i) => '<i style="--x:' + ((i * 37) % 81 - 40) + 'px;--dl:' + (i % 5) * 0.12 + 's"></i>').join('');
    const burst = Array.from({ length: 10 }, (_, i) => { const a = (Math.PI * 2 * i) / 10 + (i % 3) * 0.12, d = 54 + (i % 4) * 15; return '<i style="--dx:' + Math.round(Math.cos(a) * d) + 'px;--dy:' + Math.round(Math.sin(a) * d) + 'px"></i>'; }).join('');
    o.innerHTML = '<div class="pr-box"><div class="pr-tw"><div class="pr-t">記録更新！！</div><span class="pr-sealpos"><span class="seal pr-seal"></span></span><span class="pr-burst">' + burst + '</span></div><div class="pr-msg">' + prMsgs[Math.floor(Math.random() * prMsgs.length)] + '</div><span class="pr-dust">' + dust + '</span></div>';
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
/* ===== 種目別の目標重量（simple_goals：{ 種目名: 目標kg }）。保存の窓口（transact）へ登録 ===== */
let goalsData = loadJson('simple_goals', {});
if (!goalsData || typeof goalsData !== 'object' || Array.isArray(goalsData)) goalsData = {};
if (typeof sanitizeGoals === 'function') goalsData = sanitizeGoals(goalsData); /* 復元時と同じ検証を、起動時の読み込みにもかける */
PARTS.goals = {
  keys: ['simple_goals'],
  get: () => goalsData,
  set: v => { goalsData = (v && typeof v === 'object' && !Array.isArray(v)) ? v : {}; },
  save: () => writeJson('simple_goals', goalsData)
};
/* ===== 身体データ（simple_body：設定／simple_weight：体重ログ）。保存の窓口（transact）へ登録 ===== */
let bodyData = loadJson('simple_body', null);
if (!bodyData || typeof bodyData !== 'object' || Array.isArray(bodyData)) bodyData = {};
if (typeof sanitizeBody === 'function') bodyData = sanitizeBody(bodyData);
let weightData = (typeof sanitizeWeightLog === 'function') ? sanitizeWeightLog(loadJson('simple_weight', null)) : [];
PARTS.body = {
  keys: ['simple_body'],
  get: () => bodyData,
  set: v => { bodyData = (v && typeof v === 'object' && !Array.isArray(v)) ? v : {}; },
  save: () => writeJson('simple_body', bodyData)
};
PARTS.weight = {
  keys: ['simple_weight'],
  get: () => weightData,
  set: v => { weightData = Array.isArray(v) ? v : []; },
  save: () => writeJson('simple_weight', weightData)
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
/* ===== アップ（ホームの1番上の種目の過去最大重量から 30%・60%・80% をフォームへセット）
   WARMUP … [最大重量に対する割合, 回数]。重量は一の位を四捨五入して 10kg 単位にする（0kg になる軽い種目だけ 1kg 単位に丸める）
   フォームの状態の切り替えは index.html の startWarmup（入力中＋キャンセル／保存ボタンの無効化もそこ） ===== */
const WARMUP = [[0.3, 10], [0.6, 5], [0.8, 3]];
function maxWeightOf(name) {
  let m = 0;
  workouts.forEach(w => {
    if (w.name.trim() === name) w.setList.forEach(s => { if (s.weight > m) m = s.weight; });
  });
  return m;
}
window.homeWarmup = function () {
  const name = homeNames[0]; /* ホームで1番上の種目 */
  if (name === undefined) return;
  const max = maxWeightOf(name);
  if (!(max > 0)) return; /* 過去最大重量の記録がなければ何もしない */
  if (editingId !== null) resetForm(true); /* 編集は中断（日付指定は維持） */
  switchTab('workout');
  startWarmup(WARMUP.map(p => ({ weight: Math.round(max * p[0] / 10) * 10 || Math.max(1, Math.round(max * p[0])), reps: p[1] })));
};
/* ===== 完遂バッジ（朱印。選択中の部位のメニューを全完了したときだけ、部位文字の右横に出す） ===== */
const MEDAL_HTML = '<div class="hm-medal"><span class="seal" role="img" aria-label="今日のメニュー全完了"></span><div class="hm-medal-lb">完遂</div></div>';
/* PRミニ勲章（種目名の右。CSS で約24px。下に小さく PR） */
const prMedal = i => '<span class="hm-pr"><span class="seal" role="img" aria-label="PR更新"></span><span class="hm-medal-lb">PR</span></span>';

function renderHome() {
  const el = document.getElementById('tabContentHome');
  if (!el) return;
  ensureMenu();
  const today = dstr(new Date()), type = todayType();
  const chips = TYPES.map(t => '<button type="button" class="' + (t === type ? 'cur' : '') + '" onclick="homeType(\'' + t + '\')">' + t + '</button>').join('');
  const names = menuData[type].on;
  homeNames = names;
  const todays = workouts.filter(w => w.dateStr === today);
  const doneN = names.filter(n => todays.some(t => t.name.trim() === n)).length;
  const allDone = names.length > 0 && doneN === names.length;
  /* 選択中の部位のメニューを全完了したときだけ、部位文字（.hm-big）の右横に勲章を出す */
  let h = '<div class="hm-card"><div class="hm-pad"><div class="hm-top"><div class="hm-big">' + type +
    '</div>' + (allDone ? MEDAL_HTML : '') + '</div><div class="hm-word"><span class="hm-word-lb">ゴリラの一言</span>' + escapeHtml(gorillaWord()) + '</div><div class="hm-ord">' + chips + '</div></div></div>';
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
    /* 「アップ」は1番上の種目の「入力」ボタンの左。過去最大重量の記録がなければ押せない状態 */
    const up = (i === 0 && !t) ? '<button type="button" class="hm-in hm-up"' + (maxWeightOf(n) > 0 ? ' onclick="homeWarmup()"' : ' disabled aria-disabled="true"') + '>アップ</button>' : '';
    h += '<div class="hm-ex' + (open ? ' open' : '') + '" data-i="' + i + '"><div class="hm-exh"><div class="hm-row2"><span class="hm-chk' + (t ? ' f' : '') + '"></span><div class="hm-en' + (t ? ' dn' : '') + '">' +
      escapeHtml(n) + '</div>' + (pr ? prMedal(i) : '') + '</div><div class="hm-act">' + up + (t ? '' : '<button type="button" class="hm-in" onclick="homeFill(' + i + ')">入力</button>') +
      '<button type="button" class="hm-dt">詳細</button>' +
      '<span class="hm-chev"></span></div></div><div class="hm-mini"><div class="hm-st">' +
      (b ? (t ? '今日 ' : '前回 ') + fmtSet(b) : '') +
      (tr ? (tr.cls === 'plat' && open
        ? '<span class="hm-trw"><span class="hm-tr plat">' + trendWord(tr) + '</span><span class="hm-tip">レスト+1分or重量-10%</span></span>'
        : '<span class="hm-tr ' + tr.cls + '">' + trendWord(tr) + '</span>') : '<span class="hm-tr none">' + trendWord(null) + '</span>') + '</div>' +
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
let draft = null, editType = 'PUSH', pastCache = [], meSug = [];
/* 追加フォームの検索候補：入力に部分一致する履歴の種目名（この枠に入っていないもの）を最大8件。
   空欄のときは候補なし＝候補チップは出ない（旧仕様の常時表示チップは廃止） */
function calcMeSug(q) {
  const s = String(q || '').trim().toLowerCase();
  meSug = s ? pastCache.filter(n => n.toLowerCase().includes(s)).slice(0, 8) : [];
}
function meSugHtml() {
  return meSug.map((n, i) => '<button type="button" class="me-chip" data-act="addpast" data-i="' + i + '">' + escapeHtml(n) + '</button>').join('');
}
function paintMeSug() {
  const el = document.getElementById('meSug');
  if (!el) return;
  el.innerHTML = meSugHtml();
  el.style.display = meSug.length ? '' : 'none';
}
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
  calcMeSug(keep);
  const tabs = TYPES.map(t => '<button type="button" data-act="type" data-t="' + t + '" class="' + (t === editType ? 'cur' : '') + '">' + t + '</button>').join('');
  const rows = m.on.map((n, i) => '<div class="me-row"><div class="me-name">' + escapeHtml(n) + '</div><div class="me-ops">' +
    '<button type="button" data-act="up" data-i="' + i + '"' + (i === 0 ? ' disabled' : '') + '>▲</button>' +
    '<button type="button" data-act="down" data-i="' + i + '"' + (i === m.on.length - 1 ? ' disabled' : '') + '>▼</button>' +
    '<button type="button" data-act="hide" data-i="' + i + '" class="me-del">非表示</button></div></div>').join('') || '<div class="hm-sub me-pad">種目がありません。</div>';
  const offs = m.off.map((n, i) => '<div class="me-row"><div class="me-name dn">' + escapeHtml(n) + '</div><div class="me-ops"><button type="button" data-act="restore" data-i="' + i + '">戻す</button></div></div>').join('');
  const past = meSugHtml();
  o.innerHTML = '<div class="me-head"><div class="hm-lb">種目の編集</div><div class="me-tabs">' + tabs + '</div></div><div class="me-body">' +
    '<div class="me-sec">テンプレート名（全角5文字まで）</div><div class="me-add"><input type="text" readonly inputmode="none" id="meName" placeholder="枠の名前" autocomplete="off" value="' +
    escapeHtml(m.name) + '"></div>' +
    '<div class="me-sec">メニュー（上から順に表示）</div>' + rows +
    '<div class="me-sec">種目を追加</div><div class="me-add"><input type="text" readonly inputmode="none" id="meInput" placeholder="種目名を入力" autocomplete="off" value="' + escapeHtml(keep) +
    '"><button type="button" data-act="add">追加</button></div>' +
    '<div class="me-chips" id="meSug"' + (past ? '' : ' style="display:none"') + '>' + past + '</div>' +
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
function layerFlagged() { const s = history.state; return !!(s && (s.sheet || s.me || s.ex || s.ach || s.ai || s.body)); }
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
  if (!s.ach) removeAch();
  if (!s.ai) removeAiPage();
  if (!s.body) removeBodyPage();
  navDone();
});
function leaveEditor() {
  closeEditor();
  leaveLayer();
}
/* テンプレート名の入力：変換中は触らず、確定したら文字数を超えた分を切って下書きへ */
function onEditorInput(e) {
  if (!draft || !e.target || e.isComposing) return;
  if (e.target.id === 'meInput') { calcMeSug(e.target.value); paintMeSug(); return; }
  if (e.target.id !== 'meName') return;
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
  else if (act === 'addpast') addName(meSug[i]);
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
  const tDays = new Set(workouts.map(w => w.dateStr)), cDays = new Set(cardios.map(c => c.dateStr)), hDays = new Set(hiitDays.map(x => x.d));
  const n = new Date(), today = dstr(n);
  const first = new Date(cal.y, cal.m, 1).getDay(), len = new Date(cal.y, cal.m + 1, 0).getDate();
  const atCur = cal.y * 12 + cal.m >= n.getFullYear() * 12 + n.getMonth();
  let g = '日月火水木金土'.split('').map(w => '<div class="cal-w">' + w + '</div>').join('') +
    '<div></div>'.repeat(first);
  for (let d = 1; d <= len; d++) {
    const s = cal.y + '-' + pad(cal.m + 1) + '-' + pad(d);
    g += '<div class="cal-d' + (s === today ? ' today' : '') + '" data-d="' + s + '" role="button"><span>' + d + '</span><span class="cal-m">' +
      (tDays.has(s) ? '<i class="cal-dot"></i>' : '') + (cDays.has(s) ? '<i class="cal-ring"></i>' : '') + (hDays.has(s) ? '<span class="cal-fire">🔥</span>' : '') +
      '</span></div>';
  }
  el.innerHTML = '<div class="cal-head"><button type="button" onclick="calShift(-1)">‹</button><div class="cal-title">' + cal.y + '年' + (cal.m + 1) +
    '月</div><button type="button" onclick="calShift(1)"' + (atCur ? ' disabled' : '') + '>›</button></div><div class="cal-grid">' + g +
    '</div><div class="cal-legend"><span><i class="cal-dot"></i>トレーニング</span><span><i class="cal-ring"></i>有酸素</span><span>🔥 HIIT</span></div>';
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
      c.minutes + '分 / 約' + Math.round(c.minutes * KCAL_PER_MIN) + 'kcal</span><button type="button" onclick="deleteCardio(\'' + c.id + '\')" class="text-gray-500 hover:text-red-400 p-1">✕</button></div>').join('') + '</div>';
  } else {
    h += '<div class="hm-sub">記録なし</div>';
  }
  h += '<div class="sh-sec">HIIT</div>';
  const hes = hiitEntriesOn(d);
  if (hes.length) {
    h += '<div class="space-y-2">' + hes.map(x => '<div class="flex justify-between items-center bg-gray-900 border border-gray-700 rounded-xl p-3"><span class="text-xs text-white">🔥 ' +
      escapeHtml(x.name || 'HIIT') + (typeof x.w === 'number' ? '（' + x.w + '秒/' + x.r + '秒×' + x.n + '）' : '') + '</span><button type="button" data-sh="hdel:' + escapeHtml(x.name) + '" class="text-gray-500 hover:text-red-400 p-1">✕</button></div>').join('') + '</div>';
  } else {
    h += '<div class="hm-sub">記録なし</div>';
  }
  h += '</div>';
  if (d <= today) {
    h += '<div class="sh-foot three"><button type="button" data-sh="addw">トレーニング追加</button><button type="button" data-sh="addc">有酸素追加</button>' +
      '<button type="button" data-sh="addh">HIIT追加</button></div>';
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
  const hp = document.getElementById('hiitPicker'); /* HIIT選択モーダルも同様 */
  if (hp) hp.remove();
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
      else if (a === 'addh') { pickHiit(day); }
      else if (a.indexOf('hdel:') === 0) { sheetDelHiit(day, a.slice(5)); }
    });
    document.body.appendChild(sheetEl);
    return renderSheet;
  });
}
/* 編集：シートを閉じてトレーニングタブの編集状態へ */
/* 日付シートのHIIT欄：その日の実施マークを1件取り消す（他の削除と同じく確認ダイアログ＋元に戻すトースト） */
window.sheetDelHiit = async function (d, name) {
  if (!d) return;
  if (!(await askConfirm('このHIITの記録を削除しますか？'))) return;
  const entry = hiitEntriesOn(d).find(x => x.name === name) || null;
  const ok = removeHiitDay(d, name);
  if (sheetDate === d) renderSheet();
  requestRender('all');
  if (ok && window.showUndoToast) {
    showUndoToast('HIITの記録を削除しました', () => {
      markHiitDay(d, name, entry);
      requestRender('all');
      if (sheetDate === d) renderSheet();
    });
  }
};
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
  const sel = detailState && detailState.g != null && detailState.g < s.length ? detailState.g : s.length - 1;
  return line(s.map(x => x.v), 320, 138, s.map(x => x.d), s.map(x => x.rm), null, null, { a: 'dt', sel: sel }, goalsData[name] || null);
}
/* 詳細グラフ下の固定欄：選択中の日（初期は最新日）の詳細 */
function detailInfoHtml(name, n) {
  const s = seriesAll(name).slice(-n);
  if (s.length < 2) return '';
  const sel = detailState && detailState.g != null && detailState.g < s.length ? detailState.g : s.length - 1;
  const x = s[sel], sets = detailStats(name).map[x.d] || [];
  const b = sets.length ? bestSet(sets) : null, vol = sets.reduce((a, t) => a + t.weight * t.reps, 0);
  return '<span class="gr-d">' + fmtD(x.d) + '</span><span>スコア <b>' + x.v + '</b></span>' +
    (x.rm ? '<span>推定1RM <b>' + x.rm + 'kg</b></span>' : '') +
    (b ? '<span>ベスト <b>' + fmtSet(b) + '</b></span>' : '') +
    '<span>総負荷 <b>' + Math.round(vol).toLocaleString() + 'kg</b></span>';
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
/* ===== 種目名の変更・統合（詳細ページの「名前変更」から）
   記録・目標・メニューの名前を一括で書き換える。既存の名前に変えると統合になる（元に戻せないので確認を強めにし、変更前の控えを残す） ===== */
function renameCandidates() {
  const cur = detailState.name.trim();
  const set = new Set();
  workouts.forEach(w => { const n = w.name.trim(); if (n && n !== cur) set.add(n); });
  return [...set].sort();
}
function renameEditorHtml() {
  const others = renameCandidates();
  return '<div class="dt-sec">種目名の変更</div><div class="ren-box">' +
    '<input id="renInput" class="ren-input" type="text" readonly inputmode="none" placeholder="新しい種目名">' +
    '<div class="ren-note">既存の種目名に変更すると、その種目と統合されます（統合は元に戻せません）。</div>' +
    (others.length ? '<div class="ren-chips">' + others.map((n, i) => '<button type="button" class="ren-chip" data-dt="rename-pick" data-i="' + i + '">' + escapeHtml(n) + '</button>').join('') + '</div>' : '') +
    '<div class="ren-btns"><button type="button" class="goal-btn" data-dt="rename-save">変更する</button><button type="button" class="goal-btn" data-dt="rename-cancel">キャンセル</button></div></div>';
}
function renameInMenu(oldName, newName) {
  ensureMenu();
  if (!tplData) return;
  TYPES.forEach(t => {
    tplData[t].slots.forEach(s => {
      const mapped = { on: s.on.map(n => String(n).trim() === oldName ? newName : n), off: s.off.map(n => String(n).trim() === oldName ? newName : n) };
      const fixed = normMenu({ [t]: mapped })[t]; /* 重複の除去と on/off の競合解消は既存の正規化に任せる */
      s.on = fixed.on;
      s.off = fixed.off;
    });
  });
  syncMenuFromTpl();
}
/* 名前書き換えの実処理（記録・目標・メニュー）。呼び出し側の transact の中で使う */
function applyRename(oldName, newName, goalKeys) {
  workouts.forEach(w => { if (w.name.trim() === oldName) w.name = newName; });
  (goalKeys || [oldName]).forEach(k => {
    if (Object.prototype.hasOwnProperty.call(goalsData, k)) {
      if (!Object.prototype.hasOwnProperty.call(goalsData, newName)) goalsData[newName] = goalsData[k];
      delete goalsData[k];
    }
  });
  renameInMenu(oldName, newName);
}
async function renameExercise(rawName, newName) {
  const oldName = rawName.trim();
  const cnt = n => workouts.filter(w => w.name.trim() === n).length;
  const oldCount = cnt(oldName), targetCount = cnt(newName);
  const merging = targetCount > 0;
  const msg = merging
    ? '『' + escapeHtml(oldName) + '』の記録 ' + oldCount + '件を、既存の『' + escapeHtml(newName) + '』（' + targetCount + '件）と統合します。合計 ' + (oldCount + targetCount) + '件になります。<br>統合は元に戻せません。よろしいですか？'
    : '『' + escapeHtml(oldName) + '』の記録 ' + oldCount + '件の名前を『' + escapeHtml(newName) + '』に変更します。よろしいですか？';
  if (!(await ask(msg, merging ? '統合' : '変更'))) return;
  const goalKeys = [...new Set([rawName, oldName])];
  const ok = transact(['workouts', 'goals', 'menu'], () => {
    if (!writeJson('simple_pre_restore', { workouts: workouts, cardios: cardios, dayPplMap: dayPplMap, menu: menuData, goals: goalsData })) return false;
    applyRename(oldName, newName, goalKeys);
  }, { failMsg: '名前の変更に失敗しました。元のデータに戻しました。' });
  if (ok) {
    detailState.name = newName;
    detailState.rename = false;
    detailState.g = null;
    renderDetail();
    requestRender('all');
    alert('種目名を' + (merging ? '統合' : '変更') + 'しました');
  }
}
/* 目標の行（自己ベストの下に1行＋細いバーだけ。スクロール無しで見える今の詳細ページを崩さない） */
function fmtKg(v) { return String(Math.round(v * 10) / 10); }
function goalRowHtml(st) {
  const g = goalsData[detailState.name];
  const bestW = st.pw ? st.pw.v : 0;
  if (detailState.goalEdit) {
    return '<div class="dt-row"><div class="hm-lb">目標</div><div class="goal-edit">' +
      '<input id="goalInput" class="goal-input weight-input" type="text" readonly inputmode="none" placeholder="目標kg" value="' + (g ? fmtKg(g) : '') + '">' +
      '<button type="button" class="goal-btn" data-dt="goal-save">保存</button>' +
      '<button type="button" class="goal-btn" data-dt="goal-cancel">取消</button>' +
      (g ? '<button type="button" class="goal-btn danger" data-dt="goal-del">削除</button>' : '') +
      '</div></div>';
  }
  if (!g) {
    return '<div class="dt-row goal-row" data-dt="goal" role="button"><div class="hm-lb">目標</div><div><span class="goal-chip">未設定</span></div></div>';
  }
  const pct = Math.floor(bestW / g * 100);
  const sub = bestW >= g ? '<span class="dt-date goal-done">達成！</span>' : '<span class="dt-date goal-sub">あと' + fmtKg(g - bestW) + 'kg・' + pct + '%</span>';
  return '<div class="dt-row goal-row" data-dt="goal" role="button"><div class="hm-lb">目標</div><div><span class="dt-v">' + fmtKg(g) + 'kg</span>' + sub + '</div></div>' +
    '<div class="goal-bar"><i style="width:' + Math.min(100, pct) + '%"></i></div>';
}
function renderDetail() {
  if (!detailEl || !detailState) return;
  const st = detailStats(detailState.name);
  let h = '<div class="dt-head"><div class="dt-ttl"><span class="hm-en">' + escapeHtml(detailState.name) + '</span>' + lastDoneHtml(st) + '</div>' +
    '<button type="button" class="dt-ren" data-dt="rename">名前変更</button><button type="button" class="dt-x" data-dt="close" aria-label="閉じる">✕</button></div><div class="dt-body">';
  if (!st.days.length) {
    detailEl.innerHTML = h + (detailState.rename ? renameEditorHtml() : '') + '<div class="hm-sub dt-pad">この種目の記録がまだありません。</div></div>';
    return;
  }
  const best = x => x ? '<div class="dt-row"><div class="hm-lb">' + x.k + '</div><div><span class="dt-v">' + x.v + '</span><span class="dt-date">' + fmtD(x.d) + '</span></div></div>' : '';
  const cellv = (k, v, u) => '<div class="dt-cell"><div class="hm-lb">' + k + '</div><div class="dt-v">' + v + '<span class="dt-u">' + u + '</span></div></div>';
  h += (detailState.rename ? renameEditorHtml() : '') + '<div class="dt-sec">基本サマリー</div><div class="dt-grid">' +
    cellv('総実施回数', st.days.length, '回') + cellv('累計総負荷', Math.round(st.vol).toLocaleString(), 'kg') + '</div>' +
    '<div class="dt-sec">自己ベスト（PR）</div>' +
    best(st.pw && { k: '最大重量', v: st.pw.v + 'kg', d: st.pw.d }) +
    best(st.p1 && { k: '推定1RM', v: st.p1.v + 'kg', d: st.p1.d }) +
    best(st.ps && { k: '1日スコア', v: st.ps.v, d: st.ps.d }) +
    goalRowHtml(st) +
    '<div class="dt-sec dt-sec-row"><span>グラフ・推移</span><div class="dt-n">' +
    DETAIL_COUNTS.map(n => '<button type="button" class="gr-btn' + (n === detailState.n ? ' on' : '') + '" data-dt="n" data-n="' + n + '" aria-pressed="' + (n === detailState.n ? 'true' : 'false') + '">' + n + '件</button>').join('') +
    '</div></div><div class="dt-graph" id="dtGraph">' + detailGraphHtml(detailState.name, detailState.n) + '</div><div class="gr-info" id="dtInfo">' + detailInfoHtml(detailState.name, detailState.n) + '</div>' +
    '<div class="dt-sec">前回との比較</div>' + detailCompareHtml(st) +
    '</div>';
  detailEl.innerHTML = h;
}
/* グラフだけ描き直す（件数ボタン）。ページのスクロール位置や過去記録の開閉は触らない */
function paintDetailGraph() {
  if (!detailEl || !detailState) return;
  const g = detailEl.querySelector('#dtGraph');
  if (g) g.innerHTML = detailGraphHtml(detailState.name, detailState.n);
  const inf = detailEl.querySelector('#dtInfo');
  if (inf) inf.innerHTML = detailInfoHtml(detailState.name, detailState.n);
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
    if (DETAIL_COUNTS.includes(n) && n !== detailState.n) { detailState.n = n; detailState.g = null; paintDetailGraph(); }
  } else if (a === 'pt') {
    const i = parseInt(b.dataset.gi, 10);
    if (!isNaN(i)) { detailState.g = i; paintDetailGraph(); }
  } else if (a === 'rename') {
    detailState.rename = true;
    renderDetail();
    const rin = detailEl.querySelector('#renInput');
    if (rin) { rin.value = detailState.name; rin.focus(); }
  } else if (a === 'rename-cancel') {
    detailState.rename = false;
    renderDetail();
  } else if (a === 'rename-pick') {
    const rin = detailEl.querySelector('#renInput');
    const picked = renameCandidates()[parseInt(b.dataset.i, 10)];
    if (rin && picked) rin.value = picked;
  } else if (a === 'rename-save') {
    const rin = detailEl.querySelector('#renInput');
    const newName = rin ? rin.value.trim().slice(0, LIMITS.name) : '';
    if (!newName) { alert('新しい種目名を入力してください。'); return; }
    if (newName === detailState.name.trim()) { detailState.rename = false; renderDetail(); return; }
    renameExercise(detailState.name, newName);
  } else if (a === 'goal') {
    detailState.goalEdit = true;
    renderDetail();
    const inp = detailEl.querySelector('#goalInput');
    if (inp) { inp.focus(); inp.select(); }
  } else if (a === 'goal-cancel') {
    detailState.goalEdit = false;
    renderDetail();
  } else if (a === 'goal-save') {
    const inp = detailEl.querySelector('#goalInput');
    const v = inp ? parseFloat(String(inp.value).replace(/[^0-9.]/g, '')) : NaN;
    if (!(v > 0) || v > LIMITS.weight) { alert('目標は 0 より大きく ' + LIMITS.weight + 'kg 以下で入力してください。'); return; }
    const nm = detailState.name;
    if (transact(['goals'], () => { goalsData[nm] = Math.round(v * 10) / 10; })) { detailState.goalEdit = false; renderDetail(); }
  } else if (a === 'goal-del') {
    const nm = detailState.name;
    if (transact(['goals'], () => { delete goalsData[nm]; })) { detailState.goalEdit = false; renderDetail(); }
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
    detailState = { name: name, n: DETAIL_COUNTS[0], g: null }; /* グラフ件数は 5 件から。g は選択中の点（null＝最新） */
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
  closePad(); /* 目標入力のテンキーが開いたままページだけ消えないように */
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
  if (name !== 'cardio') closeHiit(); /* 有酸素以外へ移動したらHIITアコーディオンも閉じる（実行中でも表示だけ閉じる。中身は止めない） */
  if (name !== 'home') homeOpen = null; /* ホームの種目の展開（グラフ）も閉じる。次にホームへ戻ったときは閉じた状態で描く */
  const paging = resetPaging(); /* 履歴の表示件数は基準に戻す（トレーニング＝4件、有酸素＝5件） */
  Object.keys(TABS).forEach(k => {
    const el = document.getElementById(TABS[k]);
    if (el) el.classList.toggle('hidden', k !== name);
  });
  document.querySelectorAll('#bottomNav button').forEach(b => b.classList.toggle('on', b.dataset.t === name));
  const shownEl = document.getElementById(TABS[name]);
  if (shownEl) { shownEl.classList.remove('view-in'); void shownEl.offsetWidth; shownEl.classList.add('view-in'); }
  if (name === 'settings') { anPeriod = 'week'; setSub('analysis'); } /* 「編集・分析/設定」を開いたときは、最初に「編集・分析」（分析カードは週間分析から） */
  /* 件数を戻した履歴と、見えるようになった画面（ホーム／月間・設定）を、最新の内容で1回だけ描く */
  const e = extra || {};
  requestRender({ w: !!e.w || paging.w, c: !!e.c || paging.c, view: name });
  fitTimer(); /* トレーニング画面が見えるようになったとき、タイマーの文字サイズを合わせる */
  safe(paintRing); /* 目盛りリングも最新の状態に */
  window.scrollTo(0, 0);
}
window.switchTab = function (name) { showTab(name); };

/* ===== スナップショット世代管理（端末内のみ・クラウドなし）
   毎日「その日最初に触れた時点」のデータを1世代として自動保存し、最大7世代を保つ。
   その日に作った世代は上書きしない＝当日の事故（誤削除・誤復元）の前の状態が残る。
   復元は JSON 復元の仕組み（検証・件数確認・復元前の控え保存）をそのまま使う ===== */
const SNAP_KEY = 'simple_snapshots', SNAP_MAX = 7;
function snapData() { return buildBackupData(); } /* 組み立ては app-core.js の buildBackupData に一本化 */
function loadSnaps() {
  const s = loadJson(SNAP_KEY, []);
  return Array.isArray(s) ? s.filter(x => x && typeof x.date === 'string' && x.data && typeof x.data === 'object') : [];
}
function ensureDailySnapshot() {
  try {
    if (!workouts.length && !cardios.length) return; /* 空データの日は世代を作らない */
    const today = dstr(new Date());
    let snaps = loadSnaps();
    if (snaps.some(s => s.date === today)) return; /* 今日の分は作成済み（上書きしない） */
    const data = snapData(), ser = JSON.stringify(data);
    const last = snaps[snaps.length - 1];
    if (last && JSON.stringify(last.data) === ser) return; /* 前の世代から変化なし */
    snaps.push({ date: today, ts: new Date().toISOString(), data: data });
    snaps.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
    while (snaps.length > SNAP_MAX) snaps.shift();
    if (!writeJson(SNAP_KEY, snaps)) writeJson(SNAP_KEY, snaps.slice(-1)); /* 容量不足なら最新1世代だけでも残す */
    paintSnapshots();
  } catch (e) {}
}
/* スナップショットからの復元：JSON を取り込み欄に渡して、既存の復元処理（検証→確認→控え保存つき）に任せる */
async function restoreSnapshot(date) {
  const s = loadSnaps().find(x => x.date === date);
  if (!s) return;
  const el = document.getElementById('importText');
  if (!el) return;
  const keep = el.value;
  el.value = JSON.stringify(s.data);
  await importFromJsonText();
  el.value = keep;
  paintSnapshots();
}
window.restoreSnapshot = restoreSnapshot; /* 設定のスナップショット欄の「復元」ボタン（onclick）から呼ぶため */
function paintSnapshots() {
  const pin = document.getElementById('snapPersistInfo');
  if (pin && navigator.storage && navigator.storage.persisted) {
    navigator.storage.persisted().then(p => { pin.textContent = p ? 'データ保持：永続化されています' : 'データ保持：永続化されていません（ブラウザの判断で消える場合があります）'; }).catch(() => {});
  }
  const list = document.getElementById('snapList');
  if (!list) return;
  const snaps = loadSnaps();
  if (!snaps.length) {
    list.innerHTML = '<div class="text-xs text-gray-500">まだスナップショットがありません。記録がある日に自動で作られます。</div>';
    return;
  }
  list.innerHTML = snaps.slice().reverse().map(s =>
    '<div class="snap-row"><span>' + s.date.replace(/-/g, '/') + '（トレ' + (Array.isArray(s.data.workouts) ? s.data.workouts.length : 0) + '件・有酸素' + (Array.isArray(s.data.cardios) ? s.data.cardios.length : 0) + '件）</span>' +
    '<button type="button" class="snap-btn" onclick="restoreSnapshot(\'' + s.date + '\')">復元</button></div>').join('');
}
/* ブラウザにデータの永続化を頼む（許可されるかはブラウザの判断） */
function requestPersist() {
  try {
    if (!navigator.storage || !navigator.storage.persist) return;
    navigator.storage.persisted().then(p => { if (!p) return navigator.storage.persist(); }).catch(() => {});
  } catch (e) {}
}


/* ===== 身体データ（プロフィールから開く専用ページ）
   simple_body … 設定 { heightCm, age, sex, goal, life, targetKg, kcalManual }
   simple_weight … 体重ログ [{ d, kg }]（1日1件・日付順）
   計算は目安：基礎代謝（ミフリン式）×活動量（日常の動き＋直近4週の運動量）→ 維持カロリー → 目標タイプで調整 → PFC配分 ===== */
const BODY_GOALS = { cut: { label: '減量', adj: -400 }, bulk: { label: '増量', adj: 250 }, recomp: { label: 'リコンプ', adj: 0 } };
const BODY_LIFE = { low: { label: '座り中心', f: 1.2 }, mid: { label: '普通', f: 1.375 }, high: { label: 'よく動く', f: 1.55 } };
function weightOn(ds) { const e = weightData.find(x => x.d === ds); return e ? e.kg : null; }
function latestWeight() { return weightData.length ? weightData[weightData.length - 1] : null; }
function weightAvg(fromDs, toDs) {
  const xs = weightData.filter(x => x.d >= fromDs && x.d <= toDs);
  return xs.length ? xs.reduce((a, x) => a + x.kg, 0) / xs.length : null;
}
function weeklyAvgWeight() { return weightAvg(dstr(new Date(Date.now() - 6 * 86400000)), dstr(new Date())); }
function bmrOf(b, kg) { const base = 10 * kg + 6.25 * b.heightCm - 5 * b.age; return b.sex === 'f' ? base - 161 : base + 5; }
/* 活動量：日常の動き（設定）＋運動分（直近4週のトレ日数・有酸素から自動。上限つき） */
function activityFactor() {
  let f = (BODY_LIFE[bodyData.life] || BODY_LIFE.mid).f;
  const since = dstr(new Date(Date.now() - 27 * 86400000));
  const days = new Set(workouts.filter(w => w.dateStr >= since).map(w => w.dateStr)).size;
  const cmin = cardios.filter(c => c.dateStr >= since).reduce((a, c) => a + c.minutes, 0);
  const bonus = Math.min(0.17, (days / 4) * 0.03 + (cmin / 4 / 60) * 0.01);
  return { f: f + bonus, trainWk: days / 4, cardioWk: Math.round(cmin / 4) };
}
/* 推奨カロリー・PFCの計算。材料（身長・年齢・性別・体重）が足りなければ null */
function bodyCalc() {
  const b = bodyData, lw = latestWeight();
  if (!lw || !(b.heightCm > 0) || !(b.age > 0) || (b.sex !== 'm' && b.sex !== 'f')) return null;
  const kg = lw.kg;
  const act = activityFactor();
  const maint = Math.round(bmrOf(b, kg) * act.f / 10) * 10;
  const goal = BODY_GOALS[b.goal] ? b.goal : 'recomp';
  const kcal = b.kcalManual > 0 ? b.kcalManual : maint + BODY_GOALS[goal].adj + (b.adjKcal || 0);
  const pG = Math.round(kg * 2), fG = Math.round(kcal * 0.25 / 9);
  const cG = Math.max(0, Math.round((kcal - pG * 4 - fG * 9) / 4));
  return { kg: kg, date: lw.d, avg: weeklyAvgWeight(), bmi: Math.round(kg / Math.pow(b.heightCm / 100, 2) * 10) / 10,
    bmr: Math.round(bmrOf(b, kg)), factor: act.f, maint: maint, goal: goal, kcal: kcal, manual: b.kcalManual > 0, adj: b.adjKcal || 0,
    pG: pG, fG: fG, cG: cG, trainWk: act.trainWk, cardioWk: act.cardioWk };
}

/* ===== 自動補正（第2弾）：体重の週平均の動きが目標の想定とずれたら、目標カロリーを少しずつ寄せる。
   「目標通りに食べている」前提の目安補正。1回 ±150kcal まで・週1回まで・累積 ±600kcal まで。
   目標カロリーを手入力している間は止まる ===== */
function bodyAdjustCalc() {
  const b = bodyData;
  if (b.kcalManual > 0) return null;
  if (weightData.length < 2) return null;
  const today = dstr(new Date());
  if (weightData[0].d > shiftDate(today, -13)) return null; /* 記録が14日分に届いていない */
  const aNow = weightAvg(shiftDate(today, -6), today);
  const aPrev = weightAvg(shiftDate(today, -13), shiftDate(today, -7));
  if (aNow === null || aPrev === null) return null;
  const goal = BODY_GOALS[b.goal] ? b.goal : 'recomp';
  const expected = BODY_GOALS[goal].adj * 7 / 7700; /* 想定の週変化(kg) */
  const actual = aNow - aPrev;
  const gapKcal = (actual - expected) * 1100; /* ズレの1日あたりkcal換算（1kg＝7700kcal÷7日） */
  let step = -Math.round(gapKcal * 0.5 / 10) * 10;
  step = Math.max(-150, Math.min(150, step));
  return { step: step, actual: Math.round(actual * 100) / 100, expected: Math.round(expected * 100) / 100 };
}
function applyBodyCorrection() {
  try {
    if (bodyData.kcalManual > 0) return;
    const today = dstr(new Date());
    if (bodyData.adjDate && bodyData.adjDate > shiftDate(today, -7)) return; /* 前回から7日たっていない */
    const r = bodyAdjustCalc();
    if (!r || r.step === 0) return;
    const next = Math.max(-600, Math.min(600, (bodyData.adjKcal || 0) + r.step));
    if (next === (bodyData.adjKcal || 0)) return;
    transact(['body'], () => { bodyData = Object.assign({}, bodyData, { adjKcal: next, adjDate: today }); });
  } catch (e) {}
}
/* AI分析の「身体・栄養」セクション。身体データが無い・途中でも落ちず、ある分だけ返す */
function aiBody() {
  const lines = [];
  try {
    applyBodyCorrection();
    const b = bodyData, lw = latestWeight();
    if (!lw) return lines;
    const wn = weightData.length;
    lines.push('体重データの信頼度：' + (wn >= 14 ? '高' : wn >= 4 ? '中' : '低') + '（記録' + wn + '件）');
    const avg = weeklyAvgWeight();
    lines.push('最新体重は' + fmtKg(lw.kg) + 'kg（' + fmtD(lw.d) + '）' + (avg !== null ? '、週平均は' + fmtKg(Math.round(avg * 10) / 10) + 'kg' : '') + '。');
    const today = dstr(new Date());
    const aPrev = weightAvg(shiftDate(today, -13), shiftDate(today, -7));
    if (avg !== null && aPrev !== null) {
      const d = Math.round((avg - aPrev) * 10) / 10;
      const goal = BODY_GOALS[b.goal] ? b.goal : 'recomp';
      let judge = '';
      if (goal === 'cut') judge = d < 0 ? '減量の方向に進んでいます。' : d > 0 ? '減量目標とは逆方向です。' : '横ばいです。';
      else if (goal === 'bulk') judge = d > 0 ? '増量の方向に進んでいます。' : d < 0 ? '増量目標とは逆方向です。' : '横ばいです。';
      else judge = Math.abs(d) <= 0.5 ? 'リコンプの範囲で安定しています。' : (d > 0 ? 'やや増加傾向です。' : 'やや減少傾向です。');
      lines.push('週平均は前週比' + (d > 0 ? '+' : '') + fmtKg(d) + 'kg。' + judge);
    }
    if (b.targetKg > 0) {
      const diff = Math.round((lw.kg - b.targetKg) * 10) / 10;
      lines.push(diff === 0 ? '目標体重' + fmtKg(b.targetKg) + 'kgに到達しています！' : '目標体重' + fmtKg(b.targetKg) + 'kgまであと' + fmtKg(Math.abs(diff)) + 'kg。');
    }
    const c = bodyCalc();
    if (c) {
      lines.push('目標カロリーは' + nf(c.kcal) + 'kcal（P' + c.pG + 'g／F' + c.fG + 'g／C' + c.cG + 'g）。');
      if (c.manual) lines.push('目標カロリーは手入力のため、自動補正は止まっています。');
      else if (c.adj) lines.push('体重の動きに合わせて、目標カロリーを' + (c.adj > 0 ? '+' : '') + c.adj + 'kcal補正中です。');
    }
  } catch (e) { return []; }
  return lines;
}
let bodyEl = null; /* 身体データページ（全画面） */
let bodyState = { date: null, form: null };
function shiftDate(ds, n) { const p = ds.split('-').map(Number); return dstr(new Date(p[0], p[1] - 1, p[2] + n)); }
function openBodyPage() {
  applyBodyCorrection();
  openLayer('body', () => !bodyEl && !aiEl && !detailEl && !sheetEl && !editorOpen(), () => {
    if (achEl) removeAch();
    bodyState = { date: dstr(new Date()),
      form: { height: bodyData.heightCm || '', age: bodyData.age || '', sex: bodyData.sex || '',
        goal: bodyData.goal || 'recomp', life: bodyData.life || 'mid',
        target: bodyData.targetKg || '', kcal: bodyData.kcalManual || '' } };
    bodyEl = document.createElement('div');
    bodyEl.id = 'bodyPage';
    bodyEl.setAttribute('role', 'dialog');
    bodyEl.setAttribute('aria-modal', 'true');
    bodyEl.addEventListener('click', onBodyClick);
    document.body.appendChild(bodyEl);
    return () => { bodyEl.innerHTML = bodyPageHtml(); };
  });
}
function removeBodyPage() {
  if (!bodyEl) return;
  closePad();
  bodyEl.remove();
  bodyEl = null;
}
function leaveBodyPage() {
  if (!bodyEl) return;
  removeBodyPage();
  leaveLayer();
}
function paintBodyPage() { if (bodyEl) bodyEl.innerHTML = bodyPageHtml(); }
/* 再描画の前に、設定フォームの入力途中を下書きへ退避する（描き直しで消えないように） */
function stashBodyForm() {
  if (!bodyEl || !bodyState.form) return;
  const g = id => { const e = bodyEl.querySelector(id); return e ? e.value : ''; };
  bodyState.form.height = g('#bdHeight'); bodyState.form.age = g('#bdAge');
  bodyState.form.target = g('#bdTarget'); bodyState.form.kcal = g('#bdKcal');
}
function bodyPageHtml() {
  const b = bodyData, f = bodyState.form, c = bodyCalc(), lw = latestWeight();
  const row = (k, v) => '<div class="dt-row"><div class="hm-lb">' + k + '</div><div><span class="dt-v">' + v + '</span></div></div>';
  let h = '<div class="dt-head"><div class="dt-ttl"><div class="dt-name">身体データ</div><div class="hm-en">BODY DATA</div></div>' +
    '<button type="button" class="dt-x" data-bd="close" aria-label="閉じる">✕</button></div><div class="dt-body">';
  /* 現在 */
  h += '<div class="dt-sec">現在</div>';
  if (lw) {
    h += row('最新体重', fmtKg(lw.kg) + 'kg') + '<div class="dt-row"><div class="hm-lb">記録日</div><div><span class="dt-date">' + fmtD(lw.d) + '</span></div></div>';
    const avg = weeklyAvgWeight();
    if (avg !== null) h += row('週平均体重', fmtKg(Math.round(avg * 10) / 10) + 'kg');
    if (b.heightCm > 0) h += row('BMI', String(Math.round(lw.kg / Math.pow(b.heightCm / 100, 2) * 10) / 10));
    if (b.targetKg > 0) {
      const diff = Math.round((lw.kg - b.targetKg) * 10) / 10;
      let prog = '';
      const first = weightData[0];
      if (first && first.kg !== b.targetKg) {
        const p = Math.round((first.kg - lw.kg) / (first.kg - b.targetKg) * 100);
        if (p > 0 && p < 100) prog = '<div class="pf-bar"><i style="width:' + p + '%"></i></div>';
      }
      h += row('目標体重', fmtKg(b.targetKg) + 'kg') +
        row('目標まで', diff === 0 ? '達成！' : 'あと' + fmtKg(Math.abs(diff)) + 'kg') + prog;
    }
  } else {
    h += '<div class="ai-card"><div class="ai-line"><span>まだ体重の記録がありません。下の「体重を記録」から入れてください。</span></div></div>';
  }
  /* 体重を記録 */
  const d = bodyState.date, cur = weightOn(d), today = dstr(new Date());
  h += '<div class="dt-sec">体重を記録</div><div class="bd-form">' +
    '<div class="bd-daterow"><button type="button" class="snap-btn" data-bd="dprev">◀</button>' +
    '<span class="bd-date">' + fmtD(d) + (d === today ? '（今日）' : '') + '</span>' +
    '<button type="button" class="snap-btn" data-bd="dnext"' + (d >= today ? ' disabled' : '') + '>▶</button></div>' +
    '<div class="bd-wrow"><input id="bdWeight" class="bd-input weight-input" type="text" readonly inputmode="none" placeholder="体重 kg" value="' + (cur !== null ? cur : '') + '">' +
    '<button type="button" class="goal-btn" data-bd="wsave">保存</button>' +
    (cur !== null ? '<button type="button" class="goal-btn danger" data-bd="wdel">削除</button>' : '') + '</div></div>';
  /* 推移グラフ（直近30件：日々の体重＋週平均＋目標線） */
  h += '<div class="dt-sec">推移</div>';
  if (weightData.length >= 2) {
    const xs = weightData.slice(-30);
    const vs = xs.map(x => x.kg);
    const av = xs.map(x => { const a = weightAvg(shiftDate(x.d, -6), x.d); return a === null ? x.kg : Math.round(a * 10) / 10; });
    let mn = Math.min(...vs, ...av), mx = Math.max(...vs, ...av);
    if (b.targetKg > 0) { mn = Math.min(mn, b.targetKg); mx = Math.max(mx, b.targetKg); }
    h += '<div class="bd-graph"><div class="bd-leg"><span class="lg-g">体重</span><span class="lg-r">週平均</span></div>' +
      line(vs, 340, 170, xs.map(x => x.d), av, null, { min: Math.floor(mn - 1), max: Math.ceil(mx + 1), fmtV: x => x }, null, b.targetKg > 0 ? b.targetKg : null) + '</div>';
  } else {
    h += '<div class="ai-card"><div class="ai-line"><span>2日分たまると推移グラフが出ます。</span></div></div>';
  }
  /* 記録リスト（新しい順・最大14件） */
  if (weightData.length) {
    h += '<div class="dt-sec">記録</div>' + weightData.slice(-14).reverse().map(x =>
      '<div class="dt-row bd-witem" data-bd="wload" data-d="' + x.d + '" role="button"><div class="hm-lb">' + fmtD(x.d) + '</div><div><span class="dt-v">' + fmtKg(x.kg) + 'kg</span></div></div>').join('');
  }
  /* 設定 */
  const chips = (key, opts, val) => '<span class="bd-chips">' + opts.map(o =>
    '<button type="button" class="gr-btn' + (val === o[0] ? ' on' : '') + '" data-bd="' + key + '" data-v="' + o[0] + '">' + o[1] + '</button>').join('') + '</span>';
  const frow = (k, inner) => '<div class="dt-row"><div class="hm-lb">' + k + '</div><div>' + inner + '</div></div>';
  h += '<div class="dt-sec">設定</div>' +
    frow('身長', '<input id="bdHeight" class="bd-input reps-input" type="text" readonly inputmode="none" placeholder="cm" value="' + f.height + '"> cm') +
    frow('年齢', '<input id="bdAge" class="bd-input reps-input" type="text" readonly inputmode="none" placeholder="歳" value="' + f.age + '"> 歳') +
    frow('性別', chips('sex', [['m', '男'], ['f', '女']], f.sex)) +
    frow('目標', chips('goal', [['cut', '減量'], ['bulk', '増量'], ['recomp', 'リコンプ']], f.goal)) +
    frow('日常の動き', chips('life', [['low', '座り中心'], ['mid', '普通'], ['high', 'よく動く']], f.life)) +
    frow('目標体重', '<input id="bdTarget" class="bd-input weight-input" type="text" readonly inputmode="none" placeholder="kg" value="' + f.target + '"> kg') +
    frow('目標カロリー', '<input id="bdKcal" class="bd-input reps-input" type="text" readonly inputmode="none" placeholder="自動" value="' + f.kcal + '"> kcal') +
    '<div class="bd-saverow"><button type="button" class="goal-btn" data-bd="save">設定を保存</button></div>' +
    '<div class="ai-note">目標カロリーを空にすると自動計算になります。手入力した間は自動補正（第2弾）も止まります。</div>';
  /* 推奨 */
  h += '<div class="dt-sec">推奨</div>';
  if (c) {
    h += row('基礎代謝', nf(c.bmr) + 'kcal') +
      row('維持カロリー推定', nf(c.maint) + 'kcal') +
      '<div class="ai-card"><div class="ai-line"><span>活動量は「' + (BODY_LIFE[b.life] || BODY_LIFE.mid).label + '」＋運動分（直近4週：トレ週' + (Math.round(c.trainWk * 10) / 10) + '回・有酸素週' + c.cardioWk + '分）で計算しています。</span></div></div>' +
      row('目標カロリー', nf(c.kcal) + 'kcal' + (c.manual ? '（手入力）' : '')) +
      row('目標PFC', 'P ' + c.pG + 'g ／ F ' + c.fG + 'g ／ C ' + c.cG + 'g') +
      '<div class="ai-note">P＝体重×2g、F＝目標カロリーの25%、残りをCで計算した目安です。</div>' +
      (c.adj ? '<div class="ai-card"><div class="ai-line"><span>体重の動きに合わせて、目標カロリーを' + (c.adj > 0 ? '+' : '') + c.adj + 'kcal補正中です。</span></div></div>' : '');
  } else {
    h += '<div class="ai-card"><div class="ai-line"><span>身長・年齢・性別と体重がそろうと、推奨カロリーと目標PFCを計算します。</span></div></div>';
  }
  return h + '</div>';
}
async function onBodyClick(e) {
  const btn = e.target.closest('[data-bd]');
  if (!btn) {
    if (e.target === bodyEl || e.target.classList.contains('dt-body') || e.target.closest('.dt-ttl')) leaveBodyPage();
    return;
  }
  const act = btn.dataset.bd;
  if (act === 'close') { leaveBodyPage(); return; }
  if (act === 'sex' || act === 'goal' || act === 'life') {
    bodyState.form[act] = btn.dataset.v;
    btn.parentElement.querySelectorAll('.gr-btn').forEach(x => x.classList.toggle('on', x === btn));
    return;
  }
  if (act === 'dprev' || act === 'dnext') {
    stashBodyForm();
    const nd = shiftDate(bodyState.date, act === 'dprev' ? -1 : 1);
    if (nd <= dstr(new Date())) { bodyState.date = nd; paintBodyPage(); }
    return;
  }
  if (act === 'wload') { stashBodyForm(); bodyState.date = btn.dataset.d; paintBodyPage(); const sc = bodyEl.querySelector('.dt-body'); if (sc) sc.scrollTop = 0; return; }
  if (act === 'wsave') {
    const inp = bodyEl.querySelector('#bdWeight');
    const v = inp ? parseFloat(inp.value) : NaN;
    if (!isFinite(v) || v < 30 || v > 300) { alert('体重は30〜300kgで入れてください。'); return; }
    const kg = Math.round(v * 10) / 10, d = bodyState.date;
    const ok = transact(['weight'], () => {
      const i = weightData.findIndex(x => x.d === d);
      if (i >= 0) weightData[i].kg = kg; else { weightData.push({ d: d, kg: kg }); weightData.sort((a, z) => a.d < z.d ? -1 : 1); }
    });
    if (ok) { stashBodyForm(); paintBodyPage(); alert('体重を保存しました。'); }
    return;
  }
  if (act === 'wdel') {
    const d = bodyState.date;
    if (!(await ask(fmtD(d) + 'の体重記録を削除しますか？', '削除'))) return;
    const ok = transact(['weight'], () => { const i = weightData.findIndex(x => x.d === d); if (i >= 0) weightData.splice(i, 1); });
    if (ok) { stashBodyForm(); paintBodyPage(); }
    return;
  }
  if (act === 'save') {
    stashBodyForm();
    const f = bodyState.form;
    const height = numVal(f.height), age = numVal(f.age), target = numVal(f.target), kcal = numVal(f.kcal);
    if (height !== null && (height < 100 || height > 230)) { alert('身長は100〜230cmで入れてください。'); return; }
    if (age !== null && (age < 10 || age > 100)) { alert('年齢は10〜100で入れてください。'); return; }
    if (target !== null && (target < 30 || target > 300)) { alert('目標体重は30〜300kgで入れてください。'); return; }
    if (kcal !== null && (kcal < 800 || kcal > 6000)) { alert('目標カロリーは800〜6000kcalで入れてください。'); return; }
    const nb = {};
    if (height !== null) nb.heightCm = Math.round(height);
    if (age !== null) nb.age = Math.round(age);
    if (f.sex === 'm' || f.sex === 'f') nb.sex = f.sex;
    nb.goal = BODY_GOALS[f.goal] ? f.goal : 'recomp';
    nb.life = BODY_LIFE[f.life] ? f.life : 'mid';
    if (target !== null) nb.targetKg = Math.round(target * 10) / 10;
    if (kcal !== null) nb.kcalManual = Math.round(kcal);
    if (nb.goal === bodyData.goal && bodyData.adjKcal) { nb.adjKcal = bodyData.adjKcal; if (bodyData.adjDate) nb.adjDate = bodyData.adjDate; } /* 目標が同じなら自動補正を引き継ぐ */
    const ok = transact(['body'], () => { bodyData = nb; });
    if (ok) { bodyState.form = { height: nb.heightCm || '', age: nb.age || '', sex: nb.sex || '', goal: nb.goal, life: nb.life, target: nb.targetKg || '', kcal: nb.kcalManual || '' }; paintBodyPage(); alert('設定を保存しました。'); }
    return;
  }
}

/* ===== テスト用窓口（test.html 専用。通常の画面からは使われない）
   自己診断ページがアプリ本体の計算・集計をそのまま借りてチェックするための入口。
   swap/restore はテスト用データへの差し替えと原状復帰（実データはテスト側で退避される） ===== */
/* ===== HIITタイマー（有酸素タブのアコーディオンの中で設定→実行まで完結する）
   保存するのは「実施した日付」だけ（app-core の simple_hiit_days）。分数・kcal・設定内容は記録に残さない。
   設定（前回値）だけは端末内に覚える（iron_hiit_cfg。バックアップには入れない） ===== */
const HIIT_PRESETS = [
  { name: 'タバタ', work: 20, rest: 10, rounds: 8 },
  { name: 'ハード', work: 30, rest: 15, rounds: 10 },
  { name: 'イージー', work: 30, rest: 30, rounds: 6 }
];
const HIIT_PREP_SEC = 10;
let hiitCfg = { name: 'タバタ', work: 20, rest: 10, rounds: 8 };
try {
  const sv = JSON.parse(localStorage.getItem('iron_hiit_cfg') || 'null');
  if (sv && isFinite(sv.work) && isFinite(sv.rest) && isFinite(sv.rounds)) {
    hiitCfg = { name: typeof sv.name === 'string' ? sv.name : 'カスタム', work: sv.work | 0, rest: sv.rest | 0, rounds: sv.rounds | 0 };
  }
} catch (e) {}
let hiitState = null; /* 実行中：{ cfg, phases, i, endAt, timer, paused, remainMs, totalSec, dateStr, wake } */

function hiitSaveCfg() { try { localStorage.setItem('iron_hiit_cfg', JSON.stringify(hiitCfg)); } catch (e) {} }
function hiitPhases(cfg) {
  const ph = [{ k: 'prep', sec: HIIT_PREP_SEC, round: 0 }];
  for (let r = 1; r <= cfg.rounds; r++) {
    ph.push({ k: 'work', sec: cfg.work, round: r });
    if (r < cfg.rounds && cfg.rest > 0) ph.push({ k: 'rest', sec: cfg.rest, round: r });
  }
  return ph;
}
function hiitTotalSec(cfg) { return HIIT_PREP_SEC + cfg.work * cfg.rounds + (cfg.rest > 0 ? cfg.rest * (cfg.rounds - 1) : 0); }
function hiitCfgFromInputs() {
  const w = parseInt(document.getElementById('hiitWork').value, 10);
  const r = parseInt(document.getElementById('hiitRest').value, 10);
  const n = parseInt(document.getElementById('hiitRounds').value, 10);
  const work = isFinite(w) ? w : 0, rest = isFinite(r) ? r : 0, rounds = isFinite(n) ? n : 0;
  if (work < 5 || work > 3600 || rest < 0 || rest > 3600 || rounds < 1 || rounds > 99) return null;
  const hit = HIIT_PRESETS.find(pp => pp.work === work && pp.rest === rest && pp.rounds === rounds);
  return { name: hit ? hit.name : 'カスタム', work: work, rest: rest, rounds: rounds };
}
function hiitPaintChips() {
  const w = parseInt(document.getElementById('hiitWork').value, 10);
  const r = parseInt(document.getElementById('hiitRest').value, 10);
  const n = parseInt(document.getElementById('hiitRounds').value, 10);
  document.querySelectorAll('.hiit-chip').forEach(ch => {
    const pp = HIIT_PRESETS[+ch.dataset.hp];
    ch.classList.toggle('on', !!pp && pp.work === w && pp.rest === r && pp.rounds === n);
  });
}
function hiitPaintTotal() {
  const c = hiitCfgFromInputs();
  const tot = c ? hiitTotalSec(c) : 0;
  document.getElementById('hiitTotal').innerHTML = c
    ? '合計 <b>' + (tot >= 60 ? '約' + Math.round(tot / 60) + '分' : tot + '秒') + '</b>（準備' + HIIT_PREP_SEC + '秒を含む）'
    : '合計 ―';
}
function hiitOnInput() {
  const c = hiitCfgFromInputs();
  if (c) { hiitCfg = c; hiitSaveCfg(); }
  hiitPaintChips();
  hiitPaintTotal();
}
function hiitSyncSetup() {
  document.getElementById('hiitWork').value = hiitCfg.work;
  document.getElementById('hiitRest').value = hiitCfg.rest;
  document.getElementById('hiitRounds').value = hiitCfg.rounds;
  hiitPaintChips();
  hiitPaintTotal();
}
window.hiitPreset = function (i) {
  const pp = HIIT_PRESETS[i];
  if (!pp) return;
  document.getElementById('hiitWork').value = pp.work;
  document.getElementById('hiitRest').value = pp.rest;
  document.getElementById('hiitRounds').value = pp.rounds;
  hiitOnInput();
};
function closeHiit() {
  const body = document.getElementById('hiitBody');
  if (body && !body.classList.contains('hidden')) {
    body.classList.add('hidden');
    const ch = document.getElementById('hiitChev');
    if (ch) ch.classList.remove('is-open');
  }
}
window.toggleHiit = function () {
  const body = document.getElementById('hiitBody');
  if (!body) return;
  const nowHidden = body.classList.toggle('hidden');
  document.getElementById('hiitChev').classList.toggle('is-open', !nowHidden);
  if (!nowHidden) { if (hiitState) hiitRenderRun(); else hiitSyncSetup(); }
};
function hiitLockWake() {
  try {
    if (navigator.wakeLock && navigator.wakeLock.request) {
      navigator.wakeLock.request('screen').then(w => { if (hiitState) hiitState.wake = w; }).catch(() => {});
    }
  } catch (e) {}
}
function hiitRenderRun() {
  const st = hiitState;
  if (!st) return;
  const ph = st.phases[st.i];
  const remainMs = st.paused ? st.remainMs : Math.max(0, st.endAt - Date.now());
  const remainSec = Math.ceil(remainMs / 1000);
  const phaseEl = document.getElementById('hiitPhase');
  phaseEl.textContent = ph.k === 'prep' ? '準備' : ph.k === 'work' ? '運動' : '休憩';
  phaseEl.style.color = ph.k === 'work' ? 'var(--np-red)' : ph.k === 'rest' ? 'var(--gold)' : '';
  document.getElementById('hiitDisplay').textContent = fmtTimer(remainSec);
  document.getElementById('hiitRound').innerHTML = ph.k === 'prep'
    ? 'まもなく開始 ・ ' + escapeHtml(st.cfg.name)
    : 'ラウンド <b>' + ph.round + '</b> / ' + st.cfg.rounds + ' ・ ' + escapeHtml(st.cfg.name);
  let el = 0;
  for (let j = 0; j < st.i; j++) el += st.phases[j].sec;
  el += ph.sec - remainSec;
  document.getElementById('hiitBarFill').style.width = Math.min(100, Math.round(el / st.totalSec * 100)) + '%';
  const nx = st.phases[st.i + 1];
  document.getElementById('hiitNext').textContent = nx ? '次は ' + (nx.k === 'work' ? '運動' : '休憩') + ' ' + nx.sec + '秒' : '次で終了';
}
function hiitBeginPhase(i) {
  const st = hiitState;
  if (!st) return;
  st.i = i;
  st.paused = false;
  st.endAt = Date.now() + st.phases[i].sec * 1000;
  document.getElementById('hiitPauseBtn').textContent = '一時停止';
  hiitRenderRun();
  if (st.timer) clearInterval(st.timer);
  st.timer = setInterval(hiitTick, 200);
}
function hiitTick() {
  const st = hiitState;
  if (!st || st.paused) return;
  if (st.endAt - Date.now() > 0) { hiitRenderRun(); return; }
  if (st.i >= st.phases.length - 1) { hiitFinish(); return; }
  playSingleBeep();
  buzz(150);
  hiitBeginPhase(st.i + 1);
}
window.hiitStart = function () {
  const cfg = hiitCfgFromInputs();
  if (!cfg) { alert('運動は5秒以上・ラウンドは1以上で入力してください'); return; }
  hiitCfg = cfg;
  hiitSaveCfg();
  hiitState = {
    cfg: cfg, phases: hiitPhases(cfg), i: 0, endAt: 0, timer: null, paused: false, remainMs: 0,
    totalSec: hiitTotalSec(cfg), dateStr: cardioDate || dstr(new Date()), wake: null
  };
  document.getElementById('hiitSetup').classList.add('hidden');
  document.getElementById('hiitRun').classList.remove('hidden');
  hiitLockWake();
  hiitBeginPhase(0);
};
window.hiitPause = function () {
  const st = hiitState;
  if (!st) return;
  if (st.paused) {
    st.paused = false;
    st.endAt = Date.now() + st.remainMs;
    document.getElementById('hiitPauseBtn').textContent = '一時停止';
  } else {
    st.paused = true;
    st.remainMs = Math.max(0, st.endAt - Date.now());
    document.getElementById('hiitPauseBtn').textContent = '再開';
    hiitRenderRun();
  }
};
function hiitCleanup() {
  if (hiitState && hiitState.timer) clearInterval(hiitState.timer);
  if (hiitState && hiitState.wake) { try { hiitState.wake.release(); } catch (e) {} }
  hiitState = null;
}
function hiitShowSetup() {
  document.getElementById('hiitRun').classList.add('hidden');
  document.getElementById('hiitSetup').classList.remove('hidden');
  hiitSyncSetup();
}
window.hiitStop = function () {
  hiitCleanup();
  hiitShowSetup();
};
function hiitFinish() {
  const st = hiitState;
  if (!st) return;
  const d = st.dateStr;
  playSingleBeep();
  setTimeout(playSingleBeep, 280);
  setTimeout(playSingleBeep, 560);
  buzz([160, 90, 160, 90, 320]);
  hiitCleanup();
  hiitShowSetup();
  markHiitDay(d, st.cfg.name, { w: st.cfg.work, r: st.cfg.rest, n: st.cfg.rounds });
  requestRender('all');
  alert('HIIT完了！🔥');
}
(function hiitInit() {
  if (!document.getElementById('hiitWork')) return;
  hiitSyncSetup();
  ['hiitWork', 'hiitRest', 'hiitRounds'].forEach(id => document.getElementById(id).addEventListener('input', hiitOnInput));
})();

window.PPLTest = {
  version: 'extras v54',
  dstr: dstr, fmtD: fmtD, trendOf: trendOf, seriesAll: seriesAll, maxWeightOf: maxWeightOf,
  volByDay: volByDay, trainIn: trainIn, cardioIn: cardioIn,
  achievements: achievements, profileStats: profileStats,
  loadSnaps: loadSnaps, ensureDailySnapshot: ensureDailySnapshot,
  sanitizeGoals: (typeof sanitizeGoals === 'function') ? sanitizeGoals : null,
  sanitizeWorkouts: (typeof sanitizeWorkouts === 'function') ? sanitizeWorkouts : null,
  sanitizeCardios: (typeof sanitizeCardios === 'function') ? sanitizeCardios : null,
  sanitizeHiitDays: (typeof sanitizeHiitDays === 'function') ? sanitizeHiitDays : null,
  hiitSeconds: (typeof hiitSeconds === 'function') ? hiitSeconds : null,
  sanitizeDayPpl: (typeof sanitizeDayPpl === 'function') ? sanitizeDayPpl : null,
  applyRename: applyRename,
  bodyCalc: bodyCalc, weeklyAvgWeight: weeklyAvgWeight, bodyAdjustCalc: bodyAdjustCalc, aiReport: aiReport, aiBody: aiBody, aiConfidence: aiConfidence, gorillaWord: gorillaWord, plateauEx: plateauEx, gorillaHeads: gorillaHeads, trendWord: trendWord, snapData: snapData, buildBackupData: (typeof buildBackupData === 'function') ? buildBackupData : null, usageWarn: usageWarn, KCAL_PER_MIN: typeof KCAL_PER_MIN !== 'undefined' ? KCAL_PER_MIN : null,
  sanitizeBody: (typeof sanitizeBody === 'function') ? sanitizeBody : null,
  sanitizeWeightLog: (typeof sanitizeWeightLog === 'function') ? sanitizeWeightLog : null,
  data: function () { return { workouts: workouts, cardios: cardios, dayPplMap: dayPplMap, goalsData: goalsData, bodyData: bodyData, weightData: weightData }; },
  swap: function (fx) {
    const keep = { w: workouts, c: cardios, p: dayPplMap, g: goalsData, b: bodyData, wt: weightData };
    workouts = fx.workouts || []; cardios = fx.cardios || []; dayPplMap = fx.dayPplMap || {}; goalsData = fx.goalsData || {};
    if (fx.bodyData !== undefined) bodyData = fx.bodyData;
    if (fx.weightData !== undefined) weightData = fx.weightData;
    return keep;
  },
  restore: function (keep) {
    workouts = keep.w; cardios = keep.c; dayPplMap = keep.p; goalsData = keep.g;
    if (keep.b !== undefined) bodyData = keep.b;
    if (keep.wt !== undefined) weightData = keep.wt;
  }
};

/* 起動：1手順ずつ実行し、要素が無いなどで1つ失敗しても後続の初期化を止めない
   （保存済みテーマを適用 → 履歴・有酸素・ホームを showTab で1回ずつ描く） */
function step(fn) { try { fn(); } catch (e) { console.log(e); } }
step(() => { if (layerFlagged()) history.replaceState(null, ''); }); /* 再読み込みで残った重なり用の履歴状態を消す */
step(() => applyTheme(getTheme()));
step(() => showTab('home', { w: true, c: true })); /* 履歴・有酸素・ホームを1回ずつ描く */
step(() => { ensureDailySnapshot(); requestPersist(); paintSnapshots(); }); /* その日のスナップショット作成と永続化の要求 */
step(() => fitTimer(true));
step(() => { if (storageWarn) window.alert('保存データの一部を読み込めませんでした。バックアップから復元してください。', 7000); });
})();
