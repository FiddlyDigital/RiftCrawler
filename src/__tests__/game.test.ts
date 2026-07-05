import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Game, rotateMatrix, tickMsForLevel, scoreForLines } from '../game';
import { Cell, Tile } from '../types';
import type { GameCallbacks } from '../types';
import { Monster } from '../entities';
import { killMonster, playerAttackMonster, estimateHitChance } from '../systems/combat';
import { processMonsterTurns } from '../systems/monsterAI';
import { BRANDS, BOONS, MODIFIERS, CLASSES, FLOOR_EVENTS, getThreeRandomBoons } from '../content';
import { BALANCE, COMBAT_BALANCE, MONSTER_AI, weightedPick } from '../balance';

// ── Pure function tests ──────────────────────────────────────────────────────

describe('rotateMatrix', () => {
  it('rotates a 1×4 I-piece to 4×1', () => {
    const matrix = [[1, 1, 1, 1]] as unknown as import('../types').CellValue[][];
    const result = rotateMatrix(matrix);
    expect(result).toHaveLength(4);
    expect(result[0]).toHaveLength(1);
    expect(result.map(r => r[0])).toEqual([1, 1, 1, 1]);
  });

  it('rotates a 2×2 O-piece back to itself after 4 rotations', () => {
    const matrix = [[1, 1], [1, 1]] as unknown as import('../types').CellValue[][];
    let m = matrix;
    for (let i = 0; i < 4; i++) m = rotateMatrix(m);
    expect(m).toEqual(matrix);
  });

  it('rotates a T-piece 90° clockwise', () => {
    const matrix = [[0, 1, 0], [1, 1, 1]] as unknown as import('../types').CellValue[][];
    const result = rotateMatrix(matrix);
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
  it('returns 3000ms on floor 1 with no slow', () => expect(tickMsForLevel(1, 0)).toBe(3000));
  it('returns 2900ms on floor 2', () => expect(tickMsForLevel(2, 0)).toBe(2900));
  it('returns 400ms minimum', () => expect(tickMsForLevel(999, 0)).toBe(400));
  it('applies slow perk percentage', () => expect(tickMsForLevel(1, 15)).toBe(Math.floor(3000 * 1.15)));
});

// lineClearScoreBase/lineClearScoreOverflow now live in src/data/balance.json (progression).
describe('scoreForLines', () => {
  it('returns 100 for 1 line on floor 1', () => expect(scoreForLines(1, 1)).toBe(100));
  it('scales with dungeon level', () => expect(scoreForLines(1, 3)).toBe(300));
  it('returns 300 for 2 lines', () => expect(scoreForLines(2, 1)).toBe(300));
  it('returns 1000 for 4 lines (tetris)', () => expect(scoreForLines(4, 1)).toBe(1000));
  it('caps at 1200 base for 5+ lines', () => expect(scoreForLines(5, 1)).toBe(1200));
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

  it('player takeDamage is reduced by armor defence', () => {
    game.player.hp = 30;
    game.player.damageReduction = 2;
    const actual = game.player.takeDamage(5);
    expect(actual).toBe(3);
    expect(game.player.hp).toBe(27);
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
    expect(game.player.xpToNext).toBe(75);
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
    killMonster(a, game);
    expect(game.monsters).not.toContain(a);
    expect(game.monsters).toContain(b);
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
    game.player.addBrand('body', war);      // +2
    game.player.addBrand('left_arm', war);  // +2
    expect(game.player.atk).toBe(atk0 + 4);
    game.player.addBrand('right_arm', war); // +2 plus +10 set bonus (setSize 3)
    expect(game.player.atk).toBe(atk0 + 16);
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
      expect(tickMsForLevel(1, game.player.tickSlowPercent)).toBeGreaterThan(tickMsForLevel(1, before));
    }
  });

  // Phase 1
  it('misses chip for graze damage and the pity whiff upgrades to a stronger hit', () => {
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0); // aRoll=dRoll=1 → forced miss
    const m = new Monster(5, 21, 'sprite_berserker_orc', 'Dummy', 100, 100, 1, 5);
    game.monsters.push(m);
    const d1 = playerAttackMonster(m, game);
    const d2 = playerAttackMonster(m, game);
    const d3 = playerAttackMonster(m, game);
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
    playerAttackMonster(m, game);
    spyHit.mockRestore();
    expect(game.player.missStreak).toBe(0);
  });

  // Phase 2
  it('every boon offer spans at least two distinct roles', () => {
    for (let i = 0; i < 40; i++) {
      const roles = new Set(getThreeRandomBoons(BOONS).map(b => b.role));
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
    expect(game.gold).toBe(500 - BALANCE.economy.rerollBaseCost);
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

  // Phase 4
  it('estimateHitChance is a valid probability and rises vs weaker defenders', () => {
    const even = estimateHitChance(2, 2);
    const favoured = estimateHitChance(6, 1);
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
    expect(boss!.maxHp).toBeGreaterThanOrEqual(1000);           // huge
    expect(boss!.combatLevel).toBe(BALANCE.gorgoth.combatLevel);  // D20
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
    killMonster(boss, game);
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
    expect(boss2.maxHp).toBe(BALANCE.gorgoth.maxHp);           // out of full
  });

  it('nudges the player toward the win condition once when the stack is high', () => {
    for (let y = 0; y < 25; y++) game.map[4]![y] = Tile.FLOOR;  // a column reaching the ceiling
    const hits = (): number => cb.logs.filter(l => l.includes('GORGOTH THE RETURNED and win')).length;
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
    processMonsterTurns(game);
    spy.mockRestore();
    expect(game.player.hp).toBeLessThan(500);
  });

  it('diagonally adjacent melee monster closes and hits within a few turns', () => {
    game.map[5]![22] = Tile.FLOOR;  // open floor so it can step in
    const m = new Monster(5, 22, 'sprite_berserker_orc', 'G', 80, 80, 10, 5); // diagonal, dist 2
    game.monsters.push(m);
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.99);
    for (let i = 0; i < 4; i++) processMonsterTurns(game);
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
    for (let i = 0; i < 3; i++) processMonsterTurns(game);
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
    processMonsterTurns(game);
    spy.mockRestore();
    expect(game.player.hp).toBeLessThan(500);
  });
});

// ── Data-driven boons / brands / modifiers (JSON effects) ─────────────────────

describe('JSON-configured effects', () => {
  let game: Game;
  beforeEach(() => { game = new Game(makeCallbacks()); });

  it('boon add-effect applies (whetstone +2 ATK)', () => {
    const atk = game.player.atk;
    BOONS.find(b => b.id === 'whetstone')!.onAdd(game.player, 1);
    expect(game.player.atk).toBe(atk + 2);
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

  it('brand onSet effect applies (Life set → free-revive flag)', () => {
    expect(game.player.lifeBrandRevive).toBe(false);
    BRANDS.find(b => b.id === 'life')!.onSetComplete(game.player);
    expect(game.player.lifeBrandRevive).toBe(true);
  });

  it('modifier applies to player with clamp + full-heal special (Glass Cannon)', () => {
    const p = game.player; p.maxHp = 45; p.hp = 45; p.atk = 6;
    MODIFIERS.find(m => m.id === 'glass_cannon')!.apply(game);
    expect(p.atk).toBe(14);    // +8
    expect(p.maxHp).toBe(30);  // −15
    expect(p.hp).toBe(30);     // full_heal special sets hp = maxHp
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

  it('CLASSES loads all 4 classes from JSON in the original order', () => {
    expect(CLASSES.map(c => c.id)).toEqual(['chronomancer', 'rift_weaver', 'architect', 'cascade']);
  });

  it('tPieceCdReduction defaults to 2, architect overrides to 4', () => {
    expect(CLASSES.find(c => c.id === 'architect')!.tPieceCdReduction).toBe(4);
    expect(CLASSES.find(c => c.id === 'chronomancer')!.tPieceCdReduction).toBe(2);
    expect(CLASSES.find(c => c.id === 'rift_weaver')!.tPieceCdReduction).toBe(2);
    expect(CLASSES.find(c => c.id === 'cascade')!.tPieceCdReduction).toBe(2);
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

  it('applyClass(rift_weaver) sets stats and Gravity Well ability', () => {
    const hpBefore = game.player.maxHp;
    const atkBefore = game.player.atk;
    const visionBefore = game.player.visionRadius;
    game.applyClass('rift_weaver');
    expect(game.player.maxHp).toBe(hpBefore - 10);
    expect(game.player.atk).toBe(atkBefore + 2);
    expect(game.player.visionRadius).toBe(visionBefore + 2);
    expect(game.player.teleportImmune).toBe(true);
    expect(game.player.rangedAbility?.abilityType).toBe('gravity_well');
    expect(game.player.rangedAbility?.range).toBe(4);
    expect(game.player.rangedAbility?.params).toEqual({ pullSteps: 2, stunDuration: 1 });
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

  it('applyClass(cascade) sets stats and Overload ability', () => {
    const hpBefore = game.player.maxHp;
    const atkBefore = game.player.atk;
    game.applyClass('cascade');
    expect(game.player.maxHp).toBe(hpBefore - 20);
    expect(game.player.atk).toBe(atkBefore + 10);
    expect(game.player.lineClearDmgMult).toBe(4);
    expect(game.player.rangedAbility?.abilityType).toBe('overload');
    expect(game.player.rangedAbility?.params).toEqual({ perKillDmg: 8, perFloorMinDmg: 5 });
  });

  it('applyClass clamps hp to the new (lower) maxHp instead of leaving it over-full', () => {
    game.player.hp = game.player.maxHp; // full HP (45)
    game.applyClass('cascade'); // −20 maxHp
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

  it('Gravity Well pulls an eligible monster pullSteps tiles toward the player and stuns it', () => {
    game.applyClass('rift_weaver');
    // Use a longer stun than the 1-turn default so it survives the monster-turn
    // processing that happens later in this same action's advanceTurn().
    game.player.rangedAbility!.params = { pullSteps: 2, stunDuration: 3 };
    const m = new Monster(game.player.x + 3, game.player.y, 'sprite_berserker_orc', 'Orc', 20, 20, 1, 5);
    game.monsters = [m];
    game.visibility[m.x]![m.y] = true;
    game.handleRangedAttack();
    expect(m.x).toBe(game.player.x + 1); // pulled 2 of the 3 tiles toward the player
    expect(m.isStunned).toBe(true);
  });

  it('Overload damage uses perKillDmg × kills, floored by perFloorMinDmg × floor, and resets killsThisFloor', () => {
    game.applyClass('cascade');
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

  it("Cascade's line-clear passive deals lineClearDmgMult × rows × dungeonLevel to visible monsters", () => {
    game.applyClass('cascade');
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

// ── Balance config (src/data/*.json via src/balance.ts) ──────────────────────

describe('Balance config', () => {
  it('weightedPick returns the key whose cumulative range contains the roll', () => {
    expect(weightedPick({ a: 0.5, b: 0.5 }, 0.3)).toBe('a');
    expect(weightedPick({ a: 0.5, b: 0.5 }, 0.7)).toBe('b');
  });

  it('weightedPick returns null once the roll exceeds the total weight', () => {
    expect(weightedPick({ a: 0.3 }, 0.5)).toBeNull();
  });

  it('elite scaling is configurable (spawnMonster reads BALANCE.eliteMonsters.hpMult)', () => {
    const cb = makeCallbacks();
    const game = new Game(cb);
    const originalChance = BALANCE.eliteMonsters.spawnChance;
    const originalMult = BALANCE.eliteMonsters.hpMult;
    BALANCE.eliteMonsters.spawnChance = 1;
    BALANCE.eliteMonsters.hpMult = 3;
    try {
      (game as unknown as { spawnMonster(key: string, x: number, y: number): void }).spawnMonster('rat', 4, 23);
      const m = game.monsters[0]!;
      expect(m.isElite).toBe(true);
      expect(m.maxHp).toBe(10 * 3); // rat baseHp (10) × the configured elite hpMult
    } finally {
      BALANCE.eliteMonsters.spawnChance = originalChance;
      BALANCE.eliteMonsters.hpMult = originalMult;
    }
  });

  it('Gorgoth stats are configurable (summonGorgoth reads BALANCE.gorgoth.maxHp)', () => {
    const cb = makeCallbacks();
    const game = new Game(cb);
    const original = BALANCE.gorgoth.maxHp;
    BALANCE.gorgoth.maxHp = 999;
    try {
      game.summonGorgoth();
      const boss = game.monsters.find(m => m.isGorgoth)!;
      expect(boss.maxHp).toBe(999);
    } finally {
      BALANCE.gorgoth.maxHp = original;
    }
  });

  it('monster AI chase range is configurable (melee monster stays put beyond the configured range)', () => {
    const cb = makeCallbacks();
    const game = new Game(cb);
    const m = new Monster(game.player.x + 3, game.player.y, 'sprite_rat_01', 'Rat', 10, 10, 1, 5);
    game.monsters.push(m);
    const original = MONSTER_AI.melee.chaseRange;
    MONSTER_AI.melee.chaseRange = 1;
    try {
      processMonsterTurns(game);
      expect(m.x).toBe(game.player.x + 3); // out of the shortened chase range — doesn't move
    } finally {
      MONSTER_AI.melee.chaseRange = original;
    }
  });

  it('combat dice table is configurable (estimateHitChance reacts to a changed die size)', () => {
    const before = estimateHitChance(2, 2);
    const original = COMBAT_BALANCE.diceSidesByLevel[2];
    COMBAT_BALANCE.diceSidesByLevel[2] = 100;
    try {
      const after = estimateHitChance(2, 2);
      expect(after).not.toBe(before);
    } finally {
      COMBAT_BALANCE.diceSidesByLevel[2] = original!;
    }
  });
});

// ── Floor events (src/data/floor-events.json via src/dataLoader.ts) ──────────

describe('Floor events (JSON-configured)', () => {
  it('has all 9 events with a handler-backed apply on every option', () => {
    expect(FLOOR_EVENTS.length).toBe(9);
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
    expect(refuse.apply(game)).toBe("You refuse the dark voice. It fades, frustrated.");
  });
});
