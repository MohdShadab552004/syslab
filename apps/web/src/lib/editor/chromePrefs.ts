// Per-browser editor chrome preferences (not part of the design, never synced).

const MINIMAL_KEY = 'syslab.minimal';

/** Is "Minimize UI" on (side panels, header and bottom bar hidden, like Figma's Ctrl+Shift+\)? */
export function loadMinimal(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): boolean {
  try {
    return storage?.getItem(MINIMAL_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveMinimal(on: boolean, storage: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage) {
  try { storage?.setItem(MINIMAL_KEY, on ? '1' : '0'); } catch { /* private mode: keep it in memory */ }
}
