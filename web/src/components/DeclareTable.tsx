import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { GameDetail } from '../../../src/shared/api';
import { parseCard, RANKS, SUITS, SUIT_SYMBOL } from '../../../src/shared/cards';
import { classifyThrow, handPoints } from '../../../src/shared/declare';
import type { DeclareView } from '../../../src/server/declare/engine';
import { api, post } from '../api';
import { emitWithAck, getSocket } from '../socket';
import { CardBack, PlayingCard } from './PlayingCard';
import { Button, ErrorNote, Sheet, Spinner } from './ui';

type Move = { type: 'declare' } | { type: 'play'; cards: string[]; take: string };

function sortKey(id: string) {
  const c = parseCard(id);
  return RANKS.indexOf(c.rank as (typeof RANKS)[number]) * 4 + SUITS.indexOf(c.suit!);
}

function short(id: string) {
  const c = parseCard(id);
  return `${c.rank}${SUIT_SYMBOL[c.suit!]}`;
}

function timeLeft(deadline: number) {
  const mins = Math.max(0, Math.round((deadline - Date.now()) / 60000));
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  return h < 48 ? `${h}h ${mins % 60}m` : `${Math.round(h / 24)}d`;
}

const THROW_LABEL = { single: 'Single', set: 'Set', run: 'Run' } as const;

export function DeclareTable({ game, meId }: { game: GameDetail; meId: string }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['deck', game.id],
    queryFn: () => api<{ view: DeclareView }>(`/games/${game.id}/deck`).then((r) => r.view),
  });
  const [selected, setSelected] = useState<string[]>([]);
  const [confirmDeclare, setConfirmDeclare] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const seenHand = useRef<number | null>(null);

  const move = useMutation({
    mutationFn: async (move: Move) => {
      const m = { ...move, version: q.data?.version };
      const s = getSocket(qc);
      if (s.connected) return emitWithAck<DeclareView>(qc, 'declare:action', { gameId: game.id, action: m });
      return (await post<{ view: DeclareView }>(`/games/${game.id}/move`, m)).view;
    },
    onSuccess: (view) => {
      qc.setQueryData(['deck', game.id], view);
      setSelected([]);
    },
  });

  const v = q.data;
  const myTurn = !!v && v.turnPlayerId === meId && game.status === 'active' && game.session.status === 'active';

  // Pop the results when a hand finishes (but not for results we already saw before loading).
  useEffect(() => {
    const n = v?.lastResult?.handNumber ?? 0;
    if (seenHand.current === null) seenHand.current = n;
    else if (n > seenHand.current) {
      seenHand.current = n;
      setShowResult(true);
    }
  }, [v?.lastResult?.handNumber]);

  // Nudge when it becomes your turn.
  useEffect(() => {
    const base = document.title.replace(/^● /, '');
    document.title = myTurn ? `● ${base}` : base;
    if (myTurn) navigator.vibrate?.(60);
    return () => {
      document.title = base;
    };
  }, [myTurn]);

  // Drop selections that are no longer in hand.
  useEffect(() => {
    if (v?.myHand) setSelected((s) => s.filter((c) => v.myHand!.includes(c)));
  }, [v?.myHand]);

  const hand = useMemo(() => [...(v?.myHand ?? [])].sort((a, b) => sortKey(a) - sortKey(b)), [v?.myHand]);

  if (q.isLoading) return <Spinner />;
  if (!v) return <ErrorNote error={q.error} />;

  const name = (id: string | null) => game.players.find((p) => p.id === id)?.displayName ?? 'Someone';
  const total = (id: string) => game.players.find((p) => p.id === id)?.total ?? 0;
  const kind = classifyThrow(selected);
  const myPoints = handPoints(hand);
  const canThrow = myTurn && !!kind && !move.isPending;
  const prevCards = v.lastThrow?.cards ?? [];
  const takeable = new Set(v.lastThrow?.takeable ?? []);
  const toggle = (c: string) => setSelected((s) => (s.includes(c) ? s.filter((x) => x !== c) : [...s, c]));

  return (
    <div className="flex flex-col gap-3">
      {/* Whose turn */}
      <div
        className={`rounded-2xl px-4 py-3 text-center ${
          myTurn ? 'bg-gold-400 text-felt-950' : 'bg-felt-800 text-white/80'
        }`}
      >
        <div className="text-lg font-bold">
          {v.over || game.status !== 'active'
            ? 'Game over'
            : myTurn
              ? 'Your turn'
              : `${name(v.turnPlayerId)}’s turn${game.players.find((p) => p.id === v.turnPlayerId)?.isGuest ? ' (computer)' : ''}`}
        </div>
        <div className={`text-xs ${myTurn ? 'text-felt-900/70' : 'text-white/50'}`}>
          Hand {v.handNumber}
          {v.turnDeadline && !v.over ? ` · auto-plays in ${timeLeft(v.turnDeadline)}` : ''}
          {myTurn ? ' · throw, then take one — or declare' : ''}
        </div>
      </div>

      {/* Players */}
      <div className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1">
        {v.players.map((pid) => (
          <div
            key={pid}
            className={`min-w-20 shrink-0 rounded-xl px-3 py-2 text-center ${
              pid === v.turnPlayerId ? 'bg-felt-600 ring-2 ring-gold-400' : 'bg-felt-800'
            }`}
          >
            <div className="max-w-24 truncate text-sm font-semibold">{pid === meId ? 'You' : name(pid)}</div>
            <div className="text-xs text-white/60">
              🂠 {v.handCounts[pid]} · <span className="font-mono">{total(pid)}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Table: deck + previous throw */}
      <div className="flex items-start justify-center gap-6 rounded-2xl bg-felt-800/80 p-4">
        <div className="flex flex-col items-center gap-1">
          <CardBack size="lg" count={v.drawCount} onClick={canThrow ? () => move.mutate({ type: 'play', cards: selected, take: 'deck' }) : undefined} disabled={myTurn && !canThrow} />
          <span className="text-xs text-white/50">{canThrow ? 'Tap to draw' : 'Deck'}</span>
        </div>
        <div className="flex flex-col items-center gap-1">
          <div className="flex">
            {prevCards.map((c, i) => (
              <div key={c} className={`${i ? '-ml-10' : ''} ${takeable.has(c) ? '' : 'opacity-60'}`}>
                <PlayingCard
                  id={c}
                  size="lg"
                  onClick={canThrow && takeable.has(c) ? () => move.mutate({ type: 'play', cards: selected, take: c }) : undefined}
                />
              </div>
            ))}
          </div>
          <span className="max-w-40 text-center text-xs text-white/50">
            {v.lastThrow?.playerId ? `${name(v.lastThrow.playerId)} threw` : 'Face up'}
            {canThrow ? ' · tap to take' : ''}
          </span>
        </div>
      </div>

      {/* My hand */}
      {v.myHand ? (
        <div className="rounded-2xl bg-felt-800/80 p-4">
          <div className="mb-1 flex items-center justify-between text-sm">
            <span className="text-white/60">
              Your hand · <span className="font-mono font-bold text-white">{myPoints}</span> pts
            </span>
            {selected.length > 0 && (
              <span className={kind ? 'font-semibold text-gold-300' : 'text-red-300'}>
                {kind ? `${THROW_LABEL[kind]} · ${handPoints(selected)} pts` : 'Not a set or run'}
              </span>
            )}
          </div>
          <div className="flex justify-center pt-4">
            {hand.map((c, i) => (
              <div key={c} className={i ? '-ml-3' : ''}>
                <PlayingCard id={c} selected={selected.includes(c)} onClick={myTurn ? () => toggle(c) : undefined} />
              </div>
            ))}
          </div>
          {myTurn && (
            <div className="mt-4 flex flex-col gap-2">
              <Button big disabled={!canThrow} onClick={() => move.mutate({ type: 'play', cards: selected, take: 'deck' })}>
                {selected.length === 0 ? 'Pick cards to throw' : kind ? 'Throw & draw from deck' : 'Pick a set or a run'}
              </Button>
              <Button variant="danger" disabled={move.isPending} onClick={() => setConfirmDeclare(true)}>
                Declare with {myPoints}
              </Button>
            </div>
          )}
        </div>
      ) : (
        <p className="text-center text-sm text-white/60">You’re watching this game.</p>
      )}

      <ErrorNote error={move.error} />

      {/* Recent moves */}
      {v.log.length > 0 && (
        <ul className="flex flex-col gap-1 rounded-2xl bg-felt-950/40 p-3 text-sm text-white/70">
          {[...v.log].reverse().slice(0, 6).map((e, i) => (
            <li key={`${e.at}-${i}`} className={i === 0 ? 'text-white' : ''}>
              <span className="font-semibold">{e.playerId === meId ? 'You' : name(e.playerId)}</span>{' '}
              {e.type === 'declare' ? (
                <>declared — {e.success ? <span className="text-emerald-300">made it</span> : <span className="text-red-300">caught!</span>}</>
              ) : (
                <>
                  threw {e.cards?.map(short).join(' ')} · took {e.took === 'deck' ? 'from deck' : short(e.took!)}
                </>
              )}
              {e.auto && <span className="text-white/40"> (auto)</span>}
            </li>
          ))}
        </ul>
      )}

      {v.lastResult && (
        <Button variant="ghost" onClick={() => setShowResult(true)}>
          Last hand’s results
        </Button>
      )}

      <Sheet open={confirmDeclare} onClose={() => setConfirmDeclare(false)} title={`Declare with ${myPoints}?`}>
        <p className="mb-4 text-white/70">
          If nobody has fewer points, you score 0. If anyone is lower, you get {myPoints} + 20 for each player below you.
        </p>
        <Button
          big
          variant="danger"
          className="w-full"
          onClick={() => {
            setConfirmDeclare(false);
            move.mutate({ type: 'declare' });
          }}
        >
          Declare!
        </Button>
      </Sheet>

      {v.lastResult && (
        <Sheet
          open={showResult}
          onClose={() => setShowResult(false)}
          title={`Hand ${v.lastResult.handNumber}: ${v.lastResult.declarerId === meId ? 'You' : name(v.lastResult.declarerId)} ${
            v.lastResult.success ? 'made it!' : 'got caught!'
          }`}
        >
          <ul className="flex flex-col gap-2">
            {v.players
              .slice()
              .sort((a, b) => v.lastResult!.handPoints[a] - v.lastResult!.handPoints[b])
              .map((pid) => (
                <li key={pid} className={`rounded-xl p-2 ${pid === v.lastResult!.declarerId ? 'bg-gold-400/15 ring-1 ring-gold-400/40' : 'bg-felt-950/40'}`}>
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">
                      {pid === meId ? 'You' : name(pid)}
                      {pid === v.lastResult!.declarerId && ' · declared'}
                    </span>
                    <span className="font-mono">
                      {v.lastResult!.handPoints[pid]} pts →{' '}
                      <span className="font-bold text-gold-300">+{v.lastResult!.scores[pid]}</span>
                    </span>
                  </div>
                  <div className="mt-1 flex gap-1">
                    {v.lastResult!.hands[pid].map((c) => (
                      <PlayingCard key={c} id={c} size="sm" />
                    ))}
                  </div>
                </li>
              ))}
          </ul>
          <Button big className="mt-4 w-full" onClick={() => setShowResult(false)}>
            {v.over ? 'Done' : 'Next hand'}
          </Button>
        </Sheet>
      )}
    </div>
  );
}
