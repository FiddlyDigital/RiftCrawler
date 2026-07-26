import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Game } from '../game';
import { Monster } from '../entities';
import { MonsterAiSystem } from '../systems/monsterAI';
import { Tile } from '../types';
import type { GameCallbacks, LogClass } from '../types';

function makeCallbacks(): GameCallbacks & { logs: string[] } {
  const logs: string[] = [];
  return {
    logs,
    log: (t: string, _c: LogClass) => { logs.push(t); },
    updateUI: vi.fn(), onDeath: vi.fn(), onParticle: vi.fn(), onParticleBurst: vi.fn(),
    onLevelUp: vi.fn(), onOpenShop: vi.fn(), onOpenTattooArtist: vi.fn(), onVictory: vi.fn(),
    onBossWarning: (_b: unknown, done: () => void) => done(), onAction: vi.fn(), onBeam: vi.fn(),
    onToast: vi.fn(), onBlockLand: vi.fn(), onRingPulse: vi.fn(), onImpactGlow: vi.fn(), onAudio: vi.fn(),
  } as unknown as GameCallbacks & { logs: string[] };
}

const mk = (x: number, y: number, behavior: Monster['behaviorType'], hp = 20, maxHp = 20, atk = 3, range = 1): Monster =>
  new Monster(x, y, 'sprite_rat_01', 'Foe', hp, maxHp, atk, 5, false, behavior, range, 1);

describe('MonsterAiSystem', () => {
  let cb: ReturnType<typeof makeCallbacks>;
  let game: Game;

  // A flat, walkable floor at row 20 the AI can move and sight along.
  const corridor = (): void => {
    for (let x = 0; x < 10; x++) game.map[x]![20] = Tile.FLOOR;
    game.player.x = 1; game.player.y = 20; game.player.hp = game.player.maxHp;
  };

  beforeEach(() => { cb = makeCallbacks(); game = new Game(cb); corridor(); });

  it('does nothing once the hero is dead', () => {
    game.player.hp = 0;
    const m = mk(3, 20, 'melee'); game.monsters.push(m);
    MonsterAiSystem.processMonsterTurns(game);
    expect(m.x).toBe(3);   // never acted
  });

  it('the god-mist (veil) blinds everything but Gorgoth', () => {
    game.player.veiledTurns = 3;
    const rat = mk(2, 20, 'melee');           // adjacent, would normally hit
    game.monsters.push(rat);
    const hp0 = game.player.hp;
    MonsterAiSystem.processMonsterTurns(game);
    expect(game.player.hp).toBe(hp0);         // ignored while veiled
  });

  describe('ranged', () => {
    it('fires when the hero is in range with line of sight', () => {
      const m = mk(4, 20, 'ranged', 20, 20, 5, 3);  // dist 3 == range
      game.monsters.push(m);
      const hp0 = game.player.hp;
      MonsterAiSystem.processMonsterTurns(game);
      expect(m.x).toBe(4);                     // held position and shot
      expect(game.player.hp).toBeLessThanOrEqual(hp0);
    });

    it('retreats when the hero closes inside its comfort zone', () => {
      const m = mk(3, 20, 'ranged', 20, 20, 5, 1);  // range 1, dist 2 → kite back
      game.monsters.push(m);
      MonsterAiSystem.processMonsterTurns(game);
      expect(m.x).toBeGreaterThan(3);          // stepped away from the hero
    });

    it('advances when the hero is beyond range but within reach', () => {
      const m = mk(7, 20, 'ranged', 20, 20, 5, 3);  // dist 6 == range+advanceBonus
      game.monsters.push(m);
      MonsterAiSystem.processMonsterTurns(game);
      expect(m.x).toBeLessThan(7);             // closed the gap
    });
  });

  describe('healer', () => {
    it('mends the most-hurt ally in range instead of attacking', () => {
      const healer = mk(5, 20, 'healer');
      const wounded = mk(6, 20, 'melee', 2, 20);  // adjacent, badly hurt
      game.monsters.push(healer, wounded);
      MonsterAiSystem.processMonsterTurns(game);
      expect(wounded.hp).toBeGreaterThan(2);
      expect(cb.logs.some(l => l.includes('heals'))).toBe(true);
    });

    it('falls back to melee when no ally needs healing', () => {
      const healer = mk(2, 20, 'healer');  // adjacent to the hero, all allies healthy
      game.monsters.push(healer);
      const hp0 = game.player.hp;
      MonsterAiSystem.processMonsterTurns(game);
      expect(game.player.hp).toBeLessThanOrEqual(hp0);
    });
  });

  describe('berserker', () => {
    it('strikes twice when enraged (below the HP threshold)', () => {
      const m = mk(2, 20, 'berserker', 4, 20);   // 20% HP < 50% → enraged
      game.monsters.push(m);
      MonsterAiSystem.processMonsterTurns(game);
      expect(cb.logs.some(l => l.includes('rages and strikes again'))).toBe(true);
    });

    it('strikes once at full health', () => {
      const m = mk(2, 20, 'berserker', 20, 20);
      game.monsters.push(m);
      MonsterAiSystem.processMonsterTurns(game);
      expect(cb.logs.some(l => l.includes('rages and strikes again'))).toBe(false);
    });
  });

  describe('swift', () => {
    it('covers two tiles per chase turn', () => {
      const m = mk(7, 20, 'swift');   // dist 6, well within swift chaseRange
      game.monsters.push(m);
      MonsterAiSystem.processMonsterTurns(game);
      expect(m.x).toBeLessThanOrEqual(5);   // moved ~2 tiles toward the hero
    });
  });

  describe('Gorgoth', () => {
    const gorgoth = (x: number, y: number): Monster => {
      const g = mk(x, y, 'gorgoth', 1000, 1000, 50);
      g.isGorgoth = true; g.isBoss = true;
      return g;
    };

    it('descends one tile toward the hero, phasing through terrain', () => {
      game.player.x = 5; game.player.y = 24;
      const g = gorgoth(5, 0);   // no floor between — he phases anyway
      game.monsters.push(g);
      MonsterAiSystem.processMonsterTurns(game);
      expect(g.y).toBe(1);       // came down one row
    });

    it('attacks the moment he reaches the hero', () => {
      game.player.x = 5; game.player.y = 20;
      const g = gorgoth(5, 19);  // adjacent
      game.monsters.push(g);
      const hp0 = game.player.hp;
      MonsterAiSystem.processMonsterTurns(game);
      expect(g.y).toBe(19);      // stood and struck rather than stepping onto the hero
      expect(game.player.hp).toBeLessThanOrEqual(hp0);
    });

    it('ignores the veil that stops every other creature', () => {
      game.player.x = 5; game.player.y = 24;
      game.player.veiledTurns = 5;
      const g = gorgoth(5, 0);
      game.monsters.push(g);
      MonsterAiSystem.processMonsterTurns(game);
      expect(g.y).toBe(1);       // still advanced through the god-mist
    });
  });

  describe('movement', () => {
    it('slides a monster across ice until it runs out', () => {
      // Ice at columns 3 and 4 on row 20; the rat steps onto 4 and slides to 2.
      game.specialTiles.push({ x: 4, y: 20, type: 'ice' }, { x: 3, y: 20, type: 'ice' });
      const m = mk(5, 20, 'melee');
      game.monsters.push(m);
      MonsterAiSystem.processMonsterTurns(game);
      expect(m.x).toBe(2);       // 5 → step to 4 → slide 4→3→2 (2 isn't ice)
    });
  });

  describe('line of sight', () => {
    it('is blocked by a void gap and clear across floor', () => {
      // Row 20 is all floor from corridor(); punch a void hole at (5,20).
      expect(MonsterAiSystem.hasLineOfSight(1, 20, 8, 20, game)).toBe(true);
      game.map[5]![20] = Tile.VOID;
      expect(MonsterAiSystem.hasLineOfSight(1, 20, 8, 20, game)).toBe(false);
    });
  });
});
