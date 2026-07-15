import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Game, GameMath } from '../game';
import { Cell, Tile } from '../types';
import type { GameCallbacks, HazardTile } from '../types';
import { Monster } from '../entities';
import { CombatSystem } from '../systems/combat';
import { MonsterAiSystem } from '../systems/monsterAI';
import { HazardSystem } from '../systems/hazards';
import { StatusEffectSystem } from '../systems/statusEffects';
import { BRANDS, BOONS, MODIFIERS, CLASSES, FLOOR_EVENTS, PATRONS, Boon } from '../content';
import { Balance } from '../balance';
import { Colors } from '../colors';
import { SpriteService } from '../sprites';
import { CrashReporter } from '../errorReporting';
import { StorageService } from '../storage';

// ── Pure function tests ──────────────────────────────────────────────────────

describe('rotateMatrix', () => {
  it('rotates a 1×4 I-piece to 4×1', () => {
    const matrix = [[1, 1, 1, 1]] as unknown as import('../types').CellValue[][];
    const result = GameMath.rotateMatrix(matrix);
    expect(result).toHaveLength(4);
    expect(result[0]).toHaveLength(1);
    expect(result.map(r => r[0])).toEqual([1, 1, 1, 1]);
  });

  it('rotates a 2×2 O-piece back to itself after 4 rotations', () => {
    const matrix = [[1, 1], [1, 1]] as unknown as import('../types').CellValue[][];
    let m = matrix;
    for (let i = 0; i < 4; i++) m = GameMath.rotateMatrix(m);
    expect(m).toEqual(matrix);
  });

  it('rotates a T-piece 90° clockwise', () => {
    const matrix = [[0, 1, 0], [1, 1, 1]] as unknown as import('../types').CellValue[][];
    const result = GameMath.rotateMatrix(matrix);
    expect(result).toHaveLength(3);
    expect(result[0]).toHaveLength(2);
    expect(result[0]).toEqual([1, 0]);
    expect(result[1]).toEqual([1, 1]);
    expect(result[2]).toEqual([1, 0]);
  });
});

// Formula: Math.max(tickMinMs, tickBaseMs - (level-1)*tickMsPerDungeonLevel), then scaled by slowPercent.
// These constants now live in src/data/balance.json (progression); the literals
// below match its current defaults (3000/400/100).
describe('tickMsForLevel', () => {
  it('returns 3000ms on floor 1 with no slow', () => expect(GameMath.tickMsForLevel(1, 0)).toBe(3000));
  it('returns 2900ms on floor 2', () => expect(GameMath.tickMsForLevel(2, 0)).toBe(2900));
  it('returns 400ms minimum', () => expect(GameMath.tickMsForLevel(999, 0)).toBe(400));
  it('applies slow perk percentage', () => expect(GameMath.tickMsForLevel(1, 15)).toBe(Math.floor(3000 * 1.15)));
});

// lineClearScoreBase/lineClearScoreOverflow now live in src/data/balance.json (progression).
describe('scoreForLines', () => {
  it('returns 100 for 1 line on floor 1', () => expect(GameMath.scoreForLines(1, 1)).toBe(100));
  it('scales with dungeon level', () => expect(GameMath.scoreForLines(1, 3)).toBe(300));
  it('returns 300 for 2 lines', () => expect(GameMath.scoreForLines(2, 1)).toBe(300));
  it('returns 1000 for 4 lines (tetris)', () => expect(GameMath.scoreForLines(4, 1)).toBe(1000));
  it('caps at 1200 base for 5+ lines', () => expect(GameMath.scoreForLines(5, 1)).toBe(1200));
});

// ── Game class tests ─────────────────────────────────────────────────────────

function makeCallbacks(): GameCallbacks & { logs: string[] } {
  const logs: string[] = [];
  return {
    logs,
    log: (text) => logs.push(text),
    updateUI: vi.fn(),
    onDeath: vi.fn(),
    onParticle: vi.fn(),
    onLevelUp: vi.fn(),
    onOpenShop: vi.fn(),
    onOpenTattooArtist: vi.fn(),
    onVictory: vi.fn(),
    onBossWarning: (_boss, onDone) => onDone(),  // resolve the cinematic immediately in tests
    onAction: vi.fn(),
  };
}

describe('Game', () => {
  let cb: ReturnType<typeof makeCallbacks>;
  let game: Game;

  beforeEach(() => {
    cb = makeCallbacks();
    game = new Game(cb);
  });

  it('initialises player at (4, 23) with 45 HP', () => {
    expect(game.player.x).toBe(4);
    expect(game.player.y).toBe(23);
    expect(game.player.hp).toBe(45);
  });

  it('starts on dungeon level 1 with gold 0', () => {
    expect(game.dungeonLevel).toBe(1);
    expect(game.gold).toBe(0);
  });

  it('player starts at level 1 with 0 XP', () => {
    expect(game.player.playerLevel).toBe(1);
    expect(game.player.xp).toBe(0);
  });

  it('isValidMove returns false for void tiles', () => {
    expect(game.isValidMove(0, 0)).toBe(false);
  });

  it('isValidMove returns true for starting platform tiles', () => {
    expect(game.isValidMove(4, 23)).toBe(true);
  });

  it('isValidMove returns false for out-of-bounds', () => {
    expect(game.isValidMove(-1, 0)).toBe(false);
    expect(game.isValidMove(0, -1)).toBe(false);
    expect(game.isValidMove(10, 0)).toBe(false);
    expect(game.isValidMove(0, 25)).toBe(false);
  });

  it('player heals correctly and clamps to maxHp', () => {
    game.player.hp = 35;
    const gained = game.player.heal(20);
    expect(game.player.hp).toBe(45);
    expect(gained).toBe(10);
  });

  it('player takeDamage is reduced by armor defence (a % of maxHp)', () => {
    game.player.hp = 30;
    game.player.damageReduction = 0.2; // 20% of maxHp (45) = 9 flat reduction
    const actual = game.player.takeDamage(15);
    expect(actual).toBe(6);
    expect(game.player.hp).toBe(24);
  });

  it('player takeDamage clamps to 0', () => {
    game.player.hp = 5;
    game.player.takeDamage(100);
    expect(game.player.hp).toBe(0);
  });

  it('hero cannot move into void', () => {
    game.player.x = 4; game.player.y = 23;
    game.handleHeroMove(0, -1);
    expect(game.player.y).toBe(23);
    expect(cb.logs.some(l => l.includes('abyss'))).toBe(true);
  });

  it('checkBlockCollision detects floor collision', () => {
    game.map[0]![0] = 1;
    const matrix = [[Cell.FLOOR]] as import('../types').CellValue[][];
    expect(game.checkBlockCollision(0, 0, matrix)).toBe(true);
  });

  it('checkBlockCollision detects out-of-bounds', () => {
    const matrix = [[Cell.FLOOR]] as import('../types').CellValue[][];
    expect(game.checkBlockCollision(-1, 0, matrix)).toBe(true);
    expect(game.checkBlockCollision(0, 25, matrix)).toBe(true);
  });

  it('player gains XP and levels up at threshold', () => {
    const levelled = game.player.gainXP(50);
    expect(levelled).toBe(true);
    expect(game.player.playerLevel).toBe(2);
    expect(game.player.xp).toBe(0);
  });

  it('XP threshold increases each level', () => {
    game.player.gainXP(50);
    expect(game.player.xpToNext).toBe(70); // 50 × 1.4 growth
  });

  it('totalXpEarned accumulates across gainXP calls', () => {
    game.player.gainXP(30);
    game.player.gainXP(20);
    expect(game.player.totalXpEarned).toBe(50);
  });

  it('poison status inflicts damage per tick', () => {
    game.player.hp = 30;
    game.player.statuses = [{ type: 'poison', duration: 2, power: 5 }];
    game.autoTick();
    expect(game.player.hp).toBeLessThan(30);
  });

  it('poison immunity prevents damage', () => {
    game.player.hp = 30;
    game.player.poisonImmune = true;
    game.player.statuses = [{ type: 'poison', duration: 2, power: 5 }];
    game.autoTick();
    expect(game.player.hp).toBeGreaterThanOrEqual(30);
  });

  it('openLevelUpBoons calls onLevelUp with 3 boon choices', () => {
    let capturedChoices: unknown[] = [];
    cb.onLevelUp = (choices, _onChoice) => { capturedChoices = choices; };
    game.openLevelUpBoons();
    expect(capturedChoices).toHaveLength(3);
  });

  it('paused flag blocks player actions', () => {
    game.paused = true;
    game.player.x = 4; game.player.y = 13;
    game.handleHeroMove(0, 1);
    expect(game.player.y).toBe(13);
  });
});

describe('Game.getInspectInfo', () => {
  let cb: ReturnType<typeof makeCallbacks>;
  let game: Game;

  beforeEach(() => {
    cb = makeCallbacks();
    game = new Game(cb);
  });

  it('returns null for an out-of-bounds tile', () => {
    expect(game.getInspectInfo(-1, 0)).toBeNull();
  });

  it('returns null for an empty unexplored/void tile', () => {
    expect(game.getInspectInfo(0, 0)).toBeNull();
  });

  it('describes the player when inspecting their own tile', () => {
    const info = game.getInspectInfo(game.player.x, game.player.y);
    expect(info).not.toBeNull();
    expect(info!.title).toBe('You');
    expect(info!.lines.some(l => l.includes('HP'))).toBe(true);
  });

  it('describes a monster on a tile', () => {
    const monster = new Monster(4, 22, 'sprite_berserker_orc', 'Goblin', 10, 10, 3, 5);
    game.monsters.push(monster);
    const info = game.getInspectInfo(4, 22);
    expect(info).not.toBeNull();
    expect(info!.title).toBe('Goblin');
    expect(info!.lines.some(l => l.startsWith('HP'))).toBe(true);
    expect(info!.lines.some(l => l.includes('ATK'))).toBe(true);
  });

  it('describes the stairs tile', () => {
    game.map[4]![22] = Tile.STAIRS;
    const info = game.getInspectInfo(4, 22);
    expect(info).not.toBeNull();
    expect(info!.title).toBe('Stairs');
  });
});

// ── Regression: monster clearing, tattoo tiles, block locking ─────────────────

describe('Monster clearing & Sacred Brands', () => {
  let cb: ReturnType<typeof makeCallbacks>;
  let game: Game;

  beforeEach(() => {
    cb = makeCallbacks();
    game = new Game(cb);
  });

  it('killMonster removes only the target from the monster list', () => {
    const a = new Monster(4, 21, 'sprite_berserker_orc', 'A', 1, 1, 1, 5);
    const b = new Monster(5, 21, 'sprite_berserker_orc', 'B', 5, 5, 1, 5);
    game.monsters.push(a, b);
    CombatSystem.killMonster(a, game);
    expect(game.monsters).not.toContain(a);
    expect(game.monsters).toContain(b);
  });

  it('killing an elite pushes a one-time story beat, not one per elite kill', () => {
    expect(game.firstEliteFelled).toBe(false);
    const a = new Monster(4, 21, 'sprite_berserker_orc', 'Elite A', 1, 1, 1, 5);
    a.isElite = true;
    const b = new Monster(5, 21, 'sprite_berserker_orc', 'Elite B', 1, 1, 1, 5);
    b.isElite = true;
    game.monsters.push(a, b);
    CombatSystem.killMonster(a, game);
    expect(game.firstEliteFelled).toBe(true);
    expect(game.storyBeats.filter(s => s.includes('cut down an elite'))).toHaveLength(1);
    CombatSystem.killMonster(b, game);
    expect(game.storyBeats.filter(s => s.includes('cut down an elite'))).toHaveLength(1);
  });

  it('poison kills a monster on tick, clears it, and awards XP', () => {
    const m = new Monster(4, 21, 'sprite_berserker_orc', 'Goblin', 3, 3, 2, 20);
    m.statuses = [{ type: 'poison', duration: 3, power: 5 }];
    game.monsters.push(m);
    const xpBefore = game.player.totalXpEarned;
    game.autoTick();
    expect(game.monsters).not.toContain(m);
    expect(game.player.totalXpEarned).toBe(xpBefore + 20);
  });

  it('monster poison applies exactly once per tick (no double-application)', () => {
    const m = new Monster(4, 21, 'sprite_berserker_orc', 'Tank', 20, 20, 1, 5);
    m.statuses = [{ type: 'poison', duration: 5, power: 5 }];
    game.monsters.push(m);
    game.autoTick();
    expect(m.hp).toBe(15);
  });

  it('locking an S-piece does not throw (terrain special-tile path)', () => {
    game.currentType = 'S';
    expect(() => game.handleBlockDrop()).not.toThrow();
  });

  it('clearing a full line does not throw (row-shift + gold log path)', () => {
    for (let x = 0; x < 10; x++) game.map[x]![5] = Tile.FLOOR;
    expect(() =>
      (game as unknown as { checkLineClears(): void }).checkLineClears(),
    ).not.toThrow();
  });

  it('tattoo tile is consumed after receiving a brand', () => {
    cb.onOpenTattooArtist = (_choices, onChoice) => onChoice(0);
    const gameTiles = game as unknown as { tattooTiles: Array<{ x: number; y: number }> };
    gameTiles.tattooTiles.push({ x: 4, y: 22 });
    game.handleHeroMove(0, -1); // step up onto the tattoo tile
    expect(gameTiles.tattooTiles).toHaveLength(0); // read fresh: handleHeroMove reassigns the array
    expect(game.player.brands).toHaveLength(1);
  });

  it('addBrand applies per-brand bonus and fires the set bonus at setSize', () => {
    const war = BRANDS.find(b => b.id === 'war')!;
    const atk0 = game.player.atk;
    game.player.addBrand('body', war);      // ×1.10
    game.player.addBrand('left_arm', war);  // ×1.10
    expect(game.player.atk).toBeCloseTo(atk0 * 1.10 ** 2, 5);
    game.player.addBrand('right_arm', war); // ×1.10 plus ×2.0 set bonus (setSize 3)
    expect(game.player.atk).toBeCloseTo(atk0 * 1.10 ** 3 * 2.0, 5);
  });

  it('Ogham Marks are capped at 5 lifetime acquisitions — a 6th tattoo tile offers nothing', () => {
    const sight = BRANDS.find(b => b.id === 'sight')!;
    for (let i = 0; i < 5; i++) game.player.addBrand('body', sight);
    expect(game.player.brandsCapped).toBe(true);
    let opened = false;
    cb.onOpenTattooArtist = () => { opened = true; };
    const gameTiles = game as unknown as { tattooTiles: Array<{ x: number; y: number }> };
    gameTiles.tattooTiles.push({ x: 4, y: 22 });
    game.handleHeroMove(0, -1);
    expect(opened).toBe(false);
    expect(game.player.brands).toHaveLength(5);
  });

  it('a Life Mark revive does not reset the lifetime brand-acquisition cap (no farming exploit)', () => {
    const life = BRANDS.find(b => b.id === 'life')!;
    game.player.addBrand('body', life);
    game.player.addBrand('left_arm', life);
    game.player.addBrand('right_arm', life); // completes the set → lifeBrandRevive = true
    expect(game.player.brandsAcquiredTotal).toBe(3);
    game.player.hp = 1;
    CombatSystem.triggerDeath(game, 'HERO DEFEATED', 'test');
    expect(game.player.brands).toHaveLength(0);       // wiped, as before
    expect(game.player.brandsAcquiredTotal).toBe(3);  // NOT reset — still counts toward the cap
    expect(game.player.brandsRemaining).toBe(2);
  });
});

// ── Balance levers: pity, coherent offers, ramp, legibility ───────────────────

describe('Balance levers', () => {
  let cb: ReturnType<typeof makeCallbacks>;
  let game: Game;

  beforeEach(() => {
    cb = makeCallbacks();
    game = new Game(cb);
  });

  // Phase 0
  it('gravity boons slow the tick (raise tickSlowPercent)', () => {
    for (const id of ['gravity_well', 'rift_tide']) {
      const boon = BOONS.find(b => b.id === id)!;
      const before = game.player.tickSlowPercent;
      boon.onAdd(game.player, 1);
      expect(game.player.tickSlowPercent).toBeGreaterThan(before);
      expect(GameMath.tickMsForLevel(1, game.player.tickSlowPercent)).toBeGreaterThan(GameMath.tickMsForLevel(1, before));
    }
  });

  // Phase 1
  it('misses chip for graze damage and the pity whiff upgrades to a stronger hit', () => {
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0); // aRoll=dRoll=1 → forced miss
    const m = new Monster(5, 21, 'sprite_berserker_orc', 'Dummy', 100, 100, 1, 5);
    game.monsters.push(m);
    const d1 = CombatSystem.playerAttackMonster(m, game);
    const d2 = CombatSystem.playerAttackMonster(m, game);
    const d3 = CombatSystem.playerAttackMonster(m, game);
    spy.mockRestore();
    expect(d1).toBeGreaterThan(0);   // graze floor — no wasted swing
    expect(d2).toBe(d1);             // consistent graze chip
    expect(d3).toBeGreaterThan(d1);  // 3rd whiff upgraded to a weak hit
  });

  it('a landed hit resets the miss-pity streak', () => {
    game.player.missStreak = 2;
    const m = new Monster(5, 21, 'sprite_berserker_orc', 'Dummy', 100, 100, 1, 5);
    game.monsters.push(m);
    const spyHit = vi.spyOn(Math, 'random').mockReturnValue(0.99); // high aRoll → land
    CombatSystem.playerAttackMonster(m, game);
    spyHit.mockRestore();
    expect(game.player.missStreak).toBe(0);
  });

  it('Cryo Mark: stunAttackChance can freeze a target on a landed non-crit hit', () => {
    const m = new Monster(5, 21, 'sprite_berserker_orc', 'Dummy', 100, 100, 1, 2);
    game.monsters.push(m);
    game.player.stunAttackChance = 1;
    const spy = vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0.5)  // aRoll = 4 (D6, not the natural-max crit roll)
      .mockReturnValueOnce(0.2)  // dRoll = 2 → margin 2, a landed "weak" hit
      .mockReturnValue(0);       // freeze-chance roll always succeeds
    CombatSystem.playerAttackMonster(m, game);
    spy.mockRestore();
    expect(m.statuses.some(s => s.type === 'stun')).toBe(true);
  });

  it('Ghost Mark: a guaranteed-dodge charge blocks damage entirely and is consumed', () => {
    const m = new Monster(4, 22, 'sprite_berserker_orc', 'G', 80, 80, 10, 5);
    game.player.hp = 100; game.player.maxHp = 100;
    game.player.ghostDodgeCharges = 1;
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.99); // would otherwise land a hit
    CombatSystem.monsterAttackPlayer(m, game);
    spy.mockRestore();
    expect(game.player.hp).toBe(100);
    expect(game.player.ghostDodgeCharges).toBe(0);
  });

  it('Ghost Mark: guaranteed-dodge charges renew on floor descent from completed sets', () => {
    const ghost = BRANDS.find(b => b.id === 'ghost')!;
    game.player.addBrand('body', ghost);
    game.player.addBrand('left_arm', ghost); // completes one set (setSize 2)
    expect(game.player.ghostDodgeCharges).toBe(1);
    game.player.ghostDodgeCharges = 0; // simulate having spent it earlier this floor
    game.resetDungeonState();
    expect(game.player.ghostDodgeCharges).toBe(1); // renewed from the completed set
  });

  // Phase 2
  it('every boon offer spans at least two distinct roles', () => {
    for (let i = 0; i < 40; i++) {
      const roles = new Set(Boon.pickThree(BOONS).map(b => b.role));
      expect(roles.size).toBeGreaterThanOrEqual(2);
    }
  });

  it('tattoo reroll spends gold and returns three fresh choices', () => {
    let reroll: (() => { choices: unknown[]; gold: number; cost: number } | null) | undefined;
    cb.onOpenTattooArtist = (_choices, _onChoice, cfg) => { reroll = cfg?.run; };
    game.gold = 500;
    (game as unknown as { tattooTiles: Array<{ x: number; y: number }> }).tattooTiles.push({ x: 4, y: 22 });
    game.handleHeroMove(0, -1);
    expect(reroll).toBeTypeOf('function');
    const res = reroll!();
    expect(res).not.toBeNull();
    expect(game.gold).toBe(500 - Balance.CONFIG.economy.ogmRerollBaseCost);
    expect(res!.choices).toHaveLength(3);
  });

  it('reroll is refused when gold is insufficient', () => {
    let reroll: (() => unknown | null) | undefined;
    cb.onOpenTattooArtist = (_choices, _onChoice, cfg) => { reroll = cfg?.run; };
    game.gold = 10;
    (game as unknown as { tattooTiles: Array<{ x: number; y: number }> }).tattooTiles.push({ x: 4, y: 22 });
    game.handleHeroMove(0, -1);
    expect(reroll!()).toBeNull();
    expect(game.gold).toBe(10);
  });

  // Phase 3 — the random spawn is capped at one monster; a cursed piece may add
  // exactly one deliberate curse rider on top.
  it('a spawned block never dumps more than one random monster (+ curse)', () => {
    const monsterCells = [Cell.MONSTER_RAT, Cell.MONSTER_SKEL, Cell.MONSTER_ARCHER, Cell.MONSTER_SLIME, Cell.MONSTER_ORC, Cell.MONSTER_BAT] as number[];
    for (let i = 0; i < 200; i++) {
      (game as unknown as { spawnBlock(): void }).spawnBlock();
      const cursed = (game as unknown as { currentCursed: boolean }).currentCursed;
      const count = game.blockMatrix.flat().filter(c => monsterCells.includes(c)).length;
      expect(count).toBeLessThanOrEqual(cursed ? 2 : 1);
    }
  });

  it('line-clear passive kills award XP and count as kills (killMonster routing)', () => {
    game.player.lineClearDamage = 2.0; // 200% of ATK(6) = 12 dmg — lethal to a 5 HP rat
    const m = new Monster(0, 5, 'sprite_rat_01', 'Rat', 5, 5, 1, 20);
    game.monsters = [m];
    game.visibility[0]![5] = true;
    for (let x = 0; x < 10; x++) game.map[x]![5] = Tile.FLOOR;
    const xpBefore = game.player.totalXpEarned;
    (game as unknown as { checkLineClears(): void }).checkLineClears();
    expect(game.monsters).toHaveLength(0);
    expect(game.monstersKilled).toBe(1);
    // line-clear XP (15) + the rat's 20 XP — not just the line XP
    expect(game.player.totalXpEarned).toBe(xpBefore + 15 + 20);
  });

  it('after Bres first appears, line clears chip his stored HP — but never below the causeway floor', () => {
    game.gorgothEverSummoned = true;
    game.dungeonLevel = 10;
    for (let x = 0; x < 10; x++) game.map[x]![5] = Tile.FLOOR;
    (game as unknown as { checkLineClears(): void }).checkLineClears();
    expect(cb.logs.some(l => l.includes('causeway shudders'))).toBe(true);
    game.summonGorgoth();
    const bres = game.monsters.find(m => m.isGorgoth)!;
    // 8 dmg × 1 row × floor 10 = 80 chipped off the max
    expect(bres.hp).toBe(Balance.CONFIG.gorgoth.maxHp - 80);

    // Grind him from afar: HP clamps at the causeway floor (a fraction of max
    // HP) — you can weaken him this way, but never finish him without a fight.
    const g = game as unknown as { gorgothHp: number };
    game.monsters = [];
    (game as unknown as { gorgothSummoned: boolean }).gorgothSummoned = false;
    g.gorgothHp = Balance.CONFIG.gorgoth.maxHp;
    for (let i = 0; i < 50; i++) {
      for (let x = 0; x < 10; x++) game.map[x]![5] = Tile.FLOOR;
      (game as unknown as { checkLineClears(): void }).checkLineClears();
    }
    const chipFloor = Math.ceil(Balance.CONFIG.gorgoth.maxHp * Balance.CONFIG.gorgoth.causewayChipFloorPct);
    expect(g.gorgothHp).toBe(chipFloor);

    // Already below the floor from a real fight: passive chip must not heal him.
    g.gorgothHp = 5;
    for (let x = 0; x < 10; x++) game.map[x]![5] = Tile.FLOOR;
    (game as unknown as { checkLineClears(): void }).checkLineClears();
    expect(g.gorgothHp).toBe(5);
  });

  it('the peddler sells each item once, deducts gold, and applies the effect', () => {
    let captured: { stock: import('../types').ShopItem[]; buy: (id: string) => { gold: number; ok: boolean } } | null = null;
    cb.onOpenShop = (stock, _gold, buy) => { captured = { stock, buy }; };
    game.gold = 10000;
    const atkBefore = game.player.atk;
    game.openPeddler();
    expect(captured).not.toBeNull();
    const { stock, buy } = captured!;
    const atkItem = stock.find(s => s.id === 'atk')!;
    const r1 = buy('atk');
    expect(r1.ok).toBe(true);
    expect(r1.gold).toBe(10000 - atkItem.cost);
    expect(game.player.atk).toBeCloseTo(atkBefore * 1.10, 5);
    // once per visit
    expect(buy('atk').ok).toBe(false);
    expect(game.player.atk).toBeCloseTo(atkBefore * 1.10, 5);
  });

  it('the peddler refuses a purchase the player cannot afford', () => {
    let buyFn: ((id: string) => { gold: number; ok: boolean }) | null = null;
    cb.onOpenShop = (_stock, _gold, buy) => { buyFn = buy; };
    game.gold = 1;
    const hpBefore = game.player.maxHp;
    game.openPeddler();
    expect(buyFn!('maxhp').ok).toBe(false);
    expect(game.gold).toBe(1);
    expect(game.player.maxHp).toBe(hpBefore);
  });

  it('at most maxTattooTilesPerFloor Ogham Mark (merchant) cells spawn in a floor', () => {
    let merchantCount = 0;
    for (let i = 0; i < 200; i++) {
      (game as unknown as { spawnBlock(): void }).spawnBlock();
      merchantCount += game.blockMatrix.flat().filter(c => c === Cell.MERCHANT).length;
    }
    expect(merchantCount).toBeLessThanOrEqual(Balance.CONFIG.spawnRates.maxTattooTilesPerFloor);
  });

  // Phase 4
  it('estimateHitChance is a valid probability and rises vs weaker defenders', () => {
    const even = CombatSystem.estimateHitChance(2, 2);
    const favoured = CombatSystem.estimateHitChance(6, 1);
    expect(even).toBeGreaterThan(0);
    expect(even).toBeLessThanOrEqual(1);
    expect(favoured).toBeGreaterThan(even);
  });

  it('monster inspect reports the player hit chance', () => {
    const m = new Monster(4, 22, 'sprite_berserker_orc', 'Goblin', 10, 10, 3, 5);
    game.monsters.push(m);
    const info = game.getInspectInfo(4, 22);
    expect(info!.lines.some(l => l.toLowerCase().includes('hit chance'))).toBe(true);
  });
});

// ── Descent visibility & interaction priority ─────────────────────────────────

describe('Descent visibility & interaction priority', () => {
  let cb: ReturnType<typeof makeCallbacks>;
  let game: Game;
  const monsterCells = [Cell.MONSTER_RAT, Cell.MONSTER_SKEL, Cell.MONSTER_ARCHER, Cell.MONSTER_SLIME, Cell.MONSTER_ORC, Cell.MONSTER_BAT] as number[];

  beforeEach(() => {
    cb = makeCallbacks();
    game = new Game(cb);
  });

  it('an enemy on an interactable tile blocks it — combat takes priority', () => {
    let altarOpened = false;
    cb.onOpenAltar = () => { altarOpened = true; };
    const m = new Monster(4, 22, 'sprite_berserker_orc', 'Guard', 500, 500, 3, 5);
    game.monsters.push(m);
    (game as unknown as { altarTiles: Array<{ x: number; y: number; tier: number }> }).altarTiles.push({ x: 4, y: 22, tier: 1 });
    game.player.atk = 100;
    game.handleHeroMove(0, -1);
    expect(game.player.x).toBe(4);
    expect(game.player.y).toBe(23);   // did not step onto the enemy's tile
    expect(altarOpened).toBe(false);  // altar not triggered while guarded
    expect(m.hp).toBeLessThan(500);   // attacked instead
    expect((game as unknown as { altarTiles: unknown[] }).altarTiles).toHaveLength(1);
  });

  it('a cursed piece injects its monster as a visible rider cell', () => {
    const g = game as unknown as { blockMatrix: number[][]; currentCursed: boolean; currentType: string; injectShapeBonusRiders(): void };
    g.blockMatrix = [[Cell.FLOOR, Cell.FLOOR], [Cell.FLOOR, Cell.FLOOR]];
    g.currentCursed = true;
    g.currentType = 'O';
    g.injectShapeBonusRiders();
    expect(g.blockMatrix.flat().some(c => monsterCells.includes(c))).toBe(true);
  });

  it('an O-piece can carry its altar as a rider cell (visible during descent)', () => {
    const g = game as unknown as { blockMatrix: number[][]; currentCursed: boolean; currentType: string; injectShapeBonusRiders(): void };
    let found = false;
    for (let i = 0; i < 80 && !found; i++) {
      g.blockMatrix = [[Cell.FLOOR, Cell.FLOOR], [Cell.FLOOR, Cell.FLOOR]];
      g.currentCursed = false;
      g.currentType = 'O';
      g.injectShapeBonusRiders();
      if (g.blockMatrix.flat().includes(Cell.ALTAR)) found = true;
    }
    expect(found).toBe(true); // ~40% per try → essentially certain within 80
  });
});

// ── Endgame: Gorgoth the Returned ─────────────────────────────────────────────

describe('Gorgoth the Returned (endgame)', () => {
  let cb: ReturnType<typeof makeCallbacks>;
  let game: Game;

  beforeEach(() => {
    cb = makeCallbacks();
    game = new Game(cb);
  });

  it('summonGorgoth spawns the boss at the top and leaves the board unchanged', () => {
    game.map[3]![10] = Tile.FLOOR;  // marker to prove the board isn't wiped
    game.summonGorgoth();
    expect(game.gorgothSummoned).toBe(true);
    expect(game.blockMatrix.flat()).toHaveLength(0);            // no falling piece
    const boss = game.monsters.find(m => m.isGorgoth);
    expect(boss).toBeDefined();
    expect(boss!.isBoss).toBe(true);
    expect(boss!.y).toBe(0);                                    // the very top of the arena
    expect(boss!.maxHp).toBe(Balance.CONFIG.gorgoth.maxHp);            // the true final-boss pool
    expect(boss!.combatLevel).toBe(Balance.CONFIG.gorgoth.combatLevel);  // D20
    expect(game.map[3]![10]).toBe(Tile.FLOOR);                  // board preserved, not reset
  });

  it('Gorgoth slowly descends toward the hero, phasing through terrain', () => {
    game.summonGorgoth();
    game.monsters = game.monsters.filter(m => m.isGorgoth); // isolate the boss
    const boss = game.monsters.find(m => m.isGorgoth)!;
    game.player.x = boss.x; game.player.y = 15;  // hero far below, no floor between
    const y0 = boss.y;
    for (let i = 0; i < 10; i++) game.autoTick();
    expect(boss.y).toBeGreaterThan(y0);            // moved downward
    expect(boss.y).toBeLessThan(15);               // slow — hasn't reached the hero yet
  });

  it('overflow summons Gorgoth instead of killing the player', () => {
    // Fill the spawn row so the next piece collides on spawn (a topped-out stack).
    for (let x = 0; x < 10; x++) game.map[x]![0] = Tile.FLOOR;
    (game as unknown as { spawnBlock(): void }).spawnBlock();
    expect(game.gorgothSummoned).toBe(true);
    expect(cb.onDeath).not.toHaveBeenCalled();
  });

  it('is idempotent — a second summon does nothing', () => {
    game.summonGorgoth();
    const count = game.monsters.filter(m => m.isGorgoth).length;
    game.summonGorgoth();
    expect(game.monsters.filter(m => m.isGorgoth).length).toBe(count);
  });

  it('no tetrominoes are generated while Gorgoth is active', () => {
    game.summonGorgoth();
    game.autoTick();
    game.autoTick();
    expect(game.blockMatrix.flat()).toHaveLength(0);
    (game as unknown as { handleBlockDrop(): void }).handleBlockDrop(); // no-op
    expect(game.blockMatrix.flat()).toHaveLength(0);
  });

  it('computeGhostBlockY does not spin on an empty matrix (renderer freeze guard)', () => {
    game.summonGorgoth();
    expect(game.blockMatrix.flat()).toHaveLength(0);
    // Would infinite-loop before the guard; a returned value proves it terminates.
    expect(game.computeGhostBlockY()).toBe(game.blockY);
  });

  it('defeating Gorgoth wins the run (via any kill path)', () => {
    game.summonGorgoth();
    const boss = game.monsters.find(m => m.isGorgoth)!;
    CombatSystem.killMonster(boss, game);
    expect(game.won).toBe(true);
    expect(cb.onVictory).toHaveBeenCalledTimes(1);
    expect(game.monsters).not.toContain(boss);
  });

  it('triggerVictory is idempotent', () => {
    game.summonGorgoth();
    game.triggerVictory();
    game.triggerVictory();
    expect(cb.onVictory).toHaveBeenCalledTimes(1);
  });

  it('descending a ladder while Gorgoth is up escapes the duel and resumes normal play', () => {
    game.summonGorgoth();
    const boss = game.monsters.find(m => m.isGorgoth)!;
    boss.x = 0; boss.y = 0;                 // keep him away from the ladder
    game.player.x = 4; game.player.y = 23;
    game.map[4]![22] = Tile.STAIRS;         // ladder directly above the hero
    const floor0 = game.dungeonLevel;
    game.handleHeroMove(0, -1);             // step onto the ladder
    expect(game.gorgothSummoned).toBe(false);
    expect(game.dungeonLevel).toBe(floor0 + 1);
    expect(game.monsters.find(m => m.isGorgoth)).toBeUndefined();  // left behind
    expect(game.blockMatrix.flat().length).toBeGreaterThan(0);      // tetrominoes resume
  });

  it('Gorgoth keeps his wounds across escape and re-summon (whittle him down)', () => {
    game.summonGorgoth();
    const boss1 = game.monsters.find(m => m.isGorgoth)!;
    boss1.hp = 600;                          // damaged him this attempt
    boss1.x = 0; boss1.y = 0;
    game.player.x = 4; game.player.y = 23;
    game.map[4]![22] = Tile.STAIRS;
    game.handleHeroMove(0, -1);              // flee down the ladder
    expect(game.gorgothSummoned).toBe(false);

    game.summonGorgoth();                     // face him again later
    const boss2 = game.monsters.find(m => m.isGorgoth)!;
    expect(boss2.hp).toBe(600);               // carried his wounds
    expect(boss2.maxHp).toBe(Balance.CONFIG.gorgoth.maxHp);           // out of full
  });

  it('nudges the player toward the win condition once when the stack is high', () => {
    for (let y = 0; y < 25; y++) game.map[4]![y] = Tile.FLOOR;  // a column reaching the ceiling
    const hits = (): number => cb.logs.filter(l => l.includes('BRES THE BEAUTIFUL and win')).length;
    (game as unknown as { maybeHintGorgoth(): void }).maybeHintGorgoth();
    expect(hits()).toBe(1);
    (game as unknown as { maybeHintGorgoth(): void }).maybeHintGorgoth();
    expect(hits()).toBe(1);  // one-time only
  });
});

// ── Monsters attack when in base contact ──────────────────────────────────────

describe('Adjacent enemies attack', () => {
  let cb: ReturnType<typeof makeCallbacks>;
  let game: Game;

  beforeEach(() => {
    cb = makeCallbacks();
    game = new Game(cb);
    game.player.x = 4; game.player.y = 23; game.player.hp = 500;
  });

  it('orthogonally adjacent melee monster hits the player', () => {
    const m = new Monster(4, 22, 'sprite_berserker_orc', 'G', 80, 80, 10, 5); // directly above, dist 1
    game.monsters.push(m);
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.99); // force a landed hit
    MonsterAiSystem.processMonsterTurns(game);
    spy.mockRestore();
    expect(game.player.hp).toBeLessThan(500);
  });

  it('diagonally adjacent melee monster closes and hits within a few turns', () => {
    game.map[5]![22] = Tile.FLOOR;  // open floor so it can step in
    const m = new Monster(5, 22, 'sprite_berserker_orc', 'G', 80, 80, 10, 5); // diagonal, dist 2
    game.monsters.push(m);
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.99);
    for (let i = 0; i < 4; i++) MonsterAiSystem.processMonsterTurns(game);
    spy.mockRestore();
    expect(game.player.hp).toBeLessThan(500);
  });

  it('combat is orthogonal-only: an enemy reachable only diagonally cannot strike', () => {
    game.player.x = 4; game.player.y = 10;
    game.map[4]![10] = Tile.FLOOR;  // hero's tile
    game.map[5]![11] = Tile.FLOOR;  // enemy diagonally touching; both approach tiles are void
    const m = new Monster(5, 11, 'sprite_berserker_orc', 'G', 80, 80, 10, 5);
    game.monsters.push(m);
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.99);
    for (let i = 0; i < 3; i++) MonsterAiSystem.processMonsterTurns(game);
    spy.mockRestore();
    expect(game.player.hp).toBe(500);          // no diagonal reach — the void corner blocks it
    expect(m.x === 5 && m.y === 11).toBe(true); // and no diagonal step to close in
  });

  it('adjacent Gorgoth hits the player', () => {
    game.summonGorgoth();
    const boss = game.monsters.find(m => m.isGorgoth)!;
    game.monsters = [boss];
    boss.x = game.player.x; boss.y = game.player.y - 1; // orthogonal, dist 1
    boss.stepCharge = 0;
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.99);
    MonsterAiSystem.processMonsterTurns(game);
    spy.mockRestore();
    expect(game.player.hp).toBeLessThan(500);
  });
});

// ── Data-driven boons / brands / modifiers (JSON effects) ─────────────────────

describe('JSON-configured effects', () => {
  let game: Game;
  beforeEach(() => { game = new Game(makeCallbacks()); });

  it('boon add-effect applies (whetstone +20% ATK)', () => {
    const atk = game.player.atk;
    BOONS.find(b => b.id === 'whetstone')!.onAdd(game.player, 1);
    expect(game.player.atk).toBeCloseTo(atk * 1.2, 5);
  });

  it('boon set-effect sets a boolean flag (iron_ward → poisonImmune)', () => {
    expect(game.player.poisonImmune).toBe(false);
    BOONS.find(b => b.id === 'iron_ward')!.onAdd(game.player, 1);
    expect(game.player.poisonImmune).toBe(true);
  });

  it('capped add-effect clamps (ghost_step dodge maxes at 0.75)', () => {
    const gs = BOONS.find(b => b.id === 'ghost_step')!;
    for (let i = 0; i < 20; i++) gs.onAdd(game.player, i + 1);
    expect(game.player.dodgeChance).toBe(0.75);
  });

  it('void_loop special handler drives critEvery by stacks', () => {
    const vl = BOONS.find(b => b.id === 'void_loop')!;
    vl.onAdd(game.player, 1);
    expect(game.player.critEvery).toBe(6);
    vl.onAdd(game.player, 2);
    expect(game.player.critEvery).toBe(5);
  });

  it('Purifying Spring makes player debuffs expire a turn early', () => {
    BOONS.find(b => b.id === 'purifying_spring')!.onAdd(game.player, 1);
    expect(game.player.statusDurationBonus).toBe(1);
    game.player.statuses = [{ type: 'stun', duration: 3, power: 0 }];
    StatusEffectSystem.applyStatusEffects(game);
    StatusEffectSystem.applyStatusEffects(game);
    // A 3-turn stun normally survives two ticks (duration 1 left); with the
    // boon it's already gone.
    expect(game.player.statuses).toHaveLength(0);
  });

  it('Mist Cloak heals a % of Max HP on dodge', () => {
    BOONS.find(b => b.id === 'mist_cloak')!.onAdd(game.player, 1);
    expect(game.player.dodgeHeal).toBeCloseTo(0.04, 5);
    game.player.dodgeChance = 1; // always dodge
    game.player.hp = 20;
    const m = new Monster(game.player.x + 1, game.player.y, 'sprite_berserker_orc', 'Orc', 10, 10, 5, 5);
    CombatSystem.monsterAttackPlayer(m, game);
    expect(game.player.hp).toBe(20 + Math.round(game.player.maxHp * 0.04)); // healed, not hurt
  });

  it("Banshee's Keening grants a stun aura, capped at radius 3", () => {
    const bk = BOONS.find(b => b.id === 'banshee_keening')!;
    for (let i = 0; i < 5; i++) bk.onAdd(game.player, i + 1);
    expect(game.player.auraStunRadius).toBe(3); // capped
    const near = new Monster(game.player.x + 1, game.player.y, 'sprite_berserker_orc', 'Near', 10, 10, 1, 5);
    game.monsters.push(near);
    StatusEffectSystem.applyAuraStun(game);
    expect(near.isStunned).toBe(true);
  });

  it('brand onSet effect applies (Life set → free-revive flag)', () => {
    expect(game.player.lifeBrandRevive).toBe(false);
    BRANDS.find(b => b.id === 'life')!.onSetComplete(game.player);
    expect(game.player.lifeBrandRevive).toBe(true);
  });

  it('brand onSet effect applies (Cryo set → freeze-on-hit chance)', () => {
    expect(game.player.stunAttackChance).toBe(0);
    BRANDS.find(b => b.id === 'cryo')!.onSetComplete(game.player);
    expect(game.player.stunAttackChance).toBe(0.25);
  });

  it('brand onSet effect applies (Ghost set → guaranteed-dodge charge)', () => {
    expect(game.player.ghostDodgeCharges).toBe(0);
    BRANDS.find(b => b.id === 'ghost')!.onSetComplete(game.player);
    expect(game.player.ghostDodgeCharges).toBe(1);
  });

  it('modifier applies to player with clamp + full-heal special (Glass Cannon)', () => {
    const p = game.player; p.maxHp = 45; p.hp = 45; p.atk = 6;
    MODIFIERS.find(m => m.id === 'glass_cannon')!.apply(game);
    expect(p.atk).toBe(14);    // +8
    expect(p.maxHp).toBe(30);  // −15
    expect(p.hp).toBe(30);     // full_heal special sets hp = maxHp
  });

  it('Ironclad grants a % of Max HP as damage reduction, not a multiple of it', () => {
    const p = game.player; p.maxHp = 45; p.hp = 45;
    MODIFIERS.find(m => m.id === 'ironclad')!.apply(game);
    expect(p.totalDef).toBe(3);                    // 7% of 45, rounded
    expect(p.takeDamage(10)).toBe(7);              // hits still land — not immune
  });

  it('mul modifier with floor+min clamp (Blind Run halves vision, min 1)', () => {
    game.player.visionRadius = 3;
    MODIFIERS.find(m => m.id === 'blind_run')!.apply(game);
    expect(game.player.visionRadius).toBe(1);   // floor(3*0.5) = 1
    MODIFIERS.find(m => m.id === 'blind_run')!.apply(game);
    expect(game.player.visionRadius).toBe(1);   // clamped at min 1
  });

  it('game-targeted modifier sets game flags (Cursed → xp×2, no line heal)', () => {
    MODIFIERS.find(m => m.id === 'cursed')!.apply(game);
    expect(game.xpMultiplier).toBe(2);
    expect(game.noLineHeal).toBe(true);
  });
});

// ── Data-driven classes + their abilities (JSON effects + ability params) ────

describe('Player classes (JSON-configured)', () => {
  let cb: ReturnType<typeof makeCallbacks>;
  let game: Game;

  beforeEach(() => {
    cb = makeCallbacks();
    game = new Game(cb);
  });

  it('CLASSES loads all classes from JSON in the original order', () => {
    expect(CLASSES.map(c => c.id)).toEqual(['chronomancer', 'architect', 'draoi']);
  });

  it('tPieceCdReduction defaults to 2, architect overrides to 4', () => {
    expect(CLASSES.find(c => c.id === 'architect')!.tPieceCdReduction).toBe(4);
    expect(CLASSES.find(c => c.id === 'chronomancer')!.tPieceCdReduction).toBe(2);
  });

  it('applyClass(chronomancer) sets stats and Time Dilation ability', () => {
    const hpBefore = game.player.maxHp;
    game.applyClass('chronomancer');
    expect(game.activeClassId).toBe('chronomancer');
    expect(game.player.maxHp).toBe(hpBefore - 5);
    expect(game.player.tickSlowPercent).toBe(25);
    expect(game.player.baseCombatLevel).toBe(2);
    expect(game.player.rangedAbility?.abilityType).toBe('time_dilation');
    expect(game.player.rangedAbility?.cooldownMax).toBe(14);
    expect(game.player.rangedAbility?.params).toEqual({ slowTurns: 15, slowPct: 100 });
  });

  it('applyClass(architect) sets stats and Consecrate ability', () => {
    const hpBefore = game.player.maxHp;
    const atkBefore = game.player.atk;
    game.applyClass('architect');
    expect(game.player.maxHp).toBe(hpBefore + 15);
    expect(game.player.atk).toBe(atkBefore - 2);
    expect(game.player.lineClearXpMult).toBe(2);
    expect(game.player.rangedAbility?.abilityType).toBe('consecrate');
    expect(game.player.rangedAbility?.params).toEqual({ tileType: 'sacred' });
  });

  it('applyClass clamps hp to the new (lower) maxHp instead of leaving it over-full', () => {
    game.player.hp = game.player.maxHp; // full HP (45)
    game.applyClass('chronomancer'); // −5 maxHp
    expect(game.player.hp).toBe(game.player.maxHp);
  });

  it('Time Dilation sets timeDilationTurns/timeDilationSlowPct from ability params', () => {
    game.applyClass('chronomancer');
    game.handleRangedAttack();
    // activateTimeDilation sets timeDilationTurns to params.slowTurns (15), but it also
    // calls advanceTurn() itself, which ticks timeDilationTurns down by 1 in the same action.
    expect(game.timeDilationTurns).toBe(14);
    expect(game.timeDilationSlowPct).toBe(100);
  });

  // Gravity Well and Overload aren't wired to any current class, but the
  // ability-type engine that runs them is still live (reusable by boons/
  // future classes) — construct the ability directly rather than via a
  // removed class id.
  it('Gravity Well pulls an eligible monster pullSteps tiles toward the player and stuns it', () => {
    // Use a longer stun than the 1-turn default so it survives the monster-turn
    // processing that happens later in this same action's advanceTurn().
    game.player.rangedAbility = {
      name: 'Gravity Well', emoji: 'trap_teleport', abilityType: 'gravity_well',
      range: 4, damageMult: 0, cooldownMax: 8, params: { pullSteps: 2, stunDuration: 3 },
    };
    const m = new Monster(game.player.x + 3, game.player.y, 'sprite_berserker_orc', 'Orc', 20, 20, 1, 5);
    game.monsters = [m];
    game.visibility[m.x]![m.y] = true;
    game.handleRangedAttack();
    expect(m.x).toBe(game.player.x + 1); // pulled 2 of the 3 tiles toward the player
    expect(m.isStunned).toBe(true);
  });

  it('Overload damage uses perKillDmg × kills, floored by perFloorMinDmg × floor, and resets killsThisFloor', () => {
    game.player.rangedAbility = {
      name: 'Overload', emoji: 'fx_impact', abilityType: 'overload',
      range: 0, damageMult: 0, cooldownMax: 12, params: { perKillDmg: 8, perFloorMinDmg: 5 },
    };
    game.killsThisFloor = 3; // 8*3=24 > floor(1)*5=5 → dmg should be 24
    const m = new Monster(game.player.x, game.player.y + 1, 'sprite_berserker_orc', 'Orc', 100, 100, 1, 5);
    game.monsters = [m];
    game.visibility[m.x]![m.y] = true;
    game.handleRangedAttack();
    expect(m.hp).toBe(100 - 24);
    expect(game.killsThisFloor).toBe(0);
  });

  it('Consecrate falls back to player.visionRadius and stamps the configured tileType', () => {
    game.applyClass('architect');
    game.player.visionRadius = 3;
    game.handleRangedAttack();
    expect(game.specialTiles.length).toBeGreaterThan(0);
    expect(game.specialTiles.every(t => t.type === 'sacred')).toBe(true);
  });

  it('locking a T-piece reduces ranged cooldown by the active class tPieceCdReduction', () => {
    game.applyClass('architect'); // tPieceCdReduction: 4
    game.player.rangedCooldown = 10;
    game.currentType = 'T';
    game.handleBlockDrop();
    // lockBlock() applies the T-piece reduction (-4), then advanceTurn()'s normal
    // per-turn tickRangedCooldown() decrements it by 1 more: 10 - 4 - 1 = 5.
    expect(game.player.rangedCooldown).toBe(5);
  });

  it('the line-clear-damage-mult passive deals lineClearDmgMult × rows × dungeonLevel to visible monsters', () => {
    game.player.lineClearDmgMult = 4;
    const m = new Monster(0, 5, 'sprite_berserker_orc', 'Orc', 100, 100, 1, 5);
    game.monsters = [m];
    game.visibility[m.x]![m.y] = true;
    for (let x = 0; x < 10; x++) game.map[x]![5] = Tile.FLOOR;
    (game as unknown as { checkLineClears(): void }).checkLineClears();
    expect(m.hp).toBe(100 - 4); // lineClearDmgMult(4) × 1 row × dungeonLevel(1)
  });

  it('no line-clear passive damage fires for classes without lineClearDmgMult', () => {
    game.applyClass('architect');
    const m = new Monster(0, 5, 'sprite_berserker_orc', 'Orc', 100, 100, 1, 5);
    game.monsters = [m];
    game.visibility[m.x]![m.y] = true;
    for (let x = 0; x < 10; x++) game.map[x]![5] = Tile.FLOOR;
    (game as unknown as { checkLineClears(): void }).checkLineClears();
    expect(m.hp).toBe(100);
  });
});

// ── An Draoi: HP-pact spellcasting & deity patrons ────────────────────────────

describe('An Draoi (HP-pact magic)', () => {
  let cb: ReturnType<typeof makeCallbacks>;
  let game: Game;

  beforeEach(() => {
    cb = makeCallbacks();
    game = new Game(cb);
    game.applyClass('draoi');
  });

  it('PATRONS loads all three deities, each with a 3-spell book, all HP-costed, signature at level 1', () => {
    expect(PATRONS.map(p => p.id)).toEqual(['morrigan', 'manannan', 'tethra']);
    for (const p of PATRONS) {
      expect(p.spells.length).toBe(3);
      expect(p.spells[0]!.unlockLevel).toBe(1);
      for (const s of p.spells) {
        expect(typeof s.params?.['hpCostPct']).toBe('number');
        expect(s.params!['hpCostPct'] as number).toBeGreaterThan(0);
      }
    }
  });

  it('applyPatron grants only level-appropriate spells; level-ups unlock the rest', () => {
    game.applyPatron('morrigan');
    expect(game.player.spellbook.map(s => s.name)).toEqual(["Badb's Shriek"]);

    game.player.playerLevel = 4;
    game.openLevelUpBoons();  // choke point that runs syncSpellUnlocks
    expect(game.player.spellbook.map(s => s.name)).toEqual(["Badb's Shriek", 'Fog of Blood']);

    game.player.playerLevel = 8;
    game.openLevelUpBoons();
    expect(game.player.spellbook.map(s => s.name)).toEqual(["Badb's Shriek", 'Fog of Blood', 'Rain of Fire']);
  });

  it('swearing the pact at a high level grants everything already earned', () => {
    game.player.playerLevel = 8;
    game.applyPatron('tethra');
    expect(game.player.spellbook.length).toBe(3);
  });

  it('handleCycleSpell rotates the active spell without resetting the shared cooldown', () => {
    game.player.playerLevel = 8;
    game.applyPatron('morrigan');
    game.paused = false;
    game.player.rangedCooldown = 2;
    expect(game.player.rangedAbility?.name).toBe("Badb's Shriek");
    game.handleCycleSpell();
    expect(game.player.rangedAbility?.name).toBe('Fog of Blood');
    expect(game.player.rangedCooldown).toBe(2);
    game.handleCycleSpell();
    game.handleCycleSpell();
    expect(game.player.rangedAbility?.name).toBe("Badb's Shriek");
  });

  it('cycling is a no-op with fewer than two spells', () => {
    game.applyPatron('manannan');
    game.paused = false;
    game.handleCycleSpell();
    expect(game.player.rangedAbility?.name).toBe('Féth Fíada');
    expect(game.player.activeSpellIndex).toBe(0);
  });

  it("Tethra's Maw devours a target below the execute threshold", () => {
    game.player.playerLevel = 8;
    game.applyPatron('tethra');
    game.paused = false;
    // cycle to Tethra's Maw (index 2)
    game.handleCycleSpell();
    game.handleCycleSpell();
    expect(game.player.rangedAbility?.name).toBe("Tethra's Maw");
    const m = new Monster(game.player.x, game.player.y - 2, 'sprite_berserker_orc', 'Tank', 30, 100, 1, 5); // 30% hp < 35%
    game.monsters = [m];
    game.visibility[m.x]![m.y] = true;
    game.map[game.player.x]![game.player.y - 1] = Tile.FLOOR;
    game.map[m.x]![m.y] = Tile.FLOOR;
    game.handleRangedAttack();
    expect(game.monsters).not.toContain(m); // devoured outright despite 100 maxHp
  });

  it('Blight of the Deep poisons every visible monster with HP-scaled power', () => {
    game.player.playerLevel = 4;
    game.applyPatron('tethra');
    game.paused = false;
    game.handleCycleSpell(); // → Blight of the Deep
    expect(game.player.rangedAbility?.name).toBe('Blight of the Deep');
    const a = new Monster(game.player.x, game.player.y - 3, 'sprite_berserker_orc', 'A', 50, 50, 1, 5);
    const b = new Monster(game.player.x + 2, game.player.y - 3, 'sprite_berserker_orc', 'B', 50, 50, 1, 5);
    game.monsters = [a, b];
    game.visibility[a.x]![a.y] = true;
    game.visibility[b.x]![b.y] = true;
    game.handleRangedAttack();
    expect(a.statuses.some(s => s.type === 'poison')).toBe(true);
    expect(b.statuses.some(s => s.type === 'poison')).toBe(true);
  });

  it('casting Wild Surge deducts the HP cost and deals dmgMult × the HP paid', () => {
    const m = new Monster(game.player.x, game.player.y - 2, 'sprite_berserker_orc', 'Orc', 100, 100, 1, 5);
    game.monsters = [m];
    game.visibility[m.x]![m.y] = true;
    // Clear line of sight — the fresh map is VOID between hero and target
    game.map[game.player.x]![game.player.y - 1] = Tile.FLOOR;
    game.map[m.x]![m.y] = Tile.FLOOR;
    const maxHp = game.player.maxHp;
    const hpBefore = game.player.hp;
    const expectedCost = Math.max(1, Math.round(maxHp * 0.10));
    game.handleRangedAttack();
    // regen/heal effects don't apply to a fresh draoi, so the delta is exactly the cost
    expect(hpBefore - game.player.hp).toBe(expectedCost);
    expect(m.hp).toBe(100 - expectedCost * 2);
  });

  it('the pact never takes your last breath — cast refused when hp <= cost', () => {
    const m = new Monster(game.player.x, game.player.y - 2, 'sprite_berserker_orc', 'Orc', 100, 100, 1, 5);
    game.monsters = [m];
    game.visibility[m.x]![m.y] = true;
    const cost = Math.max(1, Math.round(game.player.maxHp * 0.10));
    game.player.hp = cost; // exactly the cost — must refuse
    game.handleRangedAttack();
    expect(game.player.hp).toBe(cost);
    expect(m.hp).toBe(100);
  });

  it('a whiffed drain (no target) costs no HP', () => {
    game.monsters = [];
    const hpBefore = game.player.hp;
    game.handleRangedAttack();
    expect(game.player.hp).toBe(hpBefore);
    expect(game.player.rangedCooldown).toBe(0);
  });

  it("applyPatron(tethra) swaps the ability, applies the passive, and Tethra's Tithe refunds on kill", () => {
    game.applyPatron('tethra');
    expect(game.activePatronId).toBe('tethra');
    expect(game.player.rangedAbility?.name).toBe("Tethra's Tithe");
    expect(game.player.killHeal).toBeCloseTo(0.04);

    // A weak target the 3× drain will certainly kill → full cost refunded
    const m = new Monster(game.player.x, game.player.y - 2, 'sprite_berserker_orc', 'Runt', 1, 1, 1, 5);
    game.monsters = [m];
    game.visibility[m.x]![m.y] = true;
    game.map[game.player.x]![game.player.y - 1] = Tile.FLOOR;
    game.map[m.x]![m.y] = Tile.FLOOR;
    const hpBefore = game.player.hp;
    game.handleRangedAttack();
    expect(game.monsters).not.toContain(m);
    // cost paid then refunded (plus kill heals) — never below where we started
    expect(game.player.hp).toBeGreaterThanOrEqual(hpBefore);
  });

  it("Badb's Shriek hits every visible monster and puts the spell on cooldown", () => {
    game.applyPatron('morrigan');
    const a = new Monster(game.player.x, game.player.y - 2, 'sprite_berserker_orc', 'A', 100, 100, 1, 5);
    const b = new Monster(game.player.x + 2, game.player.y - 3, 'sprite_berserker_orc', 'B', 100, 100, 1, 5);
    game.monsters = [a, b];
    game.visibility[a.x]![a.y] = true;
    game.visibility[b.x]![b.y] = true;
    const cost = Math.max(1, Math.round(game.player.maxHp * 0.15));
    game.handleRangedAttack();
    expect(a.hp).toBe(100 - cost * 2);
    expect(b.hp).toBe(100 - cost * 2);
    // cooldownMax 4, minus the same-action tickRangedCooldown decrement
    expect(game.player.rangedCooldown).toBe(3);
  });

  it('Féth Fíada veils the player; veiled monsters neither move nor attack; veil ticks down', () => {
    game.applyPatron('manannan');
    const m = new Monster(game.player.x + 1, game.player.y, 'sprite_berserker_orc', 'Orc', 20, 20, 5, 5);
    game.monsters = [m];
    game.visibility[m.x]![m.y] = true;
    const hpAfterCast = (): number => game.player.hp;
    game.handleRangedAttack();
    const veiledAt = game.player.veiledTurns;
    expect(veiledAt).toBeGreaterThan(0);
    const hp = hpAfterCast();
    const mx = m.x, my = m.y;
    MonsterAiSystem.processMonsterTurns(game);
    expect(game.player.hp).toBe(hp);   // adjacent orc couldn't strike
    expect([m.x, m.y]).toEqual([mx, my]); // and didn't move
  });
});

// ── Balance config (src/data/*.json via src/balance.ts) ──────────────────────

describe('Balance config', () => {
  it('Balance.weightedPick returns the key whose cumulative range contains the roll', () => {
    expect(Balance.weightedPick({ a: 0.5, b: 0.5 }, 0.3)).toBe('a');
    expect(Balance.weightedPick({ a: 0.5, b: 0.5 }, 0.7)).toBe('b');
  });

  it('Balance.weightedPick returns null once the roll exceeds the total weight', () => {
    expect(Balance.weightedPick({ a: 0.3 }, 0.5)).toBeNull();
  });

  it('elite scaling is configurable (spawnMonster reads Balance.CONFIG.eliteMonsters.hpMult)', () => {
    const cb = makeCallbacks();
    const game = new Game(cb);
    const originalChance = Balance.CONFIG.eliteMonsters.spawnChance;
    const originalMult = Balance.CONFIG.eliteMonsters.hpMult;
    Balance.CONFIG.eliteMonsters.spawnChance = 1;
    Balance.CONFIG.eliteMonsters.hpMult = 3;
    try {
      (game as unknown as { spawnMonster(key: string, x: number, y: number): void }).spawnMonster('rat', 4, 23);
      const m = game.monsters[0]!;
      expect(m.isElite).toBe(true);
      expect(m.maxHp).toBe(10 * 3); // rat baseHp (10) × the configured elite hpMult
    } finally {
      Balance.CONFIG.eliteMonsters.spawnChance = originalChance;
      Balance.CONFIG.eliteMonsters.hpMult = originalMult;
    }
  });

  it('Gorgoth stats are configurable (summonGorgoth reads Balance.CONFIG.gorgoth.maxHp)', () => {
    const cb = makeCallbacks();
    const game = new Game(cb);
    const original = Balance.CONFIG.gorgoth.maxHp;
    Balance.CONFIG.gorgoth.maxHp = 999;
    try {
      game.summonGorgoth();
      const boss = game.monsters.find(m => m.isGorgoth)!;
      expect(boss.maxHp).toBe(999);
    } finally {
      Balance.CONFIG.gorgoth.maxHp = original;
    }
  });

  it('monster AI chase range is configurable (melee monster stays put beyond the configured range)', () => {
    const cb = makeCallbacks();
    const game = new Game(cb);
    const m = new Monster(game.player.x + 3, game.player.y, 'sprite_rat_01', 'Rat', 10, 10, 1, 5);
    game.monsters.push(m);
    const original = Balance.MONSTER_AI.melee.chaseRange;
    Balance.MONSTER_AI.melee.chaseRange = 1;
    try {
      MonsterAiSystem.processMonsterTurns(game);
      expect(m.x).toBe(game.player.x + 3); // out of the shortened chase range — doesn't move
    } finally {
      Balance.MONSTER_AI.melee.chaseRange = original;
    }
  });

  it('combat dice table is configurable (estimateHitChance reacts to a changed die size)', () => {
    const before = CombatSystem.estimateHitChance(2, 2);
    const original = Balance.COMBAT.diceSidesByLevel[2];
    Balance.COMBAT.diceSidesByLevel[2] = 100;
    try {
      const after = CombatSystem.estimateHitChance(2, 2);
      expect(after).not.toBe(before);
    } finally {
      Balance.COMBAT.diceSidesByLevel[2] = original!;
    }
  });
});

// ── Floor events (src/data/floor-events.json via src/dataLoader.ts) ──────────

describe('Floor events (JSON-configured)', () => {
  it('has all 15 events with a handler-backed apply on every option', () => {
    expect(FLOOR_EVENTS.length).toBe(15);
    for (const event of FLOOR_EVENTS) {
      for (const option of event.options) {
        expect(typeof option.apply).toBe('function');
      }
    }
  });

  it('abandoned_cache gamble option pays the jackpot on a low roll', () => {
    const cb = makeCallbacks();
    const game = new Game(cb);
    const startGold = game.gold;
    const event = FLOOR_EVENTS.find(e => e.id === 'abandoned_cache')!;
    const gamble = event.options[1]!;
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const msg = gamble.apply(game);
      expect(game.gold).toBe(startGold + 2000);
      expect(msg).toMatch(/Jackpot/);
    } finally {
      spy.mockRestore();
    }
  });

  it('abandoned_cache gamble option triggers the trap on a high roll', () => {
    const cb = makeCallbacks();
    const game = new Game(cb);
    const startGold = game.gold;
    const startHp = game.player.hp;
    const event = FLOOR_EVENTS.find(e => e.id === 'abandoned_cache')!;
    const gamble = event.options[1]!;
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.9);
    try {
      const msg = gamble.apply(game);
      expect(game.gold).toBe(startGold);
      expect(game.player.hp).toBe(startHp - 30);
      expect(msg).toMatch(/booby-trapped/);
    } finally {
      spy.mockRestore();
    }
  });

  it('static_message options return the configured resultMsg', () => {
    const cb = makeCallbacks();
    const game = new Game(cb);
    const event = FLOOR_EVENTS.find(e => e.id === 'dark_bargain')!;
    const refuse = event.options[1]!;
    expect(refuse.apply(game)).toBe("You refuse the Púca's offer. It shrieks and dissolves into mist.");
  });
});

// ── Run-end story recap ────────────────────────────────────────────────────

describe('Game.buildRunStory', () => {
  it('throws on an invalid outcome', () => {
    const game = new Game(makeCallbacks());
    expect(() => game.buildRunStory('draw' as unknown as 'death')).toThrow(TypeError);
  });

  it('returns just the opener when no story beats were recorded', () => {
    const game = new Game(makeCallbacks());
    expect(game.storyBeats).toHaveLength(0);
    const story = game.buildRunStory('death');
    expect(story).not.toMatch(/Along the way/);
    expect(story).toMatch(new RegExp(`Floor ${game.dungeonLevel}`));
  });

  it('weaves recorded story beats into the recap', () => {
    const game = new Game(makeCallbacks());
    game.storyBeats.push('felled a mighty foe');
    const story = game.buildRunStory('victory');
    expect(story).toMatch(/Along the way you felled a mighty foe\./);
  });

  it('caps the recap at the first 5 beats, noting there was more', () => {
    const game = new Game(makeCallbacks());
    for (let i = 1; i <= 7; i++) game.storyBeats.push(`did thing ${i}`);
    const story = game.buildRunStory('death');
    expect(story).toContain('did thing 5');
    expect(story).not.toContain('did thing 6');
    expect(story).toMatch(/and more besides/);
  });
});

// ── Hazards (previously untested) ─────────────────────────────────────────────

describe('Hazards', () => {
  let cb: ReturnType<typeof makeCallbacks>;
  let game: Game;

  beforeEach(() => {
    cb = makeCallbacks();
    game = new Game(cb);
  });

  it('a spike hazard fires when its timer expires, damages whoever stands on it, and rearms', () => {
    const h: HazardTile = { x: 4, y: 20, type: 'spike', timer: 1, warning: false };
    game.hazards.push(h);
    game.player.x = 4; game.player.y = 20;
    const hpBefore = game.player.hp;
    HazardSystem.processHazards(game);
    const expectedDmg = spikeDamageFor(game.dungeonLevel);
    expect(game.player.hp).toBe(hpBefore - expectedDmg);
    expect(cb.logs.some(l => l.includes('Spikes fire!'))).toBe(true);
    // Rearmed within [rearmMinTurns, rearmMinTurns + rearmRandomTurns)
    expect(h.timer).toBeGreaterThanOrEqual(Balance.HAZARD.spike.rearmMinTurns);
    expect(h.timer).toBeLessThan(Balance.HAZARD.spike.rearmMinTurns + Balance.HAZARD.spike.rearmRandomTurns);
    expect(h.warning).toBe(false);
  });

  it('a spike hazard counts down and sets the warning flag near expiry, without firing early', () => {
    const h: HazardTile = { x: 4, y: 20, type: 'spike', timer: Balance.HAZARD.spike.warningThreshold + 1, warning: false };
    game.hazards.push(h);
    const hpBefore = game.player.hp;
    HazardSystem.processHazards(game);
    expect(h.timer).toBe(Balance.HAZARD.spike.warningThreshold);
    expect(h.warning).toBe(true);
    expect(game.player.hp).toBe(hpBefore); // hasn't fired yet
  });

  it('a spike hazard damages a monster standing on it and clears it on death', () => {
    const h: HazardTile = { x: 5, y: 21, type: 'spike', timer: 1, warning: false };
    game.hazards.push(h);
    const m = new Monster(5, 21, 'sprite_berserker_orc', 'Target', 1, 1, 1, 5);
    game.monsters.push(m);
    HazardSystem.processHazards(game);
    expect(game.monsters).not.toContain(m);
  });

  it('teleport hazard moves the player to a different floor tile, logs it, and is consumed', () => {
    // Clear a small deterministic floor so the destination is predictable-ish (just "somewhere else").
    for (let x = 0; x < 3; x++) game.map[x]![10] = Tile.FLOOR;
    game.player.x = 0; game.player.y = 10;
    const hazard: HazardTile = { x: 0, y: 10, type: 'teleport', timer: 0, warning: false };
    game.hazards.push(hazard);
    HazardSystem.checkHazardTrigger(game.player, game, true);
    expect(game.hazards).not.toContain(hazard);
    expect(cb.logs.some(l => l.includes('Teleport trap!'))).toBe(true);
  });

  it('teleportImmune resists the teleport trap — hazard stays, player stays put', () => {
    for (let x = 0; x < 3; x++) game.map[x]![10] = Tile.FLOOR;
    game.player.x = 0; game.player.y = 10;
    game.player.teleportImmune = true;
    const hazard: HazardTile = { x: 0, y: 10, type: 'teleport', timer: 0, warning: false };
    game.hazards.push(hazard);
    HazardSystem.checkHazardTrigger(game.player, game, true);
    expect(game.hazards).toContain(hazard);
    expect(game.player.x).toBe(0);
    expect(game.player.y).toBe(10);
    expect(cb.logs.some(l => l.includes('you resist'))).toBe(true);
  });

  it('teleportEntity lands on an unoccupied floor tile, never the void', () => {
    game.map[1]![15] = Tile.FLOOR;
    game.map[2]![15] = Tile.FLOOR;
    const entity = { x: 9, y: 24 };
    HazardSystem.teleportEntity(entity, game);
    expect(game.map[entity.x]![entity.y]).toBe(Tile.FLOOR);
  });
});

// Small local helper mirroring processHazards' damage formula, so the spike
// test above doesn't hardcode a number that'd silently drift from balance.json.
function spikeDamageFor(dungeonLevel: number): number {
  return Math.max(Balance.HAZARD.spike.minDamage, dungeonLevel * Balance.HAZARD.spike.damagePerDungeonLevel);
}

// ── Status effects (previously untested) ──────────────────────────────────────

describe('Status effects', () => {
  let cb: ReturnType<typeof makeCallbacks>;
  let game: Game;

  beforeEach(() => {
    cb = makeCallbacks();
    game = new Game(cb);
  });

  it('poison damages the player each tick and counts down duration', () => {
    game.player.statuses = [{ type: 'poison', duration: 3, power: 5 }];
    const hpBefore = game.player.hp;
    StatusEffectSystem.applyStatusEffects(game);
    expect(game.player.hp).toBe(hpBefore - 5);
    expect(game.player.statuses).toHaveLength(1);
    expect(game.player.statuses[0]!.duration).toBe(2);
  });

  it('a status wears off and is removed once duration reaches zero', () => {
    game.player.statuses = [{ type: 'poison', duration: 1, power: 5 }];
    StatusEffectSystem.applyStatusEffects(game);
    expect(game.player.statuses).toHaveLength(0);
    expect(cb.logs.some(l => l.includes('wore off'))).toBe(true);
  });

  it('poisonImmune blocks poison damage entirely (status still ticks down)', () => {
    game.player.poisonImmune = true;
    game.player.statuses = [{ type: 'poison', duration: 3, power: 5 }];
    const hpBefore = game.player.hp;
    StatusEffectSystem.applyStatusEffects(game);
    expect(game.player.hp).toBe(hpBefore);
  });

  it('monster poison damages and, on death, awards a kill (XP) through the normal kill path', () => {
    const m = new Monster(4, 21, 'sprite_berserker_orc', 'Poisoned', 3, 3, 1, 20);
    m.statuses = [{ type: 'poison', duration: 2, power: 5 }];
    game.monsters.push(m);
    const xpBefore = game.player.totalXpEarned;
    StatusEffectSystem.applyStatusEffects(game);
    expect(game.monsters).not.toContain(m);
    expect(game.player.totalXpEarned).toBe(xpBefore + 20);
  });

  it('applyRegen heals the player by a % of maxHp, clamped to maxHp', () => {
    game.player.regenPerTick = 0.5; // 50% of maxHp (45) = 22, clamps well past -2
    game.player.hp = game.player.maxHp - 2;
    StatusEffectSystem.applyRegen(game);
    expect(game.player.hp).toBe(game.player.maxHp);
  });

  it('applyRegen grants exactly the rounded % of maxHp when unclamped', () => {
    game.player.regenPerTick = 0.1; // 10% of maxHp (45) = 4.5 -> rounds to 5 (odd) or 4 (even)
    game.player.hp = 1;
    StatusEffectSystem.applyRegen(game);
    expect(game.player.hp).toBe(1 + Math.round(game.player.maxHp * 0.1));
  });

  it('applyAuraStun stuns monsters within radius and leaves distant ones alone', () => {
    game.player.auraStunRadius = 2;
    game.player.x = 4; game.player.y = 20;
    const near = new Monster(5, 20, 'sprite_berserker_orc', 'Near', 10, 10, 1, 5);   // dist 1
    const far  = new Monster(9, 20, 'sprite_berserker_orc', 'Far',  10, 10, 1, 5);   // dist 5
    game.monsters.push(near, far);
    StatusEffectSystem.applyAuraStun(game);
    expect(near.isStunned).toBe(true);
    expect(far.isStunned).toBe(false);
  });
});

// ── colors.ts (tier color source of truth) ────────────────────────────────────

describe('Colors', () => {
  it('defines a valid rgb + bg pair for all three altar tiers', () => {
    for (const tier of [1, 2, 3] as const) {
      const c = Colors.forTier(tier);
      expect(c.rgb).toMatch(/^\d{1,3},\d{1,3},\d{1,3}$/);
      expect(c.bg).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('forTier throws on an invalid tier', () => {
    expect(() => Colors.forTier(4)).toThrow(RangeError);
  });
});

// ── Sprite map validity (regression guard for the 32rogues pack swap) ─────────

describe('SpriteService.MAP', () => {
  const SHEET_DIMENSIONS: Record<string, { w: number; h: number }> = {
    monsters: { w: 384, h: 416 },
    rogues:   { w: 224, h: 224 },
    items:    { w: 352, h: 832 },
    tiles:    { w: 544, h: 832 },
  };

  it('every entry references a registered sheet with in-bounds, non-negative coordinates', () => {
    for (const [key, coord] of Object.entries(SpriteService.MAP)) {
      expect(SpriteService.SHEETS[coord.sheet], `${key}: unregistered sheet "${coord.sheet}"`).toBeDefined();
      const dims = SHEET_DIMENSIONS[coord.sheet];
      expect(dims, `${key}: unknown sheet dimensions for "${coord.sheet}"`).toBeDefined();
      expect(coord.sx, `${key}.sx`).toBeGreaterThanOrEqual(0);
      expect(coord.sy, `${key}.sy`).toBeGreaterThanOrEqual(0);
      expect(coord.sx + coord.sw, `${key}: sx+sw exceeds sheet width`).toBeLessThanOrEqual(dims!.w);
      expect(coord.sy + coord.sh, `${key}: sy+sh exceeds sheet height`).toBeLessThanOrEqual(dims!.h);
    }
  });

  it('SpriteService.iconHTML degrades gracefully with no DOM (Node test env) instead of throwing', () => {
    expect(() => SpriteService.iconHTML('sprite_player')).not.toThrow();
    expect(SpriteService.iconHTML('sprite_player')).toBe('');
    expect(SpriteService.iconHTML('totally_bogus_key_that_does_not_exist')).toBe('');
  });
});

// ── errorReporting (crash-recovery helpers) ───────────────────────────────────

describe('errorReporting', () => {
  afterEach(() => CrashReporter.reset());

  it('CrashReporter.formatCrashInfo extracts a message from an Error and tags it with context', () => {
    expect(CrashReporter.formatCrashInfo(new Error('boom'), 'tick')).toEqual({ message: 'boom', context: 'tick' });
  });

  it('CrashReporter.formatCrashInfo coerces non-Error thrown values to a string', () => {
    expect(CrashReporter.formatCrashInfo('raw string throw', 'window')).toEqual({ message: 'raw string throw', context: 'window' });
    expect(CrashReporter.formatCrashInfo(42, 'promise')).toEqual({ message: '42', context: 'promise' });
  });

  it('CrashReporter.shouldReport is a one-shot latch until reset', () => {
    expect(CrashReporter.shouldReport()).toBe(true);
    expect(CrashReporter.shouldReport()).toBe(false);
    expect(CrashReporter.shouldReport()).toBe(false);
    CrashReporter.reset();
    expect(CrashReporter.shouldReport()).toBe(true);
  });
});

// ── storage.ts (localStorage persistence + graceful degradation) ─────────────

class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length(): number { return this.store.size; }
  clear(): void { this.store.clear(); }
  getItem(key: string): string | null { return this.store.has(key) ? this.store.get(key)! : null; }
  key(index: number): string | null { return Array.from(this.store.keys())[index] ?? null; }
  removeItem(key: string): void { this.store.delete(key); }
  setItem(key: string, value: string): void { this.store.set(key, value); }
}

describe('storage', () => {
  beforeEach(() => { vi.stubGlobal('localStorage', new MemoryStorage()); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('StorageService.getHighXp defaults to 0 with nothing stored', () => {
    expect(StorageService.getHighXp()).toBe(0);
  });

  it('StorageService.recordRunEnd persists high XP (max of previous and this run) and is readable back', () => {
    const game = new Game(makeCallbacks());
    game.player.totalXpEarned = 500;
    game.dungeonLevel = 7;
    const { highXp, history } = StorageService.recordRunEnd(game, 'TEST DEATH', undefined);
    expect(highXp).toBe(500);
    expect(history[0]).toMatchObject({ totalXpEarned: 500, floor: 7, cause: 'TEST DEATH' });
    expect(StorageService.getHighXp()).toBe(500);

    // A worse run afterward doesn't lower the recorded high score.
    const game2 = new Game(makeCallbacks());
    game2.player.totalXpEarned = 100;
    game2.dungeonLevel = 2;
    const second = StorageService.recordRunEnd(game2, 'WORSE RUN', undefined);
    expect(second.highXp).toBe(500);
  });

  it('run history is capped at 5 entries, most recent first', () => {
    for (let i = 0; i < 6; i++) {
      const game = new Game(makeCallbacks());
      game.player.totalXpEarned = i;
      game.dungeonLevel = i + 1;
      StorageService.recordRunEnd(game, `RUN ${i}`, undefined);
    }
    const history = StorageService.loadHistory();
    expect(history).toHaveLength(5);
    expect(history[0]!.cause).toBe('RUN 5');  // most recent unshifted to the front
  });

  it('mute preference round-trips through localStorage', () => {
    expect(StorageService.loadMute()).toBe(false);
    StorageService.saveMute(true);
    expect(StorageService.loadMute()).toBe(true);
    StorageService.saveMute(false);
    expect(StorageService.loadMute()).toBe(false);
  });

  it('reduced-motion preference is null (no stored pref) until explicitly saved', () => {
    expect(StorageService.loadReducedMotion()).toBeNull();
    StorageService.saveReducedMotion(true);
    expect(StorageService.loadReducedMotion()).toBe(true);
    StorageService.saveReducedMotion(false);
    expect(StorageService.loadReducedMotion()).toBe(false);
  });

  it('corrupted JSON in storage falls back to defaults instead of throwing', () => {
    localStorage.setItem('riftcrawler_v2', 'not valid json{');
    expect(() => StorageService.getHighXp()).not.toThrow();
    expect(StorageService.getHighXp()).toBe(0);
  });

  it('a throwing localStorage (private browsing / quota) is swallowed, not propagated', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('quota exceeded'); },
      setItem: () => { throw new Error('quota exceeded'); },
    });
    expect(() => StorageService.saveMute(true)).not.toThrow();
    expect(() => StorageService.loadMute()).not.toThrow();
  });

  it('StorageService.loadCodex defaults to all-empty lists with nothing stored', () => {
    expect(StorageService.loadCodex()).toEqual({ bosses: [], npcs: [], biomes: [], patrons: [] });
  });

  it('StorageService.recordCodexDiscovery adds an id under the right kind and persists it', () => {
    StorageService.recordCodexDiscovery('boss', 'Oilliphéist');
    StorageService.recordCodexDiscovery('npc', 'fionnuala');
    const codex = StorageService.loadCodex();
    expect(codex.bosses).toEqual(['Oilliphéist']);
    expect(codex.npcs).toEqual(['fionnuala']);
    expect(codex.biomes).toEqual([]);
    expect(codex.patrons).toEqual([]);
  });

  it('StorageService.recordCodexDiscovery is idempotent — a repeat id is not duplicated', () => {
    StorageService.recordCodexDiscovery('biome', 'cavern');
    StorageService.recordCodexDiscovery('biome', 'cavern');
    expect(StorageService.loadCodex().biomes).toEqual(['cavern']);
  });

  it('StorageService.recordCodexDiscovery throws on an invalid kind or empty id', () => {
    expect(() => StorageService.recordCodexDiscovery('invalid' as unknown as 'boss', 'x')).toThrow(TypeError);
    expect(() => StorageService.recordCodexDiscovery('patron', '')).toThrow(TypeError);
  });

  it('corrupted codex JSON in storage falls back to defaults instead of throwing', () => {
    localStorage.setItem('riftcrawler_codex_v1', 'not valid json{');
    expect(() => StorageService.loadCodex()).not.toThrow();
    expect(StorageService.loadCodex()).toEqual({ bosses: [], npcs: [], biomes: [], patrons: [] });
  });
});
