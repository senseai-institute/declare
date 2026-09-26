// UNO scoring (official rules): when someone goes out, they score the points
// left in everyone else's hand. First to 500 wins.
//   number cards = face value · Skip, Reverse, Draw Two = 20 · Wild, Wild Draw Four = 50

export const UNO_TARGET = 500;
export const UNO_ACTION_POINTS = 20;
export const UNO_WILD_POINTS = 50;

export interface UnoOutcome {
  winnerId: string;
  scores: Record<string, number>;
}

/** `handPoints` = points left in each player's hand; the winner's own entry is ignored. */
export function scoreUnoRound(winnerId: string, handPoints: Record<string, number>): UnoOutcome {
  if (!(winnerId in handPoints)) throw new Error('The player who went out is not in this game');
  let total = 0;
  const scores: Record<string, number> = {};
  for (const [id, pts] of Object.entries(handPoints)) {
    if (id === winnerId) continue;
    if (!Number.isInteger(pts) || pts < 0) throw new Error('Hand points must be whole numbers, 0 or more');
    total += pts;
    scores[id] = 0;
  }
  scores[winnerId] = total;
  return { winnerId, scores };
}
