import type { DeclareTotalsRow, StandingRow } from '../../shared/api.js';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { computeStandings, computeTotals, placesFor, type FinishedGame } from '../scoring.js';

type GameForStats = {
  sessionId: string;
  gameType: string;
  status: string;
  scoringMode: 'high_wins' | 'low_wins';
  winnerPlayerId: string | null;
  players: { playerId: string; player: { displayName: string } }[];
  rounds: { entries: { playerId: string; points: number }[] }[];
};

function toFinished(games: GameForStats[]): { finished: FinishedGame[]; names: Map<string, string> } {
  const names = new Map<string, string>();
  const finished: FinishedGame[] = [];
  for (const g of games) {
    for (const p of g.players) names.set(p.playerId, p.player.displayName);
    if (g.status !== 'finished') continue;
    const totals = computeTotals(
      g.players.map((p) => p.playerId),
      g.rounds,
    );
    finished.push({
      sessionId: g.sessionId,
      gameType: g.gameType,
      winnerPlayerId: g.winnerPlayerId,
      places: placesFor(totals, g.scoringMode),
    });
  }
  return { finished, names };
}

export function sessionStandings(games: GameForStats[]): StandingRow[] {
  const { finished, names } = toFinished(games);
  return computeStandings(finished, names);
}

export async function groupLeaderboard(groupId: string, gameType?: string) {
  const games = await prisma.game.findMany({
    where: {
      session: { groupId },
      status: 'finished',
      ...(gameType ? { gameType: { equals: gameType, mode: 'insensitive' } } : {}),
    },
    include: {
      players: { include: { player: true } },
      rounds: { include: { entries: true } },
    },
  });
  const { finished, names } = toFinished(games);
  return computeStandings(finished, names, { sessionStats: true });
}

export async function groupGameTypes(groupId: string): Promise<string[]> {
  const rows = await prisma.game.findMany({
    where: { session: { groupId }, status: 'finished' },
    distinct: ['gameType'],
    select: { gameType: true },
  });
  return rows.map((r) => r.gameType).sort((a, b) => a.localeCompare(b));
}

/**
 * Running Declare totals. Sessions sort by total points (everyone plays the
 * same hands); groups sort by points per hand, which stays fair when people
 * miss a trip.
 */
export async function declareTotals(where: Prisma.GameWhereInput, sortBy: 'points' | 'avg'): Promise<DeclareTotalsRow[]> {
  const games = await prisma.game.findMany({
    where: { ...where, rules: 'declare', status: { not: 'abandoned' } },
    include: { players: { include: { player: true } }, rounds: { include: { entries: true } } },
  });
  const rows = new Map<string, DeclareTotalsRow>();
  for (const g of games) {
    for (const gp of g.players) {
      if (!rows.has(gp.playerId)) {
        rows.set(gp.playerId, {
          playerId: gp.playerId,
          displayName: gp.player.displayName,
          hands: 0,
          points: 0,
          avgPerHand: 0,
          declares: 0,
          declaresMade: 0,
          zeroHands: 0,
        });
      }
    }
    for (const r of g.rounds) {
      for (const e of r.entries) {
        const row = rows.get(e.playerId);
        if (!row) continue;
        row.hands++;
        row.points += e.points;
        if (e.points === 0) row.zeroHands++;
      }
      if (r.declarerId && rows.has(r.declarerId)) {
        const row = rows.get(r.declarerId)!;
        row.declares++;
        if (r.declareSuccess) row.declaresMade++;
      }
    }
  }
  const out = [...rows.values()].filter((r) => r.hands > 0);
  for (const r of out) r.avgPerHand = Math.round((r.points / r.hands) * 10) / 10;
  out.sort((a, b) =>
    sortBy === 'points'
      ? a.points - b.points || a.avgPerHand - b.avgPerHand
      : a.avgPerHand - b.avgPerHand || a.points - b.points,
  );
  return out;
}
