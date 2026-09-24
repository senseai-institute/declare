import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { DeckView } from '../../src/shared/cards';

let socket: Socket | null = null;
const rooms = new Map<string, number>(); // room -> subscriber count

function queryKeysFor(room: string): unknown[][] {
  const [kind, id] = room.split(':');
  if (kind === 'game') return [['game', id], ['audit', id]];
  return [[kind, id]];
}

export function getSocket(qc: QueryClient): Socket {
  if (socket) return socket;
  socket = io({ transports: ['websocket', 'polling'] });
  socket.on('connect', () => {
    for (const room of rooms.keys()) socket!.emit('subscribe', room);
    // We may have missed updates while disconnected.
    void qc.invalidateQueries();
  });
  socket.on('changed', ({ room }: { room: string }) => {
    for (const key of queryKeysFor(room)) void qc.invalidateQueries({ queryKey: key });
    void qc.invalidateQueries({ queryKey: ['home'] });
  });
  socket.on('deck', ({ gameId, view }: { gameId: string; view: DeckView | null }) => {
    if (view) qc.setQueryData(['deck', gameId], view);
  });
  return socket;
}

/** Reconnect so the handshake picks up a newly set device cookie. */
export function resetSocket() {
  if (socket) {
    socket.disconnect();
    socket.connect();
  }
}

/** Keep this component subscribed to live updates for a room. */
export function useRoom(room: string | null | undefined) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!room) return;
    const s = getSocket(qc);
    rooms.set(room, (rooms.get(room) ?? 0) + 1);
    if (s.connected) s.emit('subscribe', room);
    return () => {
      const n = (rooms.get(room) ?? 1) - 1;
      if (n <= 0) {
        rooms.delete(room);
        s.emit('unsubscribe', room);
      } else rooms.set(room, n);
    };
  }, [room, qc]);
}

export function emitWithAck<T>(qc: QueryClient, event: string, payload: unknown): Promise<T> {
  const s = getSocket(qc);
  return new Promise((resolve, reject) => {
    s.timeout(8000).emit(event, payload, (err: Error | null, res: { ok: boolean; error?: string; data?: T }) => {
      if (err) return reject(new Error('Connection problem — try again'));
      if (!res.ok) return reject(new Error(res.error ?? 'Failed'));
      resolve(res.data as T);
    });
  });
}
