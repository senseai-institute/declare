import type { StandingRow } from '../../../src/shared/api';
import { pct } from '../format';
import { Empty } from './ui';

export function Standings({ rows, showSessions }: { rows: StandingRow[]; showSessions?: boolean }) {
  if (rows.length === 0) return <Empty>No finished games yet.</Empty>;
  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs uppercase tracking-wider text-white/50">
          <tr>
            <th className="px-1 py-1 font-medium">#</th>
            <th className="px-1 py-1 font-medium">Player</th>
            <th className="px-1 py-1 text-right font-medium">Wins</th>
            <th className="px-1 py-1 text-right font-medium">Played</th>
            <th className="px-1 py-1 text-right font-medium">Win %</th>
            <th className="px-1 py-1 text-right font-medium" title="Average finishing place">Avg</th>
            {showSessions && (
              <th className="px-1 py-1 text-right font-medium" title="Sessions won (most wins in a session)">
                🏆
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.playerId} className="border-t border-white/5">
              <td className="px-1 py-2 text-white/50">{i + 1}</td>
              <td className="max-w-32 truncate px-1 py-2 font-semibold">
                {i === 0 && r.wins > 0 ? '👑 ' : ''}
                {r.displayName}
              </td>
              <td className="px-1 py-2 text-right font-mono font-bold text-gold-300">{r.wins}</td>
              <td className="px-1 py-2 text-right font-mono">{r.played}</td>
              <td className="px-1 py-2 text-right font-mono">{pct(r.winRate)}</td>
              <td className="px-1 py-2 text-right font-mono">{r.avgPlace?.toFixed(1) ?? '–'}</td>
              {showSessions && <td className="px-1 py-2 text-right font-mono">{r.sessionTitles ?? 0}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
