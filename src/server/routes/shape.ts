import type { GroupSummary, PlayerRef, SessionSummary } from '../../shared/api.js';

export function toPlayerRef(p: { id: string; displayName: string; deviceToken: string | null }): PlayerRef {
  return { id: p.id, displayName: p.displayName, isGuest: p.deviceToken == null };
}

export function toSessionSummary(s: {
  id: string;
  name: string;
  joinCode: string;
  status: 'active' | 'closed';
  startedAt: Date;
  endedAt: Date | null;
  group: { id: string; name: string } | null;
  _count: { games: number };
}): SessionSummary {
  return {
    id: s.id,
    name: s.name,
    joinCode: s.joinCode,
    status: s.status,
    startedAt: s.startedAt.toISOString(),
    endedAt: s.endedAt?.toISOString() ?? null,
    group: s.group ? { id: s.group.id, name: s.group.name } : null,
    gameCount: s._count.games,
  };
}

export function toGroupSummary(g: {
  id: string;
  name: string;
  joinCode: string;
  _count: { members: number };
  sessions: { id: string; name: string }[];
}): GroupSummary {
  return {
    id: g.id,
    name: g.name,
    joinCode: g.joinCode,
    memberCount: g._count.members,
    activeSession: g.sessions[0] ? { id: g.sessions[0].id, name: g.sessions[0].name } : null,
  };
}
