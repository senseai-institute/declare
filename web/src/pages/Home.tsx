import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { post } from '../api';
import { Badge, Button, Card, Empty, ErrorNote, Form, LinkButton, Page, Sheet, Spinner, TextInput } from '../components/ui';
import { fmtDate } from '../format';
import { useHome, useMe } from '../hooks';

export function Home() {
  const me = useMe().data!;
  const home = useHome(true);
  const nav = useNavigate();
  const [code, setCode] = useState('');
  const [newGroup, setNewGroup] = useState(false);

  const active = home.data?.sessions.filter((s) => s.status === 'active') ?? [];
  const past = home.data?.sessions.filter((s) => s.status === 'closed') ?? [];

  return (
    <Page
      right={
        <Link to="/me" className="flex h-11 items-center rounded-full bg-white/10 px-3 text-sm font-semibold">
          {me.displayName}
        </Link>
      }
    >
      {home.data?.yourTurn.map((t) => (
        <Link key={t.gameId} to={`/game/${t.gameId}`} className="flex items-center justify-between rounded-2xl bg-gold-400 p-4 text-felt-950 active:bg-gold-500">
          <div>
            <div className="text-lg font-bold">Your turn!</div>
            <div className="text-sm text-felt-900/80">
              {t.gameType} · {t.sessionName}
              {t.turnDeadline ? ` · auto-plays ${new Date(t.turnDeadline).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}` : ''}
            </div>
          </div>
          <span className="text-2xl">›</span>
        </Link>
      ))}

      <Card title="Join with a code">
        <Form
          className="flex gap-2"
          onSubmit={() => {
            if (code.trim()) nav(`/join/${code.trim().toUpperCase()}`);
          }}
        >
          <TextInput
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
            placeholder="ABC123"
            className="font-mono text-xl tracking-[0.3em] uppercase"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
          />
          <Button type="button" data-submit disabled={code.length < 6}>
            Join
          </Button>
        </Form>
      </Card>

      <div className="grid grid-cols-2 gap-3">
        <LinkButton to="/new-session" variant="primary" className="min-h-16 text-base">
          ▶ Quick session
        </LinkButton>
        <Button variant="secondary" className="min-h-16" onClick={() => setNewGroup(true)}>
          ＋ New group
        </Button>
      </div>

      {home.isLoading ? (
        <Spinner />
      ) : (
        <>
          {active.length > 0 && (
            <Card title="Playing now">
              <ul className="flex flex-col gap-2">
                {active.map((s) => (
                  <li key={s.id}>
                    <Link to={`/s/${s.id}`} className="flex items-center justify-between rounded-xl bg-felt-950/40 p-3 active:bg-felt-950/70">
                      <div className="min-w-0">
                        <div className="truncate font-semibold">{s.name}</div>
                        <div className="text-xs text-white/50">{s.group?.name ?? 'Ad-hoc'} · {s.gameCount} games</div>
                      </div>
                      <Badge tone="live">Live</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card title="Your groups">
            {home.data?.groups.length ? (
              <ul className="flex flex-col gap-2">
                {home.data.groups.map((g) => (
                  <li key={g.id}>
                    <Link to={`/g/${g.id}`} className="flex items-center justify-between rounded-xl bg-felt-950/40 p-3 active:bg-felt-950/70">
                      <div className="min-w-0">
                        <div className="truncate font-semibold">{g.name}</div>
                        <div className="text-xs text-white/50">{g.memberCount} players</div>
                      </div>
                      {g.activeSession && <Badge tone="live">{g.activeSession.name}</Badge>}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>Make a group for your regular crew to track who wins over time.</Empty>
            )}
          </Card>

          {past.length > 0 && (
            <Card title="Past sessions">
              <ul className="divide-y divide-white/5">
                {past.map((s) => (
                  <li key={s.id}>
                    <Link to={`/s/${s.id}`} className="flex items-center justify-between py-2.5">
                      <span className="truncate">{s.name}</span>
                      <span className="shrink-0 text-xs text-white/50">{fmtDate(s.startedAt)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
      <NewGroupSheet open={newGroup} onClose={() => setNewGroup(false)} />
    </Page>
  );
}

function NewGroupSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState('');
  const nav = useNavigate();
  const m = useMutation({
    mutationFn: () => post<{ id: string }>('/groups', { name: name.trim() }),
    onSuccess: ({ id }) => nav(`/g/${id}`),
  });
  return (
    <Sheet open={open} onClose={onClose} title="New group">
      <Form
        className="flex flex-col gap-3"
        onSubmit={() => {
          if (name.trim()) m.mutate();
        }}
      >
        <TextInput autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Beach House Crew" maxLength={40} />
        <ErrorNote error={m.error} />
        <Button type="button" data-submit big disabled={!name.trim() || m.isPending}>
          Create group
        </Button>
      </Form>
    </Sheet>
  );
}
