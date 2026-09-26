import { Link } from 'react-router-dom';
import type { GameSummary } from '../../../src/shared/api';
import { fmtTime } from '../format';
import { Badge, Empty } from './ui';

export function GameList({ games }: { games: GameSummary[] }) {
  if (games.length === 0) return <Empty>No games yet.</Empty>;
  return (
    <ul className="flex flex-col gap-2">
      {games.map((g) => {
        const winner = g.players.find((p) => p.id === g.winnerPlayerId);
        return (
          <li key={g.id}>
            <Link to={`/game/${g.id}`} className="block rounded-xl bg-felt-950/40 p-3 active:bg-felt-950/70">
              <div className="flex items-center justify-between gap-2">
                <div className="font-semibold">{g.gameType}</div>
                {g.status === 'active' ? (
                  <Badge tone="live">Live</Badge>
                ) : g.status === 'finished' ? (
                  <Badge tone="gold">{winner ? `🏆 ${winner.displayName}` : 'Tie'}</Badge>
                ) : (
                  <Badge>Abandoned</Badge>
                )}
              </div>
              <div className="mt-1 truncate text-sm text-white/60">
                {g.players.map((p) => `${p.displayName} ${p.total}`).join(' · ')}
              </div>
              <div className="mt-0.5 text-xs text-white/40">
                {fmtTime(g.createdAt)} · {g.rules === 'declare' ? `${g.roundCount} hands` : g.rules === 'uno' ? `${g.roundCount} rounds` : g.scoringMode === 'low_wins' ? 'Low wins' : 'High wins'}
                {g.targetScore != null && ` · to ${g.targetScore}`}
                {g.rules === 'declare' ? (g.deckEnabled ? ' · 📱 online' : ' · 🪑 at the table') : g.deckEnabled ? ' · 🃏 deck' : ''}
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
