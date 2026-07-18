import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Game, GameMath } from '../game';
import { Cell, Tile } from '../types';
import type { GameCallbacks, HazardTile } from '../types';
import { Monster } from '../entities';
import { CombatSystem } from '../systems/combat';
import { MonsterAiSystem } from '../systems/monsterAI';
import { HazardSystem } from '../systems/hazards';
import { StatusEffectSystem } from '../systems/statusEffects';
import { BRANDS, BOONS, MODIFIERS, CLASSES, FLOOR_EVENTS, PATRONS, SMITHS, RESCUES, Boon, Omen, OMENS, Npc, NPCS } from '../content';
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
    onBeam: vi.fn(),
    onToast: vi.fn(),
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

  it('summonGorgoth brings a floor-appropriate Fomorian escort, not scaled to match him', () => {
    // Escorts land beside him at row 0, which real topped-out boards have
    // floor tiles at (that's what caused the overflow); a fresh test board
    // doesn't, so give it one.
    for (let x = 0; x < 10; x++) game.map[x]![0] = Tile.FLOOR;
    game.summonGorgoth();
    const escort = game.monsters.filter(m => !m.isGorgoth);
    expect(escort.length).toBeGreaterThan(0);
    expect(escort.length).toBeLessThanOrEqual(3);
    for (const m of escort) {
      expect(m.isBoss).toBe(false);
      expect(m.y).toBe(0);                                  // arrives beside him at the top
      expect(m.maxHp).toBeLessThan(Balance.CONFIG.gorgoth.maxHp);  // a raiding party, not a second boss
    }
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

  it('summoning Gorgoth sweeps every stairs tile to plain floor and beams each column', () => {
    game.map[4]![22] = Tile.STAIRS;
    game.map[7]![10] = Tile.STAIRS;
    game.summonGorgoth();
    expect(game.map[4]![22]).toBe(Tile.FLOOR);
    expect(game.map[7]![10]).toBe(Tile.FLOOR);
    expect(cb.onBeam).toHaveBeenCalledWith(4, expect.any(String));
    expect(cb.onBeam).toHaveBeenCalledWith(7, expect.any(String));
  });

  it('no stairs tile survives once Gorgoth is up — stepping where one was just continues the duel', () => {
    game.summonGorgoth();
    const boss = game.monsters.find(m => m.isGorgoth)!;
    boss.x = 0; boss.y = 0;                 // keep him away from the hero
    game.player.x = 4; game.player.y = 23;
    game.map[4]![22] = Tile.STAIRS;         // simulate one somehow still present
    const floor0 = game.dungeonLevel;
    game.handleHeroMove(0, -1);             // step onto it
    expect(game.gorgothSummoned).toBe(true);   // no escape — the duel continues
    expect(game.dungeonLevel).toBe(floor0);    // no floor transition
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

// ── Wandering NPC encounters ────────────────────────────────────────────────

describe('Wandering NPC encounters', () => {
  it('a trade-kind NPC with no boons to trade still opens a dialog, not a silent log line', () => {
    const onFloorEvent = vi.fn();
    const cb = { ...makeCallbacks(), onFloorEvent };
    const game = new Game(cb);
    expect(game.player.boons).toHaveLength(0);
    const tx = game.player.x + 1, ty = game.player.y;
    game.map[tx]![ty] = Tile.FLOOR;
    game.npcTiles = [{ x: tx, y: ty, npcId: 'fomorian_tinker' }];
    game.handleHeroMove(1, 0);
    expect(onFloorEvent).toHaveBeenCalledTimes(1);
    const [event] = onFloorEvent.mock.calls[0]!;
    expect(event.title).toBe('A Fomorian Tinker');
    expect(event.options.length).toBeGreaterThan(0);
    expect(game.npcTiles).toHaveLength(0);  // tile still consumed on bump
  });
});

describe("Lugh's Spear questline (the three legendary smiths)", () => {
  it('a smith-eligible floor (every 3rd, non-boss) sets pendingSmithFloor and logs the anvil hint', () => {
    const cb = makeCallbacks();
    const game = new Game(cb);
    (game as unknown as { maybeAnnounceSmithFloor(isBossFloor: boolean): void }).maybeAnnounceSmithFloor(false);
    expect((game as unknown as { pendingSmithFloor: boolean }).pendingSmithFloor).toBe(false); // floor 1 isn't a multiple of 3
    game.dungeonLevel = 3;
    (game as unknown as { maybeAnnounceSmithFloor(isBossFloor: boolean): void }).maybeAnnounceSmithFloor(false);
    expect((game as unknown as { pendingSmithFloor: boolean }).pendingSmithFloor).toBe(true);
    expect(cb.logs.some(l => l.includes('clang of an anvil'))).toBe(true);
  });

  it('does not announce on a boss floor even if it is also a multiple of 3', () => {
    const cb = makeCallbacks();
    const game = new Game(cb);
    game.dungeonLevel = 15; // multiple of both 3 (smiths) and 5 (bosses)
    (game as unknown as { maybeAnnounceSmithFloor(isBossFloor: boolean): void }).maybeAnnounceSmithFloor(true);
    expect((game as unknown as { pendingSmithFloor: boolean }).pendingSmithFloor).toBe(false);
  });

  it('the smith rider injects only once blocksSpawnedThisFloor reaches the configured threshold', () => {
    const cb = makeCallbacks();
    const game = new Game(cb);
    const g = game as unknown as {
      pendingSmithFloor: boolean; blocksSpawnedThisFloor: number;
      spawnBlock(): void; blockMatrix: number[][];
    };
    g.pendingSmithFloor = true;
    g.blocksSpawnedThisFloor = 0;
    g.spawnBlock();
    expect(g.blockMatrix.flat().includes(Cell.SMITH)).toBe(false);

    g.blocksSpawnedThisFloor = Balance.CONFIG.smiths.pieceThreshold;
    g.spawnBlock();
    expect(g.blockMatrix.flat().includes(Cell.SMITH)).toBe(true);
  });

  it('fires the mid-floor anvil warning toast once blocksSpawnedThisFloor reaches the warning threshold, and only once', () => {
    const cb = makeCallbacks();
    const game = new Game(cb);
    const g = game as unknown as {
      pendingSmithFloor: boolean; blocksSpawnedThisFloor: number; spawnBlock(): void;
    };
    g.pendingSmithFloor = true;
    // spawnBlock() increments blocksSpawnedThisFloor before checking the
    // threshold, so start one below the value that should trip it.
    g.blocksSpawnedThisFloor = Balance.CONFIG.smiths.warningThreshold - 2;
    g.spawnBlock();
    expect(cb.onToast).not.toHaveBeenCalledWith('The sound of anvils is getting stronger!', expect.any(String));

    g.blocksSpawnedThisFloor = Balance.CONFIG.smiths.warningThreshold - 1;
    g.spawnBlock();
    expect(cb.onToast).toHaveBeenCalledWith('The sound of anvils is getting stronger!', expect.any(String));
    const callCount = (cb.onToast as ReturnType<typeof vi.fn>).mock.calls.filter(
      c => c[0] === 'The sound of anvils is getting stronger!',
    ).length;

    g.spawnBlock(); // still above threshold, but already shown this floor
    const callCountAfter = (cb.onToast as ReturnType<typeof vi.fn>).mock.calls.filter(
      c => c[0] === 'The sound of anvils is getting stronger!',
    ).length;
    expect(callCountAfter).toBe(callCount);
  });

  it('meeting all three smiths in order grants every part and Goibniu reforges the spear', () => {
    const onFloorEvent = vi.fn();
    const cb = { ...makeCallbacks(), onFloorEvent };
    const game = new Game(cb);
    const g = game as unknown as {
      spearPartsHeld: Set<string>; smithsMetCount: number; spearForged: boolean;
      triggerSmithEncounter(smith: unknown, onClosed?: () => void): void;
    };

    for (const smith of SMITHS) {
      onFloorEvent.mockClear();
      g.triggerSmithEncounter(smith);
      expect(onFloorEvent).toHaveBeenCalledTimes(1);
      const [event, onChoice] = onFloorEvent.mock.calls[0]!;
      expect(event.title).toBe(smith.name);
      onChoice(0); // the only option: take the part / let him reforge
    }

    expect([...g.spearPartsHeld].sort()).toEqual(['bolts', 'head', 'shaft']);
    expect(g.smithsMetCount).toBe(3);
    expect(g.spearForged).toBe(true);
    expect(game.player.rangedAbility?.abilityType).toBe('spear_bolt');
  });

  it('the Spear of Lugh damages every monster in the hero column above, and none elsewhere', () => {
    const cb = makeCallbacks();
    const game = new Game(cb);
    game.player.rangedAbility = {
      name: 'Spear of Lugh', emoji: 'item_spear_of_lugh', abilityType: 'spear_bolt',
      range: 0, damageMult: 3, cooldownMax: 8,
    };
    game.player.atk = 10;
    const inColumn = new Monster(game.player.x, game.player.y - 2, 'sprite_berserker_orc', 'In column', 100, 100, 1, 5);
    const offColumn = new Monster(game.player.x + 1, game.player.y - 2, 'sprite_berserker_orc', 'Off column', 100, 100, 1, 5);
    const below = new Monster(game.player.x, game.player.y + 1, 'sprite_berserker_orc', 'Below', 100, 100, 1, 5);
    game.monsters = [inColumn, offColumn, below];
    game.handleRangedAttack();
    expect(inColumn.hp).toBe(70); // 100 - (10 * 3)
    expect(offColumn.hp).toBe(100);
    expect(below.hp).toBe(100);
  });
});

describe('Ambient floor-entry toasts', () => {
  it('announceBossFloor sets pendingBossFloor and fires the ambush toast', () => {
    const cb = makeCallbacks();
    const game = new Game(cb);
    (game as unknown as { announceBossFloor(): void }).announceBossFloor();
    expect((game as unknown as { pendingBossFloor: boolean }).pendingBossFloor).toBe(true);
    expect(cb.onToast).toHaveBeenCalledWith('You sense dark forces lie in ambush!', expect.any(String));
  });

  it('the starting floor-1 biome fires its own entry toast (never reached via updateBiome)', () => {
    const cb = makeCallbacks();
    new Game(cb);
    expect(cb.onToast).toHaveBeenCalledWith(expect.stringContaining('Entering'), expect.any(String));
  });

  it('updateBiome only toasts when the biome actually changes', () => {
    const cb = makeCallbacks();
    const game = new Game(cb);
    (cb.onToast as ReturnType<typeof vi.fn>).mockClear(); // constructor already fired the floor-1 toast
    (game as unknown as { updateBiome(): void }).updateBiome(); // still floor 1, same biome
    expect(cb.onToast).not.toHaveBeenCalled();
    game.dungeonLevel = 5; // crosses into the next biome (minFloor 5)
    (game as unknown as { updateBiome(): void }).updateBiome();
    expect(cb.onToast).toHaveBeenCalledWith(expect.stringContaining('Entering'), expect.any(String));
  });
});

describe('Floor omens (per-floor modifiers)', () => {
  const asOmen = (g: Game): { maybeRollOmen(isBossFloor: boolean): void } =>
    g as unknown as { maybeRollOmen(isBossFloor: boolean): void };

  afterEach(() => vi.restoreAllMocks());

  it('never rolls on boss floors or floor 1, and respects the roll chance', () => {
    const cb = makeCallbacks();
    const game = new Game(cb);
    vi.spyOn(Math, 'random').mockReturnValue(0); // would always pass the chance gate
    asOmen(game).maybeRollOmen(true); // boss floor
    expect(game.activeOmen).toBeNull();
    game.dungeonLevel = 1;
    asOmen(game).maybeRollOmen(false); // floor 1
    expect(game.activeOmen).toBeNull();
    vi.restoreAllMocks();
    vi.spyOn(Math, 'random').mockReturnValue(0.99); // fails the chance gate
    game.dungeonLevel = 4;
    asOmen(game).maybeRollOmen(false);
    expect(game.activeOmen).toBeNull();
  });

  it('rolling an omen announces it via toast + log and populates UIState', () => {
    const cb = makeCallbacks();
    const game = new Game(cb);
    game.dungeonLevel = 4;
    vi.spyOn(Math, 'random').mockReturnValue(0);
    asOmen(game).maybeRollOmen(false);
    expect(game.activeOmen).not.toBeNull();
    expect(cb.onToast).toHaveBeenCalledWith(game.activeOmen!.toastText, game.activeOmen!.icon);
    expect(cb.logs).toContain(game.activeOmen!.logText);
  });

  it('sidhe_fog shrinks the vision radius while active', () => {
    const cb = makeCallbacks();
    const game = new Game(cb);
    game.activeOmen = new Omen(OMENS.find(o => o.id === 'sidhe_fog')!);
    (game as unknown as { updateVisibility(): void }).updateVisibility();
    const r = game.activeOmen.num('visionPenalty', 0);
    const justOutside = game.player.visionRadius - r + 1;
    const px = game.player.x, py = game.player.y;
    const yProbe = py - justOutside;
    if (yProbe >= 0) expect(game.visibility[px]![yProbe]).toBe(false);
  });

  it('rich_vein doubles line-clear gold', () => {
    const cbA = makeCallbacks();
    const plain = new Game(cbA);
    for (let x = 0; x < 10; x++) plain.map[x]![5] = Tile.FLOOR;
    (plain as unknown as { checkLineClears(): void }).checkLineClears();
    const plainGold = plain.gold;

    const cbB = makeCallbacks();
    const rich = new Game(cbB);
    rich.activeOmen = new Omen(OMENS.find(o => o.id === 'rich_vein')!);
    for (let x = 0; x < 10; x++) rich.map[x]![5] = Tile.FLOOR;
    (rich as unknown as { checkLineClears(): void }).checkLineClears();
    expect(rich.gold).toBe(plainGold * 2);
  });

  it('heavy_air feeds omenGravityPct into the UIState gravity rate', () => {
    const cb = makeCallbacks();
    const game = new Game(cb);
    const updateUI = cb.updateUI as ReturnType<typeof vi.fn>;
    updateUI.mockClear();
    (game as unknown as { pushUI(): void }).pushUI();
    const plainRate = updateUI.mock.calls[updateUI.mock.calls.length - 1]![0].gravityRate;

    game.activeOmen = new Omen(OMENS.find(o => o.id === 'heavy_air')!);
    game.omenGravityPct = game.activeOmen.num('gravityPct', 0);
    (game as unknown as { pushUI(): void }).pushUI();
    const heavyRate = updateUI.mock.calls[updateUI.mock.calls.length - 1]![0].gravityRate;
    expect(heavyRate).toBeLessThan(plainRate);
  });

  it('wild_magic scales the cursed/blessed piece shares together', () => {
    const cb = makeCallbacks();
    const game = new Game(cb);
    const roll = (Balance.CONFIG.spawnRates.cursedPieceChance + Balance.CONFIG.spawnRates.blessedPieceChance) * 1.5;
    const g = game as unknown as { rollPieceCurseState(r: number): { cursed: boolean; blessed: boolean } };
    const before = g.rollPieceCurseState(roll);
    expect(before.cursed || before.blessed).toBe(false); // outside the normal shares
    game.activeOmen = new Omen(OMENS.find(o => o.id === 'wild_magic')!);
    const after = g.rollPieceCurseState(roll);
    expect(after.cursed || after.blessed).toBe(true); // inside the scaled shares
  });

  it('descending clears the active omen and its gravity adjustment', () => {
    const cb = makeCallbacks();
    const game = new Game(cb);
    game.activeOmen = new Omen(OMENS.find(o => o.id === 'heavy_air')!);
    game.omenGravityPct = -20;
    game.resetDungeonState();
    expect(game.activeOmen).toBeNull();
    expect(game.omenGravityPct).toBe(0);
  });
});

describe('Bealtaine Fires (brazier ritual omen)', () => {
  const bealtaine = (): Omen => new Omen(OMENS.find(o => o.id === 'bealtaine_fires')!);

  function armRitual(game: Game): Omen {
    const omen = bealtaine();
    game.activeOmen = omen;
    return omen;
  }

  it('injects a brazier rider on interval pieces, and only while more fires are still needed', () => {
    const cb = makeCallbacks();
    const game = new Game(cb);
    const omen = armRitual(game);
    const interval = omen.num('brazierPieceInterval', 5);
    const g = game as unknown as { blocksSpawnedThisFloor: number; spawnBlock(): void; blockMatrix: number[][] };

    g.blocksSpawnedThisFloor = interval - 1; // spawnBlock increments first -> lands on the interval
    g.spawnBlock();
    expect(g.blockMatrix.flat().includes(Cell.BRAZIER)).toBe(true);

    g.blocksSpawnedThisFloor = interval; // off-interval piece -> no rider
    g.spawnBlock();
    expect(g.blockMatrix.flat().includes(Cell.BRAZIER)).toBe(false);

    // With required braziers already standing (unlit), no more riders come.
    const required = omen.num('braziersRequired', 3);
    for (let i = 0; i < required; i++) game.brazierTiles.push({ x: i, y: 20, lit: false });
    g.blocksSpawnedThisFloor = interval * 2 - 1;
    g.spawnBlock();
    expect(g.blockMatrix.flat().includes(Cell.BRAZIER)).toBe(false);
  });

  it('locking a brazier cell plants an unlit brazier tile on the floor', () => {
    const cb = makeCallbacks();
    const game = new Game(cb);
    armRitual(game);
    const g = game as unknown as { blockMatrix: number[][]; blockX: number; blockY: number; lockBlock(): void };
    g.blockMatrix = [[Cell.BRAZIER]] as number[][];
    g.blockX = 4; g.blockY = 20;
    g.lockBlock();
    expect(game.brazierTiles.some(b => b.x === 4 && b.y === 20 && !b.lit)).toBe(true);
    expect(game.map[4]![20]).toBe(Tile.FLOOR);
  });

  it('bumping unlit braziers lights them; the final fire completes the ritual and opens a tier-3 Geis choice', () => {
    const onOpenAltar = vi.fn();
    const cb = { ...makeCallbacks(), onOpenAltar };
    const game = new Game(cb);
    const omen = armRitual(game);
    const required = omen.num('braziersRequired', 3);

    // Stand the hero on solid ground with braziers adjacent, one at a time.
    for (let i = 0; i < required; i++) {
      const bx = game.player.x + 1, by = game.player.y;
      game.map[bx]![by] = Tile.FLOOR;
      game.brazierTiles.push({ x: bx, y: by, lit: false });
      game.handleHeroMove(1, 0);
      expect(game.brazierLitCount).toBe(i + 1);
      if (i < required - 1) {
        // step back off the (now lit) brazier tile for the next round
        game.map[game.player.x - 1]![game.player.y] = Tile.FLOOR;
        game.handleHeroMove(-1, 0);
      }
    }
    expect(onOpenAltar).toHaveBeenCalledTimes(1);
    expect(onOpenAltar.mock.calls[0]![0]).toBe(3); // tier-3 Geis
    expect(cb.logs.some(l => l.includes('need-fires blaze'))).toBe(true);
  });

  it('a cleared row removes its braziers but keeps banked lit progress, and replacements become due again', () => {
    const cb = makeCallbacks();
    const game = new Game(cb);
    const omen = armRitual(game);
    game.brazierLitCount = 1;
    game.brazierTiles.push({ x: 0, y: 5, lit: false });
    for (let x = 0; x < 10; x++) game.map[x]![5] = Tile.FLOOR;
    (game as unknown as { checkLineClears(): void }).checkLineClears();
    expect(game.brazierTiles).toHaveLength(0);
    expect(game.brazierLitCount).toBe(1);

    // The lost unlit brazier makes a rider due again on the next interval piece.
    const interval = omen.num('brazierPieceInterval', 5);
    const g = game as unknown as { blocksSpawnedThisFloor: number; spawnBlock(): void; blockMatrix: number[][] };
    g.blocksSpawnedThisFloor = interval - 1;
    g.spawnBlock();
    expect(g.blockMatrix.flat().includes(Cell.BRAZIER)).toBe(true);
  });

  it('descending resets all ritual state', () => {
    const cb = makeCallbacks();
    const game = new Game(cb);
    armRitual(game);
    game.brazierTiles.push({ x: 2, y: 20, lit: true });
    game.brazierLitCount = 2;
    game.resetDungeonState();
    expect(game.brazierTiles).toHaveLength(0);
    expect(game.brazierLitCount).toBe(0);
    expect(game.activeOmen).toBeNull();
  });
});

describe('Waystations (the sídhe mound offered at every staircase)', () => {
  /** Steps onto adjacent stairs; without an onFloorEvent mock this descends directly. */
  function stepOntoStairs(game: Game): void {
    const sx = game.player.x + 1, sy = game.player.y;
    game.map[sx]![sy] = Tile.STAIRS;
    game.handleHeroMove(1, 0);
  }

  /** Steps onto stairs with the choice dialog wired, then picks an option (0 = delve, 1 = rest). */
  function chooseAtStairs(game: Game, onFloorEvent: ReturnType<typeof vi.fn>, index: number): void {
    onFloorEvent.mockClear();
    stepOntoStairs(game);
    const [event, onChoice] = onFloorEvent.mock.calls[0]!;
    expect(event.id).toBe('__stairs_choice__');
    onChoice(index);
  }

  function enterMound(game: Game, onFloorEvent: ReturnType<typeof vi.fn>): void {
    chooseAtStairs(game, onFloorEvent, 1);
  }

  it('stairs open a delve-or-rest choice; resting enters the mound without consuming a floor number', () => {
    const onFloorEvent = vi.fn();
    const cb = { ...makeCallbacks(), onFloorEvent };
    const game = new Game(cb);
    const floorBefore = game.dungeonLevel;
    enterMound(game, onFloorEvent);
    expect(game.inWaystation).toBe(true);
    expect(game.dungeonLevel).toBe(floorBefore);  // the mound sits between floors
    expect(cb.onToast).toHaveBeenCalledWith(expect.stringContaining('sídhe mound'), expect.any(String));
    // The mound's residents are placed: seanchaí, hearth-fire, peddler stall.
    const ids = game.npcTiles.map(n => n.npcId);
    expect(ids).toContain('seanchai');
    expect(ids).toContain('__campfire__');
    expect(ids).toContain('__peddler__');
    // Exit stairs pre-placed, no monsters, and the whole floor is revealed.
    expect(game.map[Game.MOUND.stairs.x]![Game.MOUND.stairs.y]).toBe(Tile.STAIRS);
    expect(game.monsters).toHaveLength(0);
    expect(game.visibility[0]![0]).toBe(true);
  });

  it('choosing to delve descends normally, exactly like the no-dialog fallback', () => {
    const onFloorEvent = vi.fn();
    const cb = { ...makeCallbacks(), onFloorEvent };
    const game = new Game(cb);
    const floorBefore = game.dungeonLevel;
    chooseAtStairs(game, onFloorEvent, 0);
    expect(game.dungeonLevel).toBe(floorBefore + 1);
    expect(game.inWaystation).toBe(false);
  });

  it('without a dialog callback (headless), stairs descend directly', () => {
    const cb = makeCallbacks();
    const game = new Game(cb);
    const floorBefore = game.dungeonLevel;
    stepOntoStairs(game);
    expect(game.dungeonLevel).toBe(floorBefore + 1);
    expect(game.inWaystation).toBe(false);
  });

  it('the Tetris layer is suspended in a waystation: no gravity, no block input', () => {
    const onFloorEvent = vi.fn();
    const cb = { ...makeCallbacks(), onFloorEvent };
    const game = new Game(cb);
    enterMound(game, onFloorEvent);
    expect(game.inWaystation).toBe(true);
    // Block inputs are inert.
    const beforeX = (game as unknown as { blockX: number }).blockX;
    game.handleBlockLeft();
    game.handleBlockRight();
    game.handleBlockRotate();
    game.handleBlockDrop();
    expect((game as unknown as { blockX: number }).blockX).toBe(beforeX);
    expect((game as unknown as { blockMatrix: number[][] }).blockMatrix).toHaveLength(0);
    // autoTick runs without a falling piece and without crashing.
    game.paused = false;
    game.autoTick();
    expect((game as unknown as { blockMatrix: number[][] }).blockMatrix).toHaveLength(0);
  });

  it('the hearth-fire fully heals once and is consumed', () => {
    const onFloorEvent = vi.fn();
    const cb = { ...makeCallbacks(), onFloorEvent };
    const game = new Game(cb);
    enterMound(game, onFloorEvent);
    game.player.hp = 5;
    // Stand the hero beside the hearth and bump it.
    game.player.x = Game.MOUND.campfire.x - 1; game.player.y = Game.MOUND.campfire.y;
    game.npcTiles = game.npcTiles.filter(n => n.npcId === '__campfire__');
    game.handleHeroMove(1, 0);
    expect(game.player.hp).toBe(game.player.maxHp);
    expect(game.npcTiles.some(n => n.npcId === '__campfire__')).toBe(false);
  });

  it('the mound exit stairs descend directly (no second choice dialog) and restart the Tetris layer', () => {
    const onFloorEvent = vi.fn();
    const cb = { ...makeCallbacks(), onFloorEvent };
    const game = new Game(cb);
    enterMound(game, onFloorEvent);
    const floorBefore = game.dungeonLevel;
    onFloorEvent.mockClear();
    // Step to the exit stairs: teleport adjacent and move onto them.
    game.player.x = Game.MOUND.stairs.x - 1; game.player.y = Game.MOUND.stairs.y;
    game.npcTiles = [];  // clear residents from the path for the test
    game.handleHeroMove(1, 0);
    expect(game.dungeonLevel).toBe(floorBefore + 1);
    expect(game.inWaystation).toBe(false);
    expect((game as unknown as { blockMatrix: number[][] }).blockMatrix.length).toBeGreaterThan(0);
    // No stairs-choice dialog fired for the mound's own exit (a real floor
    // event may legitimately fire for the newly entered floor, though).
    const stairsChoiceCalls = onFloorEvent.mock.calls.filter(c => c[0]?.id === '__stairs_choice__');
    expect(stairsChoiceCalls).toHaveLength(0);
  });

  it('the seanchaí never appears as a random wandering NPC', () => {
    for (let i = 0; i < 200; i++) {
      expect(Npc.random().id).not.toBe('seanchai');
    }
  });

  it('interval descents roll a pending floor event instead of an immediate modal (and never auto-open the shop)', () => {
    const onFloorEvent = vi.fn();
    const cb = { ...makeCallbacks(), onFloorEvent };
    const game = new Game(cb);
    (game as unknown as { floorsDescended: number }).floorsDescended = Balance.CONFIG.floors.floorEventInterval - 1;
    chooseAtStairs(game, onFloorEvent, 0);  // delve — lands on an interval descent
    expect(game.pendingFloorEvent).not.toBeNull();
    // Only the stairs-choice dialog fired — the event itself waits in the mound.
    const nonStairsCalls = onFloorEvent.mock.calls.filter(c => c[0]?.id !== '__stairs_choice__');
    expect(nonStairsCalls).toHaveLength(0);
    expect(cb.onOpenShop).not.toHaveBeenCalled();
    expect(cb.onToast).toHaveBeenCalledWith(expect.stringContaining('stranger'), expect.any(String));
  });

  it('a pending floor event stands in the mound as a stranger; bumping them delivers it and clears the pending state', () => {
    const onFloorEvent = vi.fn();
    const cb = { ...makeCallbacks(), onFloorEvent };
    const game = new Game(cb);
    (game as unknown as { floorsDescended: number }).floorsDescended = Balance.CONFIG.floors.floorEventInterval - 1;
    chooseAtStairs(game, onFloorEvent, 0);
    const held = game.pendingFloorEvent!;
    enterMound(game, onFloorEvent);
    expect(game.npcTiles.some(n => n.npcId === '__event__')).toBe(true);
    // Bump the stranger.
    game.player.x = Game.MOUND.stranger.x - 1; game.player.y = Game.MOUND.stranger.y;
    game.npcTiles = game.npcTiles.filter(n => n.npcId === '__event__');
    onFloorEvent.mockClear();
    game.paused = false;
    game.handleHeroMove(1, 0);
    const [event, onChoice] = onFloorEvent.mock.calls[0]!;
    expect(event.id).toBe(held.id);
    expect(game.pendingFloorEvent).toBeNull();
    onChoice(0);
    expect(game.paused).toBe(false);
    // Claimed — the next mound visit has no stranger.
    (game as unknown as { enterWaystation(): void }).enterWaystation();
    expect(game.npcTiles.some(n => n.npcId === '__event__')).toBe(false);
  });

  it("An Draoi's unsworn pact stands in the mound as a deity emissary; bumping them opens the ceremony", () => {
    const onFloorEvent = vi.fn();
    const cb = { ...makeCallbacks(), onFloorEvent };
    const game = new Game(cb);
    game.applyClass('draoi');
    chooseAtStairs(game, onFloorEvent, 0);  // reach floor 2 (pact needs depth >= 2)
    enterMound(game, onFloorEvent);
    expect(game.npcTiles.some(n => n.npcId === '__pact__')).toBe(true);
    // Bump the emissary.
    game.player.x = Game.MOUND.emissary.x - 1; game.player.y = Game.MOUND.emissary.y;
    game.map[Game.MOUND.emissary.x - 1]![Game.MOUND.emissary.y] = Tile.FLOOR;  // ensure standing room at the chamber edge
    game.npcTiles = game.npcTiles.filter(n => n.npcId === '__pact__');
    onFloorEvent.mockClear();
    game.paused = false;
    game.handleHeroMove(1, 0);
    const [event, onChoice] = onFloorEvent.mock.calls[0]!;
    expect(event.id).toBe('__pact__');
    onChoice(0);
    expect(game.activePatronId).not.toBeNull();
    // Sworn — the next mound visit has no emissary.
    (game as unknown as { enterWaystation(): void }).enterWaystation();
    expect(game.npcTiles.some(n => n.npcId === '__pact__')).toBe(false);
  });

  it('the mound holds the ogham stone and well fixtures, and Aoife only while no bounty is active', () => {
    const onFloorEvent = vi.fn();
    const cb = { ...makeCallbacks(), onFloorEvent };
    const game = new Game(cb);
    enterMound(game, onFloorEvent);
    const ids = game.npcTiles.map(n => n.npcId);
    expect(ids).toContain('__ogham_stone__');
    expect(ids).toContain('__well__');
    expect(ids).toContain('aoife');
    game.activeBountyQuest = { bossName: 'Test', floor: 5 };
    (game as unknown as { enterWaystation(): void }).enterWaystation();
    expect(game.npcTiles.some(n => n.npcId === 'aoife')).toBe(false);
  });

  it('the ogham stone opens the lore codex and stays put', () => {
    const onOpenCodex = vi.fn();
    const onFloorEvent = vi.fn();
    const cb = { ...makeCallbacks(), onFloorEvent, onOpenCodex };
    const game = new Game(cb);
    enterMound(game, onFloorEvent);
    game.player.x = Game.MOUND.oghamStone.x + 1; game.player.y = Game.MOUND.oghamStone.y;
    game.npcTiles = game.npcTiles.filter(n => n.npcId === '__ogham_stone__');
    game.handleHeroMove(-1, 0);
    expect(onOpenCodex).toHaveBeenCalledTimes(1);
    expect(game.npcTiles.some(n => n.npcId === '__ogham_stone__')).toBe(true);  // fixture persists
  });

  it('the Well of Segais trades gold for XP, refuses the penniless, and persists either way', () => {
    const onFloorEvent = vi.fn();
    const cb = { ...makeCallbacks(), onFloorEvent };
    const game = new Game(cb);
    enterMound(game, onFloorEvent);
    const cost = Balance.CONFIG.well.baseCost + game.dungeonLevel * Balance.CONFIG.well.costPerFloor;
    const xpGain = Balance.CONFIG.well.baseXp + game.dungeonLevel * Balance.CONFIG.well.xpPerFloor;
    game.gold = cost + 10;
    const xpBefore = game.player.totalXpEarned;
    game.player.x = Game.MOUND.well.x - 1; game.player.y = Game.MOUND.well.y;
    game.npcTiles = game.npcTiles.filter(n => n.npcId === '__well__');
    onFloorEvent.mockClear();
    game.paused = false;
    game.handleHeroMove(1, 0);
    const [event, onChoice] = onFloorEvent.mock.calls[0]!;
    expect(event.id).toBe('__well__');
    onChoice(0);  // drink
    expect(game.gold).toBe(10);
    expect(game.player.totalXpEarned).toBe(xpBefore + xpGain);
    expect(game.npcTiles.some(n => n.npcId === '__well__')).toBe(true);  // fixture persists

    // Penniless drink: nothing changes but the well stays.
    game.paused = false;
    game.player.x = Game.MOUND.well.x - 1; game.player.y = Game.MOUND.well.y;
    onFloorEvent.mockClear();
    game.handleHeroMove(1, 0);
    const [, onChoice2] = onFloorEvent.mock.calls[0]!;
    onChoice2(0);
    expect(game.gold).toBe(10);
    expect(game.player.totalXpEarned).toBe(xpBefore + xpGain);
    expect(game.npcTiles.some(n => n.npcId === '__well__')).toBe(true);
  });

  it('the seanchaí can recite your own tale mid-run, built from the story beats', () => {
    const onFloorEvent = vi.fn();
    const cb = { ...makeCallbacks(), onFloorEvent };
    const game = new Game(cb);
    game.storyBeats.push('felled a test boss', 'lit the fires of Bealtaine');
    (game as unknown as { triggerNpcEncounter(npc: unknown): void })
      .triggerNpcEncounter(NPCS.find(n => n.id === 'seanchai')!);
    const [event] = onFloorEvent.mock.calls[0]!;
    expect(event.options.length).toBe(2);
    expect(event.options[0].label).toContain('tale');
    const tale = event.options[0].apply(game);
    expect(tale).toContain('felled a test boss');
    expect(tale).toContain('lit the fires of Bealtaine');
  });

  it('the Sídhe coffer banks gold across runs; a new character inherits the tithed remainder', () => {
    vi.stubGlobal('localStorage', new MemoryStorage());
    try {
      const onFloorEvent = vi.fn();
      const cb = { ...makeCallbacks(), onFloorEvent };
      const game = new Game(cb);
      enterMound(game, onFloorEvent);
      game.gold = 100;
      // The hero enters right beside the coffer — bump it and deposit.
      game.player.x = Game.MOUND.stash.x + 1; game.player.y = Game.MOUND.stash.y;
      game.npcTiles = game.npcTiles.filter(n => n.npcId === '__stash__');
      onFloorEvent.mockClear();
      game.paused = false;
      game.handleHeroMove(-1, 0);
      const [event, onChoice] = onFloorEvent.mock.calls[0]!;
      expect(event.id).toBe('__stash__');
      onChoice(0);  // leave your gold
      expect(game.gold).toBe(0);
      expect(StorageService.loadStash()).toBe(100);
      expect(game.npcTiles.some(n => n.npcId === '__stash__')).toBe(true);  // fixture persists
      // The next character inherits the stash, less the Sídhe's tithe.
      const heir = new Game(makeCallbacks());
      expect(heir.gold).toBe(Math.floor(100 * Balance.CONFIG.waystation.stashRecoveryPct));
      expect(StorageService.loadStash()).toBe(0);
      // And the one after that inherits nothing.
      expect(new Game(makeCallbacks()).gold).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('the Ogham-mark tattooist visits the mound when the dice favor it — never once all marks are spent', () => {
    const onFloorEvent = vi.fn();
    const cb = { ...makeCallbacks(), onFloorEvent };
    const game = new Game(cb);
    const enter = (game as unknown as { enterWaystation(): void }).enterWaystation.bind(game);
    const tattooAt = (): boolean => game.isTattooTile(Game.MOUND.tattooist.x, Game.MOUND.tattooist.y);
    const rand = vi.spyOn(Math, 'random').mockReturnValue(0);  // roll always under the chance
    try {
      enter();
      expect(tattooAt()).toBe(true);
      rand.mockReturnValue(0.99);  // roll always over the chance
      enter();
      expect(tattooAt()).toBe(false);
      rand.mockReturnValue(0);
      vi.spyOn(game.player, 'brandsCapped', 'get').mockReturnValue(true);
      enter();
      expect(tattooAt()).toBe(false);  // nothing left to offer
    } finally {
      rand.mockRestore();
    }
  });

  it('a rescue piece lands the captive with Fomorian captors; freeing requires every guard dead', () => {
    const onFloorEvent = vi.fn();
    const cb = { ...makeCallbacks(), onFloorEvent };
    const game = new Game(cb);
    const g = game as unknown as {
      pendingRescueId: string | null; blocksSpawnedThisFloor: number;
      spawnBlock(): void; lockBlock(): void; blockX: number; blockY: number;
      rescueGuards: Monster[];
    };
    game.pendingRescueId = 'goban';
    g.blocksSpawnedThisFloor = Balance.CONFIG.rescues.pieceThreshold;
    g.spawnBlock();
    const cells = (game as unknown as { blockMatrix: number[][] }).blockMatrix.flat();
    expect(cells).toContain(Cell.RESCUE);
    expect(cells.filter(c => c === Cell.ELITE_GUARD)).toHaveLength(2);
    // Land it high on an empty column region and check what materialized.
    g.blockX = 3; g.blockY = 18;
    g.lockBlock();
    const captive = game.npcTiles.find(n => n.npcId === '__rescue_goban__');
    expect(captive).toBeDefined();
    expect(game.pendingRescueId).toBeNull();
    const guards = game.monsters.filter(m => m.name.startsWith('Fomorian '));
    expect(guards).toHaveLength(2);
    // Bump while guarded: refused, tile stays.
    game.player.x = captive!.x; game.player.y = captive!.y - 1;
    game.paused = false;
    onFloorEvent.mockClear();
    game.handleHeroMove(0, 1);
    expect(onFloorEvent).not.toHaveBeenCalled();
    expect(game.npcTiles.some(n => n.npcId === '__rescue_goban__')).toBe(true);
    expect(game.rescuedIds.has('goban')).toBe(false);
    // Kill the guards, bump again: thanks dialog, then rescued.
    for (const guard of guards) { guard.hp = 0; CombatSystem.killMonster(guard, game); }
    game.player.x = captive!.x; game.player.y = captive!.y - 1;
    game.paused = false;
    game.handleHeroMove(0, 1);
    const [event, onChoice] = onFloorEvent.mock.calls[0]!;
    expect(event.id).toBe('__rescue_goban__');
    onChoice(0);
    expect(game.rescuedIds.has('goban')).toBe(true);
  });

  it('rescued figures settle in the mound; the Gobán Saor shapes your next piece to order', () => {
    const onFloorEvent = vi.fn();
    const cb = { ...makeCallbacks(), onFloorEvent };
    const game = new Game(cb);
    game.rescuedIds.add('goban');
    (game as unknown as { enterWaystation(): void }).enterWaystation();
    const resident = game.npcTiles.find(n => n.npcId === '__rescue_goban__');
    expect(resident).toBeDefined();
    // Bump him and commission a T-stone.
    game.player.x = resident!.x - 1; game.player.y = resident!.y;
    game.map[resident!.x - 1]![resident!.y] = Tile.FLOOR;
    game.npcTiles = game.npcTiles.filter(n => n.npcId === '__rescue_goban__');
    onFloorEvent.mockClear();
    game.paused = false;
    game.handleHeroMove(1, 0);
    const [event, onChoice] = onFloorEvent.mock.calls[0]!;
    const tIndex = event.options.findIndex((o: { label: string }) => o.label === 'The T-stone');
    expect(tIndex).toBeGreaterThanOrEqual(0);
    onChoice(tIndex);
    expect(game.nextType).toBe('T');
    // Resident persists after the service.
    expect(game.npcTiles.some(n => n.npcId === '__rescue_goban__')).toBe(true);
  });

  it("Bricriu's Champion's Portion grants ATK until the next descent, one helping per floor", () => {
    const onFloorEvent = vi.fn();
    const cb = { ...makeCallbacks(), onFloorEvent };
    const game = new Game(cb);
    game.rescuedIds.add('bricriu');
    (game as unknown as { enterWaystation(): void }).enterWaystation();
    const resident = game.npcTiles.find(n => n.npcId === '__rescue_bricriu__')!;
    const atkBefore = game.player.atk;
    const bump = (): void => {
      game.player.x = resident.x - 1; game.player.y = resident.y;
      game.map[resident.x - 1]![resident.y] = Tile.FLOOR;
      game.npcTiles = game.npcTiles.filter(n => n.npcId === '__rescue_bricriu__');
      onFloorEvent.mockClear();
      game.paused = false;
      game.handleHeroMove(1, 0);
    };
    bump();
    let [event, onChoice] = onFloorEvent.mock.calls[0]!;
    expect(event.options[0].label).toContain('Portion');
    onChoice(0);
    expect(game.player.atk).toBe(atkBefore + Balance.CONFIG.rescues.portionAtk);
    // Second helping refused this floor.
    bump();
    [event, onChoice] = onFloorEvent.mock.calls[0]!;
    expect(event.options.some((o: { label: string }) => o.label.includes('Portion'))).toBe(false);
    onChoice(0);
    expect(game.player.atk).toBe(atkBefore + Balance.CONFIG.rescues.portionAtk);
    // The portion ends at the descent.
    (game as unknown as { resetDungeonState(): void }).resetDungeonState();
    expect(game.player.atk).toBe(atkBefore);
  });

  it('non-Draoi classes never get a deity emissary in the mound', () => {
    const onFloorEvent = vi.fn();
    const cb = { ...makeCallbacks(), onFloorEvent };
    const game = new Game(cb);
    game.applyClass('architect');
    chooseAtStairs(game, onFloorEvent, 0);
    enterMound(game, onFloorEvent);
    expect(game.npcTiles.some(n => n.npcId === '__pact__')).toBe(false);
  });
});

describe('New omens (lore expansion) and rescue services', () => {
  const omenById = (id: string): Omen => OMENS.find(o => o.id === id) as Omen;

  it('the six new omens are loaded with their mechanical params', () => {
    for (const id of ['morrigan_ravens', 'lughnasa_truce', 'salmon_run', 'brigid_hearthlight', 'crom_tithe', 'samhain_thinning']) {
      expect(omenById(id)).toBeDefined();
    }
    expect(omenById('lughnasa_truce').num('gravityPct', 0)).toBe(25);
  });

  it("the Morrígan's Ravens harden spawns (monsterAtkMult applied at spawn)", () => {
    const game = new Game(makeCallbacks());
    (game as unknown as { spawnMonster(k: string, x: number, y: number, e?: boolean): void }).spawnMonster('rat', 0, 0, false);
    const baseAtk = game.monsters[0]!.atk;
    game.monsters = [];
    game.activeOmen = omenById('morrigan_ravens');
    (game as unknown as { spawnMonster(k: string, x: number, y: number, e?: boolean): void }).spawnMonster('rat', 0, 0, false);
    expect(game.monsters[0]!.atk).toBe(Math.floor(baseAtk * 1.3));
  });

  it('xpMult omens double kill XP', () => {
    const cb = makeCallbacks();
    const game = new Game(cb);
    const kill = (): number => {
      const before = game.player.totalXpEarned;
      const m = new Monster(0, 23, 'sprite_rat', 'XP Rat', 1, 1, 1, 30, false);
      game.monsters.push(m);
      m.hp = 0;
      CombatSystem.killMonster(m, game);
      return game.player.totalXpEarned - before;
    };
    const normal = kill();
    game.activeOmen = omenById('salmon_run');
    expect(kill()).toBe(normal * 2);
  });

  it("Brigid's Hearthlight doubles wait-healing", () => {
    const game = new Game(makeCallbacks());
    game.player.hp = 10;
    game.handleHeroWait();
    const normalHeal = game.player.hp - 10;
    game.player.hp = 10;
    game.activeOmen = omenById('brigid_hearthlight');
    game.handleHeroWait();
    expect(game.player.hp - 10).toBe(normalHeal * 2);
  });

  it("Abcán's suantraí stuns every spawn on its floor, and lapses after", () => {
    const game = new Game(makeCallbacks());
    game.harperLullFloor = game.dungeonLevel;
    (game as unknown as { spawnMonster(k: string, x: number, y: number, e?: boolean): void }).spawnMonster('rat', 0, 0, false);
    expect(game.monsters[0]!.isStunned).toBe(true);
    // Two floors later the strain has faded.
    game.dungeonLevel += 2;
    (game as unknown as { resetDungeonState(): void }).resetDungeonState();
    expect(game.harperLullFloor).toBe(0);
  });

  it("Airmed's herbs trade gold for permanent Max HP", () => {
    const onFloorEvent = vi.fn();
    const cb = { ...makeCallbacks(), onFloorEvent };
    const game = new Game(cb);
    game.rescuedIds.add('airmed');
    (game as unknown as { enterWaystation(): void }).enterWaystation();
    const resident = game.npcTiles.find(n => n.npcId === '__rescue_airmed__')!;
    const cost = Balance.CONFIG.rescues.healerBaseCost + game.dungeonLevel * Balance.CONFIG.rescues.healerCostPerFloor;
    game.gold = cost;
    const maxBefore = game.player.maxHp;
    game.player.x = resident.x; game.player.y = resident.y + 1;
    game.map[resident.x]![resident.y + 1] = Tile.FLOOR;
    game.npcTiles = [resident];
    game.paused = false;
    game.handleHeroMove(0, -1);
    const [, onChoice] = onFloorEvent.mock.calls[0]!;
    onChoice(0);
    expect(game.gold).toBe(0);
    expect(game.player.maxHp).toBe(maxBefore + Balance.CONFIG.rescues.healerHpGain);
  });

  it('all five rescued residents fit inside the mound chamber', () => {
    const game = new Game(makeCallbacks());
    for (const r of RESCUES) game.rescuedIds.add(r.id);
    (game as unknown as { enterWaystation(): void }).enterWaystation();
    const residents = game.npcTiles.filter(n => n.npcId.startsWith('__rescue_'));
    expect(residents).toHaveLength(RESCUES.length);
    for (const r of residents) {
      expect(r.x).toBeGreaterThanOrEqual(Game.MOUND.x0);
      expect(r.x).toBeLessThanOrEqual(Game.MOUND.x1);
    }
  });
});

describe('Tutorial safety (no natural enemies while teaching)', () => {
  it('tutorialSafety suppresses monster cells in spawned pieces', () => {
    const game = new Game(makeCallbacks());
    game.tutorialSafety = true;
    game.dungeonLevel = 8;  // deep floors have high natural spawn odds
    const monsterCells = new Set<number>([Cell.MONSTER_RAT, Cell.MONSTER_SKEL, Cell.MONSTER_ARCHER, Cell.MONSTER_SLIME, Cell.MONSTER_ORC, Cell.MONSTER_BAT]);
    for (let i = 0; i < 100; i++) {
      (game as unknown as { spawnBlock(): void }).spawnBlock();
      const cells = (game as unknown as { blockMatrix: number[][] }).blockMatrix.flat();
      expect(cells.some(c => monsterCells.has(c))).toBe(false);
    }
    // Released: monsters return to the spawn table (statistically certain
    // within 100 deep-floor pieces).
    game.tutorialSafety = false;
    let seen = false;
    for (let i = 0; i < 400 && !seen; i++) {
      (game as unknown as { spawnBlock(): void }).spawnBlock();
      seen = (game as unknown as { blockMatrix: number[][] }).blockMatrix.flat().some(c => monsterCells.has(c));
    }
    expect(seen).toBe(true);
  });

  it('spawnTutorialFoe places exactly one rat on a floor tile near the hero', () => {
    const game = new Game(makeCallbacks());
    expect(game.monsters).toHaveLength(0);
    game.spawnTutorialFoe();
    expect(game.monsters).toHaveLength(1);
    const foe = game.monsters[0]!;
    const d = Math.abs(foe.x - game.player.x) + Math.abs(foe.y - game.player.y);
    expect(d).toBeGreaterThanOrEqual(2);
    expect(d).toBeLessThanOrEqual(7);
    expect(game.map[foe.x]![foe.y]).toBe(Tile.FLOOR);
  });

  it('tutorialSafety also holds back rescue pieces (their captors are enemies)', () => {
    const cb = makeCallbacks();
    const game = new Game(cb);
    game.tutorialSafety = true;
    const rand = vi.spyOn(Math, 'random').mockReturnValue(0);  // would always roll a rescue
    try {
      (game as unknown as { descendFloor(): void }).descendFloor();
      expect(game.pendingRescueId).toBeNull();
      game.tutorialSafety = false;
      (game as unknown as { descendFloor(): void }).descendFloor();
      expect(game.pendingRescueId).not.toBeNull();
    } finally {
      rand.mockRestore();
    }
  });
});

describe('Tetris reward (4-line clear bonus trader)', () => {
  function clearFourLines(game: Game): void {
    for (let y = 0; y < 4; y++) for (let x = 0; x < 10; x++) game.map[x]![y] = Tile.FLOOR;
    (game as unknown as { checkLineClears(): void }).checkLineClears();
  }
  function maybeOpen(game: Game): void {
    (game as unknown as { maybeOpenTetrisReward(): void }).maybeOpenTetrisReward();
  }

  it('clearing exactly 4 lines at once opens a one-off shop (once it is safe to), once per run', () => {
    const onOpenShop = vi.fn();
    const cb = { ...makeCallbacks(), onOpenShop };
    const game = new Game(cb);
    clearFourLines(game);
    expect(onOpenShop).not.toHaveBeenCalled(); // deferred, not immediate
    game.paused = false; // a Tetris's XP burst may itself have leveled the player up — assume that modal is resolved
    maybeOpen(game);
    expect(onOpenShop).toHaveBeenCalledTimes(1);
    const [stock, , , , title] = onOpenShop.mock.calls[0]!;
    expect(stock.some((i: { id: string }) => i.id === 'boon')).toBe(true);
    expect(title).toBe('THE OTHERWORLD PEDDLER');

    // Doesn't fire again on a second Tetris the same run.
    clearFourLines(game);
    game.paused = false;
    maybeOpen(game);
    expect(onOpenShop).toHaveBeenCalledTimes(1);
  });

  it('does not open the special trader on a 1-3 line clear', () => {
    const onOpenShop = vi.fn();
    const cb = { ...makeCallbacks(), onOpenShop };
    const game = new Game(cb);
    for (let x = 0; x < 10; x++) game.map[x]![5] = Tile.FLOOR;
    (game as unknown as { checkLineClears(): void }).checkLineClears();
    maybeOpen(game);
    expect(onOpenShop).not.toHaveBeenCalled();
  });

  it('waits if another modal (e.g. a level-up from the same clear) already has the game paused', () => {
    const onOpenShop = vi.fn();
    const cb = { ...makeCallbacks(), onOpenShop };
    const game = new Game(cb);
    clearFourLines(game);
    game.paused = true; // simulate a level-up boon-choice modal still open
    maybeOpen(game);
    expect(onOpenShop).not.toHaveBeenCalled();
    game.paused = false; // modal closes
    maybeOpen(game);
    expect(onOpenShop).toHaveBeenCalledTimes(1);
  });

  it('the free Sídhe Blessing grants a tier-2 boon at no gold cost', () => {
    const onOpenShop = vi.fn();
    const cb = { ...makeCallbacks(), onOpenShop };
    const game = new Game(cb);
    const boonsBefore = game.player.boons.length;
    clearFourLines(game);
    game.paused = false;
    maybeOpen(game);
    const [, gold, buy] = onOpenShop.mock.calls[0]!;
    const result = buy('boon');
    expect(result.ok).toBe(true);
    expect(result.gold).toBe(gold); // free — no gold deducted
    expect(game.player.boons.length).toBe(boonsBefore + 1);
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
