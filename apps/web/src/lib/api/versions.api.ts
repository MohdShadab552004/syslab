import type { CreateVersionInput, Design, DesignVersion } from '@syslab/types';
import { http } from './http';

export const versionsApi = {
  list: (designId: string, signal?: AbortSignal) => http.get<DesignVersion[]>(`/designs/${designId}/versions`, signal),
  create: (designId: string, input: CreateVersionInput = {}) => http.post<DesignVersion>(`/designs/${designId}/versions`, input),
  restore: (designId: string, versionId: string) => http.post<Design>(`/designs/${designId}/versions/${versionId}/restore`),
};
