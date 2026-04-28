// main.js — エントリポイント（合体型 / 計算中の値）
(function (global) {
  'use strict';

  const Game = global.M15.Game;
  const UI = global.M15.UI;
  const TARGET = Game.CONSTANTS.TARGET;

  let state = null;
  let settings = Game.loadSettings();

  function rerender() { UI.renderAll(state); }

  function newGame() {
    state = Game.createGame();
    Game.incrementGameCount();
    UI.setPassSelecting(false);
    UI.closeOpPicker();
    rerender();
    document.getElementById('end-banner').hidden = true;
  }

  // ----- ポインタ／ドラッグ検出 -----
  // ターゲット: 場のカード or 計算中の値タイル（"running"）
  const DRAG_THRESHOLD = 8;
  let pStart = null;
  let pSrc = null;          // { kind: 'card'|'running', uid?: string, value: number }
  let activePointerId = null;
  let dragging = false;
  let dragOver = null;      // 同じ形式の {kind, uid?, value}
  let suppressClickUntil = 0;

  function elByCard(uid) {
    return document.querySelector('.card[data-uid="' + uid + '"]');
  }
  function elRunning() {
    return document.querySelector('.running-card');
  }

  function setDragOver(target) {
    const same = (a, b) => (!a && !b) ||
      (a && b && a.kind === b.kind && a.uid === b.uid);
    if (same(dragOver, target)) return;
    if (dragOver) {
      const old = dragOver.kind === 'card' ? elByCard(dragOver.uid) : elRunning();
      if (old) old.classList.remove('is-drop-target');
    }
    dragOver = target;
    if (dragOver) {
      const next = dragOver.kind === 'card' ? elByCard(dragOver.uid) : elRunning();
      if (next) next.classList.add('is-drop-target');
    }
  }

  function endDrag() {
    if (pSrc) {
      const node = pSrc.kind === 'card' ? elByCard(pSrc.uid) : elRunning();
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
    const running = el.closest && el.closest('.running-card');
    if (running) {
      return { kind: 'running', value: state.running ? state.running.value : null };
    }
    const card = el.closest && el.closest('.card');
    if (card) return { kind: 'card', uid: card.dataset.uid, value: Number(card.dataset.value) };
    return null;
  }

  function onPointerDown(e) {
    if (e.button != null && e.button !== 0) return;
    // ×（リセット）の上はドラッグ対象外
    if (e.target.closest && e.target.closest('[data-role="reset"]')) return;
    const cardBtn = e.target.closest && e.target.closest('.card');
    if (!cardBtn) return;
    e.preventDefault();
    pStart = { x: e.clientX, y: e.clientY };
    if (cardBtn.classList.contains('running-card')) {
      pSrc = { kind: 'running', value: state.running ? state.running.value : 0 };
    } else {
      pSrc = { kind: 'card', uid: cardBtn.dataset.uid, value: Number(cardBtn.dataset.value) };
    }
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
      const node = pSrc.kind === 'card' ? elByCard(pSrc.uid) : document.getElementById('running');
      if (node) {
        node.classList.add('is-grabbed');
        node.style.transition = 'none';
      }
    }
    if (!dragging) return;
    // 掴んだ要素を指/カーソルに追従させる
    const node = pSrc.kind === 'card' ? elByCard(pSrc.uid) : document.getElementById('running');
    if (node) {
      const scale = pSrc.kind === 'card' ? 1.04 : 1.02;
      node.style.transform = 'translate(' + dx + 'px, ' + dy + 'px) scale(' + scale + ')';
    }
    const target = targetFromPoint(e.clientX, e.clientY);
    if (target && target.kind === pSrc.kind && target.uid === pSrc.uid) {
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
    // タップは click ハンドラに委譲
  }

  function onPointerCancel() {
    endDrag();
  }

  function handleDrop(src, dst, x, y) {
    if (UI.isPassSelecting()) return;

    // running → card：dstの場カードを running に足す
    if (src.kind === 'running' && dst.kind === 'card' && state.running) {
      openPicker(state.running.value, dst.value, x, y, (op) => {
        const r = Game.addRunning(state, dst.uid, op);
        if (!r.ok) { UI.flashFail(r.error); return; }
        UI.flashCombine(r.running.value);
        UI.flashOp(op);
        rerender();
        autoCaptureIfReady();
      });
      return;
    }

    // ここから先は src が card の場合のみ
    if (src.kind !== 'card') return;

    // running があるとき：source を running に足す（dst が card でも running でも同じ扱い）
    if (state.running) {
      openPicker(state.running.value, src.value, x, y, (op) => {
        const r = Game.addRunning(state, src.uid, op);
        if (!r.ok) { UI.flashFail(r.error); return; }
        UI.flashCombine(r.running.value);
        UI.flashOp(op);
        rerender();
        autoCaptureIfReady();
      });
      return;
    }

    // running が無いとき：場2枚を合体して新しい running にする
    if (dst.kind === 'card') {
      openPicker(src.value, dst.value, x, y, (op) => {
        const r = Game.combineFields(state, src.uid, op, dst.uid);
        if (!r.ok) { UI.flashFail(r.error); return; }
        UI.flashCombine(r.running.value);
        UI.flashOp(op);
        rerender();
        autoCaptureIfReady();
      });
      return;
    }
  }

  // 結果が 15 になったら少し見せてから自動で獲得
  function autoCaptureIfReady() {
    if (!state.running || state.running.value !== TARGET) return;
    setTimeout(() => {
      if (!state.running || state.running.value !== TARGET) return;
      const r = Game.captureRunning(state);
      if (!r.ok) return;
      UI.flashSuccess('+' + r.weight + ' 獲得！');
      Game.saveBestScore(state.captured);
      rerender();
      afterAction();
    }, 700);
  }

  function openPicker(a, b, x, y, onPick) {
    UI.openOpPicker(a, b, x, y, onPick);
  }

  // ----- タップ処理 -----
  function onCardClick(e) {
    if (Date.now() < suppressClickUntil) return;

    // 計算結果セルの ×（リセット）
    if (e.target.closest('[data-role="reset"]')) {
      if (!state.running) return;
      if (!confirm('計算を捨てますか？（使ったカードは戻りません）')) return;
      Game.resetRunning(state);
      rerender();
      afterAction();
      return;
    }

    // 計算結果セル本体（タップ → 15なら獲得）
    const running = e.target.closest('.running-card');
    if (running) {
      if (!state.running) return;
      if (state.running.value === TARGET) {
        const r = Game.captureRunning(state);
        if (r.ok) {
          UI.flashSuccess('+' + r.weight + ' 獲得！');
          Game.saveBestScore(state.captured);
          rerender();
          afterAction();
        } else {
          UI.flashFail(r.error);
        }
      } else {
        UI.flashFail('まだ15ではありません（' + state.running.value + '）');
      }
      return;
    }

    // 通常カード
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

    if (state.running) {
      UI.flashFail('カードを計算結果にドラッグしてください');
    } else {
      UI.flashFail('カードを別のカードにドラッグして合体');
    }
  }

  function fieldHasCards() {
    return state.field.some(c => c != null);
  }

  function onPass() {
    if (!fieldHasCards()) return;
    if (state.running) {
      UI.flashFail('計算中はパスできません（× で捨ててから）');
      return;
    }
    if (!confirm('場のカードを1枚捨てて、山札から1枚引きます。よろしいですか？')) return;
    UI.setPassSelecting(true);
    rerender();
  }

  function afterAction() {
    if (state.finished) {
      Game.saveBestScore(state.captured);
      rerender();
      const banner = document.getElementById('end-banner');
      if (banner) banner.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  function onRules() { UI.openModal('rules-modal'); }

  function onSoundToggle() {
    settings.sound = !settings.sound;
    Game.saveSettings(settings);
    UI.setSoundOn(settings.sound);
    const btn = document.getElementById('btn-sound');
    btn.textContent = settings.sound ? '🔊' : '🔇';
    btn.setAttribute('aria-pressed', settings.sound ? 'true' : 'false');
  }

  function onNewClick() {
    if (state && !state.finished && state.captured === 0 && !state.running) {
      newGame();
    } else if (confirm('新しいゲーム（カードもシャッフルし直し）を始めますか？')) {
      newGame();
    }
  }

  function onRestartClick() {
    if (!state) return;
    if (!confirm('今の回（同じ5枚）を最初からやり直しますか？\n（獲得スコアは保持されます）')) return;
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

    document.getElementById('btn-pass').addEventListener('click', onPass);
    document.getElementById('btn-restart').addEventListener('click', onRestartClick);
    document.getElementById('btn-rules').addEventListener('click', onRules);
    document.getElementById('btn-new').addEventListener('click', onNewClick);
    document.getElementById('btn-end-new').addEventListener('click', newGame);
    document.getElementById('btn-sound').addEventListener('click', onSoundToggle);

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
    UI.setSoundOn(settings.sound);
    const sBtn = document.getElementById('btn-sound');
    sBtn.textContent = settings.sound ? '🔊' : '🔇';
    bindEvents();
    newGame();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(typeof window !== 'undefined' ? window : globalThis);
