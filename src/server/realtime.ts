import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { playerFromCookieHeader } from './auth.js';
import { prisma } from './db.js';
import { HttpError } from './http.js';
import { deckViewFor, runDeckAction } from './services/deck-service.js';
import type { DeckAction } from './deck.js';

let io: Server | null = null;

type Room = `group:${string}` | `session:${string}` | `game:${string}`;

interface SocketData {
  playerId: string | null;
}

export async function canAccessRoom(playerId: string, room: string): Promise<boolean> {
  const [kind, id] = room.split(':');
  if (!id) return false;
  if (kind === 'group') {
    return !!(await prisma.groupMember.findUnique({ where: { groupId_playerId: { groupId: id, playerId } } }));
  }
  if (kind === 'session') {
    return !!(await prisma.sessionPlayer.findUnique({ where: { sessionId_playerId: { sessionId: id, playerId } } }));
  }
  if (kind === 'game') {
    const game = await prisma.game.findUnique({ where: { id }, select: { sessionId: true } });
    return !!game && canAccessRoom(playerId, `session:${game.sessionId}`);
  }
  return false;
}

type Ack = (res: { ok: boolean; error?: string; data?: unknown }) => void;

export function attachRealtime(server: HttpServer) {
  io = new Server(server, { serveClient: false });

  io.use(async (socket, next) => {
    try {
      const player = await playerFromCookieHeader(socket.handshake.headers.cookie);
      (socket.data as SocketData).playerId = player?.id ?? null;
      next();
    } catch (err) {
      next(err as Error);
    }
  });

  io.on('connection', (socket: Socket) => {
    const data = socket.data as SocketData;

    socket.on('subscribe', async (room: string, ack?: Ack) => {
      try {
        if (!data.playerId || typeof room !== 'string' || !(await canAccessRoom(data.playerId, room))) {
          return ack?.({ ok: false, error: 'Not allowed' });
        }
        await socket.join(room);
        if (room.startsWith('game:')) {
          const view = await deckViewFor(room.slice(5), data.playerId);
          if (view) socket.emit('deck', { gameId: room.slice(5), view });
        }
        ack?.({ ok: true });
      } catch (err) {
        ack?.({ ok: false, error: (err as Error).message });
      }
    });

    socket.on('unsubscribe', (room: string) => {
      if (typeof room === 'string') void socket.leave(room);
    });

    socket.on('deck:action', async (payload: { gameId: string; action: DeckAction }, ack?: Ack) => {
      try {
        if (!data.playerId) throw new HttpError(401, 'Not signed in');
        const view = await runDeckAction(payload?.gameId, data.playerId, payload?.action);
        ack?.({ ok: true, data: view });
      } catch (err) {
        ack?.({ ok: false, error: (err as Error).message });
      }
    });
  });

  return io;
}

/** Tell everyone watching these rooms to refetch. */
export function notify(...rooms: (Room | null | undefined)[]) {
  if (!io) return;
  for (const room of rooms) if (room) io.to(room).emit('changed', { room });
}

/** Send each socket in a game room its own private view of the deck. */
export async function broadcastDeck(gameId: string) {
  if (!io) return;
  const sockets = await io.in(`game:${gameId}`).fetchSockets();
  const views = new Map<string | null, unknown>();
  for (const s of sockets) {
    const pid = (s.data as SocketData).playerId;
    if (!views.has(pid)) views.set(pid, await deckViewFor(gameId, pid));
    s.emit('deck', { gameId, view: views.get(pid) });
  }
}
