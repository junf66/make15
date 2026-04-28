// game.js — ゲーム進行ロジック（計算中の値方式）
// ルール:
//   - 場の2枚をドラッグで合体 → そのカードは消えて、計算結果が「計算中の値」として上に浮く
//   - さらに場のカードをドラッグして計算中の値と組み合わせると、計算中の値が更新される
//   - 計算中の値が 15 になったらタップで獲得（スコアは計算中の値に使った枚数）
//   - パスで場の1枚を捨てて1枚補充
(function (global) {
  'use strict';

  const { buildFullDeck, shuffle } = global.M15.Deck;

  const FIELD_SIZE = 5;
  const TARGET = 15;

  const STORAGE_KEYS = {
    BEST_SCORE: 'make15_best_score',
    PLAY_COUNT: 'make15_play_count',
    TOTAL_GAMES: 'make15_total_games',
    SETTINGS: 'make15_settings',
    LAST_PLAYED: 'make15_last_played',
  };

  let nextCardUid = 0;
  function newCard(value) {
    return { uid: 'c' + (++nextCardUid), value: value };
  }

  function createGame() {
    const deck = shuffle(buildFullDeck()).map(v => newCard(v));
    const field = [];
    for (let i = 0; i < FIELD_SIZE; i++) {
      if (deck.length) field.push(deck.shift());
    }
    return {
      deck: deck,
      field: field,
      discard: [],
      running: null,        // { value, weight } または null
      captured: 0,
      finished: false,
      lastEvent: null,
    };
  }

  function calcOp(a, b, op) {
    switch (op) {
      case '+': return a + b;
      case '-': return a - b;
      case '*': return a * b;
      case '/':
        if (b === 0) return null;
        if (a % b !== 0) return null;
        return a / b;
      default: return null;
    }
  }

  function previews(a, b) {
    return {
      '+': calcOp(a, b, '+'),
      '-': calcOp(a, b, '-'),
      '*': calcOp(a, b, '*'),
      '/': calcOp(a, b, '/'),
    };
  }

  // 場の2枚を合体して計算中の値を作る（計算中の値が無いときのみ可）
  function combineFields(state, uidA, op, uidB) {
    if (state.finished) return { ok: false, error: 'ゲーム終了' };
    if (state.running) return { ok: false, error: '計算中の値が既にあります' };
    if (uidA === uidB) return { ok: false, error: '同じカードは選べません' };
    const ia = state.field.findIndex(c => c.uid === uidA);
    const ib = state.field.findIndex(c => c.uid === uidB);
    if (ia < 0 || ib < 0) return { ok: false, error: 'カードが見つかりません' };
    const a = state.field[ia];
    const b = state.field[ib];
    const v = calcOp(a.value, b.value, op);
    if (v === null) return { ok: false, error: '整数で計算できません' };
    const positions = [ia, ib].sort((x, y) => y - x);
    for (const p of positions) state.field.splice(p, 1);
    state.running = { value: v, weight: 2 };
    refill(state);
    state.lastEvent = { type: 'combine', value: v, op: op };
    checkEnd(state);
    return { ok: true, running: state.running };
  }

  // 空の状態でカードを計算中の値に入れる（初期化、weight=1）
  function initRunning(state, uid) {
    if (state.finished) return { ok: false, error: 'ゲーム終了' };
    if (state.running) return { ok: false, error: '計算中の値が既にあります' };
    const idx = state.field.findIndex(c => c.uid === uid);
    if (idx < 0) return { ok: false, error: 'カードが見つかりません' };
    const card = state.field[idx];
    state.field.splice(idx, 1);
    state.running = { value: card.value, weight: 1 };
    refill(state);
    state.lastEvent = { type: 'initRunning', value: card.value };
    checkEnd(state);
    return { ok: true, running: state.running };
  }

  // 計算中の値に場のカードを足す
  function addRunning(state, uid, op) {
    if (state.finished) return { ok: false, error: 'ゲーム終了' };
    if (!state.running) return { ok: false, error: '計算中の値がありません' };
    const idx = state.field.findIndex(c => c.uid === uid);
    if (idx < 0) return { ok: false, error: 'カードが見つかりません' };
    const card = state.field[idx];
    const v = calcOp(state.running.value, card.value, op);
    if (v === null) return { ok: false, error: '整数で計算できません' };
    state.field.splice(idx, 1);
    state.running = { value: v, weight: state.running.weight + 1 };
    refill(state);
    state.lastEvent = { type: 'addRunning', value: v, op: op };
    checkEnd(state);
    return { ok: true, running: state.running };
  }

  // 計算中の値を獲得（15 のときのみ可）
  function captureRunning(state) {
    if (state.finished) return { ok: false, error: 'ゲーム終了' };
    if (!state.running) return { ok: false, error: '計算中の値がありません' };
    if (state.running.value !== TARGET) {
      return { ok: false, error: '15ではありません（' + state.running.value + '）' };
    }
    const w = state.running.weight;
    state.captured += w;
    state.running = null;
    state.lastEvent = { type: 'capture', weight: w };
    checkEnd(state);
    return { ok: true, weight: w };
  }

  // 計算中の値を捨てる（使ったカードは戻らない）
  function resetRunning(state) {
    if (state.finished) return false;
    if (!state.running) return false;
    state.running = null;
    state.lastEvent = { type: 'resetRunning' };
    checkEnd(state);
    return true;
  }

  // 場のカードが既に 15 ならタップで獲得（計算中の値が無い時のみ。1枚分のスコア）
  function captureCard(state, uid) {
    if (state.finished) return { ok: false, error: 'ゲーム終了' };
    if (state.running) return { ok: false, error: 'まずは計算中の値を確定（15）してください' };
    const idx = state.field.findIndex(c => c.uid === uid);
    if (idx < 0) return { ok: false, error: 'カードが見つかりません' };
    const card = state.field[idx];
    if (card.value !== TARGET) {
      return { ok: false, error: '15ではありません（' + card.value + '）' };
    }
    state.field.splice(idx, 1);
    state.captured += 1;
    refill(state);
    state.lastEvent = { type: 'capture', weight: 1 };
    checkEnd(state);
    return { ok: true, weight: 1 };
  }

  function pass(state, uid) {
    if (state.finished) return false;
    if (state.field.length === 0) return false;
    const idx = uid
      ? state.field.findIndex(c => c.uid === uid)
      : 0;
    if (idx < 0) return false;
    const removed = state.field.splice(idx, 1)[0];
    state.discard.push(removed);
    if (state.deck.length > 0) state.field.push(state.deck.shift());
    state.lastEvent = { type: 'pass' };
    checkEnd(state);
    return true;
  }

  function refill(state) {
    while (state.field.length < FIELD_SIZE && state.deck.length > 0) {
      state.field.push(state.deck.shift());
    }
  }

  function checkEnd(state) {
    if (state.deck.length === 0 && state.field.length === 0 && !state.running) {
      state.finished = true;
    }
  }

  // localStorage
  function loadBestScore() {
    try {
      const v = localStorage.getItem(STORAGE_KEYS.BEST_SCORE);
      return v ? parseInt(v, 10) || 0 : 0;
    } catch (e) { return 0; }
  }
  function saveBestScore(score) {
    try {
      const cur = loadBestScore();
      if (score > cur) {
        localStorage.setItem(STORAGE_KEYS.BEST_SCORE, String(score));
        return true;
      }
    } catch (e) {}
    return false;
  }
  function incrementGameCount() {
    try {
      const v = parseInt(localStorage.getItem(STORAGE_KEYS.TOTAL_GAMES) || '0', 10);
      localStorage.setItem(STORAGE_KEYS.TOTAL_GAMES, String(v + 1));
      localStorage.setItem(STORAGE_KEYS.LAST_PLAYED, new Date().toISOString());
    } catch (e) {}
  }
  function loadSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.SETTINGS);
      if (!raw) return { sound: true, theme: 'light' };
      return Object.assign({ sound: true, theme: 'light' }, JSON.parse(raw));
    } catch (e) { return { sound: true, theme: 'light' }; }
  }
  function saveSettings(settings) {
    try { localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings)); }
    catch (e) {}
  }

  global.M15 = global.M15 || {};
  global.M15.Game = {
    createGame, combineFields, initRunning, addRunning, captureRunning, resetRunning, captureCard, pass,
    previews, calcOp,
    loadBestScore, saveBestScore, incrementGameCount, loadSettings, saveSettings,
    CONSTANTS: { FIELD_SIZE, TARGET },
  };
})(typeof window !== 'undefined' ? window : globalThis);
