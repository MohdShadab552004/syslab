'use client';

import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { designsApi } from '@/lib/api/designs.api';
import { qk } from '@/lib/api/query-keys';
import { useEditorStore } from './editor.store';

/** Fetches a design once and hands it to the editor store, which owns it from then on. */
export function useEditorBootstrap(id: string) {
  const query = useQuery({
    queryKey: qk.design(id),
    queryFn: ({ signal }) => designsApi.get(id, signal),
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  const loadedId = useEditorStore((s) => s.designId);
  const load = useEditorStore((s) => s.actions.load);

  useEffect(() => {
    if (query.data && query.data.id !== loadedId) load(query.data);
  }, [query.data, loadedId, load]);

  return { ready: !!query.data && loadedId === id, error: query.error as Error | null, isLoading: query.isLoading };
}
