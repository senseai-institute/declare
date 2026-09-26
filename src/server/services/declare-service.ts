// Runs online Declare games: validates moves, records each finished hand as a
// scored round, deals the next hand, and auto-plays for guests (after a short
// pause) and for anyone who lets their turn timer run out.

import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { chooseMove } from '../declare/bot.js';
import {
  currentPlayer,
  dealHand,
  declare,
  declareViewFor,
  newMatch,
  playTurn,
  RuleError,
  type DeclareState,
  type DeclareView,
  type HandResult,
} from '../declare/engine.js';
import { takeableFrom } from '../../shared/declare.js';
import { badRequest, conflict, forbidden, HttpError } from '../http.js';
import { withLock } from '../lock.js';
import { broadcastDeck, notify } from '../realtime.js';
import { computeTotals, leader, targetReached } from '../scoring.js';
import { requireGameAccess } from './access.js';

/** `version` (optional) is the table version the player was looking at; stale moves are refused. */
export type DeclareAction = ({ type: 'declare' } | { type: 'play'; cards: string[]; take: string }) & { version?: number };

/** How long a guest ("computer") seat waits before moving, so people can follow along. */
export const GUEST_DELAY_MS = Number(process.env.DECLARE_GUEST_DELAY_MS ?? 1200);

export function createDeclareState(playerIds: string[], turnSeconds: number | null): Prisma.InputJsonValue {
  try {
    return newMatch(playerIds, { turnSeconds }) as unknown as Prisma.InputJsonValue;
  } catch (err) {
    if (err instanceof RuleError) throw badRequest(err.message);
    throw err;
  }
}

export function toDeclareView(state: unknown, playerId: string | null, version: number): DeclareView {
  return declareViewFor(state as DeclareState, playerId, version);
}

/** Apply one move. Caller must hold the game lock. Returns the new state and whether the game ended. */
async function applyLocked(gameId: string, playerId: string, action: DeclareAction, auto: boolean) {
  const game = await prisma.game.findUnique({ where: { id: gameId }, include: { session: true, deckState: true } });
  if (!game?.deckState) throw badRequest('No cards in this game');
  if (game.status !== 'active') throw conflict('This game is over');
  if (game.session.status !== 'active') throw conflict('This session is closed');
  let state = game.deckState.state as unknown as DeclareState;
  if (!state.players.includes(playerId)) throw forbidden('You’re not seated in this game');
  if (action.version !== undefined && action.version !== game.deckState.version) {
    throw conflict('The table changed — take another look');
  }

  let result: HandResult | null = null;
  try {
    if (action.type === 'declare') {
      ({ state, result } = declare(state, playerId, { auto }));
    } else if (action.type === 'play') {
      state = playTurn(state, playerId, action.cards, action.take, { auto });
    } else {
      throw new RuleError('Unknown move');
    }
  } catch (err) {
    if (err instanceof RuleError) throw new HttpError(400, err.message);
    throw err;
  }

  let ended = false;
  if (result) {
    // Record the hand as a round, then see if anyone hit the target.
    const last = await prisma.round.findFirst({ where: { gameId }, orderBy: { roundNumber: 'desc' } });
    await prisma.round.create({
      data: {
        gameId,
        roundNumber: (last?.roundNumber ?? 0) + 1,
        declarerId: result.declarerId,
        declareSuccess: result.success,
        entries: {
          create: Object.entries(result.scores).map(([pid, points]) => ({ playerId: pid, points, enteredByPlayerId: playerId })),
        },
      },
    });
    const rounds = await prisma.round.findMany({ where: { gameId }, include: { entries: true } });
    const totals = computeTotals(state.players, rounds);
    if (targetReached(totals, game.targetScore)) {
      ended = true;
      state = { ...state, over: true };
      await prisma.game.update({
        where: { id: gameId },
        data: { status: 'finished', endedAt: new Date(), winnerPlayerId: leader(totals, game.scoringMode) },
      });
    } else {
      state = dealHand(state);
    }
  }

  await prisma.deckState.update({
    where: { gameId },
    data: { state: state as unknown as Prisma.InputJsonValue, version: { increment: 1 } },
  });
  return { game, state, handEnded: !!result, ended };
}

async function afterMove(gameId: string, game: { sessionId: string; session: { groupId: string | null } }, handEnded: boolean) {
  void broadcastDeck(gameId);
  if (handEnded) {
    notify(`game:${gameId}`, `session:${game.sessionId}`, game.session.groupId ? `group:${game.session.groupId}` : null);
  }
  void scheduleAuto(gameId);
}

export async function runDeclareAction(gameId: string, playerId: string, action: DeclareAction) {
  if (!action || (action.type !== 'declare' && action.type !== 'play')) throw badRequest('Unknown move');
  await requireGameAccess(gameId, playerId);
  const r = await withLock(`game:${gameId}`, () => applyLocked(gameId, playerId, action, false));
  await afterMove(gameId, r.game, r.handEnded);
  const row = await prisma.deckState.findUniqueOrThrow({ where: { gameId } });
  return toDeclareView(row.state, playerId, row.version);
}

// ---- Auto-play -------------------------------------------------------------

const timers = new Map<string, NodeJS.Timeout>();

/** Arrange for the bot to move for the current player when it's due. */
export async function scheduleAuto(gameId: string) {
  const existing = timers.get(gameId);
  if (existing) clearTimeout(existing);
  timers.delete(gameId);

  const game = await prisma.game.findUnique({ where: { id: gameId }, include: { deckState: true, session: true } });
  if (!game?.deckState || game.rules !== 'declare' || game.status !== 'active' || game.session.status !== 'active') return;
  const state = game.deckState.state as unknown as DeclareState;
  if (state.over) return;
  const turnPlayer = await prisma.player.findUnique({ where: { id: currentPlayer(state) } });
  const isGuest = !turnPlayer?.deviceToken;

  let dueIn: number | null = null;
  if (isGuest) dueIn = GUEST_DELAY_MS;
  else if (state.turnDeadline) dueIn = Math.max(0, state.turnDeadline - Date.now());
  if (dueIn === null) return;

  // setTimeout caps at ~24.8 days; re-check periodically for long timers.
  const delay = Math.min(dueIn, 6 * 60 * 60 * 1000);
  const version = game.deckState.version;
  timers.set(
    gameId,
    setTimeout(() => {
      timers.delete(gameId);
      void autoMove(gameId, version).catch((err) => console.error('auto-play failed', gameId, err));
    }, delay),
  );
}

/** Let the bot take the current turn if nothing has changed since it was scheduled. */
export async function autoMove(gameId: string, expectedVersion?: number) {
  const r = await withLock(`game:${gameId}`, async () => {
    const row = await prisma.deckState.findUnique({ where: { gameId }, include: { game: { include: { session: true } } } });
    if (!row || row.game.status !== 'active') return null;
    if (expectedVersion !== undefined && row.version !== expectedVersion) return null;
    const state = row.state as unknown as DeclareState;
    if (state.over) return null;
    const pid = currentPlayer(state);
    const player = await prisma.player.findUnique({ where: { id: pid } });
    const guest = !player?.deviceToken;
    if (!guest && (!state.turnDeadline || state.turnDeadline > Date.now())) return null; // not due yet
    const move = chooseMove({
      hand: state.hands[pid],
      takeable: state.lastThrow ? takeableFrom(state.lastThrow.cards) : [],
      opponentCounts: state.players.filter((p) => p !== pid).map((p) => state.hands[p].length),
      turnsThisHand: state.turnInHand,
      playerCount: state.players.length,
    });
    return applyLocked(gameId, pid, move, !guest);
  });
  if (r) await afterMove(gameId, r.game, r.handEnded);
  else void scheduleAuto(gameId);
}

/** On boot: pick up every running online Declare game. */
export async function resumeAutoPlay() {
  const games = await prisma.game.findMany({ where: { rules: 'declare', status: 'active', deckEnabled: true }, select: { id: true } });
  for (const g of games) await scheduleAuto(g.id);
}

export function cancelAuto(gameId: string) {
  const t = timers.get(gameId);
  if (t) clearTimeout(t);
  timers.delete(gameId);
}
