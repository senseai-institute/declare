import type { Prisma } from '@prisma/client';
import type { DeckView } from '../../shared/cards.js';
import { prisma } from '../db.js';
import { applyAction, DeckError, viewFor, type DeckAction, type DeckData } from '../deck.js';
import { badRequest, conflict, forbidden, HttpError } from '../http.js';
import { withLock } from '../lock.js';
import { broadcastDeck } from '../realtime.js';
import { requireGameAccess } from './access.js';
import { toDeclareView } from './declare-service.js';
import type { DeclareView } from '../declare/engine.js';

const ACTIONS = new Set(['shuffle', 'deal', 'draw', 'draw_discard', 'discard', 'reshuffle', 'reset']);

/** The caller's private view of a game's cards: the free-form deck, or an online Declare table. */
export async function deckViewFor(gameId: string, playerId: string | null): Promise<DeckView | DeclareView | null> {
  const row = await prisma.deckState.findUnique({ where: { gameId } });
  if (!row) return null;
  if ((row.state as { kind?: string }).kind === 'declare') return toDeclareView(row.state, playerId, row.version);
  return viewFor(row.state as unknown as DeckData, playerId, row.version);
}

export async function runDeckAction(gameId: string, playerId: string, action: DeckAction): Promise<DeckView> {
  if (typeof gameId !== 'string' || !action || !ACTIONS.has(action.type)) throw badRequest('Unknown deck action');
  const game = await requireGameAccess(gameId, playerId);
  if (!game.deckEnabled) throw badRequest('This game is scoring-only (no deck)');
  if (game.rules === 'declare') throw badRequest('Use Declare moves for this game');
  if (game.status !== 'active') throw conflict('Game is over');
  if (game.session.status !== 'active') throw conflict('Session is closed');

  const view = await withLock(`game:${gameId}`, async () => {
    const row = await prisma.deckState.findUnique({ where: { gameId } });
    if (!row) throw badRequest('No deck for this game');
    const state = row.state as unknown as DeckData;
    if (!(playerId in state.hands)) throw forbidden('Only players in this game can use the deck');
    const seats = await prisma.gamePlayer.findMany({ where: { gameId }, orderBy: { seat: 'asc' } });
    let next: DeckData;
    try {
      next = applyAction(state, action, playerId, seats.map((s) => s.playerId));
    } catch (err) {
      if (err instanceof DeckError) throw new HttpError(400, err.message);
      throw err;
    }
    const saved = await prisma.deckState.update({
      where: { gameId },
      data: { state: next as unknown as Prisma.InputJsonValue, version: { increment: 1 } },
    });
    return viewFor(next, playerId, saved.version);
  });

  void broadcastDeck(gameId);
  return view;
}
