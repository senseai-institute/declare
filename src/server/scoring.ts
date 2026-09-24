import type { ScoringMode, StandingRow } from '../shared/api.js';

export interface RoundScores {
  entries: { playerId: string; points: number }[];
}

export function computeTotals(playerIds: string[], rounds: RoundScores[]): Map<string, number> {
  const totals = new Map(playerIds.map((id) => [id, 0]));
  for (const r of rounds) {
    for (const e of r.entries) {
      if (totals.has(e.playerId)) totals.set(e.playerId, totals.get(e.playerId)! + e.points);
    }
  }
  return totals;
}

/** 1-based places; tied totals share a place (1, 1, 3). */
export function placesFor(totals: Map<string, number>, mode: ScoringMode): Map<string, number> {
  const better = (a: number, b: number) => (mode === 'high_wins' ? a > b : a < b);
  const places = new Map<string, number>();
  for (const [id, t] of totals) {
    let place = 1;
    for (const other of totals.values()) if (better(other, t)) place++;
    places.set(id, place);
  }
  return places;
}

/** The single leader, or null when nobody has scored or first place is tied. */
export function leader(totals: Map<string, number>, mode: ScoringMode): string | null {
  const places = placesFor(totals, mode);
  const firsts = [...places].filter(([, p]) => p === 1).map(([id]) => id);
  return firsts.length === 1 ? firsts[0] : null;
}

/** Target reached when any player's total is at or past the target. */
export function targetReached(totals: Map<string, number>, target: number | null): boolean {
  if (target == null) return false;
  return [...totals.values()].some((t) => t >= target);
}

export interface FinishedGame {
  sessionId: string;
  gameType: string;
  winnerPlayerId: string | null;
  places: Map<string, number>; // playerId -> place
}

/**
 * Standings across finished games. Scores from different game types aren't
 * comparable, so we rank by wins, then win rate, then average place.
 */
export function computeStandings(
  games: FinishedGame[],
  names: Map<string, string>,
  opts: { sessionStats?: boolean } = {},
): StandingRow[] {
  const rows = new Map<string, { played: number; wins: number; placeSum: number; sessions: Set<string> }>();
  const row = (id: string) => {
    let r = rows.get(id);
    if (!r) rows.set(id, (r = { played: 0, wins: 0, placeSum: 0, sessions: new Set() }));
    return r;
  };
  const winsBySession = new Map<string, Map<string, number>>();

  for (const g of games) {
    for (const [pid, place] of g.places) {
      const r = row(pid);
      r.played++;
      r.placeSum += place;
      r.sessions.add(g.sessionId);
    }
    if (g.winnerPlayerId) {
      row(g.winnerPlayerId).wins++;
      const m = winsBySession.get(g.sessionId) ?? new Map<string, number>();
      m.set(g.winnerPlayerId, (m.get(g.winnerPlayerId) ?? 0) + 1);
      winsBySession.set(g.sessionId, m);
    }
  }

  // Session "titles": most wins in a session (shared on ties).
  const titles = new Map<string, number>();
  for (const m of winsBySession.values()) {
    const best = Math.max(...m.values());
    for (const [pid, w] of m) if (w === best) titles.set(pid, (titles.get(pid) ?? 0) + 1);
  }

  const out: StandingRow[] = [...rows].map(([playerId, r]) => ({
    playerId,
    displayName: names.get(playerId) ?? 'Unknown',
    played: r.played,
    wins: r.wins,
    winRate: r.played ? r.wins / r.played : 0,
    avgPlace: r.played ? Math.round((r.placeSum / r.played) * 100) / 100 : null,
    ...(opts.sessionStats ? { sessions: r.sessions.size, sessionTitles: titles.get(playerId) ?? 0 } : {}),
  }));

  out.sort(
    (a, b) =>
      b.wins - a.wins ||
      b.winRate - a.winRate ||
      (a.avgPlace ?? 99) - (b.avgPlace ?? 99) ||
      a.displayName.localeCompare(b.displayName),
  );
  return out;
}
