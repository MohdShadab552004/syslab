'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { versionsApi } from '@/lib/api/versions.api';
import { qk } from '@/lib/api/query-keys';
import { useEditorStore } from '../editor/editor.store';

/** Version history for the open design. Saving flushes nothing: it snapshots what the server has. */
export function useVersions(designId: string, enabled: boolean) {
  const qc = useQueryClient();
  const actions = useEditorStore((s) => s.actions);
  const saveState = useEditorStore((s) => s.saveState);

  const list = useQuery({ queryKey: qk.versions(designId), queryFn: ({ signal }) => versionsApi.list(designId, signal), enabled });

  const create = useMutation({
    mutationFn: () => versionsApi.create(designId),
    onSuccess: (v) => { qc.invalidateQueries({ queryKey: qk.versions(designId) }); actions.toast(`Saved ${v.name}`); },
    onError: () => actions.toast('Could not save a version'),
  });
  const restore = useMutation({
    mutationFn: (versionId: string) => versionsApi.restore(designId, versionId),
    onSuccess: (design) => { actions.replaceFromServer(design); actions.toast('Version restored'); },
  });

  return {
    items: (list.data ?? []).map((v) => ({
      id: v.id, name: v.name, note: v.note,
      when: new Date(v.createdAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
      onRestore: () => restore.mutate(v.id),
    })),
    isLoading: list.isLoading,
    // a version captures the saved server copy, so wait for pending edits first
    canSave: saveState !== 'dirty' && saveState !== 'saving' && !create.isPending,
    onSave: () => {
      if (saveState === 'dirty' || saveState === 'saving') return actions.toast('Saving your latest edits, try again in a second');
      create.mutate();
    },
  };
}
