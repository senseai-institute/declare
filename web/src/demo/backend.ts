// In-browser stand-in for the server, used by the playable demo build
// (VITE_DEMO=1). It answers the same /api routes the real app calls, using the
// real rules engine, scoring and computer player, and keeps its data in
// localStorage. Everyone except you is played by the computer.

import type {
  AuditEntry,
  DeclareTotalsRow,
  GameDetail,
  GameSummary,
  GroupDetail,
  HomeData,
  JoinPreview,
  Me,
  PlayerRef,
  ScoringMode,
  SessionDetail,
  SessionSummary,
  StandingRow,
} from '../../../src/shared/api';
import { scoreDeclare, takeableFrom } from '../../../src/shared/declare';
import { applyAction, createDeckState, normalizeConfig, viewFor, type DeckAction, type DeckData } from '../../../src/server/deck';
import { chooseMove } from '../../../src/server/declare/bot';
import {
  currentPlayer,
  dealHand,
  declare,
  declareViewFor,
  newMatch,
  playTurn,
  type DeclareState,
} from '../../../src/server/declare/engine';
import { computeStandings, computeTotals, leader, placesFor, targetReached, type FinishedGame } from '../../../src/server/scoring';
import { ApiError } from '../api';

// ---- Data ------------------------------------------------------------------

interface DPlayer { id: string; name: string; guest: boolean; email: string | null }
interface DGroup { id: string; name: string; code: string; createdAt: string; members: string[] }
interface DSession {
  id: string; groupId: string | null; name: string; code: string; status: 'active' | 'closed';
  startedAt: string; endedAt: string | null; players: string[];
}
interface DRound {
  id: string; roundNumber: number; createdAt: string; declarerId: string | null; declareSuccess: boolean | null;
  entries: Record<string, { points: number; edited: boolean }>;
}
interface DGame {
  id: string; sessionId: string; gameType: string; scoringMode: ScoringMode; targetScore: number | null;
  status: 'active' | 'finished' | 'abandoned'; deckEnabled: boolean; rules: string | null;
  winnerPlayerId: string | null; winnerOverride: boolean; createdAt: string; endedAt: string | null;
  players: string[]; rounds: DRound[]; deck: { state: unknown; version: number } | null;
}
interface DAudit { id: string; gameId: string; roundNumber: number; playerId: string; oldPoints: number | null; newPoints: number; by: string; at: string }
interface DB { v: 1; meId: string | null; players: DPlayer[]; groups: DGroup[]; sessions: DSession[]; games: DGame[]; audits: DAudit[] }

const KEY = 'declare-demo-v1';
const empty = (): DB => ({ v: 1, meId: null, players: [], groups: [], sessions: [], games: [], audits: [] });

function load(): DB {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as DB;
  } catch {
    /* storage blocked — run in memory */
  }
  return empty();
}

let db = load();
const listeners = new Set<() => void>();

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
  } catch {
    /* ignore */
  }
  for (const l of listeners) l();
}

export function onChange(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function resetDemo() {
  db = empty();
  save();
}

let seq = Date.now();
const uid = (p: string) => `${p}${(seq++).toString(36)}`;
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function code() {
  let s = '';
  for (let i = 0; i < 6; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}
const now = () => new Date().toISOString();

const fail = (status: number, msg: string): never => {
  throw new ApiError(status, msg);
};
const player = (id: string) => db.players.find((p) => p.id === id) ?? fail(404, 'Player not found');
const group = (id: string) => db.groups.find((g) => g.id === id) ?? fail(404, 'Group not found');
const session = (id: string) => db.sessions.find((s) => s.id === id) ?? fail(404, 'Session not found');
const game = (id: string) => db.games.find((g) => g.id === id) ?? fail(404, 'Game not found');
const ref = (id: string): PlayerRef => {
  const p = player(id);
  return { id: p.id, displayName: p.name, isGuest: p.guest };
};
function me(): DPlayer {
  const p = db.players.find((x) => x.id === db.meId);
  return p ?? fail(401, 'Tell us your name first');
}
function newPlayer(name: string, guest: boolean) {
  const p: DPlayer = { id: uid('p'), name: name.trim().slice(0, 40), guest, email: null };
  db.players.push(p);
  return p;
}

// ---- Shaping ---------------------------------------------------------------

function gameTotals(g: DGame) {
  const rounds = g.rounds.map((r) => ({ entries: Object.entries(r.entries).map(([playerId, e]) => ({ playerId, points: e.points })) }));
  const totals = computeTotals(g.players, rounds);
  return { totals, places: placesFor(totals, g.scoringMode) };
}

function toGameSummary(g: DGame): GameSummary {
  const { totals, places } = gameTotals(g);
  return {
    id: g.id, gameType: g.gameType, scoringMode: g.scoringMode, status: g.status, targetScore: g.targetScore,
    deckEnabled: g.deckEnabled, rules: g.rules, winnerPlayerId: g.winnerPlayerId, roundCount: g.rounds.length,
    createdAt: g.createdAt, endedAt: g.endedAt,
    players: g.players
      .map((id) => ({ id, displayName: player(id).name, total: totals.get(id) ?? 0, place: places.get(id) ?? 0 }))
      .sort((a, b) => a.place - b.place),
  };
}

function toSessionSummary(s: DSession): SessionSummary {
  const g = s.groupId ? group(s.groupId) : null;
  return {
    id: s.id, name: s.name, joinCode: s.code, status: s.status, startedAt: s.startedAt, endedAt: s.endedAt,
    group: g ? { id: g.id, name: g.name } : null, gameCount: db.games.filter((x) => x.sessionId === s.id).length,
  };
}

function standings(games: DGame[], sessionStats = false): StandingRow[] {
  const names = new Map<string, string>();
  const finished: FinishedGame[] = [];
  for (const g of games) {
    for (const id of g.players) names.set(id, player(id).name);
    if (g.status !== 'finished') continue;
    finished.push({ sessionId: g.sessionId, gameType: g.gameType, winnerPlayerId: g.winnerPlayerId, places: gameTotals(g).places });
  }
  return computeStandings(finished, names, { sessionStats });
}

function declareTotals(games: DGame[], sortBy: 'points' | 'avg'): DeclareTotalsRow[] {
  const rows = new Map<string, DeclareTotalsRow>();
  for (const g of games) {
    if (g.rules !== 'declare' || g.status === 'abandoned') continue;
    for (const r of g.rounds) {
      for (const [pid, e] of Object.entries(r.entries)) {
        let row = rows.get(pid);
        if (!row) rows.set(pid, (row = { playerId: pid, displayName: player(pid).name, hands: 0, points: 0, avgPerHand: 0, declares: 0, declaresMade: 0, zeroHands: 0 }));
        row.hands++;
        row.points += e.points;
        if (e.points === 0) row.zeroHands++;
      }
      const d = r.declarerId ? rows.get(r.declarerId) : undefined;
      if (d) {
        d.declares++;
        if (r.declareSuccess) d.declaresMade++;
      }
    }
  }
  const out = [...rows.values()];
  for (const r of out) r.avgPerHand = Math.round((r.points / r.hands) * 10) / 10;
  out.sort((a, b) => (sortBy === 'points' ? a.points - b.points || a.avgPerHand - b.avgPerHand : a.avgPerHand - b.avgPerHand || a.points - b.points));
  return out;
}

function gameDetail(g: DGame): GameDetail {
  const s = session(g.sessionId);
  const { totals, places } = gameTotals(g);
  return {
    id: g.id, session: { id: s.id, name: s.name, status: s.status, groupId: s.groupId },
    gameType: g.gameType, scoringMode: g.scoringMode, targetScore: g.targetScore, status: g.status,
    deckEnabled: g.deckEnabled, rules: g.rules, winnerPlayerId: g.winnerPlayerId, createdAt: g.createdAt, endedAt: g.endedAt,
    players: g.players.map((id, seat) => ({ id, displayName: player(id).name, seat, total: totals.get(id) ?? 0, place: places.get(id) ?? 0, isGuest: player(id).guest })),
    rounds: g.rounds.map((r) => ({ id: r.id, roundNumber: r.roundNumber, createdAt: r.createdAt, declarerId: r.declarerId, declareSuccess: r.declareSuccess, scores: r.entries })),
  };
}

// ---- Game logic ------------------------------------------------------------

function addRound(g: DGame, scores: Record<string, number>, declarer?: { id: string; success: boolean }) {
  g.rounds.push({
    id: uid('r'), roundNumber: g.rounds.length + 1, createdAt: now(),
    declarerId: declarer?.id ?? null, declareSuccess: declarer?.success ?? null,
    entries: Object.fromEntries(g.players.map((id) => [id, { points: scores[id] ?? 0, edited: false }])),
  });
}

function maybeAutoEnd(g: DGame) {
  if (g.status !== 'active') return false;
  const { totals } = gameTotals(g);
  if (!targetReached(totals, g.targetScore)) return false;
  g.status = 'finished';
  g.endedAt = now();
  g.winnerPlayerId = leader(totals, g.scoringMode);
  return true;
}

function finishGame(g: DGame, winner?: string | null) {
  const manual = winner !== undefined;
  const w = manual ? winner : leader(gameTotals(g).totals, g.scoringMode);
  g.status = g.rounds.length === 0 && !w ? 'abandoned' : 'finished';
  g.endedAt = now();
  g.winnerPlayerId = w ?? null;
  g.winnerOverride = manual;
  if (g.rules === 'declare' && g.deck) g.deck = { state: { ...(g.deck.state as DeclareState), over: true, turnDeadline: null }, version: g.deck.version + 1 };
}

function requireActive(g: DGame) {
  if (g.status !== 'active') fail(409, 'This game is over');
  if (session(g.sessionId).status !== 'active') fail(409, 'This session is closed');
}

type Move = ({ type: 'declare' } | { type: 'play'; cards: string[]; take: string }) & { version?: number };

function applyDeclareMove(g: DGame, pid: string, move: Move) {
  requireActive(g);
  if (!g.deck) return fail(400, 'No cards in this game');
  if (move.version !== undefined && move.version !== g.deck.version) fail(409, 'The table changed — take another look');
  let state = g.deck.state as DeclareState;
  try {
    if (move.type === 'declare') {
      const { state: s, result } = declare(state, pid);
      addRound(g, result.scores, { id: pid, success: result.success });
      if (maybeAutoEnd(g)) state = { ...s, over: true };
      else state = dealHand(s);
    } else {
      state = playTurn(state, pid, move.cards, move.take);
    }
  } catch (err) {
    fail(400, (err as Error).message);
  }
  g.deck = { state, version: g.deck.version + 1 };
}

const timers = new Map<string, ReturnType<typeof setTimeout>>();

/** Computer players take their turns after a short pause so you can follow along. */
function scheduleComputer(gameId: string) {
  if (timers.has(gameId)) return;
  const g = db.games.find((x) => x.id === gameId);
  if (!g || g.status !== 'active' || g.rules !== 'declare' || !g.deck) return;
  const state = g.deck.state as DeclareState;
  if (state.over || !player(currentPlayer(state)).guest) return;
  timers.set(
    gameId,
    setTimeout(() => {
      timers.delete(gameId);
      const g2 = db.games.find((x) => x.id === gameId);
      if (!g2?.deck || g2.status !== 'active') return;
      const st = g2.deck.state as DeclareState;
      const pid = currentPlayer(st);
      if (!player(pid).guest) return;
      const move = chooseMove({
        hand: st.hands[pid],
        takeable: st.lastThrow ? takeableFrom(st.lastThrow.cards) : [],
        opponentCounts: st.players.filter((p) => p !== pid).map((p) => st.hands[p].length),
        turnsThisHand: st.turnInHand,
        playerCount: st.players.length,
      });
      try {
        applyDeclareMove(g2, pid, move);
      } catch {
        return;
      }
      save();
      scheduleComputer(gameId);
    }, 1100),
  );
}

export function resumeComputers() {
  for (const g of db.games) scheduleComputer(g.id);
}

// ---- Example data ------------------------------------------------------------

/** Give a new visitor a family, a past trip with real totals, and a game waiting for them. */
function seed(meId: string) {
  const [mom, dad, sam, nana] = ['Mom', 'Dad', 'Sam', 'Nana'].map((n) => newPlayer(n, true).id);
  const family = [meId, mom, dad, sam, nana];
  const g: DGroup = { id: uid('g'), name: 'The Family', code: code(), createdAt: new Date(Date.now() - 86400000 * 60).toISOString(), members: family };
  db.groups.push(g);

  // A finished beach trip, scored at the table.
  const trip: DSession = {
    id: uid('s'), groupId: g.id, name: 'Beach week', code: code(), status: 'closed',
    startedAt: new Date(Date.now() - 86400000 * 30).toISOString(), endedAt: new Date(Date.now() - 86400000 * 24).toISOString(), players: family,
  };
  db.sessions.push(trip);
  const tripGame: DGame = {
    id: uid('m'), sessionId: trip.id, gameType: 'Declare', scoringMode: 'low_wins', targetScore: null, status: 'finished',
    deckEnabled: false, rules: 'declare', winnerPlayerId: null, winnerOverride: false, createdAt: trip.startedAt, endedAt: trip.endedAt,
    players: family, rounds: [], deck: null,
  };
  const hands: [number, number[]][] = [
    [1, [18, 4, 22, 13, 9]], [4, [7, 15, 3, 26, 12]], [2, [11, 9, 5, 17, 20]], [3, [9, 21, 14, 2, 6]],
    [0, [3, 12, 19, 8, 15]], [1, [14, 6, 9, 11, 8]], [4, [10, 13, 7, 16, 4]], [2, [22, 8, 1, 12, 10]],
  ];
  for (const [who, pts] of hands) {
    const out = scoreDeclare(family[who], Object.fromEntries(family.map((id, i) => [id, pts[i]])));
    addRound(tripGame, out.scores, { id: family[who], success: out.success });
  }
  tripGame.winnerPlayerId = leader(gameTotals(tripGame).totals, 'low_wins');
  db.games.push(tripGame);

  // Tonight: an online game with the family (played by the computer), your turn first.
  const tonight: DSession = { id: uid('s'), groupId: g.id, name: 'Game night', code: code(), status: 'active', startedAt: now(), endedAt: null, players: [meId, mom, sam, nana] };
  db.sessions.push(tonight);
  db.games.push({
    id: uid('m'), sessionId: tonight.id, gameType: 'Declare', scoringMode: 'low_wins', targetScore: 100, status: 'active',
    deckEnabled: true, rules: 'declare', winnerPlayerId: null, winnerOverride: false, createdAt: now(), endedAt: null,
    players: tonight.players, rounds: [], deck: { state: newMatch(tonight.players), version: 0 },
  });
}

// ---- Routes ----------------------------------------------------------------

type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const clean = (s: unknown) => {
  const v = typeof s === 'string' ? s.trim() : '';
  if (!v) fail(400, 'Enter a name');
  return v.slice(0, 40);
};

export async function handle(method: string, path: string, body: Body = {}): Promise<unknown> {
  const url = new URL(path, 'http://demo');
  const parts = url.pathname.split('/').filter(Boolean); // e.g. ['games', id, 'rounds']
  const [a, id, b, c] = parts;
  const r = route(method, a, id, b, c, body ?? {}, url.searchParams);
  if (method !== 'GET') save(); // reads must not notify, or the UI refetches forever
  // Let the UI settle before a computer player moves.
  for (const g of db.games) scheduleComputer(g.id);
  return JSON.parse(JSON.stringify(r ?? { ok: true }));
}

function route(method: string, a: string, id: string, b: string, c: string, body: Body, q: URLSearchParams): unknown {
  // Me
  if (a === 'me') {
    if (method === 'GET') {
      const p = db.players.find((x) => x.id === db.meId);
      return { me: p ? ({ id: p.id, displayName: p.name, email: p.email } satisfies Me) : null };
    }
    if (method === 'POST') {
      const name = clean(body.displayName);
      const existing = db.players.find((x) => x.id === db.meId);
      if (existing) existing.name = name;
      else {
        const p = newPlayer(name, false);
        db.meId = p.id;
        seed(p.id);
      }
      const p = me();
      return { me: { id: p.id, displayName: p.name, email: p.email } };
    }
    if (method === 'PATCH') {
      const p = me();
      if (body.displayName) p.name = clean(body.displayName);
      if (body.email !== undefined) p.email = body.email || null;
      return { me: { id: p.id, displayName: p.name, email: p.email } };
    }
  }

  if (a === 'home') {
    const m = me();
    const groups = db.groups.filter((g) => g.members.includes(m.id)).map((g) => {
      const active = db.sessions.find((s) => s.groupId === g.id && s.status === 'active');
      return { id: g.id, name: g.name, joinCode: g.code, memberCount: g.members.length, activeSession: active ? { id: active.id, name: active.name } : null };
    });
    const sessions = db.sessions
      .filter((s) => s.players.includes(m.id))
      .sort((x, y) => (x.status === y.status ? y.startedAt.localeCompare(x.startedAt) : x.status === 'active' ? -1 : 1))
      .map(toSessionSummary);
    const yourTurn = db.games.flatMap((g) => {
      const st = g.deck?.state as DeclareState | undefined;
      if (g.rules !== 'declare' || !st || g.status !== 'active' || st.over || currentPlayer(st) !== m.id) return [];
      return [{ gameId: g.id, sessionName: session(g.sessionId).name, gameType: g.gameType, turnDeadline: null }];
    });
    return { groups, sessions, yourTurn } satisfies HomeData;
  }

  if (a === 'join') {
    const codeIn = id.toUpperCase();
    const g = db.groups.find((x) => x.code === codeIn);
    const s = db.sessions.find((x) => x.code === codeIn);
    if (!g && !s) fail(404, 'No group or session with that code');
    const m = db.players.find((x) => x.id === db.meId);
    if (method === 'GET') {
      const members = g ? g.members : s!.players;
      return {
        kind: g ? 'group' : 'session', id: g ? g.id : s!.id, name: g ? g.name : s!.name,
        groupName: s?.groupId ? group(s.groupId).name : null, status: s ? s.status : null,
        claimable: m ? [] : members.filter((pid) => player(pid).guest).map(ref), alreadyMember: !!m && members.includes(m.id),
      } satisfies JoinPreview;
    }
    let pid = m?.id;
    if (!pid) {
      if (body.claimPlayerId) {
        const p = player(body.claimPlayerId);
        p.guest = false;
        pid = p.id;
      } else pid = newPlayer(clean(body.displayName), false).id;
      db.meId = pid;
    }
    if (g) {
      if (!g.members.includes(pid)) g.members.push(pid);
      return { kind: 'group', id: g.id };
    }
    if (!s!.players.includes(pid)) s!.players.push(pid);
    if (s!.groupId && !group(s!.groupId).members.includes(pid)) group(s!.groupId).members.push(pid);
    return { kind: 'session', id: s!.id };
  }

  if (a === 'groups') {
    const m = me();
    if (!id && method === 'POST') {
      const g: DGroup = { id: uid('g'), name: clean(body.name), code: code(), createdAt: now(), members: [m.id] };
      db.groups.push(g);
      return { id: g.id };
    }
    const g = group(id);
    if (!g.members.includes(m.id)) fail(403, 'Join this group first');
    const games = db.games.filter((x) => session(x.sessionId).groupId === g.id);
    if (b === 'leaderboard') {
      const t = q.get('gameType');
      return { leaderboard: standings(t ? games.filter((x) => x.gameType.toLowerCase() === t.toLowerCase()) : games, true) };
    }
    if (b === 'members' && method === 'POST') {
      const p = newPlayer(clean(body.displayName), true);
      g.members.push(p.id);
      return { player: ref(p.id) };
    }
    if (method === 'PATCH') {
      g.name = clean(body.name);
      return { ok: true };
    }
    const sessions = db.sessions.filter((s) => s.groupId === g.id);
    const active = sessions.find((s) => s.status === 'active');
    return {
      id: g.id, name: g.name, joinCode: g.code, memberCount: g.members.length,
      activeSession: active ? { id: active.id, name: active.name } : null, createdAt: g.createdAt,
      members: g.members.map(ref),
      sessions: sessions.sort((x, y) => (x.status === y.status ? y.startedAt.localeCompare(x.startedAt) : x.status === 'active' ? -1 : 1)).map(toSessionSummary),
      leaderboard: standings(games, true), declareTotals: declareTotals(games, 'avg'),
      gameTypes: [...new Set(games.filter((x) => x.status === 'finished').map((x) => x.gameType))].sort(),
    } satisfies GroupDetail;
  }

  if (a === 'sessions') {
    const m = me();
    if (!id && method === 'POST') {
      let players = [m.id];
      if (body.groupId) {
        const g = group(body.groupId);
        players = [...new Set([m.id, ...(body.playerIds ?? []).filter((p: string) => g.members.includes(p))])];
      }
      const s: DSession = { id: uid('s'), groupId: body.groupId || null, name: clean(body.name), code: code(), status: 'active', startedAt: now(), endedAt: null, players };
      db.sessions.push(s);
      return { id: s.id };
    }
    const s = session(id);
    if (!s.players.includes(m.id)) fail(403, 'Join this session first');
    const games = db.games.filter((x) => x.sessionId === s.id);
    if (b === 'players' && method === 'POST') {
      let pid: string;
      if (body.playerId) pid = body.playerId;
      else {
        pid = newPlayer(clean(body.displayName), true).id;
        if (s.groupId) group(s.groupId).members.push(pid);
      }
      if (!s.players.includes(pid)) s.players.push(pid);
      return { playerId: pid };
    }
    if (b === 'close') {
      if (s.status === 'closed') fail(409, 'Session already closed');
      for (const g of games) if (g.status === 'active') finishGame(g);
      s.status = 'closed';
      s.endedAt = now();
      return { ok: true };
    }
    if (b === 'reopen') {
      s.status = 'active';
      s.endedAt = null;
      return { ok: true };
    }
    if (b === 'games' && method === 'POST') {
      if (s.status !== 'active') fail(409, 'This session is closed');
      const playerIds: string[] = [...new Set<string>(body.playerIds ?? [])];
      if (!playerIds.length) fail(400, 'Pick at least one player');
      const g: DGame = {
        id: uid('m'), sessionId: s.id, gameType: String(body.gameType || 'Custom').slice(0, 40), scoringMode: body.scoringMode,
        targetScore: body.targetScore ?? null, status: 'active', deckEnabled: !!body.deckEnabled, rules: body.rules ?? null,
        winnerPlayerId: null, winnerOverride: false, createdAt: now(), endedAt: null, players: playerIds, rounds: [], deck: null,
      };
      try {
        if (g.rules === 'declare' && g.deckEnabled) g.deck = { state: newMatch(playerIds), version: 0 };
        else if (g.deckEnabled) g.deck = { state: createDeckState(normalizeConfig(body.deck), playerIds), version: 0 };
      } catch (err) {
        fail(400, (err as Error).message);
      }
      db.games.push(g);
      return { id: g.id };
    }
    const here = new Set(s.players);
    return {
      ...toSessionSummary(s), players: s.players.map(ref),
      games: games.map(toGameSummary).reverse(), standings: standings(games), declareTotals: declareTotals(games, 'points'),
      groupMembersNotHere: s.groupId ? group(s.groupId).members.filter((p) => !here.has(p)).map(ref) : [],
    } satisfies SessionDetail;
  }

  if (a === 'games') {
    const m = me();
    const g = game(id);
    if (!session(g.sessionId).players.includes(m.id)) fail(403, 'Join this session first');
    if (!b && method === 'GET') return gameDetail(g);
    if (b === 'rounds' && method === 'POST') {
      requireActive(g);
      if (body.declare) {
        const d = body.declare as { declarerId: string; hands: Record<string, number> };
        const out = scoreDeclare(d.declarerId, Object.fromEntries(g.players.map((p) => [p, Number(d.hands[p] ?? 0)])));
        addRound(g, out.scores, { id: d.declarerId, success: out.success });
      } else addRound(g, body.scores ?? {});
      return { roundNumber: g.rounds.length, ended: maybeAutoEnd(g) };
    }
    if (b === 'rounds' && method === 'PUT') {
      const r = g.rounds.find((x) => x.id === c) ?? fail(404, 'Round not found');
      let changed = 0;
      for (const [pid, pts] of Object.entries(body.scores ?? {})) {
        const e = r.entries[pid];
        if (!e || e.points === pts) continue;
        db.audits.push({ id: uid('a'), gameId: g.id, roundNumber: r.roundNumber, playerId: pid, oldPoints: e.points, newPoints: Number(pts), by: m.id, at: now() });
        r.entries[pid] = { points: Number(pts), edited: true };
        changed++;
      }
      if (g.status === 'finished' && !g.winnerOverride) g.winnerPlayerId = leader(gameTotals(g).totals, g.scoringMode);
      else maybeAutoEnd(g);
      return { changed };
    }
    if (b === 'end') {
      if (g.status !== 'active') fail(409, 'Game already ended');
      finishGame(g, 'winnerPlayerId' in body ? body.winnerPlayerId : undefined);
      return { ok: true };
    }
    if (b === 'audit') {
      return {
        audit: db.audits
          .filter((x) => x.gameId === g.id)
          .reverse()
          .map((x): AuditEntry => ({ id: x.id, roundNumber: x.roundNumber, playerName: player(x.playerId).name, oldPoints: x.oldPoints, newPoints: x.newPoints, changedByName: player(x.by).name, changedAt: x.at })),
      };
    }
    if (b === 'deck' && method === 'GET') {
      if (!g.deck) fail(404, 'This game has no deck');
      const st = g.deck!.state as { kind?: string };
      return { view: st.kind === 'declare' ? declareViewFor(st as DeclareState, m.id, g.deck!.version) : viewFor(st as DeckData, m.id, g.deck!.version) };
    }
    if (b === 'deck' && method === 'POST') {
      requireActive(g);
      if (!g.deck || g.rules === 'declare') fail(400, 'No free-play deck in this game');
      try {
        const next = applyAction(g.deck!.state as DeckData, { type: c, ...body } as DeckAction, m.id, g.players);
        g.deck = { state: next, version: g.deck!.version + 1 };
      } catch (err) {
        fail(400, (err as Error).message);
      }
      return { view: viewFor(g.deck!.state as DeckData, m.id, g.deck!.version) };
    }
    if (b === 'move') {
      applyDeclareMove(g, m.id, body as Move);
      return { view: declareViewFor(g.deck!.state as DeclareState, m.id, g.deck!.version) };
    }
  }

  return fail(404, 'Not found');
}
