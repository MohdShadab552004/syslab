// Every editor keyboard shortcut, grouped for the help panel. Keys are display labels.

/** sep ' ' shows keys side by side (alternatives) instead of joined with + */
export interface ShortcutRow { keys: string[]; label: string; sep?: ' ' }
export interface ShortcutGroup { title: string; rows: ShortcutRow[] }

export const SPIKE_STEPS = [1, 2, 10, 50, 100] as const;

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'Tools',
    rows: [
      { keys: ['V'], label: 'Move tool' },
      { keys: ['C'], label: 'Connect tool' },
      { keys: ['G'], label: 'Add a group' },
      { keys: ['N'], label: 'Add a sticky note' },
      { keys: ['Esc'], label: 'Deselect · leave Connect · stop recording' },
    ],
  },
  {
    title: 'Edit',
    rows: [
      { keys: ['Ctrl', 'Z'], label: 'Undo' },
      { keys: ['Ctrl', 'Shift', 'Z'], label: 'Redo' },
      { keys: ['Ctrl', 'Y'], label: 'Redo' },
      { keys: ['Ctrl', 'C'], label: 'Copy selected item' },
      { keys: ['Ctrl', 'X'], label: 'Cut selected item' },
      { keys: ['Ctrl', 'V'], label: 'Paste' },
      { keys: ['Ctrl', 'D'], label: 'Duplicate selected item' },
      { keys: ['Ctrl', 'A'], label: 'Select everything' },
    ],
  },
  {
    title: 'Selection',
    rows: [
      { keys: ['Delete', 'Backspace'], label: 'Delete selected item', sep: ' ' },
      { keys: ['←', '↑', '→', '↓'], label: 'Nudge selected item 10px', sep: ' ' },
      { keys: ['Shift', 'Arrow'], label: 'Nudge selected item 50px' },
      { keys: ['Drag', 'empty canvas'], label: 'Box-select everything it touches' },
      { keys: ['Shift', 'Click'], label: 'Add / remove an item from the selection' },
      { keys: ['Double-click', 'group'], label: 'Select a group and everything inside' },
      { keys: ['Click', '▸'], label: 'Collapse / expand a group (double-click a card opens it)' },
      { keys: ['Tab'], label: 'Select next component' },
      { keys: ['Shift', 'Tab'], label: 'Select previous component' },
      { keys: ['Drag', '●'], label: 'Reconnect: drag an end of the selected connection' },
    ],
  },
  {
    title: 'Canvas',
    rows: [
      { keys: ['Wheel'], label: 'Pan the canvas' },
      { keys: ['Space', 'Drag'], label: 'Grab and move the canvas' },
      { keys: ['Middle mouse', 'Drag'], label: 'Grab and move the canvas' },
      { keys: ['Ctrl', 'Wheel'], label: 'Zoom at cursor (or pinch)' },
      { keys: ['Ctrl', '+'], label: 'Zoom in' },
      { keys: ['Ctrl', '−'], label: 'Zoom out' },
      { keys: ['Shift', '0'], label: 'Zoom to 100%' },
      { keys: ['Shift', '1'], label: 'Fit design to screen' },
      { keys: ['L'], label: 'Auto-layout (left to right, fewer crossings)' },
      { keys: ['Hover', 'component'], label: 'Show its hidden lines to shared services' },
    ],
  },
  {
    title: 'Simulation',
    rows: [
      { keys: ['P'], label: 'Run / pause simulation' },
      { keys: ['1'], label: 'Spike off' },
      { keys: ['2'], label: 'Spike 2×' },
      { keys: ['3'], label: 'Spike 10×' },
      { keys: ['4'], label: 'Spike 50×' },
      { keys: ['5'], label: 'Spike 100×' },
      { keys: ['?'], label: 'Show this list' },
    ],
  },
];
