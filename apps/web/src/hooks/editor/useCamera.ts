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
/** a finger that moved less than this between down and up tapped instead of panning, px */
export const TAP_SLOP = 8;
export const isTap = (p: { sx: number; sy: number }, x: number, y: number) => Math.hypot(x - p.sx, y - p.sy) < TAP_SLOP;

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
export function useCamera(onTap?: () => void) {
  const stageRef = useRef<HTMLElement | null>(null);
  /** called when one finger taps empty canvas (on touch screens one finger pans, so no click reaches the canvas) */
  const tapRef = useRef(onTap);
  tapRef.current = onTap;
  // callback ref: the stage mounts after the "Loading…" screen, so effects must re-run then
  const [stageEl, setStageEl] = useState<HTMLElement | null>(null);
  const setStage = useCallback((el: HTMLElement | null) => { stageRef.current = el; setStageEl(el); }, []);
  const [cam, setCam] = useState<CameraState>({ x: 0, y: 0, z: 1 });
  const camRef = useRef(cam);
  camRef.current = cam;
  const [spaceHeld, setSpaceHeld] = useState(false);
  const spaceRef = useRef(false);
  const pan = useRef<{ id: number; sx: number; sy: number; cx: number; cy: number } | null>(null);
  /** active touch points, for one-finger pan and two-finger pinch */
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d0: number; z0: number; wx: number; wy: number } | null>(null);
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
    // leave room for the toolbar / metrics overlay at the top and the floating buttons below
    const sr = stage.getBoundingClientRect();
    const hud = stage.querySelector<HTMLElement>('.metrics');
    const top = hud ? Math.max(100, hud.getBoundingClientRect().bottom - sr.top + 24) : 100;
    const narrow = stage.clientWidth < 600;
    const pad = narrow ? 24 : 60;
    const W = stage.clientWidth - pad * 2, H = stage.clientHeight - top - (narrow ? 70 : pad);
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

  /** Touch: two fingers pinch-zoom around their midpoint (and pan as they move). */
  const startPinch = useCallback(() => {
    const el = stageRef.current;
    const [a, b] = [...touches.current.values()];
    if (!el || !a || !b) return;
    const r = el.getBoundingClientRect(), c = camRef.current;
    const mx = (a.x + b.x) / 2 - r.left, my = (a.y + b.y) / 2 - r.top;
    pinch.current = { d0: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), z0: c.z, wx: (mx - c.x) / c.z, wy: (my - c.y) / c.z };
    pan.current = null;
    setPanning(true);
  }, []);

  // Pan gestures run in the capture phase so they win over node / group drags.
  const onPointerDownCapture = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (e.pointerType === 'touch') {
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.current.size === 2) {
        e.stopPropagation();
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
        startPinch();
        return;
      }
      // one finger on empty canvas pans; on a component it drags the component as usual
      const t = e.target as HTMLElement;
      if (touches.current.size === 1 && !t.closest('[data-node], [data-note], .ghead, .group.collapsed, .gresize, .ehandle, .elabel, .hud > *, textarea, button')) {
        e.stopPropagation();
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
        const c = camRef.current;
        pan.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, cx: c.x, cy: c.y };
        setPanning(true);
      }
      return;
    }
    if (e.button !== 1 && !(e.button === 0 && spaceRef.current)) return;
    e.preventDefault();
    e.stopPropagation();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
    const c = camRef.current;
    pan.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, cx: c.x, cy: c.y };
    setPanning(true);
  }, []);

  const onPointerMoveCapture = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (e.pointerType === 'touch' && touches.current.has(e.pointerId)) {
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const pc = pinch.current, el = stageRef.current;
      if (pc && el && touches.current.size >= 2) {
        e.stopPropagation();
        const [a, b] = [...touches.current.values()];
        const r = el.getBoundingClientRect();
        const z = clampZ(pc.z0 * Math.hypot(a.x - b.x, a.y - b.y) / pc.d0);
        const mx = (a.x + b.x) / 2 - r.left, my = (a.y + b.y) / 2 - r.top;
        // keep the world point that started under the fingers under the fingers
        setCam({ z, x: mx - pc.wx * z, y: my - pc.wy * z });
        return;
      }
    }
    const p = pan.current;
    if (!p || p.id !== e.pointerId) return;
    e.stopPropagation();
    setCam((c) => ({ ...c, x: p.cx + e.clientX - p.sx, y: p.cy + e.clientY - p.sy }));
  }, []);

  const onPointerUpCapture = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (e.pointerType === 'touch') {
      touches.current.delete(e.pointerId);
      if (pinch.current && touches.current.size < 2) {
        pinch.current = null;
        setPanning(false);
        // let the event through so a component drag started by the first finger can finish cleanly
        return;
      }
    }
    const p = pan.current;
    if (!p || p.id !== e.pointerId) return;
    e.stopPropagation();
    pan.current = null;
    setPanning(false);
    if (e.pointerType === 'touch' && isTap(p, e.clientX, e.clientY)) tapRef.current?.();
  }, []);

  return useMemo(() => ({
    setStage, cam, spaceHeld, panning,
    zoomIn, zoomOut, resetZoom, fit,
    onPointerDownCapture, onPointerMoveCapture, onPointerUpCapture,
  }), [cam, spaceHeld, panning, zoomIn, zoomOut, resetZoom, fit, onPointerDownCapture, onPointerMoveCapture, onPointerUpCapture]);
}

export type Camera = ReturnType<typeof useCamera>;
