import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { ScoringMode } from '../../../src/shared/api';
import { post } from '../api';
import { Button, Card, ErrorNote, Page, Spinner, TextInput } from '../components/ui';
import { useSession } from '../hooks';

interface Preset {
  name: string;
  mode: ScoringMode;
  target: number | null;
  decks?: number;
  jokers?: number;
  deal?: string;
}

const PRESETS: Preset[] = [
  { name: 'Hearts', mode: 'low_wins', target: 100 },
  { name: 'Spades', mode: 'high_wins', target: 500 },
  { name: 'Rummy', mode: 'high_wins', target: 500 },
  { name: 'Gin Rummy', mode: 'high_wins', target: 100 },
  { name: 'Euchre', mode: 'high_wins', target: 10 },
  { name: 'Cribbage', mode: 'high_wins', target: 121 },
  { name: 'Canasta', mode: 'high_wins', target: 5000, decks: 2, jokers: 2 },
  { name: 'Crazy Eights', mode: 'low_wins', target: 100 },
  { name: 'Oh Hell', mode: 'high_wins', target: null },
  { name: 'Custom', mode: 'high_wins', target: null },
];

export function NewGame() {
  const { id = '' } = useParams();
  const q = useSession(id);
  const nav = useNavigate();
  const [preset, setPreset] = useState<Preset>(PRESETS[0]);
  const [customName, setCustomName] = useState('');
  const [mode, setMode] = useState<ScoringMode>(PRESETS[0].mode);
  const [target, setTarget] = useState<string>(String(PRESETS[0].target ?? ''));
  const [seats, setSeats] = useState<string[] | null>(null);
  const [deck, setDeck] = useState(false);
  const [decks, setDecks] = useState(1);
  const [jokers, setJokers] = useState(0);

  const m = useMutation({
    mutationFn: () =>
      post<{ id: string }>(`/sessions/${id}/games`, {
        gameType: preset.name === 'Custom' ? customName.trim() || 'Custom' : preset.name,
        scoringMode: mode,
        targetScore: target.trim() === '' ? null : Number(target),
        playerIds: seatList,
        deckEnabled: deck,
        deck: { decks, jokersPerDeck: jokers },
      }),
    onSuccess: ({ id: gameId }) => nav(`/game/${gameId}`, { replace: true }),
  });

  if (!q.data) return <Spinner />;
  const s = q.data;
  const seatList = seats ?? s.players.map((p) => p.id);

  function pick(p: Preset) {
    setPreset(p);
    setMode(p.mode);
    setTarget(p.target == null ? '' : String(p.target));
    setDecks(p.decks ?? 1);
    setJokers(p.jokers ?? 0);
  }

  function toggle(pid: string) {
    setSeats(seatList.includes(pid) ? seatList.filter((x) => x !== pid) : [...seatList, pid]);
  }

  return (
    <Page title="New game" subtitle={s.name} back={`/s/${id}`}>
      <Card title="Game">
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.name}
              onClick={() => pick(p)}
              className={`min-h-11 rounded-full px-4 font-semibold ${preset.name === p.name ? 'bg-gold-400 text-felt-950' : 'bg-white/10'}`}
            >
              {p.name}
            </button>
          ))}
        </div>
        {preset.name === 'Custom' && (
          <TextInput className="mt-3" value={customName} onChange={(e) => setCustomName(e.target.value)} placeholder="Game name" maxLength={40} />
        )}
      </Card>

      <Card title="Scoring">
        <div className="grid grid-cols-2 gap-2">
          {(['high_wins', 'low_wins'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`min-h-12 rounded-xl font-semibold ${mode === m ? 'bg-gold-400 text-felt-950' : 'bg-white/10'}`}
            >
              {m === 'high_wins' ? '⬆ High wins' : '⬇ Low wins'}
            </button>
          ))}
        </div>
        <label className="mt-3 block text-sm text-white/60">
          Game ends when someone reaches (optional)
          <TextInput
            className="mt-1 font-mono"
            inputMode="numeric"
            value={target}
            onChange={(e) => setTarget(e.target.value.replace(/[^\d-]/g, ''))}
            placeholder="No target"
          />
        </label>
      </Card>

      <Card title={`Players · seat order (${seatList.length})`}>
        <div className="flex flex-col gap-2">
          {seatList.map((pid, i) => {
            const p = s.players.find((x) => x.id === pid)!;
            return (
              <button key={pid} onClick={() => toggle(pid)} className="flex min-h-12 items-center gap-3 rounded-xl bg-gold-400/15 px-3 text-left ring-1 ring-gold-400/40">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gold-400 text-sm font-bold text-felt-950">{i + 1}</span>
                <span className="flex-1 font-semibold">{p?.displayName}</span>
                <span className="text-white/50">✕</span>
              </button>
            );
          })}
          {s.players
            .filter((p) => !seatList.includes(p.id))
            .map((p) => (
              <button key={p.id} onClick={() => toggle(p.id)} className="flex min-h-12 items-center gap-3 rounded-xl bg-white/5 px-3 text-left text-white/60">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-sm">＋</span>
                <span className="flex-1">{p.displayName}</span>
              </button>
            ))}
        </div>
        <p className="mt-2 text-xs text-white/50">Tap to sit out or rejoin. Players are seated (and dealt to) in the order you add them.</p>
      </Card>

      <Card title="Cards">
        <label className="flex min-h-12 items-center justify-between gap-3">
          <span>
            <span className="font-semibold">Virtual deck</span>
            <span className="block text-sm text-white/50">Shuffle &amp; deal to phones. Off = scoring only.</span>
          </span>
          <input type="checkbox" checked={deck} onChange={(e) => setDeck(e.target.checked)} className="h-7 w-7 accent-amber-400" />
        </label>
        {deck && (
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Stepper label="Decks" value={decks} min={1} max={8} onChange={setDecks} />
            <Stepper label="Jokers / deck" value={jokers} min={0} max={2} onChange={setJokers} />
          </div>
        )}
      </Card>

      <ErrorNote error={m.error} />
      <Button big onClick={() => m.mutate()} disabled={seatList.length === 0 || m.isPending}>
        Start game
      </Button>
    </Page>
  );
}

function Stepper({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (n: number) => void }) {
  return (
    <div className="rounded-xl bg-felt-950/40 p-2 text-center">
      <div className="text-xs text-white/50">{label}</div>
      <div className="mt-1 flex items-center justify-between">
        <button className="h-11 w-11 rounded-lg bg-white/10 text-xl" onClick={() => onChange(Math.max(min, value - 1))}>
          −
        </button>
        <span className="font-mono text-xl font-bold">{value}</span>
        <button className="h-11 w-11 rounded-lg bg-white/10 text-xl" onClick={() => onChange(Math.min(max, value + 1))}>
          ＋
        </button>
      </div>
    </div>
  );
}
