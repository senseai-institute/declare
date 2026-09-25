import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import type { AuditEntry, GameDetail, RoundDetail } from '../../../src/shared/api';
import { api, post, put } from '../api';
import { DeckPanel } from '../components/DeckPanel';
import { DeclareRoundEntry } from '../components/DeclareRoundEntry';
import { DeclareTable } from '../components/DeclareTable';
import { ScoreGrid } from '../components/ScoreGrid';
import { Badge, Button, Card, Empty, ErrorNote, Page, Sheet, Spinner } from '../components/ui';
import { fmtTime } from '../format';
import { useGame, useMe } from '../hooks';

export function GamePage() {
  const { id = '' } = useParams();
  const me = useMe().data!;
  const q = useGame(id);
  const [tab, setTab] = useState<'scores' | 'cards' | null>(null);

  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <Page back="/" title="Game"><ErrorNote error={q.error} /></Page>;
  const g = q.data;
  const online = g.rules === 'declare' && g.deckEnabled;
  const current = tab ?? (online && g.status === 'active' ? 'cards' : 'scores');

  return (
    <Page
      title={g.gameType}
      subtitle={`${g.session.name} · ${
        g.rules === 'declare' ? (online ? 'online' : 'at the table') : g.scoringMode === 'low_wins' ? 'low wins' : 'high wins'
      }${g.targetScore != null ? ` · to ${g.targetScore}` : ''}`}
      back={`/s/${g.session.id}`}
      right={g.status === 'active' ? <Badge tone="live">{g.rules === 'declare' ? 'Hand ' : 'R'}{g.rounds.length + 1}</Badge> : <Badge>{g.status === 'finished' ? 'Final' : 'Ended'}</Badge>}
    >
      {!(online && current === 'cards' && g.status === 'active') && <Totals g={g} />}
      {g.deckEnabled && (
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-felt-950/50 p-1">
          {(['scores', 'cards'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`min-h-11 rounded-lg font-semibold capitalize ${current === t ? 'bg-felt-700 text-white' : 'text-white/60'}`}
            >
              {t === 'scores' ? '📝 Scores' : online ? '🃏 Table' : '🃏 Cards'}
            </button>
          ))}
        </div>
      )}
      {current === 'cards' && g.deckEnabled ? (
        online ? (
          <DeclareTable game={g} meId={me.id} />
        ) : (
          <DeckPanel game={g} meId={me.id} />
        )
      ) : (
        <Scores g={g} />
      )}
    </Page>
  );
}

function Totals({ g }: { g: GameDetail }) {
  const sorted = [...g.players].sort((a, b) => a.place - b.place || a.seat - b.seat);
  const winner = g.players.find((p) => p.id === g.winnerPlayerId);
  return (
    <div className="flex flex-col gap-2">
      {g.status !== 'active' && (
        <div className="rounded-2xl bg-gold-400/15 p-4 text-center ring-1 ring-gold-400/40">
          <div className="text-4xl">🏆</div>
          <div className="font-display text-2xl font-bold text-gold-300">{winner ? `${winner.displayName} wins!` : 'No winner'}</div>
          <div className="text-sm text-white/60">after {g.rounds.length} round{g.rounds.length === 1 ? '' : 's'}</div>
        </div>
      )}
      <div className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1">
        {sorted.map((p) => {
          const lead = p.place === 1 && g.rounds.length > 0;
          return (
            <div
              key={p.id}
              className={`min-w-24 flex-1 shrink-0 rounded-2xl p-3 text-center ${lead ? 'bg-gold-400 text-felt-950' : 'bg-felt-800'}`}
            >
              <div className="truncate text-sm font-semibold">
                {lead ? '👑 ' : ''}
                {p.displayName}
              </div>
              <div className="font-mono text-3xl font-bold leading-tight">{p.total}</div>
              {g.targetScore != null && g.status === 'active' && (
                <div className={`text-xs ${lead ? 'text-felt-900/70' : 'text-white/40'}`}>{g.targetScore - p.total} to go</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Scores({ g }: { g: GameDetail }) {
  const [editing, setEditing] = useState<RoundDetail | null>(null);
  const [endOpen, setEndOpen] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const canPlay = g.status === 'active' && g.session.status === 'active';
  const submit = useMutation({ mutationFn: (scores: Record<string, number>) => post(`/games/${g.id}/rounds`, { scores }) });
  const submitDeclare = useMutation({
    mutationFn: (declare: { declarerId: string; hands: Record<string, number> }) => post(`/games/${g.id}/rounds`, { declare }),
  });
  const nextRound = g.rounds.length + 1;
  const isDeclare = g.rules === 'declare';

  return (
    <>
      {canPlay && isDeclare && !g.deckEnabled && (
        <Card title={`Hand ${nextRound}`}>
          <DeclareRoundEntry game={g} onSubmit={(b) => submitDeclare.mutateAsync(b)} busy={submitDeclare.isPending} />
          <div className="mt-2">
            <ErrorNote error={submitDeclare.error} />
          </div>
        </Card>
      )}
      {canPlay && !isDeclare && (
        <Card title={`Round ${nextRound}`}>
          <ScoreGrid key={nextRound} players={g.players} submitLabel={`Submit round ${nextRound}`} onSubmit={(s) => submit.mutateAsync(s)} busy={submit.isPending} />
          <div className="mt-2">
            <ErrorNote error={submit.error} />
          </div>
        </Card>
      )}

      <Card
        title={isDeclare ? "Hands" : "Rounds"}
        action={
          <button onClick={() => setAuditOpen(true)} className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold">
            Edit log
          </button>
        }
      >
        {g.rounds.length === 0 ? (
          <Empty>No rounds yet.</Empty>
        ) : (
          <>
            <div className="-mx-4 overflow-x-auto px-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-white/50">
                    <th className="sticky left-0 bg-felt-800 py-1 pr-2 text-left font-medium">#</th>
                    {g.players.map((p) => (
                      <th key={p.id} className="max-w-20 truncate px-2 py-1 text-right font-medium">
                        {p.displayName}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...g.rounds].reverse().map((r) => (
                    <tr key={r.id} onClick={() => setEditing(r)} className="cursor-pointer border-t border-white/5 active:bg-white/5">
                      <td className="sticky left-0 bg-felt-800 py-2.5 pr-2 text-white/50">
                        {r.roundNumber} <span className="text-xs">✎</span>
                      </td>
                      {g.players.map((p) => {
                        const s = r.scores[p.id];
                        return (
                          <td key={p.id} className={`px-2 py-2.5 text-right font-mono ${s && s.points < 0 ? 'text-red-300' : ''}`}>
                            {r.declarerId === p.id && (
                              <span className={r.declareSuccess ? 'text-emerald-300' : 'text-red-300'} title={r.declareSuccess ? 'Declared — made it' : 'Declared — caught'}>
                                {r.declareSuccess ? '✓' : '✗'}{' '}
                              </span>
                            )}
                            {s ? s.points : '–'}
                            {s?.edited && <span className="text-gold-400" title="Edited">*</span>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  <tr className="border-t-2 border-white/20 font-bold">
                    <td className="sticky left-0 bg-felt-800 py-2 pr-2">Σ</td>
                    {g.players.map((p) => (
                      <td key={p.id} className="px-2 py-2 text-right font-mono">
                        {p.total}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-white/40">
              Tap a round to fix a score. * = edited{isDeclare ? ' · ✓/✗ = declared (made it / caught)' : ''}.
            </p>
          </>
        )}
      </Card>

      {g.status === 'active' && (
        <Button variant="secondary" onClick={() => setEndOpen(true)}>
          End game
        </Button>
      )}

      {editing && <EditRoundSheet g={g} round={editing} onClose={() => setEditing(null)} />}
      <EndGameSheet g={g} open={endOpen} onClose={() => setEndOpen(false)} />
      <AuditSheet gameId={g.id} open={auditOpen} onClose={() => setAuditOpen(false)} />
    </>
  );
}

function EditRoundSheet({ g, round, onClose }: { g: GameDetail; round: RoundDetail; onClose: () => void }) {
  const m = useMutation({
    mutationFn: (scores: Record<string, number>) => put(`/games/${g.id}/rounds/${round.id}`, { scores }),
    onSuccess: onClose,
  });
  const initial = Object.fromEntries(g.players.map((p) => [p.id, round.scores[p.id]?.points ?? 0]));
  return (
    <Sheet open onClose={onClose} title={`Edit round ${round.roundNumber}`}>
      <p className="mb-3 text-xs text-white/50">Entered {fmtTime(round.createdAt)}. Changes are logged.</p>
      <ScoreGrid players={g.players.map(({ id, displayName }) => ({ id, displayName }))} initial={initial} submitLabel="Save changes" onSubmit={(s) => m.mutateAsync(s)} busy={m.isPending} requireAny={false} />
      <div className="mt-2">
        <ErrorNote error={m.error} />
      </div>
    </Sheet>
  );
}

function EndGameSheet({ g, open, onClose }: { g: GameDetail; open: boolean; onClose: () => void }) {
  const leaders = g.players.filter((p) => p.place === 1);
  const suggested = g.rounds.length > 0 && leaders.length === 1 ? leaders[0].id : null;
  const [choice, setChoice] = useState<string | null | undefined>(undefined);
  const picked = choice === undefined ? suggested : choice;
  const m = useMutation({
    mutationFn: () => post(`/games/${g.id}/end`, choice === undefined ? {} : { winnerPlayerId: choice }),
    onSuccess: onClose,
  });
  return (
    <Sheet open={open} onClose={onClose} title="End game">
      <p className="mb-3 text-sm text-white/60">Who won? {suggested ? 'The current leader is picked for you.' : 'It’s tied — pick a winner or call it a draw.'}</p>
      <div className="flex flex-col gap-2">
        {[...g.players]
          .sort((a, b) => a.place - b.place)
          .map((p) => (
            <button
              key={p.id}
              onClick={() => setChoice(p.id)}
              className={`flex min-h-12 items-center justify-between rounded-xl px-4 font-semibold ${picked === p.id ? 'bg-gold-400 text-felt-950' : 'bg-white/10'}`}
            >
              <span>{p.displayName}</span>
              <span className="font-mono">{p.total}</span>
            </button>
          ))}
        <button
          onClick={() => setChoice(null)}
          className={`min-h-12 rounded-xl px-4 font-semibold ${picked === null ? 'bg-gold-400 text-felt-950' : 'bg-white/5 text-white/60'}`}
        >
          No winner / draw
        </button>
      </div>
      <ErrorNote error={m.error} />
      <Button big className="mt-4 w-full" onClick={() => m.mutate()} disabled={m.isPending}>
        End game
      </Button>
    </Sheet>
  );
}

function AuditSheet({ gameId, open, onClose }: { gameId: string; open: boolean; onClose: () => void }) {
  const q = useQuery({
    queryKey: ['audit', gameId],
    queryFn: () => api<{ audit: AuditEntry[] }>(`/games/${gameId}/audit`).then((r) => r.audit),
    enabled: open,
  });
  return (
    <Sheet open={open} onClose={onClose} title="Score edits">
      {q.isLoading ? (
        <Spinner />
      ) : q.data?.length ? (
        <ul className="divide-y divide-white/5 text-sm">
          {q.data.map((a) => (
            <li key={a.id} className="py-2">
              <div>
                <span className="font-semibold">{a.changedByName}</span> changed <span className="font-semibold">{a.playerName}</span> in round {a.roundNumber}:{' '}
                <span className="font-mono text-white/60 line-through">{a.oldPoints ?? '–'}</span> → <span className="font-mono text-gold-300">{a.newPoints}</span>
              </div>
              <div className="text-xs text-white/40">{new Date(a.changedAt).toLocaleString()}</div>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>No edits — every score is as first entered.</Empty>
      )}
    </Sheet>
  );
}
