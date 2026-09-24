import type { FastifyInstance } from 'fastify';
import { requirePlayer } from '../auth.js';
import type { DeckAction } from '../deck.js';
import { notFound } from '../http.js';
import { requireGameAccess } from '../services/access.js';
import { deckViewFor, runDeckAction } from '../services/deck-service.js';
import { editRound, endGame, gameAudit, gameDetail, submitRound } from '../services/games.js';
import { parse, z } from '../validate.js';

const scoresSchema = z.object({ scores: z.record(z.string(), z.number().int()) });

export async function gameRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string } }>('/api/games/:id', async (req) => {
    const me = await requirePlayer(req);
    await requireGameAccess(req.params.id, me.id);
    return gameDetail(req.params.id);
  });

  app.post<{ Params: { id: string } }>('/api/games/:id/rounds', async (req) => {
    const me = await requirePlayer(req);
    await requireGameAccess(req.params.id, me.id);
    const { scores } = parse(scoresSchema, req.body);
    return submitRound(req.params.id, me.id, scores);
  });

  app.put<{ Params: { id: string; roundId: string } }>('/api/games/:id/rounds/:roundId', async (req) => {
    const me = await requirePlayer(req);
    await requireGameAccess(req.params.id, me.id);
    const { scores } = parse(scoresSchema, req.body);
    return editRound(req.params.id, req.params.roundId, me.id, scores);
  });

  app.post<{ Params: { id: string } }>('/api/games/:id/end', async (req) => {
    const me = await requirePlayer(req);
    await requireGameAccess(req.params.id, me.id);
    const body = parse(z.object({ winnerPlayerId: z.string().nullable().optional() }), req.body);
    await endGame(req.params.id, 'winnerPlayerId' in body ? body.winnerPlayerId : undefined);
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>('/api/games/:id/audit', async (req) => {
    const me = await requirePlayer(req);
    await requireGameAccess(req.params.id, me.id);
    return { audit: await gameAudit(req.params.id) };
  });

  // Deck: GET returns only the caller's own hand plus public table info.
  app.get<{ Params: { id: string } }>('/api/games/:id/deck', async (req) => {
    const me = await requirePlayer(req);
    await requireGameAccess(req.params.id, me.id);
    const view = await deckViewFor(req.params.id, me.id);
    if (!view) throw notFound('This game has no deck');
    return { view };
  });

  const deckBody = z
    .object({
      count: z.number().int().optional(),
      cards: z.array(z.string()).optional(),
      keepTop: z.boolean().optional(),
    })
    .default({});

  // POST /api/games/:id/deck/{shuffle|deal|draw|draw_discard|discard|reshuffle|reset}
  app.post<{ Params: { id: string; action: string } }>('/api/games/:id/deck/:action', async (req) => {
    const me = await requirePlayer(req);
    const body = parse(deckBody, req.body);
    const action = { type: req.params.action, ...body } as DeckAction;
    return { view: await runDeckAction(req.params.id, me.id, action) };
  });
}
