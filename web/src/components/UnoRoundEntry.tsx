import { useState } from 'react';
import type { GameDetail } from '../../../src/shared/api';
import { scoreUnoRound, UNO_ACTION_POINTS, UNO_WILD_POINTS } from '../../../src/shared/uno';
import { Button } from './ui';

/**
 * UNO at the table: tap who went out, then count each other hand. The +20 / +50
 * buttons add action and wild cards so nobody has to do the sums.
 */
export function UnoRoundEntry({
  game,
  onSubmit,
  busy,
}: {
  game: GameDetail;
  onSubmit: (body: { winnerId: string; hands: Record<string, number> }) => Promise<unknown>;
  busy: boolean;
}) {
  const [winner, setWinner] = useState<string | null>(null);
  const [pts, setPts] = useState<Record<string, string>>({});
  const others = game.players.filter((p) => p.id !== winner);
  const hands = Object.fromEntries(game.players.map((p) => [p.id, p.id === winner ? 0 : Number(pts[p.id] || 0)]));
  const preview = winner ? scoreUnoRound(winner, hands) : null;
  const winnerName = game.players.find((p) => p.id === winner)?.displayName;

  const add = (id: string, n: number) => setPts((s) => ({ ...s, [id]: String(Math.min(2000, Number(s[id] || 0) + n)) }));

  async function submit() {
    if (!winner) return;
    try {
      await onSubmit({ winnerId: winner, hands });
      setWinner(null);
      setPts({});
    } catch {
      /* error shown by caller */
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="mb-2 text-sm text-white/60">Who went out?</div>
        <div className="flex flex-wrap gap-2">
          {game.players.map((p) => (
            <button
              key={p.id}
              onClick={() => setWinner(p.id)}
              className={`min-h-11 rounded-full px-4 font-semibold ${winner === p.id ? 'bg-gold-400 text-felt-950' : 'bg-white/10'}`}
            >
              {p.displayName}
            </button>
          ))}
        </div>
      </div>
      {winner && (
        <>
          <div className="text-sm text-white/60">Points left in each hand</div>
          {others.map((p) => (
            <div key={p.id} className="flex flex-col gap-2 rounded-xl bg-felt-950/40 p-2">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1 truncate pl-1 font-semibold">{p.displayName}</div>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  placeholder="0"
                  value={pts[p.id] ?? ''}
                  onChange={(e) => setPts((s) => ({ ...s, [p.id]: e.target.value.replace(/\D/g, '').slice(0, 4) }))}
                  className="h-12 w-24 rounded-xl bg-felt-950/70 px-3 text-right font-mono text-2xl font-bold outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-gold-400"
                  aria-label={`Points left in ${p.displayName}'s hand`}
                />
              </div>
              <div className="flex gap-2">
                <button onClick={() => add(p.id, UNO_ACTION_POINTS)} className="min-h-10 flex-1 rounded-lg bg-white/10 text-sm font-semibold active:bg-white/20" aria-label={`Add an action card for ${p.displayName}`}>
                  +20 action
                </button>
                <button onClick={() => add(p.id, UNO_WILD_POINTS)} className="min-h-10 flex-1 rounded-lg bg-white/10 text-sm font-semibold active:bg-white/20" aria-label={`Add a wild card for ${p.displayName}`}>
                  +50 wild
                </button>
                <button onClick={() => setPts((s) => ({ ...s, [p.id]: '' }))} className="min-h-10 rounded-lg bg-white/5 px-3 text-sm text-white/60" aria-label={`Clear ${p.displayName}`}>
                  Clear
                </button>
              </div>
            </div>
          ))}
          {preview && (
            <div className="rounded-xl bg-emerald-500/20 px-3 py-2 text-center text-sm font-semibold text-emerald-200">
              {winnerName} scores {preview.scores[winner]} → {(game.players.find((p) => p.id === winner)?.total ?? 0) + preview.scores[winner]}
              {game.targetScore != null && ` of ${game.targetScore}`}
            </div>
          )}
        </>
      )}
      <Button big onClick={submit} disabled={!winner || busy}>
        {busy ? 'Saving…' : winner ? 'Save round' : 'Pick who went out'}
      </Button>
    </div>
  );
}
