// main.js — エントリポイント（場のセル同士で合体）
(function (global) {
  'use strict';

  const Game = global.M15.Game;
  const UI = global.M15.UI;
  const TARGET = Game.CONSTANTS.TARGET;
  const FIELD_SIZE = Game.CONSTANTS.FIELD_SIZE;

  let state = null;
  let settings = Game.loadSettings();

  function rerender() { UI.renderAll(state); }

  let taTimerInterval = null;

  function newGame(opts) {
    if (taTimerInterval) { clearInterval(taTimerInterval); taTimerInterval = null; }
    state = Game.createGame(opts);
    Game.incrementGameCount();
    UI.setPassSelecting(false);
    UI.closeOpPicker();
    UI.closeModal('ta-end-modal');
    rerender();
    document.getElementById('end-banner').hidden = true;
    if (state.mode === 'timeattack') startTaTick();
  }

  function startTimeAttack() {
    // 待機状態でカードを並べる（タイマーは未開始）
    newGame({ mode: 'timeattack' });
  }

  function actuallyStartTaTimer() {
    if (!state || state.mode !== 'timeattack' || state.taEndsAt) return;
    Game.startTimeAttackTimer(state);
    rerender();
    startTaTick();
  }

  function startTaTick() {
    if (taTimerInterval) clearInterval(taTimerInterval);
    taTimerInterval = setInterval(() => {
      if (!state || state.mode !== 'timeattack') {
        clearInterval(taTimerInterval); taTimerInterval = null; return;
      }
      if (Game.isTimeAttackOver(state)) {
        clearInterval(taTimerInterval); taTimerInterval = null;
        endTimeAttack();
        return;
      }
      UI.renderTimer(state);
    }, 1000);
  }

  function endTimeAttack() {
    const clears = state.taClears || 0;
    const isBest = Game.saveBestTA(clears);
    Game.endTimeAttack(state);
    rerender();
    document.getElementById('ta-end-clears').textContent = String(clears);
    document.getElementById('ta-end-best').textContent = isBest
      ? '🎉 BEST Time Attack 更新！'
      : 'BEST Time Attack: ' + Game.loadBestTA();
    UI.openModal('ta-end-modal');
  }

  function stopTimeAttack() {
    if (!confirm('タイムアタックを中止して通常モードに戻りますか？')) return;
    if (taTimerInterval) { clearInterval(taTimerInterval); taTimerInterval = null; }
    Game.endTimeAttack(state);
    rerender();
  }

  // ----- ポインタ／ドラッグ検出 -----
  const DRAG_THRESHOLD = 8;
  let pStart = null;
  let pSrc = null;          // { uid, value }
  let activePointerId = null;
  let dragging = false;
  let dragOver = null;      // { uid, value } または null
  let suppressClickUntil = 0;

  function elByUid(uid) {
    return document.querySelector('.card[data-uid="' + uid + '"]');
  }

  function setDragOver(target) {
    const same = (a, b) => (!a && !b) || (a && b && a.uid === b.uid);
    if (same(dragOver, target)) return;
    if (dragOver) {
      const old = elByUid(dragOver.uid);
      if (old) old.classList.remove('is-drop-target');
    }
    dragOver = target;
    if (dragOver) {
      const next = elByUid(dragOver.uid);
      if (next) next.classList.add('is-drop-target');
    }
  }

  function endDrag() {
    if (pSrc) {
      const node = elByUid(pSrc.uid);
      if (node) {
        node.classList.remove('is-grabbed');
        node.style.transform = '';
        node.style.transition = '';
      }
    }
    setDragOver(null);
    document.body.classList.remove('is-dragging');
    dragging = false;
    activePointerId = null;
    pStart = null;
    pSrc = null;
  }

  function targetFromPoint(x, y) {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    const card = el.closest && el.closest('.card');
    if (card && card.dataset.uid) {
      return { uid: card.dataset.uid, value: Number(card.dataset.value) };
    }
    return null;
  }

  function onPointerDown(e) {
    if (e.button != null && e.button !== 0) return;
    const cardBtn = e.target.closest && e.target.closest('.card');
    if (!cardBtn) return;
    e.preventDefault();
    pStart = { x: e.clientX, y: e.clientY };
    pSrc = { uid: cardBtn.dataset.uid, value: Number(cardBtn.dataset.value) };
    dragging = false;
    activePointerId = e.pointerId;
    try { cardBtn.setPointerCapture(e.pointerId); } catch (_) {}
  }

  function onTouchStart(e) {
    if (e.target.closest('.card')) e.preventDefault();
  }

  function onPointerMove(e) {
    if (!pStart || !pSrc) return;
    if (activePointerId != null && e.pointerId !== activePointerId) return;
    const dx = e.clientX - pStart.x;
    const dy = e.clientY - pStart.y;
    if (!dragging && Math.hypot(dx, dy) >= DRAG_THRESHOLD) {
      dragging = true;
      document.body.classList.add('is-dragging');
      const node = elByUid(pSrc.uid);
      if (node) {
        node.classList.add('is-grabbed');
        node.style.transition = 'none';
      }
    }
    if (!dragging) return;
    const node = elByUid(pSrc.uid);
    if (node) {
      node.style.transform = 'translate(' + dx + 'px, ' + dy + 'px) scale(1.04)';
    }
    const target = targetFromPoint(e.clientX, e.clientY);
    if (target && target.uid === pSrc.uid) {
      setDragOver(null);
    } else {
      setDragOver(target);
    }
  }

  function onPointerUp(e) {
    if (!pStart || !pSrc) return;
    if (activePointerId != null && e.pointerId !== activePointerId) return;
    const src = pSrc;
    const dst = dragOver;
    endDrag();

    if (dst) {
      suppressClickUntil = Date.now() + 350;
      handleDrop(src, dst, e.clientX, e.clientY);
    }
  }

  function onPointerCancel() {
    endDrag();
  }

  function handleDrop(src, dst, x, y) {
    if (UI.isPassSelecting()) return;
    if (state.mode === 'timeattack' && !state.taEndsAt) {
      UI.flashFail('STARTを押してから');
      return;
    }
    if (!src || !dst || src.uid === dst.uid) return;
    UI.openOpPicker(src.value, dst.value, x, y, (op) => {
      const r = Game.combine(state, src.uid, op, dst.uid);
      if (!r.ok) { UI.flashFail(r.error); return; }
      UI.flashCombine(r.result.value);
      UI.flashOp(op);
      rerender();
      autoCaptureIfReady();
    });
  }

  // 場が「15のセル1つだけ」になったら自動で獲得
  function autoCaptureIfReady() {
    const nonNull = state.field.filter(c => c != null);
    if (nonNull.length !== 1) return;
    if (nonNull[0].value !== TARGET) return;
    const targetUid = nonNull[0].uid;
    setTimeout(() => {
      const cur = state.field.findIndex(c => c && c.uid === targetUid);
      if (cur < 0) return;
      const r = Game.captureCell(state, targetUid);
      if (!r.ok) return;
      const fast = r.elapsedMs < 10000;
      UI.flashSuccess(fast ? '10秒以内\nクリア！！' : 'クリア！', { fast: fast });
      if (state.mode !== 'timeattack') Game.saveBestScore(state.stage);
      rerender();
      afterAction();
    }, 500);
  }

  function onCardClick(e) {
    if (Date.now() < suppressClickUntil) return;
    const btn = e.target.closest('.card');
    if (!btn) return;
    const uid = btn.dataset.uid;
    const card = state.field.find(c => c && c.uid === uid);
    if (!card) return;

    if (UI.isPassSelecting()) {
      Game.pass(state, uid);
      UI.setPassSelecting(false);
      rerender();
      afterAction();
      return;
    }

    // クリア対象のセル：場の唯一のセルで値=15
    const onlyCell = state.field.filter(c => c != null);
    if (card.value === TARGET && onlyCell.length === 1 && onlyCell[0].uid === uid) {
      const r = Game.captureCell(state, uid);
      if (r.ok) {
        const fast = r.elapsedMs < 10000;
        UI.flashSuccess(fast ? '10秒以内\nクリア！！' : 'クリア！', { fast: fast });
        if (state.mode !== 'timeattack') Game.saveBestScore(state.stage);
        rerender();
        afterAction();
      } else {
        UI.flashFail(r.error);
      }
      return;
    }

    if (card.value === TARGET) {
      UI.flashFail('残りのカードもすべて合体させてください');
      return;
    }
    UI.flashFail('カードを別のカードへドラッグして合体');
  }

  function fieldHasCards() {
    return state.field.some(c => c != null);
  }

  function onGiveUp() {
    if (!fieldHasCards()) return;
    if (!confirm('新しい5枚を引きます。よろしいですか？\n（STAGEは0に戻ります）')) return;
    Game.giveUp(state);
    UI.setPassSelecting(false);
    UI.closeOpPicker();
    rerender();
    afterAction();
  }

  function afterAction() {
    if (state.finished) {
      if (state.mode !== 'timeattack') Game.saveBestScore(state.stage);
      rerender();
      const banner = document.getElementById('end-banner');
      if (banner) banner.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  function onRules() { UI.openModal('rules-modal'); }

  function onRestartClick() {
    if (!state) return;
    Game.restartRound(state);
    UI.setPassSelecting(false);
    UI.closeOpPicker();
    rerender();
    document.getElementById('end-banner').hidden = true;
  }

  function bindEvents() {
    const field = document.getElementById('field');
    field.addEventListener('pointerdown', onPointerDown);
    field.addEventListener('touchstart', onTouchStart, { passive: false });
    field.addEventListener('contextmenu', e => e.preventDefault());
    field.addEventListener('dragstart', e => e.preventDefault());
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    field.addEventListener('click', onCardClick);

    document.getElementById('btn-giveup').addEventListener('click', onGiveUp);
    document.getElementById('btn-restart').addEventListener('click', onRestartClick);
    document.getElementById('btn-rules').addEventListener('click', onRules);
    document.getElementById('btn-end-new').addEventListener('click', () => newGame());
    document.getElementById('btn-ta').addEventListener('click', startTimeAttack);
    document.getElementById('btn-ta-start').addEventListener('click', actuallyStartTaTimer);
    document.getElementById('btn-ta-stop').addEventListener('click', stopTimeAttack);
    document.getElementById('btn-ta-restart').addEventListener('click', startTimeAttack);

    document.querySelectorAll('.modal-close').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.target;
        if (id) UI.closeModal(id);
      });
    });
    document.querySelectorAll('.modal').forEach(m => {
      m.addEventListener('click', (e) => {
        if (e.target === m) UI.closeModal(m.id);
      });
    });
  }

  function init() {
    bindEvents();
    newGame();
    maybeShowDemo();
    maybeShowIosPwaHint();
  }

  function maybeShowIosPwaHint() {
    const ua = navigator.userAgent || '';
    const isIOS = /iPhone|iPad|iPod/.test(ua);
    if (!isIOS) return;
    if (window.navigator.standalone) return; // すでにホーム画面起動
    try {
      const last = localStorage.getItem('make15_pwa_hint_seen');
      if (last) {
        const days = (Date.now() - parseInt(last, 10)) / 86400000;
        if (days < 14) return;
      }
      localStorage.setItem('make15_pwa_hint_seen', String(Date.now()));
    } catch (e) { return; }
    setTimeout(showIosPwaHint, 30000);
  }

  function showIosPwaHint() {
    const el = document.createElement('div');
    el.className = 'ios-pwa-hint';
    el.innerHTML =
      '<span class="ios-pwa-text">🍓 ホーム画面に追加</span>' +
      '<span class="ios-pwa-sub">オフラインでも遊べる ／ 下の 共有 から</span>' +
      '<span class="ios-pwa-arrow">↓</span>';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 8000);
  }

  function maybeShowDemo() {
    let alreadySeen = false;
    try {
      if (localStorage.getItem('make15_seen_demo')) alreadySeen = true;
      else localStorage.setItem('make15_seen_demo', '1');
    } catch (e) {
      // localStorage が使えない環境（LINE内ブラウザ等）では「初回扱い」で表示
    }
    if (alreadySeen) return;
    setTimeout(showDragDemo, 700);
  }

  function showDragDemo() {
    const cards = document.querySelectorAll('.card');
    if (cards.length < 2) return;
    const a = cards[0].getBoundingClientRect();
    const b = cards[1].getBoundingClientRect();
    const ax = a.left + a.width / 2;
    const ay = a.top + a.height / 2;
    const bx = b.left + b.width / 2;
    const by = b.top + b.height / 2;

    const finger = document.createElement('div');
    finger.className = 'demo-finger';
    finger.textContent = '👆';
    finger.style.left = ax + 'px';
    finger.style.top = ay + 'px';
    finger.style.setProperty('--dx', (bx - ax) + 'px');
    finger.style.setProperty('--dy', (by - ay) + 'px');
    document.body.appendChild(finger);
    setTimeout(() => finger.remove(), 5000);

    const hint = document.createElement('div');
    hint.className = 'demo-hint';
    hint.textContent = 'カードを別カードへドラッグ';
    document.body.appendChild(hint);
    setTimeout(() => hint.remove(), 5000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(typeof window !== 'undefined' ? window : globalThis);
