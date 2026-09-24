// Card ids are strings of the form "<deckIndex>-<rank><suit>" (e.g. "0-AS", "1-10H")
// or "<deckIndex>-JK<n>" for jokers. The deck index keeps ids unique when
// several decks are combined.

export const SUITS = ['S', 'H', 'D', 'C'] as const;
export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const;

export type Suit = (typeof SUITS)[number];

export interface DeckConfig {
  /** Number of standard 52-card decks combined (1–N). */
  decks: number;
  /** Jokers added per deck (0–2). */
  jokersPerDeck: number;
}

export interface ParsedCard {
  id: string;
  rank: string;
  suit: Suit | null;
  joker: boolean;
  deck: number;
}

export function parseCard(id: string): ParsedCard {
  const dash = id.indexOf('-');
  const deck = Number(id.slice(0, dash));
  const face = id.slice(dash + 1);
  if (face.startsWith('JK')) return { id, rank: 'JK', suit: null, joker: true, deck };
  return { id, rank: face.slice(0, -1), suit: face.slice(-1) as Suit, joker: false, deck };
}

export const SUIT_SYMBOL: Record<Suit, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };

export function isRed(card: ParsedCard): boolean {
  return card.suit === 'H' || card.suit === 'D';
}

/** Per-player view of a deck. Never contains other players' cards. */
export interface DeckView {
  config: DeckConfig;
  drawCount: number;
  discardCount: number;
  discardTop: string | null;
  myHand: string[] | null;
  handCounts: Record<string, number>;
  version: number;
}
