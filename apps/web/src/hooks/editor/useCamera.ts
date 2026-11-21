'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export interface CameraState {
  /** screen offset of the world origin, px */
  x: number;
  y: number;
  /** zoom factor, 1 = 100% */
  z: number;
}

const MIN_Z = 0.1;
const MAX_Z = 4;
const STEP = 1.25;
const clampZ = (z: number) => Math.min(MAX_Z, Math.max(MIN_Z, z));

function isTyping(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  if (!el) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
}

/**
 * Figma-style camera for the canvas: wheel / two-finger swipe pans, Ctrl+wheel / pinch zooms
 * around the cursor, Space+drag or middle-mouse drag grabs the canvas.
 * Shortcuts: Ctrl +/- zoom, Ctrl 0 or Shift 0 = 100%, Shift 1 = fit to content.
 */
export function useCamera() {
  const stageRef = useRef<HTMLElement | null>(null);
  // callback ref: the stage mounts after the "Loading…" screen, so effects must re-run then
  const [stageEl, setStageEl] = useState<HTMLElement | null>(null);
  const setStage = useCallback((el: HTMLElement | null) => { stageRef.current = el; setStageEl(el); }, []);
  const [cam, setCam] = useState<CameraState>({ x: 0, y: 0, z: 1 });
  const camRef = useRef(cam);
  camRef.current = cam;
  const [spaceHeld, setSpaceHeld] = useState(false);
  const spaceRef = useRef(false);
  const pan = useRef<{ id: number; sx: number; sy: number; cx: number; cy: number } | null>(null);
  const [panning, setPanning] = useState(false);

  /** Zoom to `z`, keeping the screen point (px, py) — relative to the stage — fixed. */
  const zoomAt = useCallback((z: number, px?: number, py?: number) => {
    setCam((c) => {
      const nz = clampZ(z);
      const el = stageRef.current;
      const ax = px ?? (el ? el.clientWidth / 2 : 0);
      const ay = py ?? (el ? el.clientHeight / 2 : 0);
      const k = nz / c.z;
      return { z: nz, x: ax - (ax - c.x) * k, y: ay - (ay - c.y) * k };
    });
  }, []);

  const zoomIn = useCallback(() => zoomAt(camRef.current.z * STEP), [zoomAt]);
  const zoomOut = useCallback(() => zoomAt(camRef.current.z / STEP), [zoomAt]);
  const resetZoom = useCallback(() => zoomAt(1), [zoomAt]);

  /** Fit every node, group and note into view. */
  const fit = useCallback(() => {
    const stage = stageRef.current;
    const world = stage?.querySelector<HTMLElement>('.world');
    if (!stage || !world) return;
    const items = world.querySelectorAll<HTMLElement>('.node, .note, .group');
    if (!items.length) return setCam({ x: 0, y: 0, z: 1 });
    const { z } = camRef.current;
    const wr = world.getBoundingClientRect();
    let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
    items.forEach((it) => {
      const ir = it.getBoundingClientRect();
      l = Math.min(l, (ir.left - wr.left) / z); t = Math.min(t, (ir.top - wr.top) / z);
      r = Math.max(r, (ir.right - wr.left) / z); b = Math.max(b, (ir.bottom - wr.top) / z);
    });
    // leave room for the metrics / toolbar overlay at the top
    const pad = 60, top = 100;
    const W = stage.clientWidth - pad * 2, H = stage.clientHeight - top - pad;
    const nz = clampZ(Math.min(1.5, W / Math.max(1, r - l), H / Math.max(1, b - t)));
    setCam({ z: nz, x: pad + (W - (r - l) * nz) / 2 - l * nz, y: top + (H - (b - t) * nz) / 2 - t * nz });
  }, []);

  // Wheel: native listener so we can preventDefault (stops page scroll and browser zoom).
  useEffect(() => {
    const el = stageEl;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (isTyping(e.target) && !e.ctrlKey) return;
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientHeight : 1;
      const dx = e.deltaX * unit, dy = e.deltaY * unit;
      if (e.ctrlKey || e.metaKey) {
        const r = el.getBoundingClientRect();
        // pinch sends small deltas, a mouse notch ~100: cap so one notch is ~22%, pinch stays smooth
        const factor = Math.exp(-Math.max(-20, Math.min(20, dy)) * 0.01);
        zoomAt(camRef.current.z * factor, e.clientX - r.left, e.clientY - r.top);
      } else if (e.shiftKey && !dx) {
        setCam((c) => ({ ...c, x: c.x - dy }));
      } else {
        setCam((c) => ({ ...c, x: c.x - dx, y: c.y - dy }));
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt, stageEl]);

  // Keyboard: Space to grab, zoom shortcuts.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      if (e.code === 'Space') {
        e.preventDefault();
        if (!spaceRef.current) { spaceRef.current = true; setSpaceHeld(true); }
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); zoomIn(); }
      else if (mod && e.key === '-') { e.preventDefault(); zoomOut(); }
      else if (mod && e.key === '0') { e.preventDefault(); resetZoom(); }
      else if (e.shiftKey && !mod && e.code === 'Digit0') { e.preventDefault(); resetZoom(); }
      else if (e.shiftKey && !mod && e.code === 'Digit1') { e.preventDefault(); fit(); }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') { spaceRef.current = false; setSpaceHeld(false); }
    };
    const blur = () => { spaceRef.current = false; setSpaceHeld(false); };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, [zoomIn, zoomOut, resetZoom, fit]);

  // Pan gestures run in the capture phase so they win over node / group drags.
  const onPointerDownCapture = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 1 && !(e.button === 0 && spaceRef.current)) return;
    e.preventDefault();
    e.stopPropagation();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
    const c = camRef.current;
    pan.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, cx: c.x, cy: c.y };
    setPanning(true);
  }, []);

  const onPointerMoveCapture = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const p = pan.current;
    if (!p || p.id !== e.pointerId) return;
    e.stopPropagation();
    setCam((c) => ({ ...c, x: p.cx + e.clientX - p.sx, y: p.cy + e.clientY - p.sy }));
  }, []);

  const onPointerUpCapture = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const p = pan.current;
    if (!p || p.id !== e.pointerId) return;
    e.stopPropagation();
    pan.current = null;
    setPanning(false);
  }, []);

  return useMemo(() => ({
    setStage, cam, spaceHeld, panning,
    zoomIn, zoomOut, resetZoom, fit,
    onPointerDownCapture, onPointerMoveCapture, onPointerUpCapture,
  }), [cam, spaceHeld, panning, zoomIn, zoomOut, resetZoom, fit, onPointerDownCapture, onPointerMoveCapture, onPointerUpCapture]);
}

export type Camera = ReturnType<typeof useCamera>;
