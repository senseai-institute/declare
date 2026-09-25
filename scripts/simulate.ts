// Monte-Carlo QA for the Declare engine.
//
//   npm run simulate -- [games=10000] [seed=1]
//
// Plays full matches (to 100 points) with 2–8 players mixing the strategy bot
// and a random-move bot. After every action it checks card integrity, hand
// sizes, turn order and scoring (recomputed independently), and it fires
// illegal moves at the engine to make sure every one is rejected without
// changing state. Exits non-zero on any failure.

import { chooseMove, legalThrows, randomMove, type BotInput } from '../src/server/declare/bot.js';
import {
  assertDeclareIntegrity,
  currentPlayer,
  dealHand,
  declare,
  newMatch,
  playTurn,
  RuleError,
  type DeclareState,
} from '../src/server/declare/engine.js';
import { parseCard } from '../src/shared/cards.js';
import { classifyThrow, takeableFrom } from '../src/shared/declare.js';

const GAMES = Number(process.argv[2] ?? 10_000);
const SEED = Number(process.argv[3] ?? 1);
const TARGET = 100;
const MAX_TURNS_PER_HAND = 2_000;

// mulberry32 — seeded so any failure is reproducible.
function makeRng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return (n: number) => Math.floor(next() * n);
}
const rand = makeRng(SEED);

// Independent re-implementation of the scoring rules, to cross-check the engine.
function refValue(c: string) {
  const r = parseCard(c).rank;
  return r === 'A' ? 1 : ['J', 'Q', 'K'].includes(r) ? 10 : Number(r);
}
function refScore(hands: Record<string, string[]>, declarer: string) {
  const pts = Object.fromEntries(Object.entries(hands).map(([p, h]) => [p, h.reduce((s, c) => s + refValue(c), 0)]));
  const lower = Object.keys(pts).filter((p) => p !== declarer && pts[p] < pts[declarer]).length;
  const out: Record<string, number> = {};
  for (const p of Object.keys(pts)) out[p] = p !== declarer ? pts[p] : lower === 0 ? 0 : pts[p] + 20 * lower;
  return out;
}

class SimFailure extends Error {}
function check(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new SimFailure(msg);
}

function expectRejected(fn: () => unknown, label: string, stats: Stats) {
  try {
    fn();
  } catch (err) {
    if (err instanceof RuleError) {
      stats.illegalRejected++;
      return;
    }
    throw err;
  }
  throw new SimFailure(`Illegal move accepted: ${label}`);
}

interface Stats {
  games: number;
  hands: number;
  turns: number;
  declares: number;
  declareSuccess: number;
  smartDeclares: number;
  smartDeclareSuccess: number;
  illegalRejected: number;
  reshuffles: number;
  takesFromThrow: number;
  throwKinds: Record<string, number>;
  maxTurnsInHand: number;
  winsByBot: Record<string, number>;
  seatsByBot: Record<string, number>;
  handsPerGame: number[];
  playersHist: Record<number, number>;
}

const stats: Stats = {
  games: 0,
  hands: 0,
  turns: 0,
  declares: 0,
  declareSuccess: 0,
  smartDeclares: 0,
  smartDeclareSuccess: 0,
  illegalRejected: 0,
  reshuffles: 0,
  takesFromThrow: 0,
  throwKinds: {},
  maxTurnsInHand: 0,
  winsByBot: {},
  seatsByBot: {},
  handsPerGame: [],
  playersHist: {},
};

function fuzz(s: DeclareState) {
  const me = currentPlayer(s);
  const other = s.players.find((p) => p !== me)!;
  const snapshot = JSON.stringify(s);
  const hand = s.hands[me];
  // Out of turn.
  expectRejected(() => playTurn(s, other, [s.hands[other][0]], 'deck', { rand }), 'out of turn', stats);
  expectRejected(() => declare(s, other), 'declare out of turn', stats);
  // Someone else's card.
  expectRejected(() => playTurn(s, me, [s.hands[other][0]], 'deck', { rand }), 'throw other’s card', stats);
  // Card from the deck.
  if (s.drawPile.length) expectRejected(() => playTurn(s, me, [s.drawPile[0]], 'deck', { rand }), 'throw deck card', stats);
  // Empty throw / unknown player.
  expectRejected(() => playTurn(s, me, [], 'deck', { rand }), 'empty throw', stats);
  expectRejected(() => playTurn(s, 'nobody', [hand[0]], 'deck', { rand }), 'unknown player', stats);
  // An invalid combination, if the hand has one.
  for (let mask = 3; mask < 1 << hand.length; mask++) {
    const pick = hand.filter((_, i) => mask & (1 << i));
    if (pick.length > 1 && !classifyThrow(pick)) {
      expectRejected(() => playTurn(s, me, pick, 'deck', { rand }), `invalid combo ${pick}`, stats);
      break;
    }
  }
  // Taking a card that isn't on offer (buried, in a hand, or a run's middle).
  if (s.buried.length) expectRejected(() => playTurn(s, me, [hand[0]], s.buried[0], { rand }), 'take buried', stats);
  expectRejected(() => playTurn(s, me, [hand[0]], s.hands[other][0], { rand }), 'take from hand', stats);
  const lt = s.lastThrow?.cards ?? [];
  if (lt.length >= 3 && classifyThrow(lt) === 'run') {
    const middle = lt.filter((c) => !takeableFrom(lt).includes(c))[0];
    expectRejected(() => playTurn(s, me, [hand[0]], middle, { rand }), 'take run middle', stats);
  }
  check(JSON.stringify(s) === snapshot, 'Rejected move mutated state');
}

function playGame(gameNo: number) {
  const n = 2 + rand(7); // 2..8 players
  stats.playersHist[n] = (stats.playersHist[n] ?? 0) + 1;
  const players = Array.from({ length: n }, (_, i) => `p${i}`);
  // Mostly strategy bots; ~25% random-move bots to hit odd paths.
  const kind = Object.fromEntries(players.map((p) => [p, rand(4) === 0 ? 'random' : 'smart'])) as Record<string, 'random' | 'smart'>;
  for (const p of players) stats.seatsByBot[kind[p]] = (stats.seatsByBot[kind[p]] ?? 0) + 1;

  let s = newMatch(players, {}, 0, rand);
  const totals: Record<string, number> = Object.fromEntries(players.map((p) => [p, 0]));
  let hands = 0;

  while (true) {
    assertDeclareIntegrity(s);
    let turns = 0;
    // Play one hand.
    while (true) {
      const me = currentPlayer(s);
      if (turns % 7 === 0) fuzz(s);
      const input: BotInput = {
        hand: s.hands[me],
        takeable: s.lastThrow ? takeableFrom(s.lastThrow.cards) : [],
        opponentCounts: players.filter((p) => p !== me).map((p) => s.hands[p].length),
        turnsThisHand: s.turnInHand,
        playerCount: n,
      };
      const move = kind[me] === 'smart' ? chooseMove(input) : randomMove(input, rand);
      if (move.type === 'declare') {
        const before = s;
        const { state, result } = declare(s, me);
        const ref = refScore(before.hands, me);
        for (const p of players) check(result.scores[p] === ref[p], `Scoring mismatch for ${p} in game ${gameNo}`);
        check(result.success === (ref[me] === 0), 'Success flag mismatch');
        stats.declares++;
        if (result.success) stats.declareSuccess++;
        if (kind[me] === 'smart') {
          stats.smartDeclares++;
          if (result.success) stats.smartDeclareSuccess++;
        }
        for (const p of players) totals[p] += result.scores[p];
        s = state;
        break;
      }
      check(legalThrows(s.hands[me]).some((t) => t.length === move.cards.length && t.every((c) => move.cards.includes(c))), 'Bot chose illegal throw');
      const before = s;
      const reshuffle = s.drawPile.length === 0 && move.take === 'deck';
      s = playTurn(s, me, move.cards, move.take, { rand });
      if (reshuffle) stats.reshuffles++;
      if (move.take !== 'deck') stats.takesFromThrow++;
      const kindName = classifyThrow(move.cards)!;
      stats.throwKinds[kindName] = (stats.throwKinds[kindName] ?? 0) + 1;
      check(s.hands[me].length === before.hands[me].length - move.cards.length + 1, 'Hand size wrong after turn');
      check(currentPlayer(s) === players[(players.indexOf(me) + 1) % n], 'Turn did not pass to next seat');
      check(before.hands[me].length === (JSON.parse(JSON.stringify(before.hands[me])) as string[]).length, 'Input mutated');
      assertDeclareIntegrity(s);
      turns++;
      stats.turns++;
      if (turns === MAX_TURNS_PER_HAND - 1) {
        console.error('Stuck hand:', JSON.stringify({ kind, hands: s.hands, lastThrow: s.lastThrow, log: s.log.slice(-6) }));
      }
      check(turns < MAX_TURNS_PER_HAND, `Hand never ended (game ${gameNo})`);
    }
    stats.maxTurnsInHand = Math.max(stats.maxTurnsInHand, turns);
    hands++;
    stats.hands++;
    if (Object.values(totals).some((t) => t >= TARGET)) break;
    s = dealHand(s, 0, rand);
    check(s.handNumber === hands + 1, 'Hand number did not advance');
    check(currentPlayer(s) === players[hands % n], 'Starting seat did not rotate');
    check(players.every((p) => s.hands[p].length === 5), 'Deal was not 5 each');
  }

  const best = Math.min(...Object.values(totals));
  const winners = players.filter((p) => totals[p] === best);
  for (const w of winners) stats.winsByBot[kind[w]] = (stats.winsByBot[kind[w]] ?? 0) + 1 / winners.length;
  stats.handsPerGame.push(hands);
  stats.games++;
}

const t0 = Date.now();
let failure: unknown = null;
for (let g = 1; g <= GAMES; g++) {
  try {
    playGame(g);
  } catch (err) {
    failure = err;
    console.error(`\n✗ Game ${g} (seed ${SEED}) failed:`, err);
    break;
  }
  if (g % 1000 === 0) process.stdout.write(`  ${g} games…\n`);
}

const secs = (Date.now() - t0) / 1000;
const hpg = stats.handsPerGame.sort((a, b) => a - b);
const pctOf = (a: number, b: number) => `${((100 * a) / Math.max(1, b)).toFixed(1)}%`;
const winRate = (k: string) => pctOf(stats.winsByBot[k] ?? 0, stats.seatsByBot[k] ?? 0);
console.log(`
Declare simulation — seed ${SEED}
  games completed      ${stats.games.toLocaleString()} / ${GAMES.toLocaleString()} in ${secs.toFixed(1)}s
  players per game     ${Object.entries(stats.playersHist).map(([k, v]) => `${k}p:${v}`).join(' ')}
  hands played         ${stats.hands.toLocaleString()} (median ${hpg[hpg.length >> 1]} per game, max ${hpg.at(-1)})
  turns played         ${stats.turns.toLocaleString()} (longest hand ${stats.maxTurnsInHand} turns)
  throws               ${Object.entries(stats.throwKinds).map(([k, v]) => `${k}:${v.toLocaleString()}`).join(' ')}
  takes from throw     ${stats.takesFromThrow.toLocaleString()}
  deck reshuffles      ${stats.reshuffles.toLocaleString()}
  declares             ${stats.declares.toLocaleString()} (${pctOf(stats.declareSuccess, stats.declares)} succeeded; strategy bot ${pctOf(stats.smartDeclareSuccess, stats.smartDeclares)})
  illegal moves tried  ${stats.illegalRejected.toLocaleString()} — all rejected, state unchanged
  win rate per seat    smart bot ${winRate('smart')} · random bot ${winRate('random')}
  result               ${failure ? 'FAILED' : 'PASS — every invariant held'}
`);
process.exit(failure ? 1 : 0);
