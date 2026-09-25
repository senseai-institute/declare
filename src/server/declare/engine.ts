// Server-side state machine for an online game of Declare. Pure functions:
// every action returns a new state and never mutates its input.

import { buildCards, shuffle, type RandomInt } from '../deck.js';
import {
  classifyThrow,
  HAND_SIZE,
  handPoints,
  MAX_PLAYERS,
  MIN_PLAYERS,
  scoreDeclare,
  sortByRank,
  takeableFrom,
  type HandOutcome,
} from '../../shared/declare.js';

export class RuleError extends Error {}

export interface LogEntry {
  at: number;
  playerId: string;
  type: 'throw' | 'declare';
  cards?: string[];
  /** Card taken from the previous throw, or 'deck' (the card stays hidden). */
  took?: string;
  auto?: boolean;
  success?: boolean;
}

export interface HandResult extends HandOutcome {
  handNumber: number;
  hands: Record<string, string[]>;
  auto?: boolean;
}

export interface DeclareState {
  kind: 'declare';
  players: string[]; // seat order
  handNumber: number;
  turnIdx: number;
  turnInHand: number;
  drawPile: string[]; // last = top
  buried: string[]; // older throws, reshuffled when the deck runs out
  lastThrow: { playerId: string | null; cards: string[] } | null;
  hands: Record<string, string[]>;
  /** Auto-play for a player who hasn't moved within this many seconds. */
  turnSeconds: number | null;
  turnDeadline: number | null;
  log: LogEntry[];
  lastResult: HandResult | null;
  over: boolean;
}

const LOG_SIZE = 12;

export function newMatch(
  players: string[],
  opts: { turnSeconds?: number | null } = {},
  now = Date.now(),
  rand?: RandomInt,
): DeclareState {
  if (new Set(players).size !== players.length) throw new RuleError('Duplicate players');
  if (players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) {
    throw new RuleError(`Declare needs ${MIN_PLAYERS}–${MAX_PLAYERS} players`);
  }
  const base: DeclareState = {
    kind: 'declare',
    players: [...players],
    handNumber: 0,
    turnIdx: 0,
    turnInHand: 0,
    drawPile: [],
    buried: [],
    lastThrow: null,
    hands: {},
    turnSeconds: opts.turnSeconds ?? null,
    turnDeadline: null,
    log: [],
    lastResult: null,
    over: false,
  };
  return dealHand(base, now, rand);
}

/** Shuffle a fresh deck, deal 5 each, flip one card to start the pile. The first seat rotates each hand. */
export function dealHand(s: DeclareState, now = Date.now(), rand?: RandomInt): DeclareState {
  const drawPile = shuffle(buildCards({ decks: 1, jokersPerDeck: 0 }), rand);
  const n = s.players.length;
  const starter = s.handNumber % n; // hand 1 → seat 0, hand 2 → seat 1, …
  const hands: Record<string, string[]> = Object.fromEntries(s.players.map((p) => [p, []]));
  for (let r = 0; r < HAND_SIZE; r++) {
    for (let i = 0; i < n; i++) hands[s.players[(starter + i) % n]].push(drawPile.pop()!);
  }
  const flipped = drawPile.pop()!;
  return {
    ...s,
    handNumber: s.handNumber + 1,
    turnIdx: starter,
    turnInHand: 0,
    drawPile,
    buried: [],
    lastThrow: { playerId: null, cards: [flipped] },
    hands,
    turnDeadline: s.turnSeconds ? now + s.turnSeconds * 1000 : null,
  };
}

export function currentPlayer(s: DeclareState): string {
  return s.players[s.turnIdx];
}

function requireTurn(s: DeclareState, playerId: string) {
  if (s.over) throw new RuleError('The game is over');
  if (!(playerId in s.hands)) throw new RuleError('You are not in this game');
  if (currentPlayer(s) !== playerId) throw new RuleError('It’s not your turn');
}

function pushLog(log: LogEntry[], e: LogEntry): LogEntry[] {
  return [...log, e].slice(-LOG_SIZE);
}

/** Throw `cards` and take one card: `take` is 'deck' or a card from the previous throw. */
export function playTurn(
  s: DeclareState,
  playerId: string,
  cards: string[],
  take: string,
  opts: { now?: number; rand?: RandomInt; auto?: boolean } = {},
): DeclareState {
  requireTurn(s, playerId);
  const now = opts.now ?? Date.now();
  if (!Array.isArray(cards) || cards.some((c) => typeof c !== 'string')) throw new RuleError('Pick cards to throw');
  const hand = s.hands[playerId];
  if (cards.some((c) => !hand.includes(c))) throw new RuleError('You can only throw cards from your hand');
  if (!classifyThrow(cards)) throw new RuleError('Throw one card, a set of the same rank, or a run of 3+');

  const prev = s.lastThrow?.cards ?? [];
  let drawPile = s.drawPile;
  let buried = s.buried;
  let taken: string;

  if (take === 'deck') {
    if (drawPile.length === 0) {
      if (buried.length === 0) throw new RuleError('The deck is empty — take from the throw');
      drawPile = shuffle(buried, opts.rand);
      buried = [];
    }
    drawPile = drawPile.slice();
    taken = drawPile.pop()!;
    buried = [...buried, ...prev];
  } else {
    if (!takeableFrom(prev).includes(take)) throw new RuleError('You can only take a card from the previous throw');
    taken = take;
    buried = [...buried, ...prev.filter((c) => c !== take)];
  }

  const newHand = [...hand.filter((c) => !cards.includes(c)), taken];
  const next: DeclareState = {
    ...s,
    drawPile,
    buried,
    lastThrow: { playerId, cards: sortByRank(cards) },
    hands: { ...s.hands, [playerId]: newHand },
    turnIdx: (s.turnIdx + 1) % s.players.length,
    turnInHand: s.turnInHand + 1,
    turnDeadline: s.turnSeconds ? now + s.turnSeconds * 1000 : null,
    log: pushLog(s.log, {
      at: now,
      playerId,
      type: 'throw',
      cards: sortByRank(cards),
      took: take === 'deck' ? 'deck' : take,
      ...(opts.auto ? { auto: true } : {}),
    }),
  };
  return next;
}

/**
 * Declare on your turn. Returns the finished hand's outcome and the state with
 * the result recorded; call `dealHand` to continue (unless the match is over).
 */
export function declare(
  s: DeclareState,
  playerId: string,
  opts: { now?: number; auto?: boolean } = {},
): { state: DeclareState; result: HandResult } {
  requireTurn(s, playerId);
  const now = opts.now ?? Date.now();
  const points = Object.fromEntries(s.players.map((p) => [p, handPoints(s.hands[p])]));
  const result: HandResult = {
    ...scoreDeclare(playerId, points),
    handNumber: s.handNumber,
    hands: Object.fromEntries(s.players.map((p) => [p, sortByRank(s.hands[p])])),
    ...(opts.auto ? { auto: true } : {}),
  };
  return {
    result,
    state: {
      ...s,
      lastResult: result,
      turnDeadline: null,
      log: pushLog(s.log, {
        at: now,
        playerId,
        type: 'declare',
        success: result.success,
        ...(opts.auto ? { auto: true } : {}),
      }),
    },
  };
}

/** Every card exactly once, hand sizes sane, turn pointer valid. Throws if not. */
export function assertDeclareIntegrity(s: DeclareState): void {
  const all = [...s.drawPile, ...s.buried, ...(s.lastThrow?.cards ?? []), ...Object.values(s.hands).flat()];
  const expected = buildCards({ decks: 1, jokersPerDeck: 0 });
  if (all.length !== expected.length || new Set(all).size !== all.length) {
    throw new Error(`Card integrity failed: ${all.length} cards, ${new Set(all).size} unique`);
  }
  const set = new Set(all);
  for (const c of expected) if (!set.has(c)) throw new Error(`Missing card ${c}`);
  for (const p of s.players) {
    const n = s.hands[p]?.length ?? -1;
    if (n < 1 || n > HAND_SIZE) throw new Error(`Bad hand size ${n} for ${p}`);
  }
  if (s.turnIdx < 0 || s.turnIdx >= s.players.length) throw new Error('Bad turn index');
}

export interface DeclareView {
  kind: 'declare';
  players: string[];
  handNumber: number;
  turnPlayerId: string | null;
  turnDeadline: number | null;
  turnSeconds: number | null;
  drawCount: number;
  lastThrow: { playerId: string | null; cards: string[]; takeable: string[] } | null;
  myHand: string[] | null;
  handCounts: Record<string, number>;
  log: LogEntry[];
  lastResult: HandResult | null;
  over: boolean;
  version: number;
}

/** The only shape of Declare state that leaves the server: your own hand, everyone's counts. */
export function declareViewFor(s: DeclareState, playerId: string | null, version: number): DeclareView {
  return {
    kind: 'declare',
    players: s.players,
    handNumber: s.handNumber,
    turnPlayerId: s.over ? null : currentPlayer(s),
    turnDeadline: s.turnDeadline,
    turnSeconds: s.turnSeconds,
    drawCount: s.drawPile.length + s.buried.length,
    lastThrow: s.lastThrow ? { ...s.lastThrow, takeable: takeableFrom(s.lastThrow.cards) } : null,
    myHand: playerId && s.hands[playerId] ? [...s.hands[playerId]] : null,
    handCounts: Object.fromEntries(s.players.map((p) => [p, s.hands[p].length])),
    log: s.log,
    lastResult: s.lastResult,
    over: s.over,
    version,
  };
}
