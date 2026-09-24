import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import type { GameDetail } from '../../../src/shared/api';
import { parseCard, RANKS, SUITS, type DeckView } from '../../../src/shared/cards';
import { api, post } from '../api';
import { emitWithAck, getSocket } from '../socket';
import { CardBack, EmptySlot, PlayingCard } from './PlayingCard';
import { Button, Card, ErrorNote, Sheet, Spinner } from './ui';

type Action =
  | { type: 'shuffle' }
  | { type: 'deal'; count: number }
  | { type: 'draw'; count?: number }
  | { type: 'draw_discard' }
  | { type: 'discard'; cards: string[] }
  | { type: 'reshuffle'; keepTop?: boolean }
  | { type: 'reset' };

function sortKey(id: string) {
  const c = parseCard(id);
  if (c.joker) return 999;
  return SUITS.indexOf(c.suit!) * 20 + RANKS.indexOf(c.rank as (typeof RANKS)[number]);
}

export function DeckPanel({ game, meId }: { game: GameDetail; meId: string }) {
  const qc = useQueryClient();
  const deck = useQuery({
    queryKey: ['deck', game.id],
    queryFn: () => api<{ view: DeckView }>(`/games/${game.id}/deck`).then((r) => r.view),
  });
  const [selected, setSelected] = useState<string[]>([]);
  const [sorted, setSorted] = useState(true);
  const [dealCount, setDealCount] = useState(7);
  const [confirmReset, setConfirmReset] = useState(false);

  const act = useMutation({
    mutationFn: async (action: Action) => {
      // Prefer the live socket; fall back to REST if it's not connected.
      const s = getSocket(qc);
      if (s.connected) return emitWithAck<DeckView>(qc, 'deck:action', { gameId: game.id, action });
      const { type, ...body } = action;
      return (await post<{ view: DeckView }>(`/games/${game.id}/deck/${type}`, body)).view;
    },
    onSuccess: (view) => {
      qc.setQueryData(['deck', game.id], view);
      setSelected([]);
    },
  });

  const view = deck.data;
  const hand = useMemo(() => {
    const h = view?.myHand ?? [];
    return sorted ? [...h].sort((a, b) => sortKey(a) - sortKey(b)) : h;
  }, [view?.myHand, sorted]);

  if (deck.isLoading) return <Spinner />;
  if (!view) return <ErrorNote error={deck.error} />;

  const playing = game.status === 'active' && game.session.status === 'active';
  const inGame = view.myHand !== null;
  const busy = act.isPending;
  const others = game.players.filter((p) => p.id !== meId);

  return (
    <div className="flex flex-col gap-4">
      <Card title="Table">
        <div className="mb-4 flex flex-wrap gap-2">
          {others.map((p) => (
            <div key={p.id} className="flex items-center gap-2 rounded-full bg-felt-950/50 py-1 pl-3 pr-1 text-sm">
              <span className="max-w-24 truncate">{p.displayName}</span>
              <span className="rounded-full bg-white/10 px-2 py-0.5 font-mono font-bold">🂠 {view.handCounts[p.id] ?? 0}</span>
            </div>
          ))}
        </div>
        <div className="flex items-end justify-center gap-8">
          <div className="flex flex-col items-center gap-1">
            {view.drawCount > 0 ? (
              <CardBack size="lg" count={view.drawCount} onClick={inGame && playing ? () => act.mutate({ type: 'draw' }) : undefined} disabled={busy} />
            ) : (
              <EmptySlot size="lg" label="Draw pile empty" />
            )}
            <span className="text-xs text-white/50">{inGame && playing && view.drawCount > 0 ? 'Tap to draw' : 'Draw pile'}</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            {view.discardTop ? (
              <PlayingCard id={view.discardTop} size="lg" onClick={inGame && playing ? () => act.mutate({ type: 'draw_discard' }) : undefined} />
            ) : (
              <EmptySlot size="lg" label="Discard" />
            )}
            <span className="text-xs text-white/50">
              {view.discardCount > 0 ? `Discard · ${view.discardCount}${inGame && playing ? ' · tap to take' : ''}` : 'Discard'}
            </span>
          </div>
        </div>
      </Card>

      {inGame ? (
        <Card
          title={`Your hand (${hand.length})`}
          action={
            <button onClick={() => setSorted((s) => !s)} className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold">
              {sorted ? 'Sorted' : 'As dealt'}
            </button>
          }
        >
          {hand.length === 0 ? (
            <p className="py-4 text-center text-sm text-white/50">No cards yet — deal or draw.</p>
          ) : (
            <div className="-mx-4 overflow-x-auto px-4 pb-2 pt-4">
              <div className="flex">
                {hand.map((c, i) => (
                  <div key={c} className={i === 0 ? '' : '-ml-6'}>
                    <PlayingCard
                      id={c}
                      selected={selected.includes(c)}
                      onClick={playing ? () => setSelected((s) => (s.includes(c) ? s.filter((x) => x !== c) : [...s, c])) : undefined}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
          {playing && (
            <Button className="mt-2 w-full" disabled={selected.length === 0 || busy} onClick={() => act.mutate({ type: 'discard', cards: selected })}>
              Discard{selected.length ? ` ${selected.length} card${selected.length > 1 ? 's' : ''}` : ''}
            </Button>
          )}
        </Card>
      ) : (
        <Card>
          <p className="text-sm text-white/60">You’re watching — you’re not seated in this game.</p>
        </Card>
      )}

      <ErrorNote error={act.error} />

      {playing && inGame && (
        <Card title="Dealer">
          <div className="flex items-center gap-2">
            <div className="flex items-center rounded-xl bg-felt-950/50">
              <button className="h-11 w-11 text-xl" onClick={() => setDealCount((n) => Math.max(1, n - 1))} aria-label="Fewer">
                −
              </button>
              <span className="w-8 text-center font-mono text-lg font-bold">{dealCount}</span>
              <button className="h-11 w-11 text-xl" onClick={() => setDealCount((n) => Math.min(60, n + 1))} aria-label="More">
                ＋
              </button>
            </div>
            <Button className="flex-1" disabled={busy} onClick={() => act.mutate({ type: 'deal', count: dealCount })}>
              Deal {dealCount} each
            </Button>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2">
            <Button variant="secondary" disabled={busy} onClick={() => act.mutate({ type: 'shuffle' })}>
              Shuffle
            </Button>
            <Button variant="secondary" disabled={busy || view.discardCount < 2} onClick={() => act.mutate({ type: 'reshuffle' })}>
              Reshuffle discard
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => setConfirmReset(true)}>
              New hand
            </Button>
          </div>
          <p className="mt-2 text-xs text-white/40">
            {view.config.decks} deck{view.config.decks > 1 ? 's' : ''}
            {view.config.jokersPerDeck ? ` + ${view.config.jokersPerDeck * view.config.decks} jokers` : ''} · shuffled on the server
          </p>
        </Card>
      )}

      <Sheet open={confirmReset} onClose={() => setConfirmReset(false)} title="Collect all cards?">
        <p className="mb-4 text-white/70">Everyone’s hand and the discard pile go back into a freshly shuffled deck.</p>
        <Button
          big
          className="w-full"
          onClick={() => {
            act.mutate({ type: 'reset' });
            setConfirmReset(false);
          }}
        >
          Collect &amp; shuffle
        </Button>
      </Sheet>
    </div>
  );
}
