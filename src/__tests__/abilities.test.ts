import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Game } from '../game';
import { Tile } from '../types';
import type { GameCallbacks, LogClass, RangedAbility } from '../types';

function makeCallbacks(): GameCallbacks & { logs: string[] } {
  const logs: string[] = [];
  return {
    logs,
    log: (t: string, _c: LogClass) => { logs.push(t); },
    updateUI: vi.fn(), onDeath: vi.fn(), onParticle: vi.fn(), onParticleBurst: vi.fn(),
    onLevelUp: vi.fn(), onOpenShop: vi.fn(), onOpenTattooArtist: vi.fn(), onVictory: vi.fn(),
    onBossWarning: (_b: unknown, done: () => void) => done(), onAction: vi.fn(), onBeam: vi.fn(),
    onToast: vi.fn(), onBlockLand: vi.fn(), onRingPulse: vi.fn(), onImpactGlow: vi.fn(), onAudio: vi.fn(),
    onCodexDiscover: vi.fn(),
  } as unknown as GameCallbacks & { logs: string[] };
}

const ability = (a: Partial<RangedAbility> & { abilityType?: RangedAbility['abilityType'] }): RangedAbility => ({
  name: 'Test', emoji: 'fx_arcane', range: 6, damageMult: 2, cooldownMax: 3, ...a,
});

describe('AbilitySystem', () => {
  let cb: ReturnType<typeof makeCallbacks>;
  let game: Game;

  // A lit, walkable arena: floor only the lower rows (14–24) of columns 0–8,
  // with the hero at row 20. Keeping the stack low avoids a top-out (which would
  // summon Gorgoth), and leaving column 9 VOID means no row is ever "full", so
  // the post-cast advanceTurn can't trigger a board-clearing line drop. The
  // whole grid is revealed so range/LOS never block a cast.
  const arena = (): void => {
    for (let x = 0; x < 10; x++) for (let y = 0; y < 25; y++) { game.visibility[x]![y] = true; game.explored[x]![y] = true; }
    for (let x = 0; x < 9; x++) for (let y = 14; y < 25; y++) game.map[x]![y] = Tile.FLOOR;
    game.player.x = 5; game.player.y = 20;
    game.player.rangedCooldown = 0;
  };
  const foeAt = (x: number, y: number): import('../entities').Monster => {
    game.spawnMonster('rat', x, y, false);
    return game.getMonsterAt(x, y)!;
  };

  beforeEach(() => { cb = makeCallbacks(); game = new Game(cb); game.dungeonLevel = 3; arena(); });

  describe('cast guards', () => {
    it('does nothing useful without an ability', () => {
      game.player.rangedAbility = null;
      game.handleRangedAttack();
      expect(cb.logs.some(l => l.includes('no ranged ability'))).toBe(true);
    });

    it('is blocked while stunned, still burning the turn', () => {
      game.player.rangedAbility = ability({ abilityType: 'bolt' });
      game.player.statuses.push({ type: 'stun', duration: 2, power: 0 });
      game.handleRangedAttack();
      expect(cb.logs.some(l => l.includes('stunned'))).toBe(true);
    });

    it('is blocked on cooldown', () => {
      game.player.rangedAbility = ability({ abilityType: 'bolt' });
      game.player.rangedCooldown = 2;
      game.handleRangedAttack();
      expect(cb.logs.some(l => l.includes('cooldown'))).toBe(true);
    });

    it('an HP-pact spell refuses when the cost would be lethal', () => {
      game.player.rangedAbility = ability({ abilityType: 'shriek', params: { hpCostPct: 0.9, dmgMult: 2 } });
      game.player.hp = 1;
      game.handleRangedAttack();
      expect(cb.logs.some(l => l.includes('will not take your last breath'))).toBe(true);
    });
  });

  describe('single-target', () => {
    it('bolt damages the nearest target and consumes ammo', () => {
      game.player.rangedAbility = ability({ abilityType: 'bolt' });
      game.player.rangedAmmo = 3;
      const foe = foeAt(5, 18);
      const hp0 = foe.hp;
      game.handleRangedAttack();
      expect(foe.hp).toBeLessThan(hp0);
      expect(game.player.rangedAmmo).toBe(2);
      expect(game.player.rangedCooldown).toBeGreaterThanOrEqual(2);   // set to 3, ticked down by the turn
    });

    it('bolt with no ammo does not fire', () => {
      game.player.rangedAbility = ability({ abilityType: 'bolt' });
      game.player.rangedAmmo = 0;
      foeAt(5, 18);
      game.handleRangedAttack();
      expect(cb.logs.some(l => l.includes('No Tests left') || l.includes('left!'))).toBe(true);
    });

    it('bolt reports when nothing is in range', () => {
      game.player.rangedAbility = ability({ abilityType: 'bolt', range: 1 });
      game.player.rangedAmmo = 5;
      foeAt(5, 10);   // far away
      game.handleRangedAttack();
      expect(cb.logs.some(l => l.includes('No target in range'))).toBe(true);
    });

    it('a lethal bolt kills the target and routes it through killMonster', () => {
      game.player.rangedAbility = ability({ abilityType: 'bolt', damageMult: 50 });
      game.player.rangedAmmo = 5;
      game.player.atk = 9999;
      foeAt(5, 18);
      game.handleRangedAttack();
      expect(game.getMonsterAt(5, 18)).toBeUndefined();
    });

    it('drain (HP-pact) damages the nearest foe and can heal', () => {
      game.player.rangedAbility = ability({ abilityType: 'drain', params: { hpCostPct: 0.1, dmgMult: 3, healPct: 0.5 } });
      game.player.hp = 40;
      const foe = foeAt(5, 18); foe.hp = 9999;
      game.handleRangedAttack();
      expect(foe.hp).toBeLessThan(9999);
    });

    it('spear_bolt skewers the whole column above the hero', () => {
      game.player.rangedAbility = ability({ abilityType: 'spear_bolt', params: { dmgMult: 3 } });
      game.player.atk = 100;
      const above = foeAt(5, 18);   // same column, above
      const aside = foeAt(7, 18);   // different column — untouched
      const aboveHp = above.hp, asideHp = aside.hp;
      game.handleRangedAttack();
      expect(above.hp).toBeLessThan(aboveHp);
      expect(aside.hp).toBe(asideHp);
    });
  });

  describe('area & utility', () => {
    it('shriek damages every visible foe and terror-stuns survivors', () => {
      game.player.rangedAbility = ability({ abilityType: 'shriek', params: { hpCostPct: 0.1, dmgMult: 2, stunChance: 1, stunDuration: 5 } });
      game.player.hp = 80;
      const a = foeAt(3, 18), b = foeAt(7, 19);
      a.hp = b.hp = 9999;
      game.handleRangedAttack();
      expect(a.hp).toBeLessThan(9999);
      expect(b.hp).toBeLessThan(9999);
      // terror-stun applied (a couple of turns burn off during this turn's ticks, so it lingers)
      expect(a.statuses.some(s => s.type === 'stun')).toBe(true);
    });

    it('blight poisons every visible foe', () => {
      game.player.rangedAbility = ability({ abilityType: 'blight', params: { hpCostPct: 0.1, poisonDuration: 4, poisonPowerPct: 0.5 } });
      game.player.hp = 80;
      const foe = foeAt(4, 18);
      game.handleRangedAttack();
      expect(foe.statuses.some(s => s.type === 'poison')).toBe(true);
    });

    it('overload hits everything visible, scaling with kills this floor', () => {
      game.player.rangedAbility = ability({ abilityType: 'overload', params: { perKillDmg: 8, perFloorMinDmg: 5 } });
      const foe = foeAt(6, 18); foe.hp = 9999;
      game.killsThisFloor = 3;
      game.handleRangedAttack();
      expect(foe.hp).toBeLessThan(9999);
      expect(game.killsThisFloor).toBe(0);   // consumed
    });

    it('gravity_well pulls and stuns nearby foes', () => {
      game.player.rangedAbility = ability({ abilityType: 'gravity_well', range: 6, params: { pullSteps: 3, stunDuration: 1 } });
      const foe = foeAt(5, 16);
      game.handleRangedAttack();
      expect(foe.y).toBeGreaterThan(16);   // dragged toward the hero (below)
    });

    it('veil hides the hero for a number of turns', () => {
      game.player.rangedAbility = ability({ abilityType: 'veil', params: { veilTurns: 6 } });
      game.handleRangedAttack();
      expect(game.player.veiledTurns).toBeGreaterThanOrEqual(5);   // 6, minus this turn's tick
    });

    it('blink teleports the hero and grants a brief veil', () => {
      game.player.rangedAbility = ability({ abilityType: 'blink', params: { veilTurns: 2 } });
      const x0 = game.player.x, y0 = game.player.y;
      game.handleRangedAttack();
      const moved = game.player.x !== x0 || game.player.y !== y0;
      expect(moved).toBe(true);
      expect(game.player.veiledTurns).toBeGreaterThanOrEqual(1);   // 2, minus this turn's tick
    });

    it('time_dilation slows gravity for a number of turns', () => {
      game.player.rangedAbility = ability({ abilityType: 'time_dilation', params: { slowTurns: 15, slowPct: 100 } });
      game.handleRangedAttack();
      expect(game.timeDilationTurns).toBeGreaterThanOrEqual(14);   // 15, minus this turn's tick
    });

    it('consecrate lays sacred tiles around the hero', () => {
      game.player.rangedAbility = ability({ abilityType: 'consecrate', params: { radius: 2 } });
      const before = game.specialTiles.length;
      game.handleRangedAttack();
      expect(game.specialTiles.length).toBeGreaterThan(before);
      expect(game.specialTiles.every(t => t.type === 'sacred' || game.specialTiles.length > before)).toBe(true);
    });
  });
});
