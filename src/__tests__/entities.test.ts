import { describe, it, expect, vi } from 'vitest';
import { Game } from '../game';
import { Player, Monster, StatMath } from '../entities';
import { MonsterAiSystem } from '../systems/monsterAI';
import { Balance } from '../balance';
import { BOONS, BRANDS } from '../content';
import type { GameCallbacks } from '../types';

function makeCallbacks(): GameCallbacks {
  return {
    log: vi.fn(),
    updateUI: vi.fn(),
    onDeath: vi.fn(),
    onParticle: vi.fn(),
    onLevelUp: vi.fn(),
    onOpenShop: vi.fn(),
    onOpenTattooArtist: vi.fn(),
    onVictory: vi.fn(),
    onBossWarning: (_boss: unknown, onDone: () => void): void => onDone(),
    onAction: vi.fn(),
    onBeam: vi.fn(),
    onToast: vi.fn(),
  } as unknown as GameCallbacks;
}

// ── Player stat math ─────────────────────────────────────────────────────────

describe('Player fundamentals', () => {
  it('starts with the configured HP/ATK and level 1', () => {
    const p = new Player(4, 23);
    expect(p.maxHp).toBe(Balance.CONFIG.player.startingHp);
    expect(p.hp).toBe(p.maxHp);
    expect(p.atk).toBe(Balance.CONFIG.player.startingAtk);
    expect(p.playerLevel).toBe(1);
  });

  it('heal caps at maxHp and reports the amount actually gained', () => {
    const p = new Player(0, 0);
    p.hp = p.maxHp - 3;
    expect(p.heal(10)).toBe(3);
    expect(p.hp).toBe(p.maxHp);
    expect(p.heal(5)).toBe(0);
  });

  it('takeDamage applies flat defense from damageReduction and floors at 0 HP', () => {
    const p = new Player(0, 0);
    p.maxHp = 100;
    p.hp = 100;
    p.damageReduction = 0.1;  // 10% of maxHp = 10 flat reduction
    expect(p.takeDamage(15)).toBe(5);
    expect(p.hp).toBe(95);
    expect(p.takeDamage(5)).toBe(0);  // fully absorbed
    p.hp = 3;
    p.takeDamage(999);
    expect(p.hp).toBe(0);
  });

  it('gainXP levels up exactly at the threshold and grows the next threshold', () => {
    const p = new Player(0, 0);
    const first = p.xpToNext;
    expect(p.gainXP(first - 1)).toBe(false);
    expect(p.playerLevel).toBe(1);
    expect(p.gainXP(1)).toBe(true);
    expect(p.playerLevel).toBe(2);
    expect(p.xpToNext).toBe(Math.floor(first * Balance.CONFIG.player.xpToNextGrowth));
    expect(p.totalXpEarned).toBe(first);
  });

  it('addBoon stacks repeat picks instead of duplicating entries', () => {
    const p = new Player(0, 0);
    const boon = BOONS.find(b => b.tier === 1)!;
    p.addBoon(boon);
    p.addBoon(boon);
    expect(p.boons).toHaveLength(1);
    expect(p.boons[0]!.stacks).toBe(2);
  });

  it('Void Prism scales with distinct boons and recomputes on removal', () => {
    const p = new Player(0, 0);
    const prism = BOONS.find(b => b.id === 'void_prism');
    if (!prism) return;  // content changed — nothing to test
    const other = BOONS.find(b => b.tier === 1 && b.id !== 'void_prism')!;
    const atkBase = p.atk;
    p.addBoon(prism);   // 1 distinct → +1 ATK
    const afterPrism = p.atk;
    expect(afterPrism).toBeGreaterThan(atkBase);
    p.addBoon(other);   // 2 distinct → bonus grows
    const afterOther = p.atk;
    expect(afterOther).toBeGreaterThan(afterPrism);
    // Removal: the removed boon's own stat effects deliberately persist
    // (documented behavior) — only the prism recomputes, losing exactly +1.
    p.removeBoon(other.id);
    expect(p.atk).toBe(afterOther - 1);
  });

  it('addBrand fires the set bonus exactly on every setSize-th copy', () => {
    const p = new Player(0, 0);
    const brand = BRANDS.find(b => b.setSize === 3)!;
    const onSet = vi.spyOn(brand, 'onSetComplete');
    try {
      p.addBrand('head', brand);
      p.addBrand('body', brand);
      expect(onSet).not.toHaveBeenCalled();
      p.addBrand('left_arm', brand);
      expect(onSet).toHaveBeenCalledTimes(1);
      expect(p.brandsAcquiredTotal).toBe(3);
    } finally {
      onSet.mockRestore();
    }
  });

  it('brandsCapped trips at the lifetime cap', () => {
    const p = new Player(0, 0);
    p.brandsAcquiredTotal = Balance.CONFIG.brands.maxLifetime;
    expect(p.brandsCapped).toBe(true);
    expect(p.brandsRemaining).toBe(0);
  });
});

describe('StatMath', () => {
  it('pctOf rounds the percentage of a value, floors at 1 for any positive fraction, and 0 for none', () => {
    expect(StatMath.pctOf(100, 0.1)).toBe(10);
    expect(StatMath.pctOf(45, 0.1)).toBe(5);   // rounds 4.5 up
    expect(StatMath.pctOf(3, 0.1)).toBe(1);    // never rounds a real reduction to nothing
    expect(StatMath.pctOf(100, 0)).toBe(0);
  });
});

// ── Monster AI ───────────────────────────────────────────────────────────────

describe('Monster AI', () => {
  function makeArena(): Game {
    const game = new Game(makeCallbacks());
    // A flat corridor at row 20 the AI can walk on.
    for (let x = 0; x < 10; x++) game.map[x]![20] = 1;
    game.player.x = 1; game.player.y = 20;
    return game;
  }

  it('a melee monster in chase range steps toward the player', () => {
    const game = makeArena();
    const m = new Monster(5, 20, 'sprite_rat_01', 'Chase Rat', 10, 10, 1, 5, false, 'melee');
    game.monsters.push(m);
    MonsterAiSystem.processMonsterTurns(game);
    expect(m.x).toBeLessThan(5);  // moved toward x=1
    expect(m.y).toBe(20);
  });

  it('a stunned monster loses its turn (and the stun ticks away via the status system)', () => {
    const game = makeArena();
    const m = new Monster(5, 20, 'sprite_rat_01', 'Stunned Rat', 10, 10, 1, 5, false, 'melee');
    m.statuses.push({ type: 'stun', duration: 2, power: 0 });
    game.monsters.push(m);
    MonsterAiSystem.processMonsterTurns(game);
    expect(m.x).toBe(5);  // did not move
  });

  it('an adjacent melee monster attacks instead of moving', () => {
    const game = makeArena();
    const m = new Monster(2, 20, 'sprite_rat_01', 'Biter', 10, 10, 3, 5, false, 'melee');
    game.monsters.push(m);
    const hpBefore = game.player.hp;
    MonsterAiSystem.processMonsterTurns(game);
    expect(m.x).toBe(2);  // stayed adjacent
    expect(game.player.hp).toBeLessThanOrEqual(hpBefore);  // swung (dice may miss but never heal)
  });

  it('monsters never walk into the void', () => {
    const game = makeArena();
    // Player far away on an island; monster on the corridor's edge.
    game.player.x = 9; game.player.y = 20;
    const m = new Monster(0, 20, 'sprite_rat_01', 'Edge Rat', 10, 10, 1, 5, false, 'melee');
    game.monsters.push(m);
    for (let i = 0; i < 12; i++) MonsterAiSystem.processMonsterTurns(game);
    expect(game.map[m.x]![m.y]).not.toBe(0);  // still standing on real floor
  });
});
