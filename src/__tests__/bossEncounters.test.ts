import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Game } from '../game';
import { Tile } from '../types';
import type { GameCallbacks, LogClass } from '../types';

function makeCallbacks(): GameCallbacks & { logs: string[]; toasts: string[] } {
  const logs: string[] = []; const toasts: string[] = [];
  return {
    logs, toasts,
    log: (t: string, _c: LogClass) => { logs.push(t); },
    onToast: (t: string) => { toasts.push(t); },
    updateUI: vi.fn(), onDeath: vi.fn(), onParticle: vi.fn(), onParticleBurst: vi.fn(),
    onLevelUp: vi.fn(), onOpenShop: vi.fn(), onOpenTattooArtist: vi.fn(), onVictory: vi.fn(),
    onBossWarning: (_b: unknown, done: () => void) => done(), onAction: vi.fn(), onBeam: vi.fn(),
    onBlockLand: vi.fn(), onRingPulse: vi.fn(), onImpactGlow: vi.fn(), onAudio: vi.fn(),
    onCodexDiscover: vi.fn(),
  } as unknown as GameCallbacks & { logs: string[]; toasts: string[] };
}

describe('BossEncounters', () => {
  let cb: ReturnType<typeof makeCallbacks>;
  let game: Game;
  beforeEach(() => { cb = makeCallbacks(); game = new Game(cb); game.dungeonLevel = 5; });

  describe('spawnCrystalShards (Cailleach onDeath hook)', () => {
    it('spawns up to two shards on valid tiles beside the fallen boss', () => {
      // A cross of floor around (4,23) so several neighbours are walkable.
      for (const [x, y] of [[4, 23], [3, 23], [5, 23], [4, 22], [4, 24]]) { game.map[x]![y] = Tile.FLOOR; }
      const before = game.monsters.length;
      game.spawnCrystalShards(4, 23);
      const shards = game.monsters.filter(m => m.name === 'Crystal Shard');
      expect(shards.length).toBeGreaterThan(0);
      expect(shards.length).toBeLessThanOrEqual(2);
      expect(game.monsters.length).toBe(before + shards.length);
    });

    it('never stacks a shard on an occupied tile', () => {
      for (const [x, y] of [[4, 23], [3, 23], [5, 23], [4, 22], [4, 24]]) { game.map[x]![y] = Tile.FLOOR; }
      game.spawnCrystalShards(4, 23);
      const positions = game.monsters.map(m => `${m.x},${m.y}`);
      expect(new Set(positions).size).toBe(positions.length);
    });
  });

  describe('triggerGravityBurst (Balor onHalfHp hook)', () => {
    it('yanks the falling piece up five rows, clamped at the top', () => {
      game.blockY = 10;
      game.triggerGravityBurst();
      expect(game.blockY).toBe(5);
      game.blockY = 2;
      game.triggerGravityBurst();
      expect(game.blockY).toBe(0);   // clamped, never negative
    });
  });

  describe('the near-ceiling win nudge', () => {
    const hint = (g: Game): void => (g as unknown as { maybeHintGorgoth(): void }).maybeHintGorgoth();

    it('fires once when the stack climbs near the top, and never repeats', () => {
      game.map[4]![5] = Tile.FLOOR;   // a built tile at row 5 → stackTopRow() <= 5
      hint(game);
      const nudges = cb.logs.filter(l => l.includes('top out to summon'));
      expect(nudges.length).toBe(1);
      hint(game);   // second call must not re-nudge
      expect(cb.logs.filter(l => l.includes('top out to summon')).length).toBe(1);
    });

    it('stays silent while the stack is still low', () => {
      hint(game);   // empty board → stackTopRow() is ROWS, far from the ceiling
      expect(cb.logs.some(l => l.includes('top out to summon'))).toBe(false);
    });
  });

  describe('summonGorgoth + triggerVictory', () => {
    it('summoning is idempotent and clears the falling stone into the finale', () => {
      game.summonGorgoth();
      expect(game.gorgothSummoned).toBe(true);
      const bossCount = game.monsters.filter(m => m.isGorgoth).length;
      game.summonGorgoth();   // second call is a no-op
      expect(game.monsters.filter(m => m.isGorgoth).length).toBe(bossCount);
      expect(bossCount).toBe(1);
    });

    it('triggerVictory wins the run exactly once', () => {
      game.summonGorgoth();
      game.triggerVictory();
      game.triggerVictory();
      expect(game.won).toBe(true);
      expect(cb.onVictory).toHaveBeenCalledTimes(1);
    });
  });
});
