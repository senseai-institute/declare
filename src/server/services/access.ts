import { prisma } from '../db.js';
import { forbidden, notFound } from '../http.js';

export async function requireGroupMember(groupId: string, playerId: string) {
  const group = await prisma.group.findUnique({ where: { id: groupId } });
  if (!group) throw notFound('Group not found');
  const m = await prisma.groupMember.findUnique({ where: { groupId_playerId: { groupId, playerId } } });
  if (!m) throw forbidden('Join this group first');
  return group;
}

export async function requireSessionMember(sessionId: string, playerId: string) {
  const session = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!session) throw notFound('Session not found');
  const m = await prisma.sessionPlayer.findUnique({ where: { sessionId_playerId: { sessionId, playerId } } });
  if (!m) throw forbidden('Join this session first');
  return session;
}

export async function requireGameAccess(gameId: string, playerId: string) {
  const game = await prisma.game.findUnique({ where: { id: gameId }, include: { session: true } });
  if (!game) throw notFound('Game not found');
  await requireSessionMember(game.sessionId, playerId);
  return game;
}
