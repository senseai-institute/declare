import type { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import type { SessionDetail } from '../../shared/api.js';
import { requirePlayer } from '../auth.js';
import { uniqueJoinCode } from '../codes.js';
import { prisma } from '../db.js';
import { normalizeConfig, createDeckState, DeckError } from '../deck.js';
import { badRequest, conflict } from '../http.js';
import { notify } from '../realtime.js';
import { requireGroupMember, requireSessionMember } from '../services/access.js';
import { finishActiveGames, loadSessionGames, toSummary } from '../services/games.js';
import { declareTotals, sessionStandings } from '../services/stats.js';
import { createDeclareState, scheduleAuto } from '../services/declare-service.js';
import { nameSchema, parse, z } from '../validate.js';
import { toPlayerRef, toSessionSummary } from './shape.js';

const groupRoom = (groupId: string | null) => (groupId ? (`group:${groupId}` as const) : null);

export async function sessionRoutes(app: FastifyInstance) {
  app.post('/api/sessions', async (req) => {
    const me = await requirePlayer(req);
    const body = parse(
      z.object({
        name: nameSchema,
        groupId: z.string().optional().nullable(),
        playerIds: z.array(z.string()).max(50).optional(),
      }),
      req.body,
    );
    let playerIds = [me.id];
    if (body.groupId) {
      await requireGroupMember(body.groupId, me.id);
      if (body.playerIds?.length) {
        const members = await prisma.groupMember.findMany({
          where: { groupId: body.groupId, playerId: { in: body.playerIds } },
        });
        playerIds = [...new Set([me.id, ...members.map((m) => m.playerId)])];
      }
    }
    const session = await prisma.session.create({
      data: {
        name: body.name,
        groupId: body.groupId || null,
        joinCode: await uniqueJoinCode(),
        createdById: me.id,
        players: { create: playerIds.map((playerId) => ({ playerId })) },
      },
    });
    notify(groupRoom(session.groupId));
    return { id: session.id };
  });

  app.get<{ Params: { id: string } }>('/api/sessions/:id', async (req): Promise<SessionDetail> => {
    const me = await requirePlayer(req);
    await requireSessionMember(req.params.id, me.id);
    const session = await prisma.session.findUniqueOrThrow({
      where: { id: req.params.id },
      include: {
        group: { include: { members: { include: { player: true } } } },
        players: { include: { player: true }, orderBy: { joinedAt: 'asc' } },
        _count: { select: { games: true } },
      },
    });
    const games = await loadSessionGames(session.id);
    const here = new Set(session.players.map((p) => p.playerId));
    return {
      ...toSessionSummary(session),
      players: session.players.map((p) => toPlayerRef(p.player)),
      games: games.map(toSummary).reverse(),
      standings: sessionStandings(games),
      declareTotals: await declareTotals({ sessionId: session.id }, 'points'),
      groupMembersNotHere: (session.group?.members ?? [])
        .filter((m) => !here.has(m.playerId))
        .map((m) => toPlayerRef(m.player)),
    };
  });

  // Add a player: an existing group member, or a new guest by name.
  app.post<{ Params: { id: string } }>('/api/sessions/:id/players', async (req) => {
    const me = await requirePlayer(req);
    const session = await requireSessionMember(req.params.id, me.id);
    const body = parse(
      z.union([z.object({ playerId: z.string() }), z.object({ displayName: nameSchema })]),
      req.body,
    );
    let playerId: string;
    if ('playerId' in body) {
      if (!session.groupId) throw badRequest('Only group members can be added by id');
      await requireGroupMember(session.groupId, body.playerId);
      playerId = body.playerId;
    } else {
      const p = await prisma.player.create({ data: { displayName: body.displayName } });
      playerId = p.id;
      if (session.groupId) await prisma.groupMember.create({ data: { groupId: session.groupId, playerId } });
    }
    await prisma.sessionPlayer.upsert({
      where: { sessionId_playerId: { sessionId: session.id, playerId } },
      create: { sessionId: session.id, playerId },
      update: {},
    });
    notify(`session:${session.id}`, groupRoom(session.groupId));
    return { playerId };
  });

  app.post<{ Params: { id: string } }>('/api/sessions/:id/close', async (req) => {
    const me = await requirePlayer(req);
    const session = await requireSessionMember(req.params.id, me.id);
    if (session.status === 'closed') throw conflict('Session already closed');
    await finishActiveGames(session.id);
    await prisma.session.update({ where: { id: session.id }, data: { status: 'closed', endedAt: new Date() } });
    notify(`session:${session.id}`, groupRoom(session.groupId));
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/sessions/:id/reopen', async (req) => {
    const me = await requirePlayer(req);
    const session = await requireSessionMember(req.params.id, me.id);
    await prisma.session.update({ where: { id: session.id }, data: { status: 'active', endedAt: null } });
    notify(`session:${session.id}`, groupRoom(session.groupId));
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/sessions/:id/games', async (req) => {
    const me = await requirePlayer(req);
    const session = await requireSessionMember(req.params.id, me.id);
    if (session.status !== 'active') throw conflict('This session is closed');
    const body = parse(
      z.object({
        gameType: z.string().trim().min(1).max(40),
        scoringMode: z.enum(['high_wins', 'low_wins']),
        targetScore: z.number().int().min(-1_000_000).max(1_000_000).nullable().optional(),
        playerIds: z.array(z.string()).min(1, 'Pick at least one player').max(20),
        deckEnabled: z.boolean().default(false),
        rules: z.literal('declare').nullable().optional(),
        /** Online Declare: computer plays your turn after this long (null = never). */
        turnSeconds: z.number().int().min(Number(process.env.DECLARE_MIN_TURN_SECONDS ?? 60)).max(7 * 24 * 3600).nullable().optional(),
        deck: z.object({ decks: z.number().int(), jokersPerDeck: z.number().int() }).partial().optional(),
      }),
      req.body,
    );
    const playerIds = [...new Set(body.playerIds)];
    const members = await prisma.sessionPlayer.count({
      where: { sessionId: session.id, playerId: { in: playerIds } },
    });
    if (members !== playerIds.length) throw badRequest('Everyone in the game must be in the session');

    let deckState: Prisma.InputJsonValue | undefined;
    if (body.rules === 'declare' && body.deckEnabled) {
      deckState = createDeclareState(playerIds, body.turnSeconds ?? null);
    } else if (body.deckEnabled) {
      try {
        deckState = createDeckState(normalizeConfig(body.deck), playerIds) as unknown as Prisma.InputJsonValue;
      } catch (err) {
        if (err instanceof DeckError) throw badRequest(err.message);
        throw err;
      }
    }

    const game = await prisma.game.create({
      data: {
        sessionId: session.id,
        gameType: body.gameType,
        scoringMode: body.scoringMode,
        targetScore: body.targetScore ?? null,
        deckEnabled: body.deckEnabled,
        rules: body.rules ?? null,
        players: { create: playerIds.map((playerId, seat) => ({ playerId, seat })) },
        ...(deckState ? { deckState: { create: { state: deckState } } } : {}),
      },
    });
    notify(`session:${session.id}`);
    if (game.rules === 'declare' && game.deckEnabled) void scheduleAuto(game.id);
    return { id: game.id };
  });
}
