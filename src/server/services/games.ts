import type { Prisma } from '@prisma/client';
import type { GameDetail, GameSummary } from '../../shared/api.js';
import { prisma } from '../db.js';
import { badRequest, conflict, notFound } from '../http.js';
import { withLock } from '../lock.js';
import { notify } from '../realtime.js';
import { computeTotals, leader, placesFor, targetReached } from '../scoring.js';

const MAX_POINTS = 1_000_000;

const gameInclude = {
  session: true,
  players: { include: { player: true }, orderBy: { seat: 'asc' } },
  rounds: { include: { entries: true }, orderBy: { roundNumber: 'asc' } },
} satisfies Prisma.GameInclude;

type GameWithAll = Prisma.GameGetPayload<{ include: typeof gameInclude }>;

function standingsOf(game: Pick<GameWithAll, 'players' | 'rounds' | 'scoringMode'>) {
  const ids = game.players.map((p) => p.playerId);
  const totals = computeTotals(ids, game.rounds);
  const places = placesFor(totals, game.scoringMode);
  return { totals, places };
}

export function toSummary(game: GameWithAll | Omit<GameWithAll, 'session'>): GameSummary {
  const { totals, places } = standingsOf(game);
  return {
    id: game.id,
    gameType: game.gameType,
    scoringMode: game.scoringMode,
    status: game.status,
    targetScore: game.targetScore,
    deckEnabled: game.deckEnabled,
    winnerPlayerId: game.winnerPlayerId,
    roundCount: game.rounds.length,
    createdAt: game.createdAt.toISOString(),
    endedAt: game.endedAt?.toISOString() ?? null,
    players: game.players
      .map((gp) => ({
        id: gp.playerId,
        displayName: gp.player.displayName,
        total: totals.get(gp.playerId) ?? 0,
        place: places.get(gp.playerId) ?? 0,
      }))
      .sort((a, b) => a.place - b.place),
  };
}

export async function loadGame(gameId: string): Promise<GameWithAll> {
  const game = await prisma.game.findUnique({ where: { id: gameId }, include: gameInclude });
  if (!game) throw notFound('Game not found');
  return game;
}

export function loadSessionGames(sessionId: string) {
  const { session: _s, ...inc } = gameInclude;
  return prisma.game.findMany({ where: { sessionId }, include: inc, orderBy: { createdAt: 'asc' } });
}

export async function gameDetail(gameId: string): Promise<GameDetail> {
  const game = await loadGame(gameId);
  const { totals, places } = standingsOf(game);
  return {
    id: game.id,
    session: {
      id: game.session.id,
      name: game.session.name,
      status: game.session.status,
      groupId: game.session.groupId,
    },
    gameType: game.gameType,
    scoringMode: game.scoringMode,
    targetScore: game.targetScore,
    status: game.status,
    deckEnabled: game.deckEnabled,
    winnerPlayerId: game.winnerPlayerId,
    createdAt: game.createdAt.toISOString(),
    endedAt: game.endedAt?.toISOString() ?? null,
    players: game.players.map((gp) => ({
      id: gp.playerId,
      displayName: gp.player.displayName,
      seat: gp.seat,
      total: totals.get(gp.playerId) ?? 0,
      place: places.get(gp.playerId) ?? 0,
      isGuest: gp.player.deviceToken == null,
    })),
    rounds: game.rounds.map((r) => ({
      id: r.id,
      roundNumber: r.roundNumber,
      createdAt: r.createdAt.toISOString(),
      scores: Object.fromEntries(r.entries.map((e) => [e.playerId, { points: e.points, edited: e.editedAt != null }])),
    })),
  };
}

function notifyGame(game: { id: string; sessionId: string; session: { groupId: string | null } }) {
  notify(`game:${game.id}`, `session:${game.sessionId}`, game.session.groupId ? `group:${game.session.groupId}` : null);
}

function validateScores(game: GameWithAll, scores: Record<string, unknown>, fillMissing: boolean) {
  const ids = new Set(game.players.map((p) => p.playerId));
  const out = new Map<string, number>();
  for (const [pid, raw] of Object.entries(scores ?? {})) {
    if (!ids.has(pid)) throw badRequest('Score for a player who is not in this game');
    const n = Number(raw);
    if (!Number.isInteger(n) || Math.abs(n) > MAX_POINTS) throw badRequest('Scores must be whole numbers');
    out.set(pid, n);
  }
  if (fillMissing) for (const pid of ids) if (!out.has(pid)) out.set(pid, 0);
  return out;
}

/** Finish the game if it has hit its target. Returns true if it ended. */
async function maybeAutoEnd(gameId: string): Promise<boolean> {
  const game = await loadGame(gameId);
  if (game.status !== 'active') return false;
  const { totals } = standingsOf(game);
  if (!targetReached(totals, game.targetScore)) return false;
  await prisma.game.update({
    where: { id: gameId },
    data: { status: 'finished', endedAt: new Date(), winnerPlayerId: leader(totals, game.scoringMode) },
  });
  return true;
}

export async function submitRound(gameId: string, playerId: string, scores: Record<string, unknown>) {
  return withLock(`game:${gameId}`, async () => {
    const game = await loadGame(gameId);
    if (game.status !== 'active') throw conflict('This game is over');
    if (game.session.status !== 'active') throw conflict('This session is closed');
    const points = validateScores(game, scores, true);
    const roundNumber = (game.rounds.at(-1)?.roundNumber ?? 0) + 1;
    await prisma.round.create({
      data: {
        gameId,
        roundNumber,
        entries: {
          create: [...points].map(([pid, p]) => ({ playerId: pid, points: p, enteredByPlayerId: playerId })),
        },
      },
    });
    const ended = await maybeAutoEnd(gameId);
    notifyGame(game);
    return { roundNumber, ended };
  });
}

export async function editRound(gameId: string, roundId: string, playerId: string, scores: Record<string, unknown>) {
  return withLock(`game:${gameId}`, async () => {
    const game = await loadGame(gameId);
    const round = game.rounds.find((r) => r.id === roundId);
    if (!round) throw notFound('Round not found');
    const points = validateScores(game, scores, false);
    const now = new Date();
    const ops: Prisma.PrismaPromise<unknown>[] = [];
    for (const [pid, p] of points) {
      const existing = round.entries.find((e) => e.playerId === pid);
      if (existing?.points === p) continue;
      ops.push(
        existing
          ? prisma.scoreEntry.update({ where: { id: existing.id }, data: { points: p, editedAt: now } })
          : prisma.scoreEntry.create({
              data: { roundId, playerId: pid, points: p, enteredByPlayerId: playerId, editedAt: now },
            }),
        prisma.scoreAudit.create({
          data: {
            gameId,
            roundId,
            roundNumber: round.roundNumber,
            playerId: pid,
            oldPoints: existing?.points ?? null,
            newPoints: p,
            changedByPlayerId: playerId,
            changedAt: now,
          },
        }),
      );
    }
    if (ops.length === 0) return { changed: 0 };
    await prisma.$transaction(ops);

    if (game.status === 'finished' && !game.winnerOverride) {
      const fresh = await loadGame(gameId);
      const { totals } = standingsOf(fresh);
      await prisma.game.update({ where: { id: gameId }, data: { winnerPlayerId: leader(totals, fresh.scoringMode) } });
    } else if (game.status === 'active') {
      await maybeAutoEnd(gameId);
    }
    notifyGame(game);
    return { changed: ops.length / 2 };
  });
}

/**
 * End a game. `winnerPlayerId` undefined → pick the leader automatically;
 * a string or null → a manual choice (null = no winner / tie).
 */
export async function endGame(gameId: string, winnerPlayerId?: string | null) {
  return withLock(`game:${gameId}`, async () => {
    const game = await loadGame(gameId);
    if (game.status !== 'active') throw conflict('Game already ended');
    await finishLoadedGame(game, winnerPlayerId);
    notifyGame(game);
  });
}

async function finishLoadedGame(game: GameWithAll, winnerPlayerId?: string | null) {
  if (winnerPlayerId && !game.players.some((p) => p.playerId === winnerPlayerId)) {
    throw badRequest('Winner must be a player in this game');
  }
  const manual = winnerPlayerId !== undefined;
  const winner = manual ? winnerPlayerId : leader(standingsOf(game).totals, game.scoringMode);
  await prisma.game.update({
    where: { id: game.id },
    data: {
      status: game.rounds.length === 0 && !winner ? 'abandoned' : 'finished',
      endedAt: new Date(),
      winnerPlayerId: winner ?? null,
      winnerOverride: manual,
    },
  });
}

/** Used when a session closes: end whatever is still running. */
export async function finishActiveGames(sessionId: string) {
  const active = await prisma.game.findMany({ where: { sessionId, status: 'active' }, select: { id: true } });
  for (const { id } of active) {
    await withLock(`game:${id}`, async () => {
      const game = await loadGame(id);
      if (game.status === 'active') await finishLoadedGame(game);
    });
    notify(`game:${id}`);
  }
}

export async function gameAudit(gameId: string) {
  const audits = await prisma.scoreAudit.findMany({ where: { gameId }, orderBy: { changedAt: 'desc' } });
  const ids = [...new Set(audits.flatMap((a) => [a.playerId, a.changedByPlayerId]))];
  const players = await prisma.player.findMany({ where: { id: { in: ids } } });
  const name = new Map(players.map((p) => [p.id, p.displayName]));
  return audits.map((a) => ({
    id: a.id,
    roundNumber: a.roundNumber,
    playerName: name.get(a.playerId) ?? 'Unknown',
    oldPoints: a.oldPoints,
    newPoints: a.newPoints,
    changedByName: name.get(a.changedByPlayerId) ?? 'Unknown',
    changedAt: a.changedAt.toISOString(),
  }));
}
