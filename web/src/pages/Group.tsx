import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { StandingRow } from '../../../src/shared/api';
import { api, post } from '../api';
import { Invite } from '../components/Invite';
import { Standings } from '../components/Standings';
import { Badge, Button, Card, Empty, ErrorNote, LinkButton, Page, Sheet, Spinner, TextInput } from '../components/ui';
import { fmtDate } from '../format';
import { useGroup } from '../hooks';

export function GroupPage() {
  const { id = '' } = useParams();
  const q = useGroup(id);
  const [gameType, setGameType] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const filtered = useQuery({
    queryKey: ['group', id, 'leaderboard', gameType],
    queryFn: () => api<{ leaderboard: StandingRow[] }>(`/groups/${id}/leaderboard?gameType=${encodeURIComponent(gameType)}`),
    enabled: !!gameType,
  });

  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <Page back="/" title="Group"><ErrorNote error={q.error} /></Page>;
  const g = q.data;
  const board = gameType ? (filtered.data?.leaderboard ?? []) : g.leaderboard;

  return (
    <Page title={g.name} subtitle={`${g.members.length} players · since ${fmtDate(g.createdAt)}`} back="/">
      {g.activeSession ? (
        <LinkButton to={`/s/${g.activeSession.id}`} variant="primary" className="min-h-14 text-lg">
          ▶ Back to {g.activeSession.name}
        </LinkButton>
      ) : (
        <LinkButton to={`/new-session?group=${g.id}`} variant="primary" className="min-h-14 text-lg">
          ▶ Start a session
        </LinkButton>
      )}

      <Card title="Leaderboard">
        {g.gameTypes.length > 1 && (
          <div className="-mx-1 mb-3 flex gap-2 overflow-x-auto px-1 pb-1">
            {['', ...g.gameTypes].map((t) => (
              <button
                key={t || 'all'}
                onClick={() => setGameType(t)}
                className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-semibold ${gameType === t ? 'bg-gold-400 text-felt-950' : 'bg-white/10'}`}
              >
                {t || 'All games'}
              </button>
            ))}
          </div>
        )}
        {gameType && filtered.isLoading ? <Spinner /> : <Standings rows={board} showSessions />}
      </Card>

      <Card title="Invite">
        <Invite code={g.joinCode} label={g.name} />
      </Card>

      <Card
        title="Players"
        action={
          <Button variant="ghost" onClick={() => setAddOpen(true)} className="!min-h-9 text-sm">
            ＋ Add
          </Button>
        }
      >
        <div className="flex flex-wrap gap-2">
          {g.members.map((m) => (
            <span key={m.id} className="rounded-full bg-white/10 px-3 py-1.5 text-sm">
              {m.displayName}
              {m.isGuest && <span className="text-white/40"> · guest</span>}
            </span>
          ))}
        </div>
      </Card>

      <Card title="Sessions">
        {g.sessions.length ? (
          <ul className="divide-y divide-white/5">
            {g.sessions.map((s) => (
              <li key={s.id}>
                <Link to={`/s/${s.id}`} className="flex items-center justify-between gap-2 py-2.5">
                  <span className="min-w-0 truncate">{s.name}</span>
                  <span className="flex shrink-0 items-center gap-2 text-xs text-white/50">
                    {s.gameCount} games · {fmtDate(s.startedAt)}
                    {s.status === 'active' && <Badge tone="live">Live</Badge>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>No sessions yet.</Empty>
        )}
      </Card>
      <AddGuestSheet open={addOpen} onClose={() => setAddOpen(false)} groupId={g.id} />
    </Page>
  );
}

function AddGuestSheet({ open, onClose, groupId }: { open: boolean; onClose: () => void; groupId: string }) {
  const [name, setName] = useState('');
  const m = useMutation({
    mutationFn: () => post(`/groups/${groupId}/members`, { displayName: name.trim() }),
    onSuccess: () => {
      setName('');
      onClose();
    },
  });
  return (
    <Sheet open={open} onClose={onClose} title="Add a player">
      <p className="mb-3 text-sm text-white/60">
        For someone without a phone. They can claim this name later by joining with the group code.
      </p>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) m.mutate();
        }}
      >
        <TextInput autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" maxLength={40} />
        <ErrorNote error={m.error} />
        <Button type="submit" disabled={!name.trim() || m.isPending}>
          Add
        </Button>
      </form>
    </Sheet>
  );
}
