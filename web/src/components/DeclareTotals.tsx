import type { DeclareTotalsRow } from '../../../src/shared/api';

export function DeclareTotals({ rows, by }: { rows: DeclareTotalsRow[]; by: 'points' | 'avg' }) {
  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs uppercase tracking-wider text-white/50">
          <tr>
            <th className="px-1 py-1 font-medium">#</th>
            <th className="px-1 py-1 font-medium">Player</th>
            <th className="px-1 py-1 text-right font-medium">{by === 'points' ? 'Total' : 'Per hand'}</th>
            <th className="px-1 py-1 text-right font-medium">{by === 'points' ? 'Per hand' : 'Total'}</th>
            <th className="px-1 py-1 text-right font-medium">Hands</th>
            <th className="px-1 py-1 text-right font-medium" title="Declares made / tried">Decl.</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.playerId} className="border-t border-white/5">
              <td className="px-1 py-2 text-white/50">{i + 1}</td>
              <td className="max-w-32 truncate px-1 py-2 font-semibold">
                {i === 0 ? '👑 ' : ''}
                {r.displayName}
              </td>
              <td className="px-1 py-2 text-right font-mono font-bold text-gold-300">{by === 'points' ? r.points : r.avgPerHand.toFixed(1)}</td>
              <td className="px-1 py-2 text-right font-mono">{by === 'points' ? r.avgPerHand.toFixed(1) : r.points}</td>
              <td className="px-1 py-2 text-right font-mono">{r.hands}</td>
              <td className="px-1 py-2 text-right font-mono">
                {r.declaresMade}/{r.declares}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 px-1 text-xs text-white/40">Lowest is best. {by === 'avg' ? 'Ranked by points per hand so missed trips don’t count against anyone.' : ''}</p>
    </div>
  );
}
