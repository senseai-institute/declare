import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { GameDetail, GroupDetail, HomeData, Me, SessionDetail } from '../../src/shared/api';
import { api, post } from './api';
import { resetSocket, useRoom } from './socket';

export function useMe() {
  return useQuery({ queryKey: ['me'], queryFn: () => api<{ me: Me | null }>('/me').then((r) => r.me) });
}

export function useSetName() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (displayName: string) => post<{ me: Me }>('/me', { displayName }),
    onSuccess: ({ me }) => {
      qc.setQueryData(['me'], me);
      resetSocket();
    },
  });
}

export function useHome(enabled: boolean) {
  return useQuery({ queryKey: ['home'], queryFn: () => api<HomeData>('/home'), enabled });
}

export function useGroup(id: string) {
  useRoom(`group:${id}`);
  return useQuery({ queryKey: ['group', id], queryFn: () => api<GroupDetail>(`/groups/${id}`) });
}

export function useSession(id: string) {
  useRoom(`session:${id}`);
  return useQuery({ queryKey: ['session', id], queryFn: () => api<SessionDetail>(`/sessions/${id}`) });
}

export function useGame(id: string) {
  useRoom(`game:${id}`);
  return useQuery({ queryKey: ['game', id], queryFn: () => api<GameDetail>(`/games/${id}`) });
}
