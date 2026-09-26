import { describe, expect, it } from 'vitest';
import { scoreUnoRound } from '../shared/uno.js';
import { computeStandings, computeTotals, leader, placesFor, targetReached } from './scoring.js';

describe('scoring', () => {
  const rounds = [
    { entries: [{ playerId: 'a', points: 10 }, { playerId: 'b', points: -5 }, { playerId: 'c', points: 3 }] },
    { entries: [{ playerId: 'a', points: 5 }, { playerId: 'b', points: 20 }, { playerId: 'c', points: 12 }] },
  ];

  it('totals rounds including negative points', () => {
    expect(Object.fromEntries(computeTotals(['a', 'b', 'c'], rounds))).toEqual({ a: 15, b: 15, c: 15 });
  });

  it('ranks by scoring mode with shared places', () => {
    const totals = new Map([['a', 30], ['b', 10], ['c', 10]]);
    expect(Object.fromEntries(placesFor(totals, 'high_wins'))).toEqual({ a: 1, b: 2, c: 2 });
    expect(Object.fromEntries(placesFor(totals, 'low_wins'))).toEqual({ a: 3, b: 1, c: 1 });
    expect(leader(totals, 'high_wins')).toBe('a');
    expect(leader(totals, 'low_wins')).toBeNull();
  });

  it('detects target', () => {
    expect(targetReached(new Map([['a', 99]]), 100)).toBe(false);
    expect(targetReached(new Map([['a', 100]]), 100)).toBe(true);
    expect(targetReached(new Map([['a', 500]]), null)).toBe(false);
  });

  it('builds standings with session titles', () => {
    const names = new Map([['a', 'Ann'], ['b', 'Bo']]);
    const rows = computeStandings(
      [
        { sessionId: 's1', gameType: 'Hearts', winnerPlayerId: 'a', places: new Map([['a', 1], ['b', 2]]) },
        { sessionId: 's1', gameType: 'Hearts', winnerPlayerId: 'a', places: new Map([['a', 1], ['b', 2]]) },
        { sessionId: 's2', gameType: 'Rummy', winnerPlayerId: 'b', places: new Map([['a', 2], ['b', 1]]) },
      ],
      names,
      { sessionStats: true },
    );
    expect(rows[0]).toMatchObject({ playerId: 'a', wins: 2, played: 3, sessions: 2, sessionTitles: 1 });
    expect(rows[1]).toMatchObject({ playerId: 'b', wins: 1, sessionTitles: 1, avgPlace: 1.67 });
  });
});

describe('UNO scoring', () => {
  it('gives the player who went out everyone else’s card points', () => {
    const r = scoreUnoRound('a', { a: 999, b: 27, c: 70, d: 0 });
    expect(r.scores).toEqual({ a: 97, b: 0, c: 0, d: 0 });
  });
  it('rejects bad input', () => {
    expect(() => scoreUnoRound('x', { a: 1 })).toThrow();
    expect(() => scoreUnoRound('a', { a: 0, b: -3 })).toThrow();
  });
});
