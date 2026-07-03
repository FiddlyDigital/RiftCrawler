import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Game, rotateMatrix, tickMsForLevel, scoreForLines } from '../game';
import { Cell, Tile } from '../types';
import type { GameCallbacks } from '../types';
import { Monster, Item } from '../entities';
import { killMonster } from '../systems/combat';
import { BRANDS } from '../content';

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

// Formula: Math.max(400, 1500 - (level-1)*100), then scaled by slowPercent
describe('tickMsForLevel', () => {
  it('returns 3000ms on floor 1 with no slow', () => expect(tickMsForLevel(1, 0)).toBe(3000));
  it('returns 2900ms on floor 2', () => expect(tickMsForLevel(2, 0)).toBe(2900));
  it('returns 400ms minimum', () => expect(tickMsForLevel(999, 0)).toBe(400));
  it('applies slow perk percentage', () => expect(tickMsForLevel(1, 15)).toBe(Math.floor(3000 * 1.15)));
});

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
    const monster = new Monster(4, 22, '👹', 'Goblin', 10, 10, 3, 5);
    game.monsters.push(monster);
    const info = game.getInspectInfo(4, 22);
    expect(info).not.toBeNull();
    expect(info!.title).toBe('Goblin');
    expect(info!.lines.some(l => l.startsWith('HP'))).toBe(true);
    expect(info!.lines.some(l => l.includes('ATK'))).toBe(true);
  });

  it('describes a heal item on a tile', () => {
    const item = new Item(4, 22, '🧪', 'Potion', 'heal', 15);
    game.items.push(item);
    const info = game.getInspectInfo(4, 22);
    expect(info).not.toBeNull();
    expect(info!.title).toBe('Potion');
    expect(info!.lines[0]).toContain('15 HP');
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
    const a = new Monster(4, 21, '👹', 'A', 1, 1, 1, 5);
    const b = new Monster(5, 21, '👹', 'B', 5, 5, 1, 5);
    game.monsters.push(a, b);
    killMonster(a, game);
    expect(game.monsters).not.toContain(a);
    expect(game.monsters).toContain(b);
  });

  it('poison kills a monster on tick, clears it, and awards XP', () => {
    const m = new Monster(4, 21, '👹', 'Goblin', 3, 3, 2, 20);
    m.statuses = [{ type: 'poison', duration: 3, power: 5 }];
    game.monsters.push(m);
    const xpBefore = game.player.totalXpEarned;
    game.autoTick();
    expect(game.monsters).not.toContain(m);
    expect(game.player.totalXpEarned).toBe(xpBefore + 20);
  });

  it('monster poison applies exactly once per tick (no double-application)', () => {
    const m = new Monster(4, 21, '👹', 'Tank', 20, 20, 1, 5);
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
