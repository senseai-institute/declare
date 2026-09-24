import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { Me } from '../../../src/shared/api';
import { patch } from '../api';
import { Button, Card, ErrorNote, Page, TextInput } from '../components/ui';
import { useMe } from '../hooks';

export function Profile() {
  const me = useMe().data!;
  const qc = useQueryClient();
  const [name, setName] = useState(me.displayName);
  const [email, setEmail] = useState(me.email ?? '');
  const m = useMutation({
    mutationFn: () => patch<{ me: Me }>('/me', { displayName: name.trim(), email: email.trim() }),
    onSuccess: ({ me }) => {
      qc.setQueryData(['me'], me);
      void qc.invalidateQueries();
    },
  });
  return (
    <Page title="You" back="/">
      <Card>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            m.mutate();
          }}
        >
          <label className="text-sm text-white/60">
            Display name
            <TextInput value={name} onChange={(e) => setName(e.target.value)} maxLength={40} className="mt-1" />
          </label>
          <label className="text-sm text-white/60">
            Email (optional — lets you claim your history on another device later)
            <TextInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1" placeholder="you@example.com" />
          </label>
          <ErrorNote error={m.error} />
          <Button type="submit" disabled={!name.trim() || m.isPending}>
            {m.isSuccess ? 'Saved ✓' : 'Save'}
          </Button>
        </form>
      </Card>
      <p className="px-1 text-sm text-white/50">
        You're signed in on this device only. There are no passwords yet — keep using the same browser to keep your stats.
      </p>
    </Page>
  );
}
