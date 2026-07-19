import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { KeyBindings, ACTION_LABELS } from '../keybinds';

describe('KeyBindings', () => {
  let store: Map<string, string>;

  beforeEach(() => {
    store = new Map();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
    });
    KeyBindings.reset();
  });

  afterEach(() => {
    KeyBindings.reset();
    vi.unstubAllGlobals();
  });

  it('ships the original layout as defaults (WASD/arrows, JLIKX, Space/Q/E/H)', () => {
    expect(KeyBindings.actionForKey('w')).toBe('hero-up');
    expect(KeyBindings.actionForKey('ArrowUp')).toBe('hero-up');
    expect(KeyBindings.actionForKey('ArrowLeft')).toBe('hero-left');
    expect(KeyBindings.actionForKey(' ')).toBe('hero-wait');
    expect(KeyBindings.actionForKey('q')).toBe('hero-ranged');
    expect(KeyBindings.actionForKey('e')).toBe('spell-cycle');
    expect(KeyBindings.actionForKey('j')).toBe('block-left');
    expect(KeyBindings.actionForKey('l')).toBe('block-right');
    expect(KeyBindings.actionForKey('i')).toBe('block-rotate');
    expect(KeyBindings.actionForKey('k')).toBe('block-drop');
    expect(KeyBindings.actionForKey('x')).toBe('block-softdrop');
    expect(KeyBindings.actionForKey('h')).toBe('block-hold');
    expect(KeyBindings.actionForKey('z')).toBeNull();
  });

  it('lookup is case-insensitive (Shift-held keys still work)', () => {
    expect(KeyBindings.actionForKey('W')).toBe('hero-up');
    expect(KeyBindings.actionForKey('Q')).toBe('hero-ranged');
    expect(KeyBindings.actionForKey('H')).toBe('block-hold');
  });

  it('rebind moves an action onto a fresh key', () => {
    expect(KeyBindings.rebind('block-drop', 'v')).toBe(true);
    expect(KeyBindings.actionForKey('v')).toBe('block-drop');
    expect(KeyBindings.keysFor('block-drop')).toEqual(['v']);
    expect(KeyBindings.actionForKey('k')).toBeNull();  // old key freed
  });

  it('rebind steals a key that another action held (one key, one meaning)', () => {
    KeyBindings.rebind('hero-wait', 'k');  // k was block-drop's
    expect(KeyBindings.actionForKey('k')).toBe('hero-wait');
    // block-drop had only 'k' — it is now unbound rather than silently conflicting.
    expect(KeyBindings.keysFor('block-drop')).toEqual([]);
  });

  it('stealing one of several default keys leaves the others in place', () => {
    KeyBindings.rebind('block-hold', 'w');  // hero-up keeps ArrowUp
    expect(KeyBindings.actionForKey('w')).toBe('block-hold');
    expect(KeyBindings.actionForKey('ArrowUp')).toBe('hero-up');
  });

  it('refuses the reserved shell keys (Esc / P / M)', () => {
    for (const key of ['Escape', 'p', 'P', 'm', 'M']) {
      expect(KeyBindings.rebind('hero-up', key)).toBe(false);
    }
    expect(KeyBindings.actionForKey('w')).toBe('hero-up');  // untouched
  });

  it('persists rebinds to localStorage and reset clears them', () => {
    KeyBindings.rebind('hero-ranged', 'f');
    const raw = store.get('riftcrawler_keybinds_v1');
    expect(raw).toBeDefined();
    expect((JSON.parse(raw!) as Record<string, string[]>)['hero-ranged']).toEqual(['f']);
    KeyBindings.reset();
    expect(store.has('riftcrawler_keybinds_v1')).toBe(false);
    expect(KeyBindings.actionForKey('q')).toBe('hero-ranged');
  });

  it('every labeled action in the Controls screen has a binding entry', () => {
    for (const { action } of ACTION_LABELS) {
      expect(KeyBindings.keysFor(action).length).toBeGreaterThan(0);
    }
  });

  it('keyLabel prettifies special keys', () => {
    expect(KeyBindings.keyLabel(' ')).toBe('Space');
    expect(KeyBindings.keyLabel('arrowup')).toBe('↑');
    expect(KeyBindings.keyLabel('q')).toBe('Q');
  });
});
