// game.js — ゲーム進行ロジック
(function (global) {
  'use strict';

  const { buildPlayDeck, shuffle, SPECIAL_CARD } = global.M15.Deck;
  const { judge } = global.M15.Evaluator;

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
    const deck = shuffle(buildPlayDeck()).map(newCard);
    const field = [];
    for (let i = 0; i < FIELD_SIZE; i++) {
      if (deck.length) field.push(deck.shift());
    }
    return {
      deck: deck,
      field: field,
      discard: [],
      expression: [],
      captured: 0,
      bonusEarned: false,
      finished: false,
      lastResult: null,
    };
  }

  function lastToken(state) {
    return state.expression.length > 0 ? state.expression[state.expression.length - 1] : null;
  }

  function isCardInExpression(state, cardUid) {
    return state.expression.some(t => t.type === 'num' && t.cardId === cardUid);
  }

  function canAddCard(state, cardUid) {
    if (state.finished) return false;
    if (isCardInExpression(state, cardUid)) return false;
    const prev = lastToken(state);
    if (prev && (prev.type === 'num' || prev.type === 'rparen')) return false;
    return true;
  }

  function canAddOp(state, op) {
    if (state.finished) return false;
    const prev = lastToken(state);
    if (op === '(') {
      if (prev && (prev.type === 'num' || prev.type === 'rparen')) return false;
      return true;
    }
    if (op === ')') {
      if (!prev || prev.type === 'op' || prev.type === 'lparen') return false;
      let depth = 0;
      for (const t of state.expression) {
        if (t.type === 'lparen') depth++;
        else if (t.type === 'rparen') depth--;
      }
      return depth > 0;
    }
    if (!prev) return false;
    if (prev.type === 'op' || prev.type === 'lparen') return false;
    return true;
  }

  function addCard(state, card) {
    if (!canAddCard(state, card.uid)) return false;
    state.expression.push({ type: 'num', value: card.value, cardId: card.uid });
    return true;
  }

  function addOp(state, op) {
    if (!canAddOp(state, op)) return false;
    if (op === '(') state.expression.push({ type: 'lparen' });
    else if (op === ')') state.expression.push({ type: 'rparen' });
    else state.expression.push({ type: 'op', value: op });
    return true;
  }

  function backspace(state) {
    if (state.expression.length === 0) return false;
    state.expression.pop();
    return true;
  }

  function clearExpression(state) {
    state.expression = [];
  }

  function refill(state) {
    while (state.field.length < FIELD_SIZE && state.deck.length > 0) {
      state.field.push(state.deck.shift());
    }
  }

  function checkEnd(state) {
    if (state.deck.length === 0 && state.field.length === 0) {
      state.finished = true;
    }
  }

  function submit(state) {
    if (state.finished) return { ok: false, error: 'ゲームは終了しています' };
    const result = judge(state.expression, TARGET);
    state.lastResult = result;
    if (!result.ok) return result;
    const usedSet = new Set(result.usedCardIds);
    const usedCount = usedSet.size;
    state.field = state.field.filter(c => !usedSet.has(c.uid));
    state.captured += usedCount;
    if (usedCount === FIELD_SIZE && !state.bonusEarned) {
      state.bonusEarned = true;
      state.captured += 1;
    }
    refill(state);
    state.expression = [];
    checkEnd(state);
    return result;
  }

  function pass(state, cardUid) {
    if (state.finished) return false;
    if (state.field.length === 0) return false;
    const idx = cardUid
      ? state.field.findIndex(c => c.uid === cardUid)
      : 0;
    if (idx < 0) return false;
    const removed = state.field.splice(idx, 1)[0];
    state.discard.push(removed);
    if (state.deck.length > 0) state.field.push(state.deck.shift());
    state.expression = [];
    checkEnd(state);
    return true;
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
    createGame, canAddCard, canAddOp, addCard, addOp, backspace, clearExpression,
    isCardInExpression, submit, pass,
    loadBestScore, saveBestScore, incrementGameCount, loadSettings, saveSettings,
    CONSTANTS: { FIELD_SIZE, TARGET, SPECIAL_CARD },
  };
})(typeof window !== 'undefined' ? window : globalThis);
