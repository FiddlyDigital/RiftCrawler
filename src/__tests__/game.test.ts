import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Game, rotateMatrix, tickMsForLevel, scoreForLines } from '../game';
import { Cell } from '../types';
import type { GameCallbacks } from '../types';

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
  it('returns 1500ms on floor 1 with no slow', () => expect(tickMsForLevel(1, 0)).toBe(1500));
  it('returns 1400ms on floor 2', () => expect(tickMsForLevel(2, 0)).toBe(1400));
  it('returns 400ms minimum', () => expect(tickMsForLevel(999, 0)).toBe(400));
  it('applies slow perk percentage', () => expect(tickMsForLevel(1, 15)).toBe(Math.floor(1500 * 1.15)));
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

  it('initialises player at (4, 13) with 35 HP', () => {
    expect(game.player.x).toBe(4);
    expect(game.player.y).toBe(13);
    expect(game.player.hp).toBe(35);
  });

  it('starts on dungeon level 1 with score 0', () => {
    expect(game.dungeonLevel).toBe(1);
    expect(game.score).toBe(0);
  });

  it('player starts at level 1 with 0 XP', () => {
    expect(game.player.playerLevel).toBe(1);
    expect(game.player.xp).toBe(0);
  });

  it('isValidMove returns false for void tiles', () => {
    expect(game.isValidMove(0, 0)).toBe(false);
  });

  it('isValidMove returns true for starting platform tiles', () => {
    expect(game.isValidMove(4, 13)).toBe(true);
  });

  it('isValidMove returns false for out-of-bounds', () => {
    expect(game.isValidMove(-1, 0)).toBe(false);
    expect(game.isValidMove(0, -1)).toBe(false);
    expect(game.isValidMove(10, 0)).toBe(false);
    expect(game.isValidMove(0, 15)).toBe(false);
  });

  it('player heals correctly and clamps to maxHp', () => {
    game.player.hp = 30;
    const gained = game.player.heal(10);
    expect(game.player.hp).toBe(35);
    expect(gained).toBe(5);
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
    game.player.x = 4; game.player.y = 13;
    game.handleHeroMove(0, -1);
    expect(game.player.y).toBe(13);
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
    expect(game.checkBlockCollision(0, 15, matrix)).toBe(true);
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

  it('getRandomPerks returns 3 unique perks', () => {
    const perks = game.getRandomPerks(3);
    expect(perks).toHaveLength(3);
    const ids = perks.map(p => p.id);
    expect(new Set(ids).size).toBe(3);
  });

  it('paused flag blocks player actions', () => {
    game.paused = true;
    game.player.x = 4; game.player.y = 13;
    game.handleHeroMove(0, 1);
    expect(game.player.y).toBe(13);
  });
});
