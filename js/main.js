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

  function newGame() {
    state = Game.createGame();
    Game.incrementGameCount();
    UI.setPassSelecting(false);
    UI.closeOpPicker();
    rerender();
    document.getElementById('end-banner').hidden = true;
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

  // 場に「15 かつ 重み=5」のセルが現れたら自動で獲得
  function autoCaptureIfReady() {
    const idx = state.field.findIndex(c => c && c.value === TARGET && c.weight === FIELD_SIZE);
    if (idx < 0) return;
    const targetUid = state.field[idx].uid;
    setTimeout(() => {
      const cur = state.field.findIndex(c => c && c.uid === targetUid);
      if (cur < 0) return;
      const r = Game.captureCell(state, targetUid);
      if (!r.ok) return;
      UI.flashSuccess(r.weight + '枚獲得');
      Game.saveBestScore(state.captured);
      rerender();
      afterAction();
    }, 1100);
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

    // クリア対象のセル：タップで獲得
    if (card.value === TARGET && card.weight === FIELD_SIZE) {
      const r = Game.captureCell(state, uid);
      if (r.ok) {
        UI.flashSuccess(r.weight + '枚獲得');
        Game.saveBestScore(state.captured);
        rerender();
        afterAction();
      } else {
        UI.flashFail(r.error);
      }
      return;
    }

    if (card.value === TARGET) {
      UI.flashFail('5枚すべて使ってください（現在 ' + card.weight + ' 枚）');
      return;
    }
    UI.flashFail('カードを別のカードへドラッグして合体');
  }

  function fieldHasCards() {
    return state.field.some(c => c != null);
  }

  function onPass() {
    if (!fieldHasCards()) return;
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

  function onNewClick() {
    if (state && !state.finished && state.captured === 0 && allOriginalCards()) {
      newGame();
    } else if (confirm('新しいゲーム（カードもシャッフルし直し）を始めますか？')) {
      newGame();
    }
  }

  function allOriginalCards() {
    return state.field.every(c => !c || c.weight === 1);
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
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(typeof window !== 'undefined' ? window : globalThis);
