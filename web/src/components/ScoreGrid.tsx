import { useRef, useState } from 'react';
import { Button, Form } from './ui';

interface Row {
  id: string;
  displayName: string;
  total?: number;
}

type Entry = { neg: boolean; digits: string };

function toEntry(n: number | undefined): Entry {
  if (n === undefined) return { neg: false, digits: '' };
  return { neg: n < 0, digits: String(Math.abs(n)) };
}

function valueOf(e: Entry): number {
  const n = Number(e.digits || '0');
  return e.neg ? -n : n;
}

/**
 * Fast numeric entry: one big row per player, a +/- toggle (phone number pads
 * often lack a minus key), and running totals previewed as you type.
 */
export function ScoreGrid({
  players,
  initial,
  submitLabel,
  onSubmit,
  busy,
  requireAny = true,
}: {
  players: Row[];
  initial?: Record<string, number>;
  submitLabel: string;
  onSubmit: (scores: Record<string, number>) => Promise<unknown> | void;
  busy?: boolean;
  requireAny?: boolean;
}) {
  const [entries, setEntries] = useState<Record<string, Entry>>(() =>
    Object.fromEntries(players.map((p) => [p.id, toEntry(initial?.[p.id])])),
  );
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const any = Object.values(entries).some((e) => e.digits !== '');

  const set = (id: string, patch: Partial<Entry>) =>
    setEntries((prev) => ({ ...prev, [id]: { ...(prev[id] ?? toEntry(undefined)), ...patch } }));

  async function submit() {
    if (busy || (requireAny && !any)) return;
    const scores = Object.fromEntries(players.map((p) => [p.id, valueOf(entries[p.id] ?? toEntry(undefined))]));
    try {
      await onSubmit(scores);
    } catch {
      return; // the caller shows the error; keep what was typed
    }
    if (!initial) setEntries(Object.fromEntries(players.map((p) => [p.id, toEntry(undefined)])));
  }

  return (
    <Form
      className="flex flex-col gap-2"
      onSubmit={() => {
        void submit();
      }}
    >
      {players.map((p, i) => {
        const e = entries[p.id] ?? toEntry(undefined);
        const v = valueOf(e);
        return (
          <div key={p.id} className="flex items-center gap-2 rounded-xl bg-felt-950/40 p-2">
            <div className="min-w-0 flex-1 pl-1">
              <div className="truncate font-semibold">{p.displayName}</div>
              {p.total !== undefined && (
                <div className="text-xs text-white/50">
                  {p.total}
                  {e.digits !== '' && v !== 0 && <span className="text-gold-300"> → {p.total + v}</span>}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => set(p.id, { neg: !e.neg })}
              className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-xl text-2xl font-bold ${
                e.neg ? 'bg-red-500/80 text-white' : 'bg-white/10 text-white/80'
              }`}
              aria-label={`Toggle sign for ${p.displayName}`}
            >
              {e.neg ? '−' : '+'}
            </button>
            <input
              ref={(el) => {
                inputs.current[i] = el;
              }}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="off"
              enterKeyHint={i === players.length - 1 ? 'done' : 'next'}
              placeholder="0"
              value={e.digits}
              onChange={(ev) => set(p.id, { digits: ev.target.value.replace(/\D/g, '').slice(0, 7) })}
              onKeyDown={(ev) => {
                if (ev.key === '-') {
                  ev.preventDefault();
                  set(p.id, { neg: !e.neg });
                } else if (ev.key === 'Enter' && i < players.length - 1) {
                  ev.preventDefault();
                  inputs.current[i + 1]?.focus();
                }
              }}
              className={`h-14 w-28 shrink-0 rounded-xl bg-felt-950/70 px-3 text-right font-mono text-2xl font-bold outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-gold-400 ${
                e.neg ? 'text-red-300' : 'text-white'
              }`}
              aria-label={`Points for ${p.displayName}`}
            />
          </div>
        );
      })}
      <Button type="button" data-submit big disabled={busy || (requireAny && !any)} className="mt-1 w-full">
        {busy ? 'Saving…' : submitLabel}
      </Button>
    </Form>
  );
}
