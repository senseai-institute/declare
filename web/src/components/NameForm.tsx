import { useState } from 'react';
import { useSetName } from '../hooks';
import { Button, ErrorNote, Form, TextInput } from './ui';

export function NameForm({ cta = 'Continue', initial = '' }: { cta?: string; initial?: string }) {
  const [name, setName] = useState(initial);
  const m = useSetName();
  return (
    <Form
      className="flex flex-col gap-3"
      onSubmit={() => {
        if (name.trim()) m.mutate(name.trim());
      }}
    >
      <TextInput autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" maxLength={40} autoComplete="nickname" />
      <ErrorNote error={m.error} />
      <Button type="button" data-submit big disabled={!name.trim() || m.isPending}>
        {cta}
      </Button>
    </Form>
  );
}
