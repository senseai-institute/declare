// The auto-player. Uses only what the seated player could see: their own hand,
// the previous throw, and how many cards everyone else holds.

import { parseCard } from '../../shared/cards.js';
import { cardPoints, classifyThrow, handPoints, rankIndex } from '../../shared/declare.js';

export interface BotInput {
  hand: string[];
  /** Cards that may be taken from the previous throw. */
  takeable: string[];
  /** Hand sizes of the other players. */
  opponentCounts: number[];
  /** Turns already taken this hand (by anyone). Long hands make the bot bolder. */
  turnsThisHand?: number;
  playerCount?: number;
}

export type BotMove = { type: 'declare' } | { type: 'play'; cards: string[]; take: string };

/** Average points of an unseen card (A=1 … 10, J/Q/K=10). */
const EXPECTED_DRAW = 85 / 13;

/** Every legal throw from a hand (hands are ≤5 cards, so brute force is cheap). */
export function legalThrows(hand: string[]): string[][] {
  const out: string[][] = [];
  const n = hand.length;
  for (let mask = 1; mask < 1 << n; mask++) {
    const pick = hand.filter((_, i) => mask & (1 << i));
    if (classifyThrow(pick)) out.push(pick);
  }
  return out;
}

/**
 * How much of a hand could be dumped next turn in one go: rewards keeping
 * pairs and near-runs together, discounted since plans can be disrupted.
 */
function comboPotential(hand: string[]): number {
  let best = 0;
  for (const t of legalThrows(hand)) if (t.length > 1) best = Math.max(best, handPoints(t) - Math.max(...t.map(cardPoints)));
  // Two cards one rank apart can become a run with the right draw.
  const idx = hand.map((c) => rankIndex(parseCard(c).rank)).sort((a, b) => a - b);
  let nearRun = 0;
  for (let i = 1; i < idx.length; i++) if (idx[i] - idx[i - 1] === 1 || idx[i] - idx[i - 1] === 2) nearRun = 1;
  return best * 0.6 + nearRun;
}

export function shouldDeclare(hand: string[], opponentCounts: number[], turnsThisHand = 0, playerCount = 4): boolean {
  const pts = handPoints(hand);
  const fewest = Math.min(...opponentCounts);
  // After several laps, everyone's hand is small and waiting rarely pays off.
  const laps = turnsThisHand / Math.max(2, playerCount);
  // Guarantee a hand of computer players always ends.
  if (laps >= 12) return true;
  if (laps >= 8 && pts <= 10) return true;
  if (laps >= 5 && pts <= 6) return true;
  // Tuned by simulation (see scripts/simulate.ts): declare when your hand is
  // low relative to how many cards the others are still holding.
  if (pts <= 2) return true;
  if (fewest >= 2 && pts <= 5) return true;
  if (fewest >= 3 && pts <= 8) return true;
  if (fewest >= 4 && pts <= 11) return true;
  return false;
}

export function chooseMove(input: BotInput): BotMove {
  const { hand, takeable, opponentCounts } = input;
  if (shouldDeclare(hand, opponentCounts, input.turnsThisHand, input.playerCount)) return { type: 'declare' };

  let best: { score: number; cards: string[]; take: string } | null = null;
  for (const cards of legalThrows(hand)) {
    const rest = hand.filter((c) => !cards.includes(c));
    const options: { take: string; hand: string[]; unknown: number }[] = [
      { take: 'deck', hand: rest, unknown: EXPECTED_DRAW },
      ...takeable.map((t) => ({ take: t, hand: [...rest, t], unknown: 0 })),
    ];
    for (const o of options) {
      const score = handPoints(o.hand) + o.unknown - comboPotential(o.hand);
      if (!best || score < best.score - 1e-9) best = { score, cards, take: o.take };
    }
  }
  return { type: 'play', cards: best!.cards, take: best!.take };
}

/** A bot that picks uniformly among legal moves — used to fuzz the engine. */
export function randomMove(input: BotInput, rand: (n: number) => number, declareChance = 0.08): BotMove {
  if (rand(1000) < declareChance * 1000) return { type: 'declare' };
  const throws = legalThrows(input.hand);
  const cards = throws[rand(throws.length)];
  const takes = ['deck', ...input.takeable];
  return { type: 'play', cards, take: takes[rand(takes.length)] };
}
