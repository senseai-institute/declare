import type { StandingRow } from '../../shared/api.js';
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
