/* iron-log extras: index.html のスクリプトの後ろに読み込む */
(function () {
  const buzz = ms => { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) {} };
  const pad = n => String(n).padStart(2, '0');
  const dstr = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const fmtD = s => { const p = s.split('-'); return parseInt(p[1], 10) + '/' + parseInt(p[2], 10); };

  /* ===== トースト / 確認ダイアログ ===== */
  const toastEl = document.createElement('div');
  toastEl.id = 'toast';
  document.body.appendChild(toastEl);
  let toastTimer;
  window.alert = function (msg) {
    toastEl.textContent = String(msg);
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200);
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
  window.deleteWorkout = async function (id) {
    if (!(await ask('この記録を削除しますか？'))) return;
    if (editingId === id) resetForm();
    workouts = workouts.filter(i => i.id !== id);
    localStorage.setItem('simple_workouts', JSON.stringify(workouts));
    renderWorkouts();
  };
  window.deleteCardio = async function (id) {
    if (!(await ask('この有酸素記録を削除しますか？'))) return;
    cardios = cardios.filter(i => i.id !== id);
    localStorage.setItem('simple_cardios', JSON.stringify(cardios));
    renderCardios();
  };

  /* ===== 履歴の開閉（シェブロン） ===== */
  function toggle(h, sel) {
    const hidden = h.nextElementSibling.classList.toggle('hidden');
    h.querySelector(sel).classList.toggle('is-open', !hidden);
  }
  window.toggleDayAccordion = h => toggle(h, '.day-toggle-icon');
  window.toggleExerciseAccordion = h => toggle(h, '.ex-toggle-icon');

  /* ===== タイマー：残り時間バー・終了時の発光・振動 ===== */
  const disp = document.getElementById('timerDisplay');
  const card = disp.closest('.bg-gray-800');
  disp.parentElement.insertAdjacentHTML('afterend', '<div id="timerTrack"><div id="timerBar"></div></div>');
  const bar = document.getElementById('timerBar');
  let total = 0;
  const origStart = window.startTimer, origStop = window.stopTimer;
  window.startTimer = function (m) { origStart(m); total = m * 60000; };
  window.stopTimer = function () { origStop(); total = 0; };
  setInterval(() => {
    bar.style.width = (targetEndTime && total) ? Math.max(0, (targetEndTime - Date.now()) / total * 100) + '%' : '0%';
    card.classList.toggle('timer-done', !!alarmInterval);
  }, 200);
  const origBeep = window.playSingleBeep;
  window.playSingleBeep = function () { origBeep(); buzz(150); };
  document.addEventListener('click', e => { if (e.target.closest('button')) buzz(10); });

  /* ===== 保存：トースト＋振動 ===== */
  function wrapSave(name, key) {
    const orig = window[name];
    window[name] = function () {
      const before = localStorage.getItem(key);
      orig.apply(this, arguments);
      if (localStorage.getItem(key) !== before) { buzz(25); window.alert('保存しました'); }
    };
  }
  wrapSave('saveWorkout', 'simple_workouts');
  wrapSave('saveCardio', 'simple_cardios');

  /* ===== 折れ線グラフ（金の線・面のグラデ・最新点の光・描画アニメ） ===== */
  let gid = 0;
  function line(v, w, h, dates) {
    const n = v.length;
    if (n < 2) return '';
    const big = !!dates;
    const px = big ? 22 : 5, pt = big ? 26 : 8, pb = big ? 24 : 8;
    const mn = Math.min(...v), mx = Math.max(...v), r = (mx - mn) || 1;
    const P = v.map((y, i) => [px + i * (w - 2 * px) / (n - 1), h - pb - (y - mn) / r * (h - pt - pb)]);
    const f = x => x.toFixed(1);
    let d = 'M' + f(P[0][0]) + ',' + f(P[0][1]);
    for (let i = 1; i < n - 1; i++) {
      d += ' Q' + f(P[i][0]) + ',' + f(P[i][1]) + ' ' + f((P[i][0] + P[i + 1][0]) / 2) + ',' + f((P[i][1] + P[i + 1][1]) / 2);
    }
    d += ' L' + f(P[n - 1][0]) + ',' + f(P[n - 1][1]);
    const id = 'g' + (++gid), L = P[n - 1];
    let s = '<svg ' + (big ? 'width="100%"' : 'width="' + w + '" height="' + h + '"') + ' viewBox="0 0 ' + w + ' ' + h + '">' +
      '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c9a96a" stop-opacity=".3"/><stop offset="1" stop-color="#c9a96a" stop-opacity="0"/></linearGradient></defs>' +
      '<path d="' + d + ' L' + f(L[0]) + ',' + (h - pb) + ' L' + f(P[0][0]) + ',' + (h - pb) + ' Z" fill="url(#' + id + ')"/>' +
      '<path class="ln" pathLength="1" d="' + d + '" fill="none" stroke="#c9a96a" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<circle cx="' + f(L[0]) + '" cy="' + f(L[1]) + '" r="' + (big ? 9 : 7) + '" fill="#c9a96a" opacity=".18"/>' +
      '<circle cx="' + f(L[0]) + '" cy="' + f(L[1]) + '" r="' + (big ? 3.5 : 2.5) + '" fill="#dcc28a"/>';
    if (big) {
      s += '<line x1="' + px + '" y1="' + (h - pb + 6) + '" x2="' + (w - px) + '" y2="' + (h - pb + 6) + '" stroke="#2a2a2c"/>';
      P.forEach((q, i) => {
        s += '<text x="' + f(q[0]) + '" y="' + f(q[1] - 10) + '" text-anchor="middle" font-size="11" fill="' + (i === n - 1 ? '#ece8dd' : '#b8b2a2') + '" font-family="Barlow Condensed,sans-serif">' + v[i] + '</text>' +
          '<text x="' + f(q[0]) + '" y="' + (h - 5) + '" text-anchor="middle" font-size="11" fill="#b8b2a2" font-family="Barlow Condensed,sans-serif">' + fmtD(dates[i]) + '</text>';
      });
    }
    return s + '</svg>';
  }

  /* ===== 現行の推移と同じ計算式（重量あり＝Σ(重量+回数×0.1)、重量なし＝回数合計） ===== */
  function metric(sets) {
    if (!sets.some(s => s.weight > 0)) return sets.reduce((a, s) => a + s.reps, 0);
    return Number(sets.reduce((a, s) => a + s.weight + s.reps * 0.1, 0).toFixed(1));
  }
  function series(name) {
    const map = {};
    workouts.filter(w => w.name.trim() === name).forEach(w => { (map[w.dateStr] = map[w.dateStr] || []).push(...w.setList); });
    return Object.keys(map).sort().slice(-5).map(d => ({ d, v: metric(map[d]) }));
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
  /* ===== 固定メニュー（部位ごとの種目リスト。非表示は論理削除） ===== */
  function normMenu(m) {
    const out = {};
    TYPES.forEach(t => {
      const x = (m && m[t]) || {};
      out[t] = { on: Array.isArray(x.on) ? x.on.map(String) : [], off: Array.isArray(x.off) ? x.off.map(String) : [] };
    });
    return out;
  }
  function ensureMenu() {
    if (menuData) { menuData = normMenu(menuData); return; }
    const m = normMenu(null), days = dayList();
    TYPES.forEach(t => {
      const d = days.filter(x => pplOf(x) === t).pop();
      if (d) workouts.filter(w => w.dateStr === d).forEach(w => { const n = w.name.trim(); if (!m[t].on.includes(n)) m[t].on.push(n); });
    });
    menuData = m;
    saveMenu();
  }
  function saveMenu() { localStorage.setItem('simple_menu', JSON.stringify(menuData)); }
  function lastRec(name, today) {
    return workouts.filter(w => w.name.trim() === name && w.dateStr < today).sort((a, b) => (a.dateStr < b.dateStr ? -1 : 1)).pop() || null;
  }

  /* ===== ホーム ===== */
  let homeOpen = null, homeNames = [];
  window.homeFill = function (i) {
    const name = homeNames[i];
    if (name === undefined) return;
    if (editingId !== null) resetForm();
    switchTab('workout');
    const rec = lastRec(name, dstr(new Date()));
    if (rec) applySuggestion(rec.id);
    else { resetForm(); document.getElementById('exerciseName').value = name; }
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
    h += '<div class="hm-card"><div class="hm-pad" style="padding-bottom:12px"><div class="hm-exh"><div class="hm-lb">今日のメニュー</div><div class="hm-lb hm-gold">' +
      doneN + ' / ' + names.length + ' 完了</div></div><div class="hm-prog"><div style="width:' + Math.round(doneN / names.length * 100) + '%"></div></div></div>';
    names.forEach((n, i) => {
      const t = todays.find(x => x.name.trim() === n);
      const rec = t || lastRec(n, today);
      const b = rec ? bestSet(rec.setList) : null;
      const s = series(n);
      const open = homeOpen === n;
      h += '<div class="hm-ex' + (open ? ' open' : '') + '" data-i="' + i + '"><div class="hm-exh"><div class="hm-row2"><span class="hm-chk' + (t ? ' f' : '') + '"></span><div class="hm-en' + (t ? ' dn' : '') + '">' +
        escapeHtml(n) + '</div></div><div class="hm-act">' + (t ? '' : '<button type="button" class="hm-in" onclick="homeFill(' + i + ')">入力</button>') +
        '<span class="hm-chev"></span></div></div><div class="hm-mini"><div class="hm-st">' + (b ? (t ? '今日 ' : '前回 ') + fmtSet(b) : '<span class="hm-sub">記録なし</span>') + '</div>' +
        (open || s.length < 2 ? '' : '<div class="hm-ch">' + line(s.map(x => x.v), 110, 34) + '</div>') + '</div>' +
        (open ? '<div class="hm-big2">' + (s.length > 1 ? line(s.map(x => x.v), 320, 124, s.map(x => x.d)) : '<div class="hm-sub">2回以上の記録でグラフが出ます。</div>') + '</div>' : '') +
        '</div>';
    });
    el.innerHTML = h + '</div>';
  }
  document.addEventListener('click', e => {
    const r = e.target.closest('.hm-ex');
    if (!r || e.target.closest('.hm-in')) return;
    const n = homeNames[parseInt(r.dataset.i, 10)];
    if (n === undefined) return;
    homeOpen = homeOpen === n ? null : n;
    renderHome();
  });

  /* ===== 種目の編集（画面全体。保存まで確定しない。戻る操作＝キャンセル） ===== */
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
      '<div class="me-sec">メニュー（上から順に表示）</div>' + rows +
      '<div class="me-sec">種目を追加</div><div class="me-add"><input type="text" id="meInput" placeholder="種目名を入力" autocomplete="off" value="' + escapeHtml(keep) + '"><button type="button" data-act="add">追加</button></div>' +
      (past ? '<div class="me-chips">' + past + '</div>' : '') +
      (offs ? '<div class="me-sec">非表示の種目</div>' + offs : '') +
      '</div><div class="me-foot"><button type="button" data-act="cancel">キャンセル</button><button type="button" data-act="save" class="primary">保存</button></div>';
  }
  function addName(raw) {
    const n = String(raw || '').trim(), m = draft[editType];
    if (!n) return;
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
  function onEditorClick(e) {
    const b = e.target.closest('button');
    if (!b || !draft) return;
    const act = b.dataset.act, m = draft[editType], i = parseInt(b.dataset.i, 10);
    if (act === 'cancel') { leaveEditor(); return; }
    if (act === 'save') {
      menuData = normMenu(draft);
      saveMenu();
      leaveEditor();
      renderHome();
      renderMenuSummary();
      window.alert('メニューを保存しました');
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
    ensureMenu();
    draft = JSON.parse(JSON.stringify(menuData));
    editType = 'PUSH';
    const o = document.createElement('div');
    o.id = 'menuEditor';
    o.addEventListener('click', onEditorClick);
    document.body.appendChild(o);
    history.pushState({ me: 1 }, '');
    renderEditor();
  };
  function renderMenuSummary() {
    const el = document.getElementById('menuSummary');
    if (!el) return;
    ensureMenu();
    el.innerHTML = TYPES.map(t => '<div class="ms-row"><span class="ms-t">' + t + '</span><span class="ms-n">' + menuData[t].on.length + ' 種目</span></div>').join('');
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
    let g = '日月火水木金土'.split('').map(w => '<div class="cal-w">' + w + '</div>').join('') + '<div></div>'.repeat(first);
    for (let d = 1; d <= len; d++) {
      const s = cal.y + '-' + pad(cal.m + 1) + '-' + pad(d);
      g += '<div class="cal-d' + (s === today ? ' today' : '') + '"><span>' + d + '</span><span class="cal-m">' +
        (tDays.has(s) ? '<i class="cal-dot"></i>' : '') + (cDays.has(s) ? '<i class="cal-ring"></i>' : '') + '</span></div>';
    }
    el.innerHTML = '<div class="cal-head"><button type="button" onclick="calShift(-1)">‹</button><div class="cal-title">' + cal.y + '年' + (cal.m + 1) +
      '月</div><button type="button" onclick="calShift(1)"' + (atCur ? ' disabled' : '') + '>›</button></div><div class="cal-grid">' + g +
      '</div><div class="cal-legend"><span><i class="cal-dot"></i>トレーニング</span><span><i class="cal-ring"></i>有酸素</span></div>';
  }
  const cardiosInner = window.renderCardios;
  window.renderCardios = function () { cardiosInner(); renderCalendar(); };

  /* ===== 保存時：今日の部位を記録／新しい種目を今日の部位のメニューへ自動追加 ===== */
  const saveInner = window.saveWorkout;
  window.saveWorkout = function () {
    const today = dstr(new Date()), type = todayType();
    const name = document.getElementById('exerciseName').value.trim();
    const before = localStorage.getItem('simple_workouts');
    saveInner.apply(this, arguments);
    if (localStorage.getItem('simple_workouts') === before) return;
    if (dayPplMap[today] === undefined && workouts.some(w => w.dateStr === today)) {
      dayPplMap[today] = type;
      localStorage.setItem('simple_day_ppl', JSON.stringify(dayPplMap));
    }
    ensureMenu();
    const m = menuData[dayPplMap[today] || type];
    if (name && workouts.some(w => w.dateStr === today && w.name.trim() === name) && !m.on.includes(name) && !m.off.includes(name)) {
      m.on.push(name);
      saveMenu();
    }
    renderWorkouts();
  };
  const renderInner = window.renderWorkouts;
  window.renderWorkouts = function () { renderInner(); renderHome(); renderMenuSummary(); };

   /* ===== 下タブ ===== */
  const TABS = { home: 'tabContentHome', workout: 'tabContentWorkout', cardio: 'tabContentCardio', settings: 'tabContentSettings' };
  window.switchTab = function (name) {
    if (alarmInterval) { clearInterval(alarmInterval); alarmInterval = null; }
    Object.keys(TABS).forEach(k => document.getElementById(TABS[k]).classList.toggle('hidden', k !== name));
    document.querySelectorAll('#bottomNav button').forEach(b => b.classList.toggle('on', b.dataset.t === name));
    if (name === 'home') renderHome();
    if (name === 'settings') renderCalendar();
    window.scrollTo(0, 0);
  };
  const isField = el => el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
  document.addEventListener('focusin', e => { if (isField(e.target)) document.body.classList.add('kb'); });
  document.addEventListener('focusout', () => setTimeout(() => { if (!isField(document.activeElement)) document.body.classList.remove('kb'); }, 100));

  renderWorkouts();
  switchTab('home');
})();
