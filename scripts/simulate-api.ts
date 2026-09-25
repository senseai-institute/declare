// Full-stack QA: plays online Declare games through the real HTTP API and
// database, with several "phones" (cookie jars) per game, computer-played
// guests, players who fall asleep (turn timer → auto-play), concurrent games,
// racing double-submits and illegal moves.
//
//   DECLARE_GUEST_DELAY_MS=5 DECLARE_MIN_TURN_SECONDS=1 PORT=3100 node dist/server/index.js
//   npm run simulate:api -- [games=200] [concurrency=8]

import { chooseMove } from '../src/server/declare/bot.js';
import type { DeclareView } from '../src/server/declare/engine.js';
import type { GameDetail, SessionDetail } from '../src/shared/api.js';
import { parseCard } from '../src/shared/cards.js';

const BASE = process.env.BASE_URL ?? 'http://localhost:3100';
const GAMES = Number(process.argv[2] ?? 200);
const CONCURRENCY = Number(process.argv[3] ?? 8);
const TARGET = 60;

class Phone {
  cookie = '';
  id = '';
  constructor(public name: string) {}
  async req<T>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
    const res = await fetch(BASE + '/api' + path, {
      method,
      headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(this.cookie ? { cookie: this.cookie } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0];
    return { status: res.status, data: (await res.json()) as T };
  }
  async ok<T>(method: string, path: string, body?: unknown): Promise<T> {
    const r = await this.req<T>(method, path, body);
    if (r.status >= 400) throw new Error(`${this.name} ${method} ${path} → ${r.status} ${JSON.stringify(r.data)}`);
    return r.data;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rnd = (n: number) => Math.floor(Math.random() * n);
function check(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error('CHECK FAILED: ' + msg);
}
const value = (c: string) => {
  const r = parseCard(c).rank;
  return r === 'A' ? 1 : ['J', 'Q', 'K'].includes(r) ? 10 : Number(r);
};

const stats = { games: 0, hands: 0, moves: 0, illegalRejected: 0, racesResolved: 0, autoMoves: 0, guestMoves: 0, privacyChecks: 0 };

async function playOne(no: number) {
  const humans = 2 + rnd(3); // 2–4 phones
  const guests = rnd(3); // 0–2 computer players
  const sleepy = rnd(8) === 0; // one phone never plays; timer auto-plays for them
  const phones = Array.from({ length: humans }, (_, i) => new Phone(`G${no}P${i}`));
  for (const p of phones) p.id = (await p.ok<{ me: { id: string } }>('POST', '/me', { displayName: p.name })).me.id;
  const host = phones[0];
  const { id: sessionId } = await host.ok<{ id: string }>('POST', '/sessions', { name: `Sim ${no}` });
  const s = await host.ok<SessionDetail>('GET', `/sessions/${sessionId}`);
  for (const p of phones.slice(1)) await p.ok('POST', `/join/${s.joinCode}`, {});
  const guestIds: string[] = [];
  for (let i = 0; i < guests; i++) guestIds.push((await host.ok<{ playerId: string }>('POST', `/sessions/${sessionId}/players`, { displayName: `Bot${i}` })).playerId);
  const seats = [...phones.map((p) => p.id), ...guestIds].sort(() => Math.random() - 0.5);
  const { id: gameId } = await host.ok<{ id: string }>('POST', `/sessions/${sessionId}/games`, {
    gameType: 'Declare',
    scoringMode: 'low_wins',
    targetScore: TARGET,
    playerIds: seats,
    deckEnabled: true,
    rules: 'declare',
    turnSeconds: sleepy ? 1 : null,
  });
  const sleeper = sleepy ? phones[phones.length - 1].id : null;
  const phoneById = new Map(phones.map((p) => [p.id, p]));
  const totals: Record<string, number> = Object.fromEntries(seats.map((id) => [id, 0]));
  let seenHand = 0;
  let lastVersion = -1;
  let stuck = 0;

  while (true) {
    // Read the game first, then the tables: if it has ended, the tables are final too.
    const game = await host.ok<GameDetail>('GET', `/games/${gameId}`);
    const views = await Promise.all(phones.map((p) => p.ok<{ view: DeclareView }>('GET', `/games/${gameId}/deck`).then((r) => r.view)));
    const v = views[0];
    // Privacy: each phone sees exactly its own hand and nobody else's cards.
    for (let i = 0; i < phones.length; i++) {
      check(views[i].myHand?.length === views[i].handCounts[phones[i].id], 'hand count mismatch');
      for (let j = 0; j < phones.length; j++) {
        if (i === j || views[i].version !== views[j].version) continue;
        const json = JSON.stringify({ ...views[i], lastResult: null, log: null, lastThrow: null });
        for (const c of views[j].myHand ?? []) check(!json.includes(`"${c}"`), `${phones[i].name} can see ${phones[j].name}'s ${c}`);
        stats.privacyChecks++;
      }
    }
    // A finished hand: verify its scoring independently.
    if (v.lastResult && v.lastResult.handNumber > seenHand) {
      const r = v.lastResult;
      check(r.handNumber === seenHand + 1, `skipped a hand result (${seenHand} → ${r.handNumber})`);
      seenHand = r.handNumber;
      const pts = Object.fromEntries(Object.entries(r.hands).map(([id, h]) => [id, h.reduce((a, c) => a + value(c), 0)]));
      const lower = seats.filter((id) => id !== r.declarerId && pts[id] < pts[r.declarerId]).length;
      for (const id of seats) {
        const want = id !== r.declarerId ? pts[id] : lower ? pts[id] + 20 * lower : 0;
        check(r.scores[id] === want, `hand ${r.handNumber}: ${id} scored ${r.scores[id]}, expected ${want}`);
        totals[id] += r.scores[id];
      }
      stats.hands++;
    }
    if (game.status !== 'active') {
      check(v.over, 'game finished but table not over');
      check(game.rounds.length === seenHand, `rounds ${game.rounds.length} ≠ hands ${seenHand}`);
      for (const p of game.players) check(p.total === totals[p.id], `total for ${p.displayName}: ${p.total} ≠ ${totals[p.id]}`);
      check(Object.values(totals).some((t) => t >= TARGET), 'ended before target');
      const best = Math.min(...Object.values(totals));
      const winners = Object.keys(totals).filter((id) => totals[id] === best);
      check(game.winnerPlayerId === (winners.length === 1 ? winners[0] : null), 'wrong winner');
      const sd = await host.ok<SessionDetail>('GET', `/sessions/${sessionId}`);
      for (const row of sd.declareTotals) check(row.points === totals[row.playerId], 'session running total wrong');
      break;
    }

    const turn = v.turnPlayerId!;
    const phone = phoneById.get(turn);
    if (!phone || turn === sleeper) {
      // Computer's move (guest delay or turn timer). Wait for the table to change.
      if (v.version === lastVersion) {
        check(++stuck < 400, `game ${no} stalled waiting for auto-play`);
        await sleep(25);
      } else {
        stuck = 0;
        if (v.log.at(-1)?.auto) stats.autoMoves++;
        else if (lastVersion >= 0) stats.guestMoves++;
      }
      lastVersion = v.version;
      continue;
    }
    lastVersion = v.version;
    stuck = 0;
    const myView = views[phones.indexOf(phone)];

    // Illegal attempts that must bounce: out-of-turn, someone else's card, bad take.
    if (rnd(5) === 0) {
      const other = phones.find((p) => p.id !== turn && p.id !== sleeper);
      if (other) {
        const r = await other.req('POST', `/games/${gameId}/move`, { type: 'play', cards: [views[phones.indexOf(other)].myHand![0]], take: 'deck' });
        check(r.status === 400, `out-of-turn move accepted (${r.status})`);
        stats.illegalRejected++;
      }
      const r2 = await phone.req('POST', `/games/${gameId}/move`, { type: 'play', cards: [myView.myHand![0]], take: '0-XX' });
      check(r2.status === 400, 'bad take accepted');
      stats.illegalRejected++;
    }

    const move = { version: myView.version, ...chooseMove({
      hand: myView.myHand!,
      takeable: myView.lastThrow?.takeable ?? [],
      opponentCounts: seats.filter((id) => id !== turn).map((id) => myView.handCounts[id]),
      playerCount: seats.length,
    }) };
    // Sometimes fire the same move twice at once (double-tap / two tabs): exactly one may win.
    if (rnd(10) === 0) {
      const [a, b] = await Promise.all([phone.req('POST', `/games/${gameId}/move`, move), phone.req('POST', `/games/${gameId}/move`, move)]);
      check([a.status, b.status].filter((x) => x === 200).length === 1, `race: ${a.status}/${b.status}`);
      stats.racesResolved++;
    } else {
      await phone.ok('POST', `/games/${gameId}/move`, move);
    }
    stats.moves++;
  }
  stats.games++;
}

const t0 = Date.now();
let next = 1;
let failed: unknown = null;
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (!failed && next <= GAMES) {
      const n = next++;
      try {
        await playOne(n);
      } catch (err) {
        failed = err;
      }
      if (stats.games % 25 === 0 && stats.games) process.stdout.write(`  ${stats.games} games…\n`);
    }
  }),
);
console.log(`
Declare full-stack simulation (${BASE})
  games completed       ${stats.games} / ${GAMES} in ${((Date.now() - t0) / 1000).toFixed(1)}s (${CONCURRENCY} at a time)
  hands scored          ${stats.hands}
  moves by phones       ${stats.moves}
  moves by computer     ${stats.guestMoves} for guests · ${stats.autoMoves} for timed-out players
  illegal moves         ${stats.illegalRejected} tried — all rejected
  double-submit races   ${stats.racesResolved} — exactly one accepted each time
  privacy checks        ${stats.privacyChecks} — no phone saw another's cards
  result                ${failed ? 'FAILED: ' + (failed as Error).message : 'PASS'}
`);
process.exit(failed ? 1 : 0);
