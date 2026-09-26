import { useState } from 'react';
import type { GameDetail } from '../../../src/shared/api';
import { scoreDeclare } from '../../../src/shared/declare';
import { Button } from './ui';

/**
 * Declare at the table: tap who declared, type everyone's hand points, and the
 * app works out the round (0 for a good declare, +20 per lower player if not).
 */
export function DeclareRoundEntry({
  game,
  onSubmit,
  busy,
}: {
  game: GameDetail;
  onSubmit: (body: { declarerId: string; hands: Record<string, number> }) => Promise<unknown>;
  busy: boolean;
}) {
  const [declarer, setDeclarer] = useState<string | null>(null);
  const [pts, setPts] = useState<Record<string, string>>({});
  const filled = game.players.every((p) => pts[p.id] !== undefined && pts[p.id] !== '');
  const hands = Object.fromEntries(game.players.map((p) => [p.id, Number(pts[p.id] || 0)]));
  const preview = declarer && filled ? scoreDeclare(declarer, hands) : null;

  async function submit() {
    if (!declarer || !filled) return;
    try {
      await onSubmit({ declarerId: declarer, hands });
      setDeclarer(null);
      setPts({});
    } catch {
      /* error shown by caller */
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="mb-2 text-sm text-white/60">Who declared?</div>
        <div className="flex flex-wrap gap-2">
          {game.players.map((p) => (
            <button
              key={p.id}
              onClick={() => setDeclarer(p.id)}
              className={`min-h-11 rounded-full px-4 font-semibold ${declarer === p.id ? 'bg-gold-400 text-felt-950' : 'bg-white/10'}`}
            >
              {p.displayName}
            </button>
          ))}
        </div>
      </div>
      <div className="text-sm text-white/60">Points in each hand (face cards 10, ace 1)</div>
      {game.players.map((p) => {
        const add = preview?.scores[p.id];
        return (
          <div key={p.id} className="flex items-center gap-2 rounded-xl bg-felt-950/40 p-2">
            <div className="min-w-0 flex-1 pl-1">
              <div className="truncate font-semibold">
                {p.displayName}
                {p.id === declarer && <span className="text-gold-300"> · declared</span>}
              </div>
              <div className="text-xs text-white/50">
                {p.total}
                {add !== undefined && <span className="text-gold-300"> + {add} → {p.total + add}</span>}
              </div>
            </div>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              placeholder="–"
              value={pts[p.id] ?? ''}
              onChange={(e) => setPts((s) => ({ ...s, [p.id]: e.target.value.replace(/\D/g, '').slice(0, 3) }))}
              className="h-14 w-24 rounded-xl bg-felt-950/70 px-3 text-right font-mono text-2xl font-bold outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-gold-400"
              aria-label={`Hand points for ${p.displayName}`}
            />
          </div>
        );
      })}
      {preview && (
        <div className={`rounded-xl px-3 py-2 text-center text-sm font-semibold ${preview.success ? 'bg-emerald-500/20 text-emerald-200' : 'bg-red-500/20 text-red-200'}`}>
          {preview.success
            ? `${game.players.find((p) => p.id === declarer)?.displayName} made it — scores 0`
            : `Caught! ${preview.lowerCount} player${preview.lowerCount > 1 ? 's were' : ' was'} lower (+${20 * preview.lowerCount})`}
        </div>
      )}
      <Button big onClick={submit} disabled={!preview || busy}>
        {busy ? 'Saving…' : !declarer ? 'Pick who declared' : !filled ? 'Enter every hand' : 'Save hand'}
      </Button>
    </div>
  );
}
