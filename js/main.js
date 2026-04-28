// main.js — エントリポイント
(function (global) {
  'use strict';

  const Game = global.M15.Game;
  const UI = global.M15.UI;

  let state = null;
  let settings = Game.loadSettings();

  function rerender() { UI.renderAll(state); }

  function newGame() {
    state = Game.createGame();
    Game.incrementGameCount();
    UI.setPassSelecting(false);
    rerender();
    document.getElementById('end-banner').hidden = true;
  }

  function removeCardFromExpression(uid) {
    const idx = state.expression.findIndex(t => t.type === 'num' && t.cardId === uid);
    if (idx < 0) return;
    state.expression.splice(idx, 1);
    while (state.expression.length > 0) {
      const last = state.expression[state.expression.length - 1];
      if (last.type === 'op' || last.type === 'lparen') state.expression.pop();
      else break;
    }
  }

  // タップ／スワイプ共通の処理。swipeOp が null なら「タップ」（必要なら + を自動挿入）
  function activateCard(uid, swipeOp) {
    const card = state.field.find(c => c.uid === uid);
    if (!card) return;

    if (UI.isPassSelecting()) {
      Game.pass(state, uid);
      UI.setPassSelecting(false);
      rerender();
      afterAction();
      return;
    }

    if (Game.isCardInExpression(state, uid)) {
      removeCardFromExpression(uid);
      UI.notifySelect();
      rerender();
      return;
    }

    const prev = state.expression.length > 0
      ? state.expression[state.expression.length - 1] : null;
    const needsOp = prev && (prev.type === 'num' || prev.type === 'rparen');
    if (needsOp) {
      const op = swipeOp || '+';
      if (Game.canAddOp(state, op)) {
        Game.addOp(state, op);
      } else {
        UI.flashFail('そこに数字は置けません');
        return;
      }
    }

    if (!Game.canAddCard(state, uid)) {
      UI.flashFail('そこに数字は置けません');
      return;
    }
    Game.addCard(state, card);
    UI.notifySelect();
    if (swipeOp) UI.flashOp(swipeOp);
    rerender();
  }

  // ----- ポインタ／スワイプ／ドラッグ検出 -----
  const SWIPE_THRESHOLD = 28;
  const DRAG_THRESHOLD = 12;
  let pStart = null;
  let pUid = null;
  let suppressClickUntil = 0;
  let dragging = false;
  let dragOverUid = null;
  let activePointerId = null;

  function cardElByUid(uid) {
    return document.querySelector('.card[data-uid="' + uid + '"]');
  }

  function setDragOver(uid) {
    if (dragOverUid === uid) return;
    if (dragOverUid) {
      const old = cardElByUid(dragOverUid);
      if (old) old.classList.remove('is-drop-target');
    }
    dragOverUid = uid;
    if (dragOverUid) {
      const next = cardElByUid(dragOverUid);
      if (next) next.classList.add('is-drop-target');
    }
  }

  function endDrag() {
    if (pUid) {
      const src = cardElByUid(pUid);
      if (src) src.classList.remove('is-grabbed');
    }
    setDragOver(null);
    document.body.classList.remove('is-dragging');
    dragging = false;
    activePointerId = null;
  }

  function onPointerDown(e) {
    const btn = e.target.closest('.card');
    if (!btn) return;
    if (e.pointerType !== 'mouse') e.preventDefault();
    pStart = { x: e.clientX, y: e.clientY };
    pUid = btn.dataset.uid;
    dragging = false;
    activePointerId = e.pointerId;
    try { btn.setPointerCapture(e.pointerId); } catch (_) {}
  }

  function onTouchStart(e) {
    if (e.target.closest('.card')) e.preventDefault();
  }

  function onPointerMove(e) {
    if (!pStart || !pUid) return;
    if (activePointerId != null && e.pointerId !== activePointerId) return;
    const dx = e.clientX - pStart.x;
    const dy = e.clientY - pStart.y;
    if (!dragging && Math.hypot(dx, dy) >= DRAG_THRESHOLD) {
      dragging = true;
      document.body.classList.add('is-dragging');
      const src = cardElByUid(pUid);
      if (src) src.classList.add('is-grabbed');
    }
    if (!dragging) return;
    const target = document.elementFromPoint(e.clientX, e.clientY);
    const card = target && target.closest ? target.closest('.card') : null;
    const overUid = (card && card.dataset.uid !== pUid) ? card.dataset.uid : null;
    setDragOver(overUid);
  }

  function onPointerUp(e) {
    if (!pStart || !pUid) return;
    if (activePointerId != null && e.pointerId !== activePointerId) return;
    const startUid = pUid;
    const dropUid = dragOverUid;
    const dx = e.clientX - pStart.x;
    const dy = e.clientY - pStart.y;
    const dist = Math.hypot(dx, dy);
    pStart = null;
    pUid = null;
    endDrag();

    // (a) ドラッグ＆ドロップ：別カードで離した
    if (dropUid && dropUid !== startUid) {
      suppressClickUntil = Date.now() + 350;
      openOpPicker(startUid, dropUid, e.clientX, e.clientY);
      return;
    }

    // (b) スワイプ：同じカード内で閾値以上動いた
    if (dist >= SWIPE_THRESHOLD) {
      let op;
      if (Math.abs(dx) > Math.abs(dy)) op = dx > 0 ? '*' : '/';
      else op = dy < 0 ? '+' : '-';
      suppressClickUntil = Date.now() + 350;
      activateCard(startUid, op);
      return;
    }
    // それ以外（タップ）は click ハンドラに任せる
  }

  function onPointerCancel() {
    pStart = null;
    pUid = null;
    endDrag();
  }

  function onCardClick(e) {
    if (Date.now() < suppressClickUntil) return;
    const btn = e.target.closest('.card');
    if (!btn) return;
    activateCard(btn.dataset.uid, null);
  }

  // ----- ドラッグ→ピッカー -----
  let pickerSrcUid = null;
  let pickerDstUid = null;

  function openOpPicker(srcUid, dstUid, x, y) {
    if (UI.isPassSelecting()) return;
    if (Game.isCardInExpression(state, srcUid) || Game.isCardInExpression(state, dstUid)) {
      UI.flashFail('既に式に入っています');
      return;
    }
    pickerSrcUid = srcUid;
    pickerDstUid = dstUid;
    const src = state.field.find(c => c.uid === srcUid);
    const dst = state.field.find(c => c.uid === dstUid);
    if (!src || !dst) return;
    UI.openOpPicker(src.value, dst.value, x, y, applyOpPicker);
  }

  function applyOpPicker(op) {
    const srcUid = pickerSrcUid;
    const dstUid = pickerDstUid;
    pickerSrcUid = pickerDstUid = null;
    if (!srcUid || !dstUid) return;
    const src = state.field.find(c => c.uid === srcUid);
    const dst = state.field.find(c => c.uid === dstUid);
    if (!src || !dst) return;
    // 直前が num/rparen なら接続用 + を補う
    const prev = state.expression.length > 0
      ? state.expression[state.expression.length - 1] : null;
    if (prev && (prev.type === 'num' || prev.type === 'rparen')) {
      Game.addOp(state, '+');
    }
    if (!Game.addCard(state, src)) { UI.flashFail('追加できません'); return; }
    if (!Game.addOp(state, op))    { UI.flashFail('追加できません'); return; }
    if (!Game.addCard(state, dst)) { UI.flashFail('追加できません'); return; }
    UI.notifySelect();
    UI.flashOp(op);
    rerender();
  }

  // 式エリアの演算子トークンをタップで循環
  const OP_CYCLE = ['+', '-', '*', '/'];
  function onExpressionClick(e) {
    const opEl = e.target.closest('.expr-op');
    if (!opEl) return;
    const idx = parseInt(opEl.dataset.index, 10);
    if (isNaN(idx)) return;
    const t = state.expression[idx];
    if (!t || t.type !== 'op') return;
    const cur = OP_CYCLE.indexOf(t.value);
    t.value = OP_CYCLE[(cur + 1) % OP_CYCLE.length];
    UI.notifySelect();
    UI.flashOp(t.value);
    rerender();
  }

  function onOpClick(op) {
    if (!Game.canAddOp(state, op)) {
      UI.flashFail('そこに記号は置けません');
      return;
    }
    Game.addOp(state, op);
    UI.notifySelect();
    rerender();
  }

  function onBack() {
    if (Game.backspace(state)) { UI.notifySelect(); rerender(); }
  }

  function onClear() {
    Game.clearExpression(state);
    rerender();
  }

  function onSubmit() {
    const result = Game.submit(state);
    if (result.ok) {
      UI.flashSuccess();
      Game.saveBestScore(state.captured);
      rerender();
      afterAction();
    } else {
      UI.flashFail(result.error || '15になりません');
      rerender();
    }
  }

  function onPass() {
    if (state.field.length === 0) return;
    if (!confirm('場のカードを1枚捨てて、山札から1枚引きます。よろしいですか？')) return;
    Game.clearExpression(state);
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
    if (state && !state.finished && state.captured === 0 && state.expression.length === 0) {
      newGame();
    } else if (confirm('新しいゲームを始めますか？（現在のスコアはリセットされます）')) {
      newGame();
    }
  }

  function bindEvents() {
    const field = document.getElementById('field');
    field.addEventListener('pointerdown', onPointerDown);
    field.addEventListener('touchstart', onTouchStart, { passive: false });
    field.addEventListener('contextmenu', e => e.preventDefault());
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
    document.addEventListener('pointercancel', onPointerCancel);
    field.addEventListener('click', onCardClick);

    document.getElementById('expression').addEventListener('click', onExpressionClick);

    document.getElementById('op-lparen').addEventListener('click', () => onOpClick('('));
    document.getElementById('op-rparen').addEventListener('click', () => onOpClick(')'));
    document.getElementById('btn-back').addEventListener('click', onBack);
    document.getElementById('btn-clear').addEventListener('click', onClear);
    document.getElementById('btn-submit').addEventListener('click', onSubmit);
    document.getElementById('btn-pass').addEventListener('click', onPass);
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
