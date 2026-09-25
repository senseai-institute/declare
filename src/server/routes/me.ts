import type { FastifyInstance } from 'fastify';
import type { HomeData, Me } from '../../shared/api.js';
import { currentPlayer, newDeviceToken, requirePlayer, setDeviceCookie } from '../auth.js';
import { prisma } from '../db.js';
import { nameSchema, parse, z } from '../validate.js';
import { toGroupSummary, toSessionSummary } from './shape.js';
import { currentPlayer as turnOf, type DeclareState } from '../declare/engine.js';

const toMe = (p: { id: string; displayName: string; email: string | null }): Me => ({
  id: p.id,
  displayName: p.displayName,
  email: p.email,
});

export async function meRoutes(app: FastifyInstance) {
  app.get('/api/me', async (req) => {
    const p = await currentPlayer(req);
    return { me: p ? toMe(p) : null };
  });

  // Create this device's player (or rename it if it already exists).
  app.post('/api/me', async (req, reply) => {
    const { displayName } = parse(z.object({ displayName: nameSchema }), req.body);
    const existing = await currentPlayer(req);
    if (existing) {
      const p = await prisma.player.update({ where: { id: existing.id }, data: { displayName } });
      return { me: toMe(p) };
    }
    const token = newDeviceToken();
    const p = await prisma.player.create({ data: { displayName, deviceToken: token } });
    setDeviceCookie(reply, token);
    return { me: toMe(p) };
  });

  app.patch('/api/me', async (req) => {
    const me = await requirePlayer(req);
    const body = parse(
      z.object({
        displayName: nameSchema.optional(),
        email: z.union([z.string().trim().email().max(200), z.literal('')]).optional(),
      }),
      req.body,
    );
    const p = await prisma.player.update({
      where: { id: me.id },
      data: {
        ...(body.displayName ? { displayName: body.displayName } : {}),
        ...(body.email !== undefined ? { email: body.email || null } : {}),
      },
    });
    return { me: toMe(p) };
  });

  app.get('/api/home', async (req): Promise<HomeData> => {
    const me = await requirePlayer(req);
    const [groups, sessions, online] = await Promise.all([
      prisma.group.findMany({
        where: { members: { some: { playerId: me.id } } },
        include: {
          _count: { select: { members: true } },
          sessions: { where: { status: 'active' }, orderBy: { startedAt: 'desc' }, take: 1 },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.session.findMany({
        where: { players: { some: { playerId: me.id } } },
        include: { group: true, _count: { select: { games: true } } },
        orderBy: [{ status: 'asc' }, { startedAt: 'desc' }],
        take: 20,
      }),
      prisma.game.findMany({
        where: { rules: 'declare', deckEnabled: true, status: 'active', session: { status: 'active' }, players: { some: { playerId: me.id } } },
        include: { deckState: true, session: true },
      }),
    ]);
    const yourTurn = online.flatMap((g) => {
      const st = g.deckState?.state as unknown as DeclareState | undefined;
      if (!st || st.over || turnOf(st) !== me.id) return [];
      return [{ gameId: g.id, sessionName: g.session.name, gameType: g.gameType, turnDeadline: st.turnDeadline }];
    });
    return { groups: groups.map(toGroupSummary), sessions: sessions.map(toSessionSummary), yourTurn };
  });
}
