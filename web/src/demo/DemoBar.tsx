import type { QueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { onChange, resetDemo, resumeComputers } from './backend';

export function startDemo(qc: QueryClient) {
  onChange(() => void qc.invalidateQueries());
  resumeComputers();
}

/** A thin strip explaining the demo, with a way to start over. */
export function DemoBar() {
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="mx-auto flex max-w-xl items-center justify-between gap-2 bg-gold-400/15 px-3 py-1.5 text-xs text-gold-300">
      <span>Demo · runs in your browser · everyone else is the computer</span>
      {confirm ? (
        <span className="flex gap-2">
          <button
            className="rounded-full bg-red-600/80 px-2 py-0.5 font-semibold text-white"
            onClick={() => {
              resetDemo();
              location.reload();
            }}
          >
            Erase all
          </button>
          <button className="rounded-full bg-white/10 px-2 py-0.5" onClick={() => setConfirm(false)}>
            Keep
          </button>
        </span>
      ) : (
        <button className="shrink-0 rounded-full bg-white/10 px-2 py-0.5 font-semibold" onClick={() => setConfirm(true)}>
          Start over
        </button>
      )}
    </div>
  );
}
