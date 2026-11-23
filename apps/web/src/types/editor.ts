/** UI-only editor types shared by hooks, lib and components. */
export type Tool = 'select' | 'connect';
export type InspectorTab = 'inspect' | 'flows' | 'metrics' | 'versions';
export type Selection = { type: 'node' | 'edge' | 'group' | 'note'; id: string } | null;
/** One item in a multi-selection (connections are never multi-selected; they follow their nodes). */
export interface Pick { type: 'node' | 'group' | 'note'; id: string }
/** Box-select rectangle in world coordinates. */
export interface Marquee { x1: number; y1: number; x2: number; y2: number }
export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error' | 'conflict';
export interface FlowPlayback { id: string; idx: number; playing: boolean }
/** Playing the journey of a request through one component, one step at a time. */
export interface JourneyPlayback { focus: string; idx: number; playing: boolean; /** when the current step started, ms */ at?: number }
export interface Toast { text: string; at: number }
