// game.js — 場のセルが直接「数値＋重み」を持つモデル
// ルール:
//   - 場のセルは {uid, value, weight} で、合体するとそのセル位置に新セルができる（重みは合算）
//   - もう片方のセルは空になる（位置はそのまま）
//   - セルの値が 15 かつ 重み が 5 のとき、タップで獲得（スコア +5）
//   - パス：1セルを捨てて山札から1枚補充
(function (global) {
  'use strict';

  const { buildFullDeck, shuffle } = global.M15.Deck;

  const FIELD_SIZE = 5;
  const TARGET = 15;

  const STORAGE_KEYS = {
    BEST_SCORE: 'make15_best_stage',
    BEST_TA: 'make15_best_ta',
    PLAY_COUNT: 'make15_play_count',
    TOTAL_GAMES: 'make15_total_games',
    SETTINGS: 'make15_settings',
    LAST_PLAYED: 'make15_last_played',
  };

  const TIME_ATTACK_MS = 180000; // 3分

  let nextCardUid = 0;
  function newCard(value, weight) {
    return { uid: 'c' + (++nextCardUid), value: value, weight: weight || 1 };
  }

  function createGame(opts) {
    opts = opts || {};
    const sequence = shuffle(buildFullDeck());
    return startWithSequence(sequence, opts);
  }

  function restartGame(state) {
    if (!state || !state.originalSequence) return createGame();
    return startWithSequence(state.originalSequence.slice());
  }

  function startWithSequence(sequence, opts) {
    opts = opts || {};
    const original = sequence.slice();
    const deck = sequence.map(v => newCard(v, 1));
    const field = [];
    for (let i = 0; i < FIELD_SIZE; i++) {
      field.push(deck.length ? deck.shift() : null);
    }
    const isTA = opts.mode === 'timeattack';
    const now = Date.now();
    const state = {
      deck: deck,
      field: field,
      discard: [],
      captured: 0,
      stage: 0,
      finished: false,
      lastEvent: null,
      originalSequence: original,
      roundSnapshot: null,
      roundStartedAt: now,
      mode: isTA ? 'timeattack' : 'normal',
      taStartedAt: null,
      taEndsAt: null, // STARTを押すまで null（待機中）
      taClears: 0,
    };
    snapshotRound(state);
    return state;
  }

  function startTimeAttackTimer(state) {
    if (state.mode !== 'timeattack') return false;
    const now = Date.now();
    state.taStartedAt = now;
    state.taEndsAt = now + TIME_ATTACK_MS;
    state.taClears = 0;
    state.roundStartedAt = now;
    state.lastEvent = { type: 'taStart' };
    return true;
  }

  function cloneCard(c) { return c ? { uid: c.uid, value: c.value, weight: c.weight } : null; }
  function cloneCardArr(arr) { return arr.map(cloneCard); }

  function snapshotRound(state) {
    state.roundSnapshot = {
      field: cloneCardArr(state.field),
      deck: state.deck.map(c => ({ uid: c.uid, value: c.value, weight: c.weight })),
      discard: state.discard.slice(),
    };
  }

  function restartRound(state) {
    if (!state.roundSnapshot) return false;
    state.field = cloneCardArr(state.roundSnapshot.field);
    state.deck = state.roundSnapshot.deck.map(c => ({ uid: c.uid, value: c.value, weight: c.weight }));
    state.discard = state.roundSnapshot.discard.slice();
    state.finished = false;
    state.roundStartedAt = Date.now();
    state.lastEvent = { type: 'restartRound' };
    return true;
  }

  function calcOp(a, b, op) {
    switch (op) {
      case '+': return a + b;
      case '-': return Math.max(a, b) - Math.min(a, b);
      case '*': return a * b;
      case '/': {
        const absA = Math.abs(a), absB = Math.abs(b);
        let dividend, divisor;
        if (absA >= absB) { dividend = a; divisor = b; }
        else { dividend = b; divisor = a; }
        if (divisor === 0) return null;
        if (dividend % divisor !== 0) return null;
        return dividend / divisor;
      }
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

  // 場の2セルを合体 → 1セルに（重みは合算）
  function combine(state, uidA, op, uidB) {
    if (state.finished) return { ok: false, error: 'ゲーム終了' };
    if (uidA === uidB) return { ok: false, error: '同じカードは選べません' };
    const ia = state.field.findIndex(c => c && c.uid === uidA);
    const ib = state.field.findIndex(c => c && c.uid === uidB);
    if (ia < 0 || ib < 0) return { ok: false, error: 'カードが見つかりません' };
    const a = state.field[ia];
    const b = state.field[ib];
    const v = calcOp(a.value, b.value, op);
    if (v === null) return { ok: false, error: '整数で計算できません' };
    const result = newCard(v, a.weight + b.weight);
    const lo = Math.min(ia, ib);
    const hi = Math.max(ia, ib);
    state.field[hi] = null;
    state.field[lo] = result;
    state.lastEvent = { type: 'combine', value: v, op: op, weight: result.weight };
    checkEnd(state);
    return { ok: true, result: result };
  }

  // セルを獲得（値=15 かつ 場に残るセルがその1つだけ）
  function captureCell(state, uid) {
    if (state.finished) return { ok: false, error: 'ゲーム終了' };
    const idx = state.field.findIndex(c => c && c.uid === uid);
    if (idx < 0) return { ok: false, error: 'カードが見つかりません' };
    const card = state.field[idx];
    if (card.value !== TARGET) {
      return { ok: false, error: '15ではありません（' + card.value + '）' };
    }
    const otherNonNull = state.field.some((c, i) => c != null && i !== idx);
    if (otherNonNull) {
      return { ok: false, error: '残りのカードもすべて合体させてください' };
    }
    const w = card.weight;
    const elapsedMs = Date.now() - (state.roundStartedAt || Date.now());
    state.field[idx] = null;
    state.captured += w;
    state.stage += 1;
    if (state.mode === 'timeattack') state.taClears += 1;
    refill(state);
    state.roundStartedAt = Date.now();
    snapshotRound(state);
    state.lastEvent = { type: 'capture', weight: w, elapsedMs: elapsedMs };
    checkEnd(state);
    return { ok: true, weight: w, elapsedMs: elapsedMs };
  }

  function isTimeAttackOver(state) {
    return state.mode === 'timeattack' && state.taEndsAt != null && Date.now() >= state.taEndsAt;
  }

  function endTimeAttack(state) {
    state.mode = 'normal';
    state.taEndsAt = null;
  }

  function pass(state, uid) {
    if (state.finished) return false;
    const nonNull = state.field.findIndex(c => c != null);
    if (nonNull < 0) return false;
    const idx = uid
      ? state.field.findIndex(c => c && c.uid === uid)
      : nonNull;
    if (idx < 0) return false;
    const removed = state.field[idx];
    state.field[idx] = null;
    state.discard.push(removed);
    if (state.deck.length > 0) state.field[idx] = state.deck.shift();
    state.lastEvent = { type: 'pass' };
    checkEnd(state);
    return true;
  }

  // ギブアップ：場の全カードを捨てて、新しい5枚を引く（ステージは0に戻る）
  function giveUp(state) {
    if (state.finished) return false;
    for (let i = 0; i < state.field.length; i++) {
      if (state.field[i] != null) {
        state.discard.push(state.field[i]);
        state.field[i] = null;
      }
    }
    refill(state);
    state.stage = 0;
    state.roundStartedAt = Date.now();
    snapshotRound(state);
    state.lastEvent = { type: 'giveUp' };
    checkEnd(state);
    return true;
  }

  function refill(state) {
    for (let i = 0; i < state.field.length; i++) {
      if (state.field[i] == null) {
        if (state.deck.length === 0) {
          // 山札が尽きたら新しい山札を自動でシャッフルして追加（無限デッキ）
          const more = shuffle(buildFullDeck()).map(v => newCard(v, 1));
          for (const c of more) state.deck.push(c);
        }
        if (state.deck.length > 0) state.field[i] = state.deck.shift();
      }
    }
  }

  function checkEnd(state) {
    const allEmpty = state.field.every(c => c == null);
    if (state.deck.length === 0 && allEmpty) {
      state.finished = true;
    }
  }

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
  function loadBestTA() {
    try {
      const v = localStorage.getItem(STORAGE_KEYS.BEST_TA);
      return v ? parseInt(v, 10) || 0 : 0;
    } catch (e) { return 0; }
  }
  function saveBestTA(score) {
    try {
      const cur = loadBestTA();
      if (score > cur) {
        localStorage.setItem(STORAGE_KEYS.BEST_TA, String(score));
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
    createGame, restartGame, restartRound,
    combine, captureCell, pass, giveUp,
    isTimeAttackOver, endTimeAttack, startTimeAttackTimer,
    previews, calcOp,
    loadBestScore, saveBestScore, loadBestTA, saveBestTA,
    incrementGameCount, loadSettings, saveSettings,
    CONSTANTS: { FIELD_SIZE, TARGET, TIME_ATTACK_MS },
  };
})(typeof window !== 'undefined' ? window : globalThis);
