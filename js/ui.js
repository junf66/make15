// ui.js — DOM操作・アニメーション・効果音（合体型 / 計算中の値）
(function (global) {
  'use strict';

  const Game = global.M15.Game;
  const TARGET = Game.CONSTANTS.TARGET;

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

  // ----- 効果音 -----
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
  function playSelect() { if (soundOn) beep({ freq: 660, duration: 0.06, type: 'triangle', gain: 0.05 }); }
  function playCombine() {
    if (!soundOn) return;
    beep({ freq: 440, duration: 0.08, type: 'triangle', gain: 0.06 });
    setTimeout(() => beep({ freq: 660, duration: 0.12, type: 'triangle', gain: 0.06 }), 70);
  }
  function playSuccess() {
    if (!soundOn) return;
    beep({ freq: 523, duration: 0.12, type: 'triangle', gain: 0.07 });
    setTimeout(() => beep({ freq: 784, duration: 0.18, type: 'triangle', gain: 0.07 }), 120);
    setTimeout(() => beep({ freq: 1047, duration: 0.22, type: 'triangle', gain: 0.07 }), 280);
  }
  function playFail() { if (soundOn) beep({ freq: 220, duration: 0.18, type: 'sawtooth', gain: 0.05, sweep: -80 }); }

  // クラッカー音（ホワイトノイズの鋭い破裂）
  function playPopper() {
    if (!soundOn) return;
    const ctx = getAudio();
    if (!ctx) return;
    if (ctx.state === 'suspended') { try { ctx.resume(); } catch (e) {} }
    const dur = 0.45;
    const samples = Math.floor(ctx.sampleRate * dur);
    const buffer = ctx.createBuffer(1, samples, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < samples; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / samples, 1.5);
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 2400;
    filter.Q.value = 0.8;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.32, ctx.currentTime + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    noise.connect(filter).connect(gain).connect(ctx.destination);
    noise.start();
    noise.stop(ctx.currentTime + dur + 0.05);
  }

  // ----- 描画 -----
  function renderAll(state) {
    renderHeader(state);
    renderField(state);
    renderControls(state);
    renderEnd(state);
  }

  function renderHeader(state) {
    $('#stat-stage').textContent = String(state.stage);
    $('#stat-best').textContent = String(Game.loadBestScore());
  }

  function renderField(state) {
    const root = $('#field');
    root.innerHTML = '';
    for (let i = 0; i < state.field.length; i++) {
      const card = state.field[i];
      if (card == null) {
        root.appendChild(el('div', { class: 'card-empty', 'aria-hidden': 'true' }));
        continue;
      }
      const isComputed = card.weight > 1;
      const onlyCell = !state.field.some((c, j) => c != null && j !== i);
      const isClearable = card.value === TARGET && onlyCell;
      const cls = ['card'];
      if (isComputed) cls.push('is-computed');
      if (isClearable) cls.push('is-target');
      const node = el('button', {
        type: 'button',
        class: cls.join(' '),
        dataset: { uid: card.uid, value: String(card.value) },
        'aria-label': isClearable ? '15のセル（タップで獲得）' : 'カード ' + card.value,
      }, [
        el('span', { class: 'card-num' }, String(card.value)),
        isComputed ? el('span', { class: 'card-weight', 'aria-hidden': 'true' }, '×' + card.weight) : null,
        isClearable ? el('span', { class: 'card-grab' }, 'いちご') : null,
      ]);
      root.appendChild(node);
    }
  }

  function renderControls(state) {
    const anyCard = state.field.some(c => c != null);
    $('#btn-giveup').disabled = !anyCard;
  }

  function renderEnd(state) {
    const banner = $('#end-banner');
    if (!state.finished) { banner.hidden = true; return; }
    banner.hidden = false;
    $('#end-title').textContent = 'ゲーム終了';
    $('#end-score').textContent = String(state.stage);
    const best = Game.loadBestScore();
    const isBest = state.stage > best;
    $('#end-best').textContent = isBest
      ? '🎉 ベスト更新！（前回: ' + best + '）'
      : 'ベスト: ' + best;
  }

  // ----- フィードバック -----
  let bannerTimer = null;
  function setBanner(text, cls, hideMs) {
    if (bannerTimer) { clearTimeout(bannerTimer); bannerTimer = null; }
    const banner = $('#feedback');
    banner.textContent = text;
    banner.className = cls;
    if (hideMs) {
      bannerTimer = setTimeout(() => {
        banner.className = 'feedback';
        banner.textContent = '';
        bannerTimer = null;
      }, hideMs);
    }
  }

  function flashSuccess(msg) {
    playPopper();
    playSuccess();
    setTimeout(playPopper, 220);
    setTimeout(playPopper, 460);
    setTimeout(playSuccess, 800);

    setBanner(msg || '＝ 15　獲得！', 'feedback is-success', 3500);

    // 左右の小さなクラッカー（中央は邪魔しない）
    sidePoppers();
    setTimeout(sidePoppers, 700);

    // 紙吹雪：画面上から落とす
    confettiRain();
  }

  function sidePoppers() {
    spawnPopper('left');
    spawnPopper('right');
  }

  function spawnPopper(side) {
    const tag = document.createElement('span');
    tag.className = 'popper-side popper-' + side;
    tag.textContent = '🎉';
    document.body.appendChild(tag);
    setTimeout(() => tag.remove(), 1600);
  }

  function confettiRain() {
    const total = 48;
    for (let i = 0; i < total; i++) {
      setTimeout(() => {
        const c = document.createElement('span');
        c.className = 'strawberry-rain';
        c.textContent = '🍓';
        c.style.left = (Math.random() * 100) + 'vw';
        const size = 18 + Math.random() * 22;
        c.style.fontSize = size + 'px';
        c.style.setProperty('--tx', (Math.random() * 240 - 120) + 'px');
        c.style.setProperty('--rot', ((Math.random() * 720) + 360) + 'deg');
        c.style.animationDuration = (2.4 + Math.random() * 1.8) + 's';
        document.body.appendChild(c);
        setTimeout(() => c.remove(), 4500);
      }, i * 35);
    }
  }
  function flashCombine(value) {
    playCombine();
    setBanner('＝ ' + value, 'feedback is-combine', 900);
  }
  function flashFail(msg) {
    playFail();
    setBanner(msg || 'もう一度どうぞ', 'feedback is-fail', 1600);
    const fld = $('#field');
    fld.classList.remove('shake');
    void fld.offsetWidth;
    fld.classList.add('shake');
  }
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
  function notifySelect() { playSelect(); }

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

  // ----- 演算子ピッカー（プレビュー値付き） -----
  function openOpPicker(srcVal, dstVal, x, y, onPick) {
    closeOpPicker();
    const overlay = document.createElement('div');
    overlay.id = 'op-picker';
    overlay.className = 'op-picker';
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeOpPicker();
    });

    const pv = Game.previews(srcVal, dstVal);
    const card = document.createElement('div');
    card.className = 'op-picker-card';
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const W = 240;
    const H = 280;
    const left = Math.max(12, Math.min(vw - W - 12, x - W / 2));
    const top = Math.max(12, Math.min(vh - H - 12, y - H / 2));
    card.style.left = left + 'px';
    card.style.top = top + 'px';
    card.style.width = W + 'px';

    const label = document.createElement('div');
    label.className = 'op-picker-label';
    const a = document.createElement('span');
    a.className = 'op-picker-num';
    a.textContent = String(srcVal);
    const slot = document.createElement('span');
    slot.className = 'op-picker-slot';
    slot.textContent = '？';
    const b = document.createElement('span');
    b.className = 'op-picker-num';
    b.textContent = String(dstVal);
    label.appendChild(a);
    label.appendChild(slot);
    label.appendChild(b);
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
      const v = pv[o.op];
      const valid = v !== null;
      btn.disabled = !valid;
      const sym = document.createElement('span');
      sym.className = 'op-picker-sym';
      sym.textContent = o.label;
      const num = document.createElement('span');
      num.className = 'op-picker-val';
      num.textContent = valid ? String(v) : '—';
      if (valid && v === TARGET) btn.classList.add('is-target');
      btn.appendChild(num);
      btn.appendChild(sym);
      btn.addEventListener('click', () => {
        if (!valid) return;
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
    renderAll, flashSuccess, flashCombine, flashFail, flashOp, notifySelect,
    openModal, closeModal,
    openOpPicker, closeOpPicker,
    isPassSelecting, setPassSelecting, setSoundOn,
  };
})(typeof window !== 'undefined' ? window : globalThis);
