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

  // ----- ポインタ／スワイプ検出 -----
  const SWIPE_THRESHOLD = 28;
  let pStart = null;
  let pUid = null;
  let suppressClickUntil = 0;

  function onPointerDown(e) {
    const btn = e.target.closest('.card');
    if (!btn) return;
    pStart = { x: e.clientX, y: e.clientY };
    pUid = btn.dataset.uid;
  }

  function onPointerUp(e) {
    if (!pStart || !pUid) return;
    const dx = e.clientX - pStart.x;
    const dy = e.clientY - pStart.y;
    const dist = Math.hypot(dx, dy);
    const uid = pUid;
    pStart = null;
    pUid = null;
    if (dist < SWIPE_THRESHOLD) return; // タップは click ハンドラに任せる
    let op;
    if (Math.abs(dx) > Math.abs(dy)) op = dx > 0 ? '*' : '/';
    else op = dy < 0 ? '+' : '-';
    suppressClickUntil = Date.now() + 350;
    activateCard(uid, op);
  }

  function onPointerCancel() {
    pStart = null;
    pUid = null;
  }

  function onCardClick(e) {
    if (Date.now() < suppressClickUntil) return;
    const btn = e.target.closest('.card');
    if (!btn) return;
    activateCard(btn.dataset.uid, null);
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
    field.addEventListener('pointerup', onPointerUp);
    field.addEventListener('pointercancel', onPointerCancel);
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
