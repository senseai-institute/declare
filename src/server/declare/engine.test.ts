import { describe, expect, it } from 'vitest';
import { classifyThrow, scoreDeclare, takeableFrom, cardPoints, handPoints } from '../../shared/declare.js';
import { chooseMove, legalThrows } from './bot.js';
import { assertDeclareIntegrity, currentPlayer, dealHand, declare, declareViewFor, newMatch, playTurn, RuleError, type DeclareState } from './engine.js';

describe('Declare rules', () => {
  it('values cards: ace 1, faces 10', () => {
    expect(cardPoints('0-AS')).toBe(1);
    expect(cardPoints('0-7H')).toBe(7);
    expect(cardPoints('0-10D')).toBe(10);
    expect(['0-JC', '0-QC', '0-KC'].map(cardPoints)).toEqual([10, 10, 10]);
    expect(handPoints(['0-AS', '0-KD', '0-3C'])).toBe(14);
  });

  it('classifies throws', () => {
    expect(classifyThrow(['0-7H'])).toBe('single');
    expect(classifyThrow(['0-7H', '0-7S'])).toBe('set');
    expect(classifyThrow(['0-7H', '0-7S', '0-7D'])).toBe('set');
    expect(classifyThrow(['0-7H', '0-8S', '0-9D'])).toBe('run'); // suits may differ
    expect(classifyThrow(['0-AH', '0-2S', '0-3D'])).toBe('run');
    expect(classifyThrow(['0-10H', '0-JS', '0-QD', '0-KC'])).toBe('run');
    expect(classifyThrow(['0-QH', '0-KS', '0-AD'])).toBeNull(); // ace is low only
    expect(classifyThrow(['0-7H', '0-8S'])).toBeNull(); // runs need 3
    expect(classifyThrow(['0-7H', '0-9S', '0-10D'])).toBeNull();
    expect(classifyThrow([])).toBeNull();
  });

  it('only offers the ends of a run', () => {
    expect(takeableFrom(['0-9D', '0-7H', '0-8S']).sort()).toEqual(['0-7H', '0-9D']);
    expect(takeableFrom(['0-7H', '0-7S']).sort()).toEqual(['0-7H', '0-7S']);
  });

  it('scores a good declare: declarer 0, others add their hands', () => {
    const r = scoreDeclare('a', { a: 4, b: 9, c: 4 });
    expect(r.success).toBe(true); // a tie isn't "lower"
    expect(r.scores).toEqual({ a: 0, b: 9, c: 4 });
  });

  it('scores a failed declare: hand + 20 per lower player', () => {
    const r = scoreDeclare('a', { a: 8, b: 3, c: 5, d: 12 });
    expect(r.success).toBe(false);
    expect(r.lowerCount).toBe(2);
    expect(r.scores).toEqual({ a: 48, b: 3, c: 5, d: 12 });
  });
});

describe('Declare engine', () => {
  const players = ['a', 'b', 'c'];

  it('deals 5 each and flips one card', () => {
    const s = newMatch(players);
    for (const p of players) expect(s.hands[p]).toHaveLength(5);
    expect(s.lastThrow?.cards).toHaveLength(1);
    expect(s.drawPile).toHaveLength(52 - 15 - 1);
    expect(currentPlayer(s)).toBe('a');
    assertDeclareIntegrity(s);
  });

  it('enforces turns and legal throws', () => {
    const s = newMatch(players);
    expect(() => playTurn(s, 'b', [s.hands.b[0]], 'deck')).toThrow(RuleError);
    expect(() => playTurn(s, 'a', [s.hands.b[0]], 'deck')).toThrow(RuleError);
    expect(() => playTurn(s, 'a', [s.hands.a[0]], s.drawPile[0])).toThrow(RuleError);
    const next = playTurn(s, 'a', [s.hands.a[0]], s.lastThrow!.cards[0]);
    expect(next.hands.a).toContain(s.lastThrow!.cards[0]);
    expect(currentPlayer(next)).toBe('b');
    expect(next.lastThrow).toEqual({ playerId: 'a', cards: [s.hands.a[0]] });
    assertDeclareIntegrity(next);
  });

  it('rotates the first player each hand', () => {
    let s = newMatch(players);
    s = declare(s, 'a').state;
    s = dealHand(s);
    expect(s.handNumber).toBe(2);
    expect(currentPlayer(s)).toBe('b');
  });

  it('reshuffles buried throws when the deck runs out', () => {
    let s: DeclareState = newMatch(['a', 'b']);
    for (let i = 0; i < 200; i++) {
      const p = currentPlayer(s);
      s = playTurn(s, p, [s.hands[p][0]], 'deck');
      assertDeclareIntegrity(s);
    }
  });

  it('never shows other players’ cards in a view', () => {
    const s = newMatch(players);
    const v = JSON.stringify(declareViewFor(s, 'b', 0));
    for (const c of [...s.hands.a, ...s.hands.c, ...s.drawPile]) expect(v).not.toContain(`"${c}"`);
    expect(declareViewFor(s, 'b', 0).myHand).toEqual(s.hands.b);
  });

  it('bot only ever makes legal moves', () => {
    let s = newMatch(['a', 'b', 'c', 'd']);
    for (let i = 0; i < 500; i++) {
      const p = currentPlayer(s);
      const m = chooseMove({ hand: s.hands[p], takeable: takeableFrom(s.lastThrow!.cards), opponentCounts: [5, 5, 5], turnsThisHand: s.turnInHand, playerCount: 4 });
      if (m.type === 'declare') s = dealHand(declare(s, p).state);
      else s = playTurn(s, p, m.cards, m.take);
      assertDeclareIntegrity(s);
    }
    expect(legalThrows(['0-7H', '0-8S', '0-9D']).length).toBe(3 + 1);
  });
});
