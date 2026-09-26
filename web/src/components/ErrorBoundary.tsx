import { Component, type ReactNode } from 'react';

/** Shows what went wrong instead of a blank screen, with a way back in. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('Declare crashed:', error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="mx-auto flex min-h-dvh max-w-xl flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="text-5xl">🂠</div>
        <h1 className="text-xl font-bold">Something went wrong</h1>
        <p className="text-sm text-white/60">Your games are saved. Reload to pick up where you left off.</p>
        <pre className="max-w-full overflow-x-auto rounded-lg bg-black/30 p-3 text-left text-xs text-red-200">{this.state.error.message}</pre>
        <button className="min-h-12 rounded-xl bg-gold-400 px-6 font-semibold text-felt-950" onClick={() => this.setState({ error: null })}>
          Reload
        </button>
      </div>
    );
  }
}
