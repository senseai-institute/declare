import { useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { post } from '../api';
import { Button, Card, ErrorNote, Page, TextInput } from '../components/ui';
import { useGroup, useMe } from '../hooks';

function defaultName() {
  const d = new Date();
  const day = d.toLocaleDateString(undefined, { weekday: 'long' });
  return `${day} ${d.getHours() >= 17 ? 'night' : 'games'}`;
}

const NO_MEMBERS: { id: string; displayName: string }[] = [];

export function NewSession() {
  const [params] = useSearchParams();
  const groupId = params.get('group');
  return groupId ? <GroupSession groupId={groupId} /> : <Form groupId={null} members={NO_MEMBERS} />;
}

function GroupSession({ groupId }: { groupId: string }) {
  const g = useGroup(groupId);
  if (!g.data) return <Form groupId={groupId} members={NO_MEMBERS} loading />;
  return <Form groupId={groupId} groupName={g.data.name} members={g.data.members} />;
}

function Form({
  groupId,
  groupName,
  members,
  loading,
}: {
  groupId: string | null;
  groupName?: string;
  members: { id: string; displayName: string }[];
  loading?: boolean;
}) {
  const me = useMe().data!;
  const nav = useNavigate();
  const [name, setName] = useState(defaultName);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  useEffect(() => setPicked(new Set(members.map((m) => m.id))), [members]);

  const m = useMutation({
    mutationFn: () => post<{ id: string }>('/sessions', { name: name.trim(), groupId, playerIds: [...picked] }),
    onSuccess: ({ id }) => nav(`/s/${id}`, { replace: true }),
  });

  return (
    <Page title="New session" subtitle={groupName ?? 'Ad-hoc — not tied to a group'} back={groupId ? `/g/${groupId}` : '/'}>
      <Card title="Name">
        <TextInput value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="Tahoe 2026" />
      </Card>
      {members.length > 0 && (
        <Card title="Who's here?">
          <div className="flex flex-wrap gap-2">
            {members.map((p) => {
              const on = picked.has(p.id) || p.id === me.id;
              return (
                <button
                  key={p.id}
                  disabled={p.id === me.id}
                  onClick={() =>
                    setPicked((s) => {
                      const n = new Set(s);
                      if (n.has(p.id)) n.delete(p.id);
                      else n.add(p.id);
                      return n;
                    })
                  }
                  className={`min-h-11 rounded-full px-4 font-semibold ${on ? 'bg-gold-400 text-felt-950' : 'bg-white/10 text-white/70'}`}
                >
                  {on ? '✓ ' : ''}
                  {p.displayName}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-white/50">Others can also join with the session code.</p>
        </Card>
      )}
      <ErrorNote error={m.error} />
      <Button big onClick={() => m.mutate()} disabled={!name.trim() || m.isPending || loading}>
        Start session
      </Button>
    </Page>
  );
}
