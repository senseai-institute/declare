import { describe, expect, it } from 'vitest';
import {
  allCards,
  applyAction,
  assertIntegrity,
  buildCards,
  createDeckState,
  deal,
  discard,
  draw,
  drawFromDiscard,
  normalizeConfig,
  reshuffleDiscard,
  reset,
  shuffle,
  viewFor,
  type DeckData,
} from './deck.js';

const players = ['p1', 'p2', 'p3', 'p4'];

describe('buildCards', () => {
  it('builds a standard 52-card deck', () => {
    const cards = buildCards({ decks: 1, jokersPerDeck: 0 });
    expect(cards).toHaveLength(52);
    expect(new Set(cards).size).toBe(52);
  });

  it('combines decks and jokers with unique ids', () => {
    const cards = buildCards({ decks: 3, jokersPerDeck: 2 });
    expect(cards).toHaveLength(3 * 54);
    expect(new Set(cards).size).toBe(3 * 54);
  });

  it('validates config', () => {
    expect(() => normalizeConfig({ decks: 0 })).toThrow();
    expect(() => normalizeConfig({ decks: 1, jokersPerDeck: 3 })).toThrow();
    expect(normalizeConfig(undefined)).toEqual({ decks: 1, jokersPerDeck: 0 });
  });
});

describe('shuffle distribution', () => {
  it('produces every permutation of 4 items roughly uniformly', () => {
    const trials = 48_000;
    const counts = new Map<string, number>();
    for (let t = 0; t < trials; t++) {
      const key = shuffle([1, 2, 3, 4]).join('');
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    expect(counts.size).toBe(24);
    const expected = trials / 24;
    // Chi-square with 23 degrees of freedom; p=0.001 critical value ≈ 49.7.
    let chi = 0;
    for (const c of counts.values()) chi += (c - expected) ** 2 / expected;
    expect(chi).toBeLessThan(49.7);
  });

  it('places each card in each position roughly uniformly (52 cards)', () => {
    const trials = 10_000;
    const cards = buildCards({ decks: 1, jokersPerDeck: 0 });
    const index = new Map(cards.map((c, i) => [c, i]));
    const grid = Array.from({ length: 52 }, () => new Array<number>(52).fill(0));
    for (let t = 0; t < trials; t++) {
      shuffle(cards).forEach((c, pos) => grid[index.get(c)!][pos]++);
    }
    const expected = trials / 52; // ≈ 192
    for (const row of grid) {
      for (const n of row) {
        // ~7.5 standard deviations; a biased shuffle (e.g. naive swap) blows well past this.
        expect(Math.abs(n - expected)).toBeLessThan(105);
      }
    }
  });

  it('does not mutate its input', () => {
    const input = [1, 2, 3, 4, 5];
    shuffle(input);
    expect(input).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('deck operations keep every card exactly once', () => {
  it('deal gives each player N cards in seat order', () => {
    const s = deal(createDeckState({ decks: 1, jokersPerDeck: 0 }, players), players, 13);
    for (const p of players) expect(s.hands[p]).toHaveLength(13);
    expect(s.drawPile).toHaveLength(0);
    assertIntegrity(s);
  });

  it('refuses to deal more than the draw pile holds', () => {
    const s = createDeckState({ decks: 1, jokersPerDeck: 0 }, players);
    expect(() => deal(s, players, 14)).toThrow(/Not enough cards/);
  });

  it('only discards cards from the player’s own hand', () => {
    let s = deal(createDeckState({ decks: 1, jokersPerDeck: 0 }, players), players, 5);
    const other = s.hands.p2[0];
    expect(() => discard(s, 'p1', [other])).toThrow();
    s = discard(s, 'p1', [s.hands.p1[0]]);
    expect(s.hands.p1).toHaveLength(4);
    expect(s.discardPile).toHaveLength(1);
    assertIntegrity(s);
  });

  it('survives many random deal/draw/discard/reshuffle cycles', () => {
    for (const config of [
      { decks: 1, jokersPerDeck: 0 },
      { decks: 2, jokersPerDeck: 2 },
    ]) {
      let s: DeckData = createDeckState(config, players);
      for (let cycle = 0; cycle < 50; cycle++) {
        s = reset(s);
        s = deal(s, players, 5);
        for (let turn = 0; turn < 60; turn++) {
          const p = players[turn % players.length];
          if (s.drawPile.length === 0) s = reshuffleDiscard(s);
          if (turn % 5 === 0 && s.discardPile.length > 0) s = drawFromDiscard(s, p);
          else s = draw(s, p);
          const hand = s.hands[p];
          s = discard(s, p, [hand[Math.floor(Math.random() * hand.length)]]);
          assertIntegrity(s);
        }
        expect(allCards(s)).toHaveLength(buildCards(config).length);
      }
    }
  });

  it('reshuffle keeps the top discard and moves the rest under the draw pile', () => {
    let s = deal(createDeckState({ decks: 1, jokersPerDeck: 0 }, players), players, 5);
    s = discard(s, 'p1', s.hands.p1.slice(0, 3));
    const top = s.discardPile.at(-1);
    const drawTop = s.drawPile.at(-1);
    s = reshuffleDiscard(s);
    expect(s.discardPile).toEqual([top]);
    expect(s.drawPile.at(-1)).toBe(drawTop);
    expect(s.drawPile).toHaveLength(32 + 2);
    assertIntegrity(s);
  });

  it('applyAction runs integrity checks and reports errors', () => {
    const s = createDeckState({ decks: 1, jokersPerDeck: 1 }, players);
    const dealt = applyAction(s, { type: 'deal', count: 7 }, 'p1', players);
    expect(dealt.hands.p4).toHaveLength(7);
    expect(() => applyAction(dealt, { type: 'draw_discard' }, 'p1', players)).toThrow(/empty/);
  });
});

describe('viewFor', () => {
  it('exposes only the requesting player’s hand', () => {
    const s = deal(createDeckState({ decks: 1, jokersPerDeck: 0 }, players), players, 5);
    const v = viewFor(s, 'p2', 3);
    expect(v.myHand).toEqual(s.hands.p2);
    expect(v.handCounts).toEqual({ p1: 5, p2: 5, p3: 5, p4: 5 });
    const serialized = JSON.stringify(v);
    for (const card of [...s.hands.p1, ...s.hands.p3, ...s.hands.p4, ...s.drawPile]) {
      expect(serialized).not.toContain(`"${card}"`);
    }
  });

  it('gives spectators no hand at all', () => {
    const s = deal(createDeckState({ decks: 1, jokersPerDeck: 0 }, players), players, 5);
    expect(viewFor(s, 'someone-else', 0).myHand).toBeNull();
  });
});
