'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { SPIKE_STEPS } from '@/lib/editor/shortcuts';
import { selectedPicks, useEditorStore } from './editor.store';

function isTyping(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  if (!el) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
}

/** Tab cycles components only while focus is not on a control, so normal Tab navigation still works. */
function onCanvasFocus() {
  const a = document.activeElement as HTMLElement | null;
  return !a || a === document.body || !!a.closest('.stage');
}

/**
 * Editor keyboard shortcuts (tools, delete, nudge, cycle selection, undo/redo, clipboard,
 * simulation, help).
 * Zoom / pan keys live in useCamera. The full list is in lib/editor/shortcuts.ts.
 */
export function useEditorShortcuts() {
  const [helpOpen, setHelpOpen] = useState(false);
  const openHelp = useCallback(() => setHelpOpen(true), []);
  const closeHelp = useCallback(() => setHelpOpen(false), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isTyping(e.target)) return;
      if (e.key === '?') { e.preventDefault(); setHelpOpen((o) => !o); return; }
      // leave keys alone while any dialog is open
      if (document.querySelector('[aria-modal="true"]')) return;

      const { doc, ui, actions: a } = useEditorStore.getState();
      if (!doc) return;

      // Ctrl / Cmd combos: history and clipboard. Only swallow the key when we act on it,
      // so e.g. Ctrl+C still copies selected page text when nothing is selected on the canvas.
      if (e.ctrlKey || e.metaKey) {
        if (e.altKey) return;
        // Ctrl+Shift+\ like Figma: hide or show every panel around the canvas
        if (e.shiftKey && e.code === 'Backslash') { e.preventDefault(); a.toggleMinimal(); return; }
        const k = e.key.toLowerCase();
        let done = false;
        if (k === 'a' && !e.shiftKey) { a.selectAll(); done = true; }
        else if (k === 'z' && !e.shiftKey) { a.undo(); done = true; }
        else if ((k === 'z' && e.shiftKey) || k === 'y') { a.redo(); done = true; }
        else if (k === 'c' && !e.shiftKey) done = a.copySelection();
        else if (k === 'x' && !e.shiftKey) done = a.cutSelection();
        else if (k === 'v' && !e.shiftKey) done = a.paste();
        else if (k === 'd' && !e.shiftKey) done = a.duplicateSelection();
        if (done) e.preventDefault();
        return;
      }
      if (e.altKey) return;
      const sel = ui.sel;
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;

      switch (key) {
        case 'Delete':
        case 'Backspace': {
          if (selectedPicks(ui).length) { e.preventDefault(); a.deleteSelection(); return; }
          if (sel?.type === 'edge') { e.preventDefault(); a.deleteEdge(sel.id); }
          return;
        }
        case 'Escape':
          if (ui.rewire) { a.setRewire(null); a.setDragging(false); return; }
          if (ui.recording) a.finishRecording();
          else if (ui.tool === 'connect') a.setTool('select');
          a.clearSelection();
          return;
        case 'v': if (!e.shiftKey) a.setTool('select'); return;
        case 'c': if (!e.shiftKey) a.setTool('connect'); return;
        case 'g': if (!e.shiftKey) a.addGroup(); return;
        case 'n': if (!e.shiftKey) a.addNote(); return;
        case 'l': if (!e.shiftKey) a.autoLayout(); return;
        case 'p': if (!e.shiftKey) a.toggleRunning(); return;
        case 'ArrowLeft': case 'ArrowRight': case 'ArrowUp': case 'ArrowDown': {
          const step = e.shiftKey ? 50 : 10;
          const dx = key === 'ArrowLeft' ? -step : key === 'ArrowRight' ? step : 0;
          const dy = key === 'ArrowUp' ? -step : key === 'ArrowDown' ? step : 0;
          if (a.nudgeSelection(dx, dy)) e.preventDefault();
          return;
        }
        case 'Tab': {
          if (!doc.nodes.length || !onCanvasFocus()) return;
          e.preventDefault();
          const i = sel?.type === 'node' ? doc.nodes.findIndex((n) => n.id === sel.id) : -1;
          const len = doc.nodes.length;
          const next = i < 0 ? (e.shiftKey ? len - 1 : 0) : (i + (e.shiftKey ? -1 : 1) + len) % len;
          a.select({ type: 'node', id: doc.nodes[next].id });
          return;
        }
        default:
          // 1-5 pick a spike level (Shift+digit is a camera shortcut)
          if (!e.shiftKey && /^[1-5]$/.test(key)) a.setSpike(SPIKE_STEPS[Number(key) - 1]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return useMemo(() => ({ helpOpen, openHelp, closeHelp }), [helpOpen, openHelp, closeHelp]);
}
