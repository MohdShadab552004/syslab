'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TemplateKey } from '@syslab/types';
import { KINDS, TEMPLATES, timeAgo } from '@syslab/sim';
import { designsApi } from '@/lib/api/designs.api';
import { qk } from '@/lib/api/query-keys';

export type CubeColors = { t: string; l: string; r: string };
const cubes = (kinds: (keyof typeof KINDS)[]): CubeColors[] => kinds.map((k) => ({ t: KINDS[k].colors[0], l: KINDS[k].colors[1], r: KINDS[k].colors[2] }));

/** Everything the “My designs” page needs: list, templates, create / duplicate / delete. */
export function useDesignsHome() {
  const router = useRouter();
  const qc = useQueryClient();
  const [modal, setModal] = useState<{ open: boolean; template: TemplateKey; name: string }>({ open: false, template: 'blank', name: '' });

  const list = useQuery({ queryKey: qk.designs, queryFn: ({ signal }) => designsApi.list(signal) });

  const create = useMutation({
    mutationFn: designsApi.create,
    onSuccess: (d) => { qc.invalidateQueries({ queryKey: qk.designs }); router.push(`/designs/${d.id}`); },
  });
  const duplicate = useMutation({ mutationFn: designsApi.duplicate, onSuccess: () => qc.invalidateQueries({ queryKey: qk.designs }) });
  const remove = useMutation({
    mutationFn: designsApi.remove,
    // Optimistic: drop the card immediately, roll back on failure.
    onMutate: async (id: string) => {
      await qc.cancelQueries({ queryKey: qk.designs });
      const prev = qc.getQueryData<Awaited<ReturnType<typeof designsApi.list>>>(qk.designs);
      if (prev) qc.setQueryData(qk.designs, { ...prev, items: prev.items.filter((d) => d.id !== id) });
      return { prev };
    },
    onError: (_e, _id, ctx) => ctx?.prev && qc.setQueryData(qk.designs, ctx.prev),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.designs }),
  });

  const templates = useMemo(() => TEMPLATES.map((t) => ({
    key: t.key, name: t.name, desc: t.desc, cubes: cubes(t.previewKinds),
    onSelect: () => setModal({ open: true, template: t.key, name: '' }),
  })), []);

  const designs = useMemo(() => (list.data?.items ?? []).map((d) => ({
    id: d.id,
    name: d.name,
    isLesson: d.isLesson,
    meta: `Edited ${timeAgo(d.updatedAt)} · ${d.nodeCount} components · ${d.flowCount} flows`,
    cubes: cubes(d.previewKinds.length ? d.previewKinds : ['users']),
    href: `/designs/${d.id}`,
    onDuplicate: () => duplicate.mutate(d.id),
    onDelete: () => remove.mutate(d.id),
  })), [list.data, duplicate, remove]);

  const current = TEMPLATES.find((t) => t.key === modal.template) ?? TEMPLATES[0];

  return {
    templates,
    designs,
    isLoading: list.isLoading,
    error: list.error as Error | null,
    newModal: {
      open: modal.open,
      name: modal.name,
      placeholder: current.key === 'blank' ? 'e.g. My platform HLD' : current.name,
      options: TEMPLATES.map((t) => ({ key: t.key, label: t.name, sub: t.desc, active: t.key === modal.template, onSelect: () => setModal((m) => ({ ...m, template: t.key })) })),
      creating: create.isPending,
      onName: (name: string) => setModal((m) => ({ ...m, name })),
      onOpen: () => setModal({ open: true, template: 'blank', name: '' }),
      onClose: () => setModal((m) => ({ ...m, open: false })),
      onCreate: () => create.mutate({ template: modal.template, name: modal.name.trim() || undefined }),
    },
  };
}
