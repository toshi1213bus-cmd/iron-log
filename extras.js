/* iron-log extras: index.html のスクリプトの後ろに読み込む（元のJSは変更しない） */
(function () {
  const buzz = ms => { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) {} };

  /* ---- 2. alert → トースト / confirm → 黒×金のダイアログ ---- */
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

  /* ---- 3. ▼▲ → 細いシェブロン（開閉は is-open クラスで回転） ---- */
  function toggle(h, sel) {
    const hidden = h.nextElementSibling.classList.toggle('hidden');
    h.querySelector(sel).classList.toggle('is-open', !hidden);
  }
  window.toggleDayAccordion = h => toggle(h, '.day-toggle-icon');
  window.toggleExerciseAccordion = h => toggle(h, '.ex-toggle-icon');

  /* ---- 5. タイマーの残り時間バー＋終了時の発光 ---- */
  const disp = document.getElementById('timerDisplay');
  const card = disp.closest('.bg-gray-800');
  disp.parentElement.insertAdjacentHTML('afterend', '<div id="timerTrack"><div id="timerBar"></div></div>');
  const bar = document.getElementById('timerBar');
  let total = 0;

  const origStart = window.startTimer, origStop = window.stopTimer;
  window.startTimer = function (m) { origStart(m); total = m * 60000; };
  window.stopTimer = function () { origStop(); total = 0; };

  setInterval(() => {
    if (targetEndTime && total) {
      bar.style.width = Math.max(0, (targetEndTime - Date.now()) / total * 100) + '%';
    } else {
      bar.style.width = '0%';
    }
    card.classList.toggle('timer-done', !!alarmInterval);
  }, 200);

  /* ---- 6. 手応え：保存トースト＋振動、タイマー終了の振動 ---- */
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

  const origBeep = window.playSingleBeep;
  window.playSingleBeep = function () { origBeep(); buzz(150); };

  document.addEventListener('click', e => { if (e.target.closest('button')) buzz(10); });
})();
