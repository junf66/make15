// ui.js — DOM操作・アニメーション・効果音
(function (global) {
  'use strict';

  const Game = global.M15.Game;

  const OP_LABEL = { '+': '＋', '-': '−', '*': '×', '/': '÷' };

  function $(sel) { return document.querySelector(sel); }

  function el(tag, attrs, children) {
    attrs = attrs || {};
    children = children || [];
    const node = document.createElement(tag);
    for (const k in attrs) {
      if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
      const v = attrs[k];
      if (k === 'class') node.className = v;
      else if (k === 'dataset') Object.assign(node.dataset, v);
      else if (v === true) node.setAttribute(k, '');
      else if (v !== false && v != null) node.setAttribute(k, String(v));
    }
    const arr = Array.isArray(children) ? children : [children];
    for (const child of arr) {
      if (child == null) continue;
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    }
    return node;
  }

  // ----- 効果音（Web Audio APIで合成） -----
  let audioCtx = null;
  function getAudio() {
    if (audioCtx) return audioCtx;
    try {
      const Ctx = global.AudioContext || global.webkitAudioContext;
      if (!Ctx) return null;
      audioCtx = new Ctx();
      return audioCtx;
    } catch (e) { return null; }
  }

  function beep(opts) {
    opts = opts || {};
    const freq = opts.freq != null ? opts.freq : 440;
    const duration = opts.duration != null ? opts.duration : 0.1;
    const type = opts.type || 'sine';
    const gain = opts.gain != null ? opts.gain : 0.08;
    const sweep = opts.sweep || 0;
    const ctx = getAudio();
    if (!ctx) return;
    if (ctx.state === 'suspended') { try { ctx.resume(); } catch (e) {} }
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    if (sweep) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq + sweep), ctx.currentTime + duration);
    g.gain.setValueAtTime(0, ctx.currentTime);
    g.gain.linearRampToValueAtTime(gain, ctx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    osc.connect(g).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration + 0.05);
  }

  let soundOn = true;
  function setSoundOn(v) { soundOn = !!v; }

  function playSelect() {
    if (soundOn) beep({ freq: 660, duration: 0.06, type: 'triangle', gain: 0.05 });
  }
  function playSuccess() {
    if (!soundOn) return;
    beep({ freq: 523, duration: 0.12, type: 'triangle', gain: 0.07 });
    setTimeout(() => beep({ freq: 784, duration: 0.18, type: 'triangle', gain: 0.07 }), 120);
    setTimeout(() => beep({ freq: 1047, duration: 0.22, type: 'triangle', gain: 0.07 }), 280);
  }
  function playFail() {
    if (!soundOn) return;
    beep({ freq: 220, duration: 0.18, type: 'sawtooth', gain: 0.05, sweep: -80 });
  }

  // ----- 描画 -----
  function renderAll(state) {
    renderHeader(state);
    renderField(state);
    renderExpression(state);
    renderControls(state);
    renderEnd(state);
  }

  function renderHeader(state) {
    $('#stat-deck').textContent = String(state.deck.length);
    $('#stat-captured').textContent = String(state.captured);
    $('#stat-best').textContent = String(Game.loadBestScore());
  }

  function renderField(state) {
    const root = $('#field');
    root.innerHTML = '';
    if (state.field.length === 0) {
      root.appendChild(el('div', { class: 'field-empty' }, '場にカードがありません'));
      return;
    }
    for (const card of state.field) {
      const used = Game.isCardInExpression(state, card.uid);
      const node = el('button', {
        type: 'button',
        class: 'card' + (used ? ' is-used' : ''),
        dataset: { uid: card.uid, value: String(card.value) },
        'aria-label': 'カード ' + card.value,
        'aria-pressed': used ? 'true' : 'false',
      }, [
        el('span', { class: 'card-num' }, String(card.value)),
        el('span', { class: 'card-mark', 'aria-hidden': 'true' }),
      ]);
      root.appendChild(node);
    }
  }

  function renderExpression(state) {
    const root = $('#expression');
    root.innerHTML = '';
    if (state.expression.length === 0) {
      root.appendChild(el('span', { class: 'expr-placeholder' },
        'カードをタップ、または上＋／下−／右×／左÷にスワイプ'));
      return;
    }
    state.expression.forEach((t, i) => {
      let cls = 'expr-token';
      let txt = '';
      if (t.type === 'num') { cls += ' expr-num'; txt = String(t.value); }
      else if (t.type === 'op') { cls += ' expr-op'; txt = OP_LABEL[t.value] || t.value; }
      else if (t.type === 'lparen') { cls += ' expr-paren'; txt = '('; }
      else if (t.type === 'rparen') { cls += ' expr-paren'; txt = ')'; }
      const node = el('span', { class: cls, dataset: { index: String(i) } }, txt);
      root.appendChild(node);
    });
  }

  function renderControls(state) {
    const opMap = { 'op-lparen': '(', 'op-rparen': ')' };
    for (const id in opMap) {
      const btn = document.getElementById(id);
      if (btn) btn.disabled = !Game.canAddOp(state, opMap[id]);
    }
    $('#btn-back').disabled = state.expression.length === 0;
    $('#btn-clear').disabled = state.expression.length === 0;
    $('#btn-submit').disabled = state.expression.length === 0;
    $('#btn-pass').disabled = state.field.length === 0;
  }

  function renderEnd(state) {
    const banner = $('#end-banner');
    if (!state.finished) { banner.hidden = true; return; }
    banner.hidden = false;
    const isClear = state.captured >= 15;
    $('#end-title').textContent = isClear ? 'クリア！' : 'ゲーム終了';
    $('#end-score').textContent = String(state.captured);
    const best = Game.loadBestScore();
    const isBest = state.captured > best;
    $('#end-best').textContent = isBest
      ? '🎉 ベストスコア更新！（前回: ' + best + '）'
      : 'ベストスコア: ' + best;
  }

  // ----- フィードバック -----
  function flashSuccess() {
    playSuccess();
    const banner = $('#feedback');
    banner.textContent = '＝ 15　成功！';
    banner.className = 'feedback is-success';
    burst('#D2454D');
    setTimeout(() => { banner.className = 'feedback'; banner.textContent = ''; }, 1400);
  }

  function flashFail(msg) {
    playFail();
    const banner = $('#feedback');
    banner.textContent = msg || 'もう一度どうぞ';
    banner.className = 'feedback is-fail';
    const expr = $('#expression');
    expr.classList.remove('shake');
    void expr.offsetWidth;
    expr.classList.add('shake');
    setTimeout(() => { banner.className = 'feedback'; banner.textContent = ''; }, 1800);
  }

  function notifySelect() { playSelect(); }

  function flashOp(op) {
    const layer = $('#fx');
    if (!layer) return;
    const sym = OP_LABEL[op] || op;
    const tag = document.createElement('span');
    tag.className = 'op-flash';
    tag.textContent = sym;
    layer.appendChild(tag);
    setTimeout(() => tag.remove(), 600);
  }

  function burst(color) {
    const layer = $('#fx');
    if (!layer) return;
    const N = 18;
    for (let i = 0; i < N; i++) {
      const dot = document.createElement('span');
      dot.className = 'fx-dot';
      dot.style.background = color;
      const angle = (Math.PI * 2 * i) / N;
      const dist = 80 + Math.random() * 60;
      dot.style.setProperty('--dx', (Math.cos(angle) * dist) + 'px');
      dot.style.setProperty('--dy', (Math.sin(angle) * dist) + 'px');
      layer.appendChild(dot);
      setTimeout(() => dot.remove(), 900);
    }
  }

  // ----- ドラッグ→演算子ピッカー -----
  function openOpPicker(srcVal, dstVal, x, y, onPick) {
    closeOpPicker();
    const overlay = document.createElement('div');
    overlay.id = 'op-picker';
    overlay.className = 'op-picker';
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeOpPicker();
    });

    const card = document.createElement('div');
    card.className = 'op-picker-card';
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const W = 220;
    const H = 240;
    const left = Math.max(12, Math.min(vw - W - 12, x - W / 2));
    const top = Math.max(12, Math.min(vh - H - 12, y - H / 2));
    card.style.left = left + 'px';
    card.style.top = top + 'px';

    const label = document.createElement('div');
    label.className = 'op-picker-label';
    label.textContent = srcVal + ' ? ' + dstVal;
    card.appendChild(label);

    const grid = document.createElement('div');
    grid.className = 'op-picker-grid';
    const ops = [
      { op: '+', label: '＋' },
      { op: '-', label: '−' },
      { op: '*', label: '×' },
      { op: '/', label: '÷' },
    ];
    for (const o of ops) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'op-picker-btn';
      btn.textContent = o.label;
      btn.addEventListener('click', () => {
        closeOpPicker();
        onPick(o.op);
      });
      grid.appendChild(btn);
    }
    card.appendChild(grid);

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'op-picker-cancel';
    cancel.textContent = 'キャンセル';
    cancel.addEventListener('click', closeOpPicker);
    card.appendChild(cancel);

    overlay.appendChild(card);
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('is-open'));
  }

  function closeOpPicker() {
    const cur = document.getElementById('op-picker');
    if (cur) cur.remove();
  }

  // ----- モーダル -----
  function openModal(id) {
    const m = document.getElementById(id);
    if (m) { m.hidden = false; m.classList.add('is-open'); }
  }
  function closeModal(id) {
    const m = document.getElementById(id);
    if (m) { m.hidden = true; m.classList.remove('is-open'); }
  }

  // ----- パスモード -----
  let passSelecting = false;
  function isPassSelecting() { return passSelecting; }
  function setPassSelecting(v) {
    passSelecting = !!v;
    document.body.classList.toggle('pass-mode', passSelecting);
    const hint = $('#pass-hint');
    if (hint) hint.hidden = !passSelecting;
  }

  global.M15 = global.M15 || {};
  global.M15.UI = {
    renderAll, flashSuccess, flashFail, flashOp, notifySelect,
    openModal, closeModal,
    openOpPicker, closeOpPicker,
    isPassSelecting, setPassSelecting, setSoundOn,
  };
})(typeof window !== 'undefined' ? window : globalThis);
