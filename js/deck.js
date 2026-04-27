// deck.js — カードデッキの生成とシャッフル
(function (global) {
  'use strict';

  const SPECIAL_CARD = 15;

  function buildFullDeck() {
    const deck = [];
    for (let n = 1; n <= 12; n++) deck.push(n, n);
    for (let n = 13; n <= 31; n++) deck.push(n);
    return deck;
  }

  function buildPlayDeck() {
    const full = buildFullDeck();
    const idx = full.indexOf(SPECIAL_CARD);
    if (idx >= 0) full.splice(idx, 1);
    return full;
  }

  function shuffle(arr, rng) {
    rng = rng || Math.random;
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  }

  global.M15 = global.M15 || {};
  global.M15.Deck = { SPECIAL_CARD, buildFullDeck, buildPlayDeck, shuffle };
})(typeof window !== 'undefined' ? window : globalThis);
