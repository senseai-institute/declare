// Response shapes shared by the server and the web client.

export type ScoringMode = 'high_wins' | 'low_wins';
export type GameStatus = 'active' | 'finished' | 'abandoned';
export type SessionStatus = 'active' | 'closed';

export interface Me {
  id: string;
  displayName: string;
  email: string | null;
}

export interface PlayerRef {
  id: string;
  displayName: string;
  isGuest: boolean;
}

export interface StandingRow {
  playerId: string;
  displayName: string;
  played: number;
  wins: number;
  winRate: number; // 0..1
  avgPlace: number | null;
  /** Group leaderboard only: sessions attended with at least one finished game. */
  sessions?: number;
  /** Group leaderboard only: sessions where this player had the most wins. */
  sessionTitles?: number;
}

export interface GameSummary {
  id: string;
  gameType: string;
  scoringMode: ScoringMode;
  status: GameStatus;
  targetScore: number | null;
  deckEnabled: boolean;
  winnerPlayerId: string | null;
  roundCount: number;
  createdAt: string;
  endedAt: string | null;
  players: { id: string; displayName: string; total: number; place: number }[];
}

export interface SessionSummary {
  id: string;
  name: string;
  joinCode: string;
  status: SessionStatus;
  startedAt: string;
  endedAt: string | null;
  group: { id: string; name: string } | null;
  gameCount: number;
}

export interface SessionDetail extends SessionSummary {
  players: PlayerRef[];
  games: GameSummary[];
  standings: StandingRow[];
  /** Group members who are not in this session yet (for quick add). */
  groupMembersNotHere: PlayerRef[];
}

export interface GroupSummary {
  id: string;
  name: string;
  joinCode: string;
  memberCount: number;
  activeSession: { id: string; name: string } | null;
}

export interface GroupDetail extends GroupSummary {
  createdAt: string;
  members: PlayerRef[];
  sessions: SessionSummary[];
  leaderboard: StandingRow[];
  gameTypes: string[];
}

export interface HomeData {
  groups: GroupSummary[];
  sessions: SessionSummary[];
}

export interface RoundDetail {
  id: string;
  roundNumber: number;
  createdAt: string;
  scores: Record<string, { points: number; edited: boolean }>;
}

export interface GameDetail {
  id: string;
  session: { id: string; name: string; status: SessionStatus; groupId: string | null };
  gameType: string;
  scoringMode: ScoringMode;
  targetScore: number | null;
  status: GameStatus;
  deckEnabled: boolean;
  winnerPlayerId: string | null;
  createdAt: string;
  endedAt: string | null;
  players: { id: string; displayName: string; seat: number; total: number; place: number; isGuest: boolean }[];
  rounds: RoundDetail[];
}

export interface AuditEntry {
  id: string;
  roundNumber: number;
  playerName: string;
  oldPoints: number | null;
  newPoints: number;
  changedByName: string;
  changedAt: string;
}

export interface JoinPreview {
  kind: 'group' | 'session';
  id: string;
  name: string;
  groupName: string | null;
  status: SessionStatus | null;
  /** Guests you could claim as yourself (only offered to new devices). */
  claimable: PlayerRef[];
  alreadyMember: boolean;
}
