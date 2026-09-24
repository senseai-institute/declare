import type { FastifyInstance } from 'fastify';
import type { JoinPreview } from '../../shared/api.js';
import { currentPlayer, newDeviceToken, setDeviceCookie } from '../auth.js';
import { normalizeCode } from '../codes.js';
import { prisma } from '../db.js';
import { badRequest, notFound } from '../http.js';
import { notify } from '../realtime.js';
import { nameSchema, parse, z } from '../validate.js';
import { toPlayerRef } from './shape.js';

async function resolveCode(raw: string) {
  const code = normalizeCode(raw);
  const group = await prisma.group.findUnique({
    where: { joinCode: code },
    include: { members: { include: { player: true } } },
  });
  if (group) return { kind: 'group' as const, group };
  const session = await prisma.session.findUnique({
    where: { joinCode: code },
    include: { group: true, players: { include: { player: true } } },
  });
  if (session) return { kind: 'session' as const, session };
  throw notFound('No group or session with that code');
}

export async function joinRoutes(app: FastifyInstance) {
  app.get<{ Params: { code: string } }>('/api/join/:code', async (req): Promise<JoinPreview> => {
    const me = await currentPlayer(req);
    const r = await resolveCode(req.params.code);
    if (r.kind === 'group') {
      const players = r.group.members.map((m) => m.player);
      return {
        kind: 'group',
        id: r.group.id,
        name: r.group.name,
        groupName: null,
        status: null,
        claimable: me ? [] : players.filter((p) => !p.deviceToken).map(toPlayerRef),
        alreadyMember: !!me && players.some((p) => p.id === me.id),
      };
    }
    const players = r.session.players.map((m) => m.player);
    return {
      kind: 'session',
      id: r.session.id,
      name: r.session.name,
      groupName: r.session.group?.name ?? null,
      status: r.session.status,
      claimable: me ? [] : players.filter((p) => !p.deviceToken).map(toPlayerRef),
      alreadyMember: !!me && players.some((p) => p.id === me.id),
    };
  });

  /**
   * Join by code. New devices either give a name or claim an existing guest
   * ("I'm Alice") so their past scores carry over.
   */
  app.post<{ Params: { code: string } }>('/api/join/:code', async (req, reply) => {
    const body = parse(
      z.object({ displayName: nameSchema.optional(), claimPlayerId: z.string().optional() }),
      req.body,
    );
    const r = await resolveCode(req.params.code);
    let me = await currentPlayer(req);

    if (!me) {
      const token = newDeviceToken();
      if (body.claimPlayerId) {
        const memberIds =
          r.kind === 'group' ? r.group.members.map((m) => m.playerId) : r.session.players.map((p) => p.playerId);
        if (!memberIds.includes(body.claimPlayerId)) throw badRequest('That player is not here');
        const claimed = await prisma.player.updateMany({
          where: { id: body.claimPlayerId, deviceToken: null },
          data: { deviceToken: token },
        });
        if (claimed.count === 0) throw badRequest('That player is already on another device');
        me = await prisma.player.findUniqueOrThrow({ where: { id: body.claimPlayerId } });
      } else {
        if (!body.displayName) throw badRequest('Enter your name');
        me = await prisma.player.create({ data: { displayName: body.displayName, deviceToken: token } });
      }
      setDeviceCookie(reply, token);
    }
    const playerId = me.id;

    if (r.kind === 'group') {
      await prisma.groupMember.upsert({
        where: { groupId_playerId: { groupId: r.group.id, playerId } },
        create: { groupId: r.group.id, playerId },
        update: {},
      });
      notify(`group:${r.group.id}`);
      return { kind: 'group', id: r.group.id };
    }

    const s = r.session;
    await prisma.sessionPlayer.upsert({
      where: { sessionId_playerId: { sessionId: s.id, playerId } },
      create: { sessionId: s.id, playerId },
      update: {},
    });
    // Joining a group's session makes you part of the group too.
    if (s.groupId) {
      await prisma.groupMember.upsert({
        where: { groupId_playerId: { groupId: s.groupId, playerId } },
        create: { groupId: s.groupId, playerId },
        update: {},
      });
    }
    notify(`session:${s.id}`, s.groupId ? `group:${s.groupId}` : null);
    return { kind: 'session', id: s.id };
  });
}
