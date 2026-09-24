import type { FastifyInstance } from 'fastify';
import type { GroupDetail } from '../../shared/api.js';
import { requirePlayer } from '../auth.js';
import { uniqueJoinCode } from '../codes.js';
import { prisma } from '../db.js';
import { notify } from '../realtime.js';
import { requireGroupMember } from '../services/access.js';
import { groupGameTypes, groupLeaderboard } from '../services/stats.js';
import { nameSchema, parse, z } from '../validate.js';
import { toGroupSummary, toPlayerRef, toSessionSummary } from './shape.js';

export async function groupRoutes(app: FastifyInstance) {
  app.post('/api/groups', async (req) => {
    const me = await requirePlayer(req);
    const { name } = parse(z.object({ name: nameSchema }), req.body);
    const group = await prisma.group.create({
      data: { name, joinCode: await uniqueJoinCode(), members: { create: { playerId: me.id } } },
    });
    return { id: group.id };
  });

  app.get<{ Params: { id: string } }>('/api/groups/:id', async (req): Promise<GroupDetail> => {
    const me = await requirePlayer(req);
    await requireGroupMember(req.params.id, me.id);
    const group = await prisma.group.findUniqueOrThrow({
      where: { id: req.params.id },
      include: {
        _count: { select: { members: true } },
        members: { include: { player: true }, orderBy: { joinedAt: 'asc' } },
        sessions: {
          include: { group: true, _count: { select: { games: true } } },
          orderBy: [{ status: 'asc' }, { startedAt: 'desc' }],
        },
      },
    });
    const [leaderboard, gameTypes] = await Promise.all([groupLeaderboard(group.id), groupGameTypes(group.id)]);
    return {
      ...toGroupSummary({ ...group, sessions: group.sessions.filter((s) => s.status === 'active') }),
      createdAt: group.createdAt.toISOString(),
      members: group.members.map((m) => toPlayerRef(m.player)),
      sessions: group.sessions.map(toSessionSummary),
      leaderboard,
      gameTypes,
    };
  });

  app.get<{ Params: { id: string }; Querystring: { gameType?: string } }>(
    '/api/groups/:id/leaderboard',
    async (req) => {
      const me = await requirePlayer(req);
      await requireGroupMember(req.params.id, me.id);
      return { leaderboard: await groupLeaderboard(req.params.id, req.query.gameType || undefined) };
    },
  );

  // Add someone without a phone to the group.
  app.post<{ Params: { id: string } }>('/api/groups/:id/members', async (req) => {
    const me = await requirePlayer(req);
    await requireGroupMember(req.params.id, me.id);
    const { displayName } = parse(z.object({ displayName: nameSchema }), req.body);
    const p = await prisma.player.create({
      data: { displayName, groups: { create: { groupId: req.params.id } } },
    });
    notify(`group:${req.params.id}`);
    return { player: toPlayerRef(p) };
  });

  app.patch<{ Params: { id: string } }>('/api/groups/:id', async (req) => {
    const me = await requirePlayer(req);
    await requireGroupMember(req.params.id, me.id);
    const { name } = parse(z.object({ name: nameSchema }), req.body);
    await prisma.group.update({ where: { id: req.params.id }, data: { name } });
    notify(`group:${req.params.id}`);
    return { ok: true };
  });
}
