// evaluator.js — 四則演算の判定（eval禁止）
// トークン列を Shunting-yard で逆ポーランド記法に変換し、整数のみで評価する。
//
// トークン形式:
//   { type: 'num',    value: number, cardId?: string }
//   { type: 'op',     value: '+' | '-' | '*' | '/' }
//   { type: 'lparen' }
//   { type: 'rparen' }
(function (global) {
  'use strict';

  const PRECEDENCE = { '+': 1, '-': 1, '*': 2, '/': 2 };

  function toRPN(tokens) {
    const out = [];
    const stack = [];
    for (let k = 0; k < tokens.length; k++) {
      const t = tokens[k];
      if (t.type === 'num') {
        out.push(t);
      } else if (t.type === 'op') {
        while (stack.length) {
          const top = stack[stack.length - 1];
          if (top.type === 'op' && PRECEDENCE[top.value] >= PRECEDENCE[t.value]) {
            out.push(stack.pop());
          } else break;
        }
        stack.push(t);
      } else if (t.type === 'lparen') {
        stack.push(t);
      } else if (t.type === 'rparen') {
        let matched = false;
        while (stack.length) {
          const top = stack.pop();
          if (top.type === 'lparen') { matched = true; break; }
          out.push(top);
        }
        if (!matched) throw new Error('括弧が一致しません');
      } else {
        throw new Error('不明なトークンです');
      }
    }
    while (stack.length) {
      const top = stack.pop();
      if (top.type === 'lparen' || top.type === 'rparen') {
        throw new Error('括弧が一致しません');
      }
      out.push(top);
    }
    return out;
  }

  function evalRPN(rpn) {
    const stack = [];
    for (let k = 0; k < rpn.length; k++) {
      const t = rpn[k];
      if (t.type === 'num') { stack.push(t.value); continue; }
      if (stack.length < 2) throw new Error('式が不正です');
      const b = stack.pop();
      const a = stack.pop();
      let r;
      switch (t.value) {
        case '+': r = a + b; break;
        case '-': r = a - b; break;
        case '*': r = a * b; break;
        case '/':
          if (b === 0) throw new Error('0で割ることはできません');
          if (a % b !== 0) throw new Error('割り切れません（整数解のみ有効）');
          r = a / b;
          break;
        default: throw new Error('不明な演算子です');
      }
      if (!Number.isInteger(r)) throw new Error('整数解のみ有効です');
      stack.push(r);
    }
    if (stack.length !== 1) throw new Error('式が不正です');
    return stack[0];
  }

  function validateSyntax(tokens) {
    if (tokens.length === 0) return { ok: false, error: '式が空です' };
    let depth = 0;
    let prev = null;
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (t.type === 'num') {
        if (prev && (prev.type === 'num' || prev.type === 'rparen')) {
          return { ok: false, error: '数字の前に演算子が必要です' };
        }
      } else if (t.type === 'op') {
        if (!prev || prev.type === 'op' || prev.type === 'lparen') {
          return { ok: false, error: '演算子の位置が不正です' };
        }
      } else if (t.type === 'lparen') {
        if (prev && (prev.type === 'num' || prev.type === 'rparen')) {
          return { ok: false, error: '「(」の前に演算子が必要です' };
        }
        depth++;
      } else if (t.type === 'rparen') {
        if (!prev || prev.type === 'op' || prev.type === 'lparen') {
          return { ok: false, error: '「)」の位置が不正です' };
        }
        depth--;
        if (depth < 0) return { ok: false, error: '括弧が一致しません' };
      }
      prev = t;
    }
    if (depth !== 0) return { ok: false, error: '括弧が閉じていません' };
    if (prev && (prev.type === 'op' || prev.type === 'lparen')) {
      return { ok: false, error: '式が完結していません' };
    }
    return { ok: true };
  }

  function judge(tokens, target) {
    if (target == null) target = 15;
    const syn = validateSyntax(tokens);
    if (!syn.ok) return { ok: false, error: syn.error };
    let value;
    try {
      const rpn = toRPN(tokens);
      value = evalRPN(rpn);
    } catch (e) {
      return { ok: false, error: e.message };
    }
    if (value !== target) {
      return { ok: false, error: '結果は ' + value + ' です（' + target + ' ではありません）', value: value };
    }
    const usedCardIds = [];
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (t.type === 'num' && t.cardId != null) usedCardIds.push(t.cardId);
    }
    const seen = new Set();
    for (const id of usedCardIds) {
      if (seen.has(id)) return { ok: false, error: '同じカードを2回は使えません' };
      seen.add(id);
    }
    return { ok: true, value: value, usedCardIds: usedCardIds };
  }

  global.M15 = global.M15 || {};
  global.M15.Evaluator = { toRPN, evalRPN, validateSyntax, judge };
})(typeof window !== 'undefined' ? window : globalThis);
