/* PPL extras.js */
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
  function ask(msg) {
    return new Promise(resolve => {
      const o = document.createElement('div');
      o.id = 'modal';
      o.innerHTML = '<div class="modal-box"><p>' + msg + '</p><div class="modal-actions">' +
        '<button type="button" data-v="0">キャンセル</button>' +
        '<button type="button" data-v="1" class="modal-danger">削除</button></div></div>';
      o.addEventListener('click', e => {
        const b = e.target.closest('button');
        if (b || e.target === o) { o.remove(); resolve(!!b && b.dataset.v === '1'); }
      });
      document.body.appendChild(o);
    });
  }
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

  /* ===== 履歴の開閉 ===== */
  function toggle(h, sel) {
    const hidden = h.nextElementSibling.classList.toggle('hidden');
    h.querySelector(sel).classList.toggle('is-open', !hidden);
  }
  window.toggleDayAccordion = h => toggle(h, '.day-toggle-icon');
  window.toggleExerciseAccordion = h => toggle(h, '.ex-toggle-icon');

  /* ===== タイマー ===== */
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

  /* ===== 保存 ===== */
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

  /* ===== 折れ線グラフ ===== */
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

  /* ===== 推移の計算式 ===== */
  function metric(sets) {
    if (!sets.some(s => s.weight > 0)) return sets.reduce((a, s) => a + s.reps, 0);
    return Number(sets.reduce((a, s) => a + s.weight + s.reps * 0.1, 0).toFixed(1));
  }
  function series(name) {
    const map = {};
    workouts.filter(w => w.name.trim() === name).forEach(w => {
      (map[w.dateStr] = map[w.dateStr] || []).push(...w.setList);
    });
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
  window.homeType = function (t) { override = { day: dstr(new Date()), type: t }; renderHome(); };
  window.homeFill = function (id) {
    if (editingId !== null) resetForm();
    switchTab('workout');
    applySuggestion(id);
  };

  /* ===== 記録済みの全種目を取得 ===== */
  function allExerciseNames() {
    const latest = new Map();
    workouts.forEach((w, index) => {
      const name = String(w.name || '').trim();
      if (!name) return;
      const old = latest.get(name);
      if (!old || w.dateStr > old.date || (w.dateStr === old.date && index > old.index)) {
        latest.set(name, { date: w.dateStr, index });
      }
    });
    return [...latest.entries()]
      .sort((a, b) => b[1].date.localeCompare(a[1].date) || b[1].index - a[1].index)
      .map(([name]) => name);
  }

  let trOpen = null;
  function renderExerciseTrends() {
    const names = allExerciseNames();
    if (!names.length) {
      return '<div class="hm-card"><div class="hm-pad"><div class="hm-lb">種目別の推移</div><div class="hm-sub">トレーニングを記録すると、ここに種目が追加されます。</div></div></div>';
    }
    const rows = names.map((name, i) => {
      const s = series(name), v = s.map(x => x.v), last = v[v.length - 1];
      const open = trOpen === name;
      const body = open
        ? '<div class="tr-big">' +
          (v.length > 1
            ? line(v, 320, 124, s.map(x => x.d))
            : '<div class="hm-sub">2回以上の記録でグラフが表示されます。</div>') +
          '<div class="tr-history">' + s.map(x => '<span>' + fmtD(x.d) + '　' + x.v + '</span>').join('') + '</div>' +
          '</div>'
        : '';
      return '<div class="tr-row' + (open ? ' open' : '') + '" data-exercise="' + escapeHtml(name) + '">' +
        '<div class="tr-top">' +
          '<div><div class="hm-sub">種目</div><div class="tr-name">' + escapeHtml(name) + '</div></div>' +
          '<div class="tr-mini">' + line(v, 84, 30) + '</div>' +
          '<div class="tr-val">' + (last === undefined ? '<span class="hm-sub">—</span>' : last) + '</div>' +
          '<div class="tr-chev"></div>' +
        '</div>' + body + '</div>';
    }).join('');
    return '<div class="hm-card hm-trend-card"><div class="hm-pad hm-trend-heading"><div class="hm-lb">種目別の推移</div><div class="hm-sub">種目をタップすると直近5回分のグラフを表示</div></div>' + rows + '</div>';
  }

  function renderHome() {
    const el = document.getElementById('tabContentHome');
    if (!el) return;
    const today = dstr(new Date()), type = todayType();
    const days = dayList(), last = days.filter(d => d < today).pop();
    const yday = dstr(new Date(Date.now() - 864e5));
    const sub = days.includes(today) ? '今日は ' + pplOf(today) + ' を記録中'
      : last ? (last === yday ? '昨日' : '前回') + 'は ' + pplOf(last) + '（' + fmtD(last) + '）' : 'まだ記録がありません';
    const chips = TYPES.map(t => '<button type="button" class="' + (t === type ? 'cur' : '') + '" onclick="homeType(\'' + t + '\')">' + t + '</button>').join('');
    let h = '<div class="hm-card"><div class="hm-pad"><div class="hm-lb">今日のおすすめ</div><div class="hm-big">' + type +
      '</div><div class="hm-sub">' + sub + '</div><div class="hm-ord">' + chips + '</div></div></div>';

    const pd = days.filter(d => d < today && pplOf(d) === type).pop();
    if (!pd) {
      h += '<div class="hm-card"><div class="hm-pad hm-sub">まだ ' + type + ' の記録がありません。</div></div>';
    } else {
      const items = workouts.filter(w => w.dateStr === pd);
      const todays = workouts.filter(w => w.dateStr === today);
      const done = items.filter(it => todays.some(t => t.name === it.name)).length;
      h += '<div class="hm-card"><div class="hm-pad" style="padding-bottom:12px"><div class="hm-exh"><div class="hm-lb">今日のメニュー（前回 ' + fmtD(pd) +
        '）</div><div class="hm-lb hm-gold">' + done + ' / ' + items.length + ' 完了</div></div><div class="hm-prog"><div style="width:' +
        Math.round(done / items.length * 100) + '%"></div></div></div>';
      items.forEach(it => {
        const t = todays.find(x => x.name === it.name);
        const b = bestSet((t || it).setList);
        const s = series(it.name.trim());
        h += '<div class="hm-ex"><div class="hm-exh"><div class="hm-row2"><span class="hm-chk' + (t ? ' f' : '') + '"></span><div class="hm-en' + (t ? ' dn' : '') + '">' +
          escapeHtml(it.name) + '</div></div>' + (t ? '' : '<button type="button" class="hm-in" onclick="homeFill(\'' + it.id + '\')">入力</button>') +
          '</div><div class="hm-mini"><div class="hm-st">' + (t ? '今日 ' : '前回 ') + (b ? fmtSet(b) : '') + '</div><div class="hm-ch">' + line(s.map(x => x.v), 110, 34) + '</div></div></div>';
      });
      h += '</div>';
    }
    h += renderExerciseTrends();
    el.innerHTML = h;
  }

  /* ===== 種目をタップしてグラフ開閉 ===== */
  document.addEventListener('click', e => {
    const r = e.target.closest('.tr-row[data-exercise]');
    if (!r) return;
    const name = r.dataset.exercise;
    trOpen = trOpen === name ? null : name;
    renderHome();
  });

  /* ===== 今日の部位を保存時に記録 ===== */
  const saveInner = window.saveWorkout;
  window.saveWorkout = function () {
    const today = dstr(new Date()), type = todayType();
    const before = localStorage.getItem('simple_workouts');
    saveInner.apply(this, arguments);
    if (localStorage.getItem('simple_workouts') === before) return;
    if (dayPplMap[today] === undefined && workouts.some(w => w.dateStr === today)) {
      dayPplMap[today] = type;
      localStorage.setItem('simple_day_ppl', JSON.stringify(dayPplMap));
      renderWorkouts();
    }
  };

  /* ===== トレーニング画面を履歴だけにする ===== */
  function simplifyWorkoutScreen() {
    const historyBtn = document.getElementById('subTabBtnHistory');
    if (historyBtn && historyBtn.parentElement) historyBtn.parentElement.remove();
    const stats = document.getElementById('subTabContentStats');
    if (stats) stats.remove();
    const history = document.getElementById('subTabContentHistory');
    if (history) history.classList.remove('hidden');
  }

  const renderInner = window.renderWorkouts;
  window.renderWorkouts = function () {
    renderInner();
    renderHome();
  };

  /* ===== 下タブ ===== */
  const TABS = { home: 'tabContentHome', workout: 'tabContentWorkout', cardio: 'tabContentCardio', settings: 'tabContentSettings' };
  window.switchTab = function (name) {
    if (alarmInterval) { clearInterval(alarmInterval); alarmInterval = null; }
    Object.keys(TABS).forEach(k => {
      const el = document.getElementById(TABS[k]);
      if (el) el.classList.toggle('hidden', k !== name);
    });
    document.querySelectorAll('#bottomNav button').forEach(b => b.classList.toggle('on', b.dataset.t === name));
    if (name === 'home') renderHome();
    window.scrollTo(0, 0);
  };
  const isField = el => el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
  document.addEventListener('focusin', e => { if (isField(e.target)) document.body.classList.add('kb'); });
  document.addEventListener('focusout', () => setTimeout(() => { if (!isField(document.activeElement)) document.body.classList.remove('kb'); }, 100));

  simplifyWorkoutScreen();
  renderWorkouts();
  switchTab('home');
})();
