import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { JoinPreview } from '../../../src/shared/api';
import { api, post } from '../api';
import { Badge, Button, Card, ErrorNote, Form, Page, Spinner, TextInput } from '../components/ui';
import { useMe } from '../hooks';
import { resetSocket } from '../socket';

export function JoinPage() {
  const { code = '' } = useParams();
  const me = useMe().data;
  const nav = useNavigate();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const preview = useQuery({
    queryKey: ['join', code, !!me],
    queryFn: () => api<JoinPreview>(`/join/${encodeURIComponent(code)}`),
    retry: false,
  });

  const go = (r: { kind: 'group' | 'session'; id: string }) => nav(r.kind === 'group' ? `/g/${r.id}` : `/s/${r.id}`, { replace: true });

  const join = useMutation({
    mutationFn: (body: { displayName?: string; claimPlayerId?: string }) =>
      post<{ kind: 'group' | 'session'; id: string }>(`/join/${encodeURIComponent(code)}`, body),
    onSuccess: async (r) => {
      resetSocket();
      await qc.invalidateQueries({ queryKey: ['me'] });
      go(r);
    },
  });

  useEffect(() => {
    if (preview.data?.alreadyMember) go(preview.data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview.data]);

  if (preview.isLoading) return <Spinner />;
  if (preview.error || !preview.data) {
    return (
      <Page title="Join" back="/">
        <Card>
          <p className="mb-2 text-lg font-semibold">
            Code <span className="font-mono text-gold-300">{code.toUpperCase()}</span> not found
          </p>
          <p className="text-white/60">Double-check the code with whoever invited you.</p>
        </Card>
      </Page>
    );
  }

  const p = preview.data;
  return (
    <Page title="Join" back="/">
      <Card>
        <div className="text-xs uppercase tracking-wider text-white/50">{p.kind === 'group' ? 'Group' : 'Session'}</div>
        <div className="mt-1 flex items-center gap-2">
          <h2 className="text-2xl font-bold">{p.name}</h2>
          {p.status === 'closed' && <Badge>Closed</Badge>}
        </div>
        {p.groupName && <div className="text-sm text-white/60">in {p.groupName}</div>}
      </Card>

      {me ? (
        <Button big onClick={() => join.mutate({})} disabled={join.isPending}>
          Join as {me.displayName}
        </Button>
      ) : (
        <>
          {p.claimable.length > 0 && (
            <Card title="Are you one of these?">
              <div className="flex flex-wrap gap-2">
                {p.claimable.map((c) => (
                  <Button key={c.id} variant="secondary" onClick={() => join.mutate({ claimPlayerId: c.id })} disabled={join.isPending}>
                    I'm {c.displayName}
                  </Button>
                ))}
              </div>
            </Card>
          )}
          <Card title={p.claimable.length ? 'Or join as someone new' : 'Your name'}>
            <Form
              className="flex flex-col gap-3"
              onSubmit={() => {
                if (name.trim()) join.mutate({ displayName: name.trim() });
              }}
            >
              <TextInput autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" maxLength={40} />
              <Button type="button" data-submit big disabled={!name.trim() || join.isPending}>
                Join
              </Button>
            </Form>
          </Card>
        </>
      )}
      <ErrorNote error={join.error} />
    </Page>
  );
}
