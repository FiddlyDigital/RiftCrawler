/**
 * Remappable keyboard bindings. Every in-game action maps to one or more
 * `KeyboardEvent.key` values; defaults match the original hardcoded layout.
 * Custom bindings persist to `localStorage` and survive updates; unknown or
 * stale entries fall back to the defaults. The pause-menu Controls screen
 * is the only writer.
 */

/** Every rebindable in-game action (pause/mute stay fixed on Esc/P/M). */
export type GameAction =
  | 'hero-up' | 'hero-down' | 'hero-left' | 'hero-right'
  | 'hero-wait' | 'hero-ranged' | 'spell-cycle'
  | 'block-left' | 'block-right' | 'block-rotate'
  | 'block-drop' | 'block-softdrop' | 'block-hold';

const KEY_STORE = 'riftcrawler_keybinds_v1';

/** Keys owned by the app shell (pause menu, mute) — never bindable to game actions. */
const RESERVED_KEYS = new Set(['escape', 'p', 'm']);

const DEFAULTS: Record<GameAction, string[]> = {
  'hero-up':        ['w', 'arrowup'],
  'hero-down':      ['s', 'arrowdown'],
  'hero-left':      ['a', 'arrowleft'],
  'hero-right':     ['d', 'arrowright'],
  'hero-wait':      [' '],
  'hero-ranged':    ['q'],
  'spell-cycle':    ['e'],
  'block-left':     ['j'],
  'block-right':    ['l'],
  'block-rotate':   ['i'],
  'block-drop':     ['k'],
  'block-softdrop': ['x'],
  'block-hold':     ['h'],
};

/** Player-facing labels for the Controls screen, in display order. */
export const ACTION_LABELS: Array<{ action: GameAction; label: string; group: 'hero' | 'block' }> = [
  { action: 'hero-up',        label: 'Hero Up',          group: 'hero' },
  { action: 'hero-down',      label: 'Hero Down',        group: 'hero' },
  { action: 'hero-left',      label: 'Hero Left',        group: 'hero' },
  { action: 'hero-right',     label: 'Hero Right',       group: 'hero' },
  { action: 'hero-wait',      label: 'Wait & Heal',      group: 'hero' },
  { action: 'hero-ranged',    label: 'Ability / Spell',  group: 'hero' },
  { action: 'spell-cycle',    label: 'Cycle Spell',      group: 'hero' },
  { action: 'block-left',     label: 'Block Left',       group: 'block' },
  { action: 'block-right',    label: 'Block Right',      group: 'block' },
  { action: 'block-rotate',   label: 'Rotate Block',     group: 'block' },
  { action: 'block-drop',     label: 'Hard Drop',        group: 'block' },
  { action: 'block-softdrop', label: 'Soft Drop',        group: 'block' },
  { action: 'block-hold',     label: 'Hold Block',       group: 'block' },
];

/** Static registry of the live key → action map. */
export class KeyBindings {
  private static bindings: Record<GameAction, string[]> = KeyBindings.loadStored();

  /** Normalizes a `KeyboardEvent.key` for lookup ('W' and 'w', 'ArrowUp' and 'arrowup' are the same binding). */
  static normalize(key: string): string {
    return key.toLowerCase();
  }

  private static loadStored(): Record<GameAction, string[]> {
    const merged: Record<GameAction, string[]> = { ...DEFAULTS };
    try {
      const raw = localStorage.getItem(KEY_STORE);
      if (!raw) return merged;
      const stored = JSON.parse(raw) as Partial<Record<GameAction, string[]>>;
      for (const action of Object.keys(DEFAULTS) as GameAction[]) {
        const keys = stored[action];
        if (Array.isArray(keys) && keys.length > 0 && keys.every(k => typeof k === 'string')) {
          merged[action] = keys.map(KeyBindings.normalize);
        }
      }
    } catch { /* unavailable/corrupt — defaults stand */ }
    return merged;
  }

  private static persist(): void {
    try { localStorage.setItem(KEY_STORE, JSON.stringify(KeyBindings.bindings)); } catch { /* quota */ }
  }

  /** The action bound to `key`, or `null` if none. */
  static actionForKey(key: string): GameAction | null {
    const k = KeyBindings.normalize(key);
    for (const action of Object.keys(KeyBindings.bindings) as GameAction[]) {
      if (KeyBindings.bindings[action].includes(k)) return action;
    }
    return null;
  }

  /** The keys currently bound to `action`. */
  static keysFor(action: GameAction): string[] {
    return [...(KeyBindings.bindings[action] ?? [])];
  }

  /**
   * Rebinds `action` to exactly `key`, stealing the key from any action that
   * held it (a key can only mean one thing). Returns `false` — leaving the
   * bindings untouched — for reserved keys (Esc/P/M belong to the app shell).
   */
  static rebind(action: GameAction, key: string): boolean {
    const k = KeyBindings.normalize(key);
    if (RESERVED_KEYS.has(k)) return false;
    for (const other of Object.keys(KeyBindings.bindings) as GameAction[]) {
      if (other === action) continue;
      const remaining = KeyBindings.bindings[other].filter(x => x !== k);
      // Never leave another action unbound: if stealing this key would empty
      // it, that action falls back to its default keys (minus the stolen one).
      KeyBindings.bindings[other] = remaining.length > 0
        ? remaining
        : DEFAULTS[other].filter(x => x !== k);
    }
    KeyBindings.bindings[action] = [k];
    KeyBindings.persist();
    return true;
  }

  /** Restores every action's default keys and clears the stored overrides. */
  static reset(): void {
    KeyBindings.bindings = { ...DEFAULTS };
    try { localStorage.removeItem(KEY_STORE); } catch { /* unavailable */ }
  }

  /** Player-facing label for a bound key ('arrowup' → '↑', ' ' → 'Space'). */
  static keyLabel(key: string): string {
    const MAP: Record<string, string> = {
      ' ': 'Space', 'arrowup': '↑', 'arrowdown': '↓', 'arrowleft': '←', 'arrowright': '→',
    };
    return MAP[key] ?? key.toUpperCase();
  }
}
