import { useEffect, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const variants: Record<Variant, string> = {
  primary: 'bg-gold-400 text-felt-950 active:bg-gold-500 disabled:bg-gold-400/40',
  secondary: 'bg-white/10 text-white active:bg-white/20 disabled:opacity-40',
  ghost: 'bg-transparent text-white/80 active:bg-white/10 disabled:opacity-40',
  danger: 'bg-red-600/90 text-white active:bg-red-700 disabled:opacity-40',
};

export function Button({
  variant = 'primary',
  className = '',
  big,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; big?: boolean }) {
  return (
    <button
      {...props}
      className={`inline-flex select-none items-center justify-center gap-2 rounded-xl font-semibold transition-colors ${
        big ? 'min-h-14 px-5 text-lg' : 'min-h-11 px-4'
      } ${variants[variant]} ${className}`}
    />
  );
}

export function LinkButton({ to, children, variant = 'secondary', className = '' }: { to: string; children: ReactNode; variant?: Variant; className?: string }) {
  return (
    <Link
      to={to}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 font-semibold ${variants[variant]} ${className}`}
    >
      {children}
    </Link>
  );
}

export function Card({ children, className = '', title, action }: { children: ReactNode; className?: string; title?: ReactNode; action?: ReactNode }) {
  return (
    <section className={`rounded-2xl bg-felt-800/80 p-4 ring-1 ring-white/5 ${className}`}>
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title && <h2 className="text-sm font-semibold uppercase tracking-wider text-white/60">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Page({ title, back, children, right, subtitle }: { title?: ReactNode; subtitle?: ReactNode; back?: string; children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col">
      <header className="sticky top-0 z-20 flex items-center gap-2 bg-felt-900/95 px-3 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur">
        {back ? (
          <Link to={back} className="-ml-1 flex h-11 w-11 items-center justify-center rounded-full text-2xl text-white/80 active:bg-white/10" aria-label="Back">
            ‹
          </Link>
        ) : (
          <Link to="/" className="flex h-11 items-center pl-1 pr-2 font-display text-xl font-bold text-gold-300">
            Declare
          </Link>
        )}
        <div className="min-w-0 flex-1">
          {title && <h1 className="truncate text-lg font-bold leading-tight">{title}</h1>}
          {subtitle && <div className="truncate text-xs text-white/60">{subtitle}</div>}
        </div>
        {right}
      </header>
      <main className="flex flex-1 flex-col gap-4 px-3 pb-8">{children}</main>
    </div>
  );
}

export function Spinner() {
  return (
    <div className="flex flex-1 items-center justify-center py-16">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-white/20 border-t-gold-400" />
    </div>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  return <p className="rounded-lg bg-red-900/50 px-3 py-2 text-sm text-red-100">{(error as Error).message ?? 'Error'}</p>;
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'live' | 'gold' }) {
  const t = {
    neutral: 'bg-white/10 text-white/70',
    live: 'bg-emerald-400/20 text-emerald-200',
    gold: 'bg-gold-400/20 text-gold-300',
  }[tone];
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${t}`}>{children}</span>;
}

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center" onClick={onClose}>
      <div
        className="safe-bottom max-h-[90dvh] w-full max-w-xl overflow-y-auto rounded-t-3xl bg-felt-800 p-4 shadow-2xl sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">{title}</h2>
          <button onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-full text-xl text-white/70 active:bg-white/10" aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`min-h-12 w-full rounded-xl bg-felt-950/60 px-4 text-base text-white placeholder-white/40 outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-gold-400 ${props.className ?? ''}`}
    />
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-2 text-sm text-white/50">{children}</p>;
}
