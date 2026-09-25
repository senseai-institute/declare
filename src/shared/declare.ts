// Rules of Declare, shared by the server (enforcement) and the client (hints).
//
// Each hand: everyone gets 5 cards. On your turn you either DECLARE, or throw
// a card / set / run onto the pile and then take one card — from the deck or
// from the throw of the player before you. Lowest hand wins.
//
// Scoring when someone declares:
//   - nobody lower than the declarer → declarer 0, everyone else adds their hand
//   - otherwise → declarer adds hand + 20 per player lower; everyone else adds their hand

import { parseCard, RANKS } from './cards.js';

export const HAND_SIZE = 5;
export const PENALTY_PER_LOWER = 20;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;

/** Rank order for runs: A low (A-2-3 is a run, Q-K-A is not). */
export function rankIndex(rank: string): number {
  return RANKS.indexOf(rank as (typeof RANKS)[number]);
}

export function cardPoints(id: string): number {
  const c = parseCard(id);
  if (c.joker) return 0;
  if (c.rank === 'A') return 1;
  if (c.rank === 'J' || c.rank === 'Q' || c.rank === 'K') return 10;
  return Number(c.rank);
}

export function handPoints(cards: readonly string[]): number {
  return cards.reduce((s, c) => s + cardPoints(c), 0);
}

export type ThrowKind = 'single' | 'set' | 'run';

/** What kind of throw these cards make, or null if they aren't a legal throw. */
export function classifyThrow(cards: readonly string[]): ThrowKind | null {
  if (cards.length === 0 || new Set(cards).size !== cards.length) return null;
  if (cards.length === 1) return 'single';
  const ranks = cards.map((c) => parseCard(c).rank);
  if (ranks.some((r) => r === 'JK')) return null;
  if (ranks.every((r) => r === ranks[0])) return 'set';
  if (cards.length < 3) return null;
  const idx = ranks.map(rankIndex).sort((a, b) => a - b);
  for (let i = 1; i < idx.length; i++) if (idx[i] !== idx[i - 1] + 1) return null;
  return 'run';
}

/** Cards in low→high order (runs are displayed and stored this way). */
export function sortByRank(cards: readonly string[]): string[] {
  return [...cards].sort((a, b) => rankIndex(parseCard(a).rank) - rankIndex(parseCard(b).rank) || a.localeCompare(b));
}

/**
 * Which cards of the previous throw may be taken: any card of a single/set,
 * but only the ends of a run (taking the middle would break it).
 */
export function takeableFrom(throwCards: readonly string[]): string[] {
  const kind = classifyThrow(throwCards);
  if (kind !== 'run') return [...throwCards];
  const sorted = sortByRank(throwCards);
  return [sorted[0], sorted[sorted.length - 1]];
}

export interface HandOutcome {
  declarerId: string;
  handPoints: Record<string, number>;
  lowerCount: number;
  success: boolean;
  scores: Record<string, number>;
}

/** Score a declared hand. `points` maps every player to their hand total. */
export function scoreDeclare(declarerId: string, points: Record<string, number>): HandOutcome {
  if (!(declarerId in points)) throw new Error('Declarer is not in this hand');
  const mine = points[declarerId];
  const lowerCount = Object.entries(points).filter(([id, p]) => id !== declarerId && p < mine).length;
  const success = lowerCount === 0;
  const scores: Record<string, number> = {};
  for (const [id, p] of Object.entries(points)) {
    scores[id] = id === declarerId ? (success ? 0 : p + PENALTY_PER_LOWER * lowerCount) : p;
  }
  return { declarerId, handPoints: { ...points }, lowerCount, success, scores };
}
