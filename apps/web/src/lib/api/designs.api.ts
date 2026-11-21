import type {
  CreateDesignInput, Design, DesignSummary, ShareState, UpdateDesignInput, UpdateDesignResult,
} from '@syslab/types';
import { http } from './http';

export interface DesignPage { items: DesignSummary[]; nextCursor: string | null }

export const designsApi = {
  list: (signal?: AbortSignal) => http.get<DesignPage>('/designs?limit=50', signal),
  get: (id: string, signal?: AbortSignal) => http.get<Design>(`/designs/${id}`, signal),
  getShared: (token: string, signal?: AbortSignal) => http.get<Design>(`/public/designs/${token}`, signal),
  create: (input: CreateDesignInput) => http.post<Design>('/designs', input),
  update: (id: string, input: UpdateDesignInput) => http.patch<UpdateDesignResult>(`/designs/${id}`, input),
  duplicate: (id: string) => http.post<Design>(`/designs/${id}/duplicate`),
  setShare: (id: string, enabled: boolean) => http.patch<ShareState>(`/designs/${id}/share`, { enabled }),
  remove: (id: string) => http.del(`/designs/${id}`),
};
