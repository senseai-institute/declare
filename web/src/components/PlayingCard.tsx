import { isRed, parseCard, SUIT_SYMBOL } from '../../../src/shared/cards';

const sizes = {
  sm: 'h-16 w-11 text-sm',
  md: 'h-24 w-16 text-lg',
  lg: 'h-32 w-22 text-2xl',
};

export function PlayingCard({
  id,
  size = 'md',
  selected,
  onClick,
}: {
  id: string;
  size?: keyof typeof sizes;
  selected?: boolean;
  onClick?: () => void;
}) {
  const c = parseCard(id);
  const color = c.joker ? 'text-purple-700' : isRed(c) ? 'text-red-600' : 'text-slate-900';
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      onClick={onClick}
      className={`relative flex shrink-0 flex-col justify-between rounded-lg bg-white p-1 font-bold shadow-md ring-2 transition-transform ${sizes[size]} ${color} ${
        selected ? '-translate-y-3 ring-gold-400' : 'ring-transparent'
      }`}
      aria-label={c.joker ? 'Joker' : `${c.rank} of ${c.suit}`}
      aria-pressed={onClick ? !!selected : undefined}
    >
      <span className="leading-none">{c.joker ? '★' : c.rank}</span>
      <span className="self-center text-[1.6em] leading-none">{c.joker ? 'J' : SUIT_SYMBOL[c.suit!]}</span>
      <span className="rotate-180 self-end leading-none">{c.joker ? '★' : c.rank}</span>
    </Tag>
  );
}

export function CardBack({ size = 'md', count, onClick, disabled }: { size?: keyof typeof sizes; count?: number; onClick?: () => void; disabled?: boolean }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      onClick={onClick}
      disabled={disabled}
      className={`relative flex shrink-0 items-center justify-center rounded-lg bg-[repeating-linear-gradient(45deg,#7f1d1d_0_6px,#991b1b_6px_12px)] shadow-md ring-2 ring-white/80 disabled:opacity-40 ${sizes[size]}`}
    >
      {count !== undefined && <span className="rounded-md bg-black/60 px-1.5 text-sm font-bold text-white">{count}</span>}
    </Tag>
  );
}

export function EmptySlot({ size = 'md', label }: { size?: keyof typeof sizes; label: string }) {
  return (
    <div className={`flex shrink-0 items-center justify-center rounded-lg border-2 border-dashed border-white/25 text-center text-[10px] text-white/40 ${sizes[size]}`}>
      {label}
    </div>
  );
}
