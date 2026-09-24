import { randomInt } from 'node:crypto';
import { RANKS, SUITS, type DeckConfig, type DeckView } from '../shared/cards.js';

/** Stored in DeckState.state. Hands are keyed by player id. */
export interface DeckData {
  config: DeckConfig;
  drawPile: string[]; // last element is the top card
  discardPile: string[]; // last element is the top card
  hands: Record<string, string[]>;
}

export class DeckError extends Error {}

export type RandomInt = (maxExclusive: number) => number;
const cryptoRandom: RandomInt = (max) => randomInt(max);

export const MAX_DECKS = 8;

export function normalizeConfig(config: Partial<DeckConfig> | undefined): DeckConfig {
  const decks = Math.trunc(config?.decks ?? 1);
  const jokersPerDeck = Math.trunc(config?.jokersPerDeck ?? 0);
  if (!(decks >= 1 && decks <= MAX_DECKS)) throw new DeckError(`Decks must be between 1 and ${MAX_DECKS}`);
  if (!(jokersPerDeck >= 0 && jokersPerDeck <= 2)) throw new DeckError('Jokers per deck must be 0, 1 or 2');
  return { decks, jokersPerDeck };
}

export function buildCards(config: DeckConfig): string[] {
  const cards: string[] = [];
  for (let d = 0; d < config.decks; d++) {
    for (const suit of SUITS) for (const rank of RANKS) cards.push(`${d}-${rank}${suit}`);
    for (let j = 1; j <= config.jokersPerDeck; j++) cards.push(`${d}-JK${j}`);
  }
  return cards;
}

/** Fisher–Yates shuffle using a cryptographically secure RNG. Returns a new array. */
export function shuffle<T>(items: readonly T[], rand: RandomInt = cryptoRandom): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function createDeckState(config: DeckConfig, playerIds: string[], rand?: RandomInt): DeckData {
  return {
    config,
    drawPile: shuffle(buildCards(config), rand),
    discardPile: [],
    hands: Object.fromEntries(playerIds.map((id) => [id, []])),
  };
}

function clone(s: DeckData): DeckData {
  return {
    config: { ...s.config },
    drawPile: s.drawPile.slice(),
    discardPile: s.discardPile.slice(),
    hands: Object.fromEntries(Object.entries(s.hands).map(([k, v]) => [k, v.slice()])),
  };
}

function handOf(s: DeckData, playerId: string): string[] {
  const hand = s.hands[playerId];
  if (!hand) throw new DeckError('Player is not in this game');
  return hand;
}

function count(n: unknown, min: number, max: number, label: string): number {
  const v = Number(n);
  if (!Number.isInteger(v) || v < min || v > max) throw new DeckError(`${label} must be between ${min} and ${max}`);
  return v;
}

/** Shuffle the draw pile in place (hands and discard untouched). */
export function shuffleDraw(s: DeckData, rand?: RandomInt): DeckData {
  const next = clone(s);
  next.drawPile = shuffle(next.drawPile, rand);
  return next;
}

/** Deal `n` cards to each player, one at a time in seat order. */
export function deal(s: DeckData, playerIds: string[], n: number): DeckData {
  const per = count(n, 1, 52 * MAX_DECKS, 'Cards per player');
  if (playerIds.length === 0) throw new DeckError('No players to deal to');
  const need = per * playerIds.length;
  if (need > s.drawPile.length) {
    throw new DeckError(`Not enough cards: need ${need}, draw pile has ${s.drawPile.length}`);
  }
  const next = clone(s);
  for (let r = 0; r < per; r++) {
    for (const pid of playerIds) handOf(next, pid).push(next.drawPile.pop()!);
  }
  return next;
}

export function draw(s: DeckData, playerId: string, n = 1): DeckData {
  const k = count(n, 1, 52 * MAX_DECKS, 'Cards to draw');
  if (k > s.drawPile.length) {
    throw new DeckError(
      s.drawPile.length === 0 ? 'Draw pile is empty — reshuffle the discard pile' : `Only ${s.drawPile.length} cards left`,
    );
  }
  const next = clone(s);
  const hand = handOf(next, playerId);
  for (let i = 0; i < k; i++) hand.push(next.drawPile.pop()!);
  return next;
}

/** Take the top card of the discard pile into the player's hand. */
export function drawFromDiscard(s: DeckData, playerId: string): DeckData {
  if (s.discardPile.length === 0) throw new DeckError('Discard pile is empty');
  const next = clone(s);
  handOf(next, playerId).push(next.discardPile.pop()!);
  return next;
}

/** Move cards from a player's own hand onto the discard pile (in the given order). */
export function discard(s: DeckData, playerId: string, cardIds: string[]): DeckData {
  if (!Array.isArray(cardIds) || cardIds.length === 0) throw new DeckError('Pick at least one card');
  if (new Set(cardIds).size !== cardIds.length) throw new DeckError('Duplicate cards in discard');
  const next = clone(s);
  const hand = handOf(next, playerId);
  for (const id of cardIds) {
    const idx = hand.indexOf(id);
    if (idx === -1) throw new DeckError('You can only discard cards from your own hand');
    hand.splice(idx, 1);
    next.discardPile.push(id);
  }
  return next;
}

/**
 * Shuffle the discard pile back into the draw pile. By default the top discard
 * stays face up; the rest is shuffled and placed under the remaining draw pile.
 */
export function reshuffleDiscard(s: DeckData, keepTop = true, rand?: RandomInt): DeckData {
  const next = clone(s);
  const top = keepTop ? next.discardPile.pop() : undefined;
  if (next.discardPile.length === 0) {
    if (top !== undefined) next.discardPile.push(top);
    throw new DeckError('Nothing to reshuffle');
  }
  next.drawPile = [...shuffle(next.discardPile, rand), ...next.drawPile];
  next.discardPile = top !== undefined ? [top] : [];
  return next;
}

/** Collect every card, clear hands and discard, and shuffle a fresh draw pile. */
export function reset(s: DeckData, rand?: RandomInt): DeckData {
  return createDeckState(s.config, Object.keys(s.hands), rand);
}

/** Every card in the state, wherever it is. */
export function allCards(s: DeckData): string[] {
  return [...s.drawPile, ...s.discardPile, ...Object.values(s.hands).flat()];
}

/** Throws if any card is duplicated or missing relative to the configured deck. */
export function assertIntegrity(s: DeckData): void {
  const expected = buildCards(s.config).sort();
  const actual = allCards(s).sort();
  if (expected.length !== actual.length || expected.some((c, i) => c !== actual[i])) {
    throw new DeckError('Deck integrity check failed');
  }
}

/** The only shape of deck data that should ever leave the server. */
export function viewFor(s: DeckData, playerId: string | null, version: number): DeckView {
  return {
    config: s.config,
    drawCount: s.drawPile.length,
    discardCount: s.discardPile.length,
    discardTop: s.discardPile.at(-1) ?? null,
    myHand: playerId && s.hands[playerId] ? s.hands[playerId].slice() : null,
    handCounts: Object.fromEntries(Object.entries(s.hands).map(([k, v]) => [k, v.length])),
    version,
  };
}

export type DeckAction =
  | { type: 'shuffle' }
  | { type: 'deal'; count: number }
  | { type: 'draw'; count?: number }
  | { type: 'draw_discard' }
  | { type: 'discard'; cards: string[] }
  | { type: 'reshuffle'; keepTop?: boolean }
  | { type: 'reset' };

/** Apply an action on behalf of `playerId`. Seat order is used for dealing. */
export function applyAction(s: DeckData, action: DeckAction, playerId: string, seatOrder: string[]): DeckData {
  let next: DeckData;
  switch (action.type) {
    case 'shuffle':
      next = shuffleDraw(s);
      break;
    case 'deal':
      next = deal(s, seatOrder, action.count);
      break;
    case 'draw':
      next = draw(s, playerId, action.count ?? 1);
      break;
    case 'draw_discard':
      next = drawFromDiscard(s, playerId);
      break;
    case 'discard':
      next = discard(s, playerId, action.cards);
      break;
    case 'reshuffle':
      next = reshuffleDiscard(s, action.keepTop ?? true);
      break;
    case 'reset':
      next = reset(s);
      break;
    default:
      throw new DeckError('Unknown deck action');
  }
  assertIntegrity(next);
  return next;
}
