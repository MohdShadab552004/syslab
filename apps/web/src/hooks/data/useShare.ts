'use client';

import { useMutation } from '@tanstack/react-query';
import { designsApi } from '@/lib/api/designs.api';
import { useEditorStore } from '../editor/editor.store';

/** Share-link state for the open design. */
export function useShare() {
  const designId = useEditorStore((s) => s.designId);
  const enabled = useEditorStore((s) => s.shareEnabled);
  const token = useEditorStore((s) => s.shareToken);
  const open = useEditorStore((s) => s.ui.shareOpen);
  const name = useEditorStore((s) => s.name);
  const actions = useEditorStore((s) => s.actions);

  const toggle = useMutation({
    mutationFn: (next: boolean) => designsApi.setShare(designId!, next),
    onSuccess: (s) => actions.setShare(s.shareEnabled, s.shareToken),
    onError: () => actions.toast('Could not change sharing'),
  });

  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const link = enabled && token ? `${origin}/share/${token}` : '';

  return {
    open,
    name,
    enabled,
    busy: toggle.isPending,
    link,
    embed: link ? `<iframe src="${link}" width="100%" height="560"></iframe>` : '',
    onOpen: () => actions.setShareOpen(true),
    onClose: () => actions.setShareOpen(false),
    onToggle: () => toggle.mutate(!enabled),
    onCopy: async () => {
      if (!link) return;
      try { await navigator.clipboard.writeText(link); actions.toast('Link copied'); } catch { actions.toast('Copy failed'); }
    },
  };
}
