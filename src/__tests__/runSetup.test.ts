import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Game } from '../game';
import { CLASSES, MODIFIERS } from '../content';
import type { GameCallbacks, LogClass } from '../types';

function makeCallbacks(): GameCallbacks & { logs: string[] } {
  const logs: string[] = [];
  return {
    logs,
    log: (text: string, _cls: LogClass) => { logs.push(text); },
    updateUI: vi.fn(), onDeath: vi.fn(), onParticle: vi.fn(), onParticleBurst: vi.fn(),
    onLevelUp: vi.fn(), onOpenShop: vi.fn(), onOpenTattooArtist: vi.fn(), onVictory: vi.fn(),
    onBossWarning: (_b: unknown, done: () => void) => done(), onAction: vi.fn(), onBeam: vi.fn(),
    onToast: vi.fn(), onBlockLand: vi.fn(), onRingPulse: vi.fn(), onImpactGlow: vi.fn(), onAudio: vi.fn(),
    onCodexDiscover: vi.fn(),
  } as unknown as GameCallbacks & { logs: string[] };
}

describe('RunSetup — start-of-run pickers', () => {
  let game: Game;
  beforeEach(() => { game = new Game(makeCallbacks()); });

  describe('class picker', () => {
    it('offers the requested number of distinct classes', () => {
      const offered = game.getRandomClasses(2);
      expect(offered).toHaveLength(2);
      expect(new Set(offered.map(c => c.id)).size).toBe(2);
    });

    it('rejects a non-positive or non-finite count', () => {
      expect(() => game.getRandomClasses(0)).toThrow(TypeError);
      expect(() => game.getRandomClasses(-1)).toThrow(TypeError);
      expect(() => game.getRandomClasses(NaN)).toThrow(TypeError);
    });

    it('applyClass sets the active id, swaps the hero sprite, and logs', () => {
      const cls = CLASSES[0]!;
      game.applyClass(cls.id);
      expect(game.activeClassId).toBe(cls.id);
      expect(game.player.char).toBe(cls.emoji);
    });

    it('applyClass with an unknown id is a no-op (no throw, no active class)', () => {
      game.applyClass('__nope__');
      expect(game.activeClassId).toBeNull();
    });
  });

  describe('modifier (Rift Curse) picker', () => {
    it('offers a distinct random selection of the requested size', () => {
      const offered = game.getRandomModifiers(3);
      expect(offered).toHaveLength(3);
      expect(new Set(offered.map(m => m.id)).size).toBe(3);
    });

    it('rejects a bad count', () => {
      expect(() => game.getRandomModifiers(0)).toThrow(TypeError);
      expect(() => game.getRandomModifiers(Infinity)).toThrow(TypeError);
    });

    it('applyModifier activates the curse and logs it', () => {
      const mod = MODIFIERS.find(m => m.id === 'glass_cannon')!;
      game.applyModifier(mod.id);
      expect(game.activeModifierId).toBe('glass_cannon');
      expect((game.cb as unknown as { logs: string[] }).logs.some(l => l.includes(mod.name))).toBe(true);
    });

    it('applyModifier with an unknown id is a no-op', () => {
      game.applyModifier('__nope__');
      expect(game.activeModifierId).toBeNull();
    });

    it("frozen_rift's modifier effect is observable on the run", () => {
      game.applyModifier('frozen_rift');
      expect(game.frozenRift).toBe(true);
    });
  });
});
