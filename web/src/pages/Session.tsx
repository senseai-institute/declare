import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import type { SessionDetail } from '../../../src/shared/api';
import { post } from '../api';
import { GameList } from '../components/GameList';
import { Invite } from '../components/Invite';
import { Standings } from '../components/Standings';
import { Badge, Button, Card, ErrorNote, LinkButton, Page, Sheet, Spinner, TextInput } from '../components/ui';
import { fmtDate, fmtDuration } from '../format';
import { useSession } from '../hooks';

export function SessionPage() {
  const { id = '' } = useParams();
  const q = useSession(id);
  const [addOpen, setAddOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const reopen = useMutation({ mutationFn: () => post(`/sessions/${id}/reopen`) });

  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <Page back="/" title="Session"><ErrorNote error={q.error} /></Page>;
  const s = q.data;
  const back = s.group ? `/g/${s.group.id}` : '/';
  const closed = s.status === 'closed';

  return (
    <Page
      title={s.name}
      subtitle={`${s.group?.name ?? 'Ad-hoc'} · ${fmtDate(s.startedAt)}`}
      back={back}
      right={closed ? <Badge>Closed</Badge> : <Badge tone="live">Live</Badge>}
    >
      {closed ? (
        <Summary s={s} />
      ) : (
        <>
          <LinkButton to={`/s/${s.id}/new-game`} variant="primary" className="min-h-14 text-lg">
            ＋ New game
          </LinkButton>
          {s.games.some((g) => g.status === 'active') && (
            <Card title="In progress">
              <GameList games={s.games.filter((g) => g.status === 'active')} />
            </Card>
          )}
          <Card title="Session standings">
            <Standings rows={s.standings} />
          </Card>
          <Card
            title={`Players (${s.players.length})`}
            action={
              <Button variant="ghost" onClick={() => setAddOpen(true)} className="!min-h-9 text-sm">
                ＋ Add
              </Button>
            }
          >
            <div className="flex flex-wrap gap-2">
              {s.players.map((p) => (
                <span key={p.id} className="rounded-full bg-white/10 px-3 py-1.5 text-sm">
                  {p.displayName}
                  {p.isGuest && <span className="text-white/40"> · guest</span>}
                </span>
              ))}
            </div>
          </Card>
          <Card title="Invite to this session">
            <Invite code={s.joinCode} label={s.name} />
          </Card>
          {s.games.some((g) => g.status !== 'active') && (
            <Card title="Finished games">
              <GameList games={s.games.filter((g) => g.status !== 'active')} />
            </Card>
          )}
          <Button variant="secondary" onClick={() => setCloseOpen(true)}>
            Close session
          </Button>
        </>
      )}
      {closed && (
        <Button variant="ghost" onClick={() => reopen.mutate()} disabled={reopen.isPending}>
          Reopen session
        </Button>
      )}
      <AddPlayerSheet open={addOpen} onClose={() => setAddOpen(false)} s={s} />
      <CloseSheet open={closeOpen} onClose={() => setCloseOpen(false)} s={s} />
    </Page>
  );
}

function Summary({ s }: { s: SessionDetail }) {
  const finished = s.games.filter((g) => g.status === 'finished');
  const top = s.standings[0];
  const champs = top && top.wins > 0 ? s.standings.filter((r) => r.wins === top.wins) : [];
  return (
    <>
      <Card className="text-center">
        <div className="text-xs uppercase tracking-wider text-white/50">Session summary</div>
        {champs.length > 0 ? (
          <>
            <div className="mt-2 text-5xl">🏆</div>
            <div className="mt-1 font-display text-2xl font-bold text-gold-300">{champs.map((c) => c.displayName).join(' & ')}</div>
            <div className="text-sm text-white/60">
              {top.wins} win{top.wins === 1 ? '' : 's'}
              {champs.length > 1 ? ' each' : ''}
            </div>
          </>
        ) : (
          <div className="mt-2 text-white/60">No games were finished.</div>
        )}
        <div className="mt-4 grid grid-cols-3 gap-2 text-sm">
          <Stat label="Games" value={finished.length} />
          <Stat label="Players" value={s.players.length} />
          <Stat label="Duration" value={fmtDuration(s.startedAt, s.endedAt)} />
        </div>
      </Card>
      <Card title="Standings">
        <Standings rows={s.standings} />
      </Card>
      <Card title="Games">
        <GameList games={s.games} />
      </Card>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl bg-felt-950/40 p-2">
      <div className="font-mono text-lg font-bold">{value}</div>
      <div className="text-xs text-white/50">{label}</div>
    </div>
  );
}

function AddPlayerSheet({ open, onClose, s }: { open: boolean; onClose: () => void; s: SessionDetail }) {
  const [name, setName] = useState('');
  const m = useMutation({
    mutationFn: (body: { playerId?: string; displayName?: string }) => post(`/sessions/${s.id}/players`, body),
    onSuccess: () => {
      setName('');
      onClose();
    },
  });
  return (
    <Sheet open={open} onClose={onClose} title="Add a player">
      {s.groupMembersNotHere.length > 0 && (
        <div className="mb-4">
          <div className="mb-2 text-sm text-white/60">From {s.group?.name}</div>
          <div className="flex flex-wrap gap-2">
            {s.groupMembersNotHere.map((p) => (
              <Button key={p.id} variant="secondary" onClick={() => m.mutate({ playerId: p.id })} disabled={m.isPending}>
                ＋ {p.displayName}
              </Button>
            ))}
          </div>
        </div>
      )}
      <div className="mb-2 text-sm text-white/60">Someone without a phone? Add them by name:</div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) m.mutate({ displayName: name.trim() });
        }}
      >
        <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" maxLength={40} />
        <Button type="submit" disabled={!name.trim() || m.isPending}>
          Add
        </Button>
      </form>
      <div className="mt-3">
        <ErrorNote error={m.error} />
      </div>
    </Sheet>
  );
}

function CloseSheet({ open, onClose, s }: { open: boolean; onClose: () => void; s: SessionDetail }) {
  const active = s.games.filter((g) => g.status === 'active').length;
  const m = useMutation({ mutationFn: () => post(`/sessions/${s.id}/close`), onSuccess: onClose });
  return (
    <Sheet open={open} onClose={onClose} title="Close session?">
      <p className="mb-4 text-white/70">
        {active > 0
          ? `${active} game${active === 1 ? ' is' : 's are'} still going — ${active === 1 ? 'it' : 'they'} will end with the current leader as winner.`
          : 'You’ll get a summary of the session. You can reopen it later.'}
      </p>
      <ErrorNote error={m.error} />
      <Button big className="w-full" onClick={() => m.mutate()} disabled={m.isPending}>
        Close &amp; see summary
      </Button>
    </Sheet>
  );
}
