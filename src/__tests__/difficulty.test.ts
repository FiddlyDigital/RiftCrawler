import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Game } from '../game';
import { Tile } from '../types';
import type { GameCallbacks, SavedRun } from '../types';
import { Balance } from '../balance';

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
    onBossWarning: (_boss, onDone) => onDone(),
    onAction: vi.fn(),
    onBeam: vi.fn(),
    onToast: vi.fn(),
  };
}

const preset = (id: string) => Balance.CONFIG.difficulty.presets.find(p => p.id === id)!;

describe('difficulty presets', () => {
  let game: Game;

  beforeEach(() => {
    game = new Game(makeCallbacks());
  });

  it('balance.json ships story/standard/fomorian presets and standard is identity', () => {
    expect(preset('story')).toBeDefined();
    expect(preset('fomorian')).toBeDefined();
    const std = preset('standard');
    expect(std.gravityPct).toBe(0);
    expect(std.playerHpMult).toBe(1);
    expect(std.monsterAtkMult).toBe(1);
    expect(std.monsterHpMult).toBe(1);
    expect(std.goldMult).toBe(1);
    expect(std.xpMult).toBe(1);
  });

  it('applyDifficulty(story) scales the hero HP pool and slows gravity', () => {
    const p = preset('story');
    const baseMax = game.player.maxHp;
    game.applyDifficulty('story');
    expect(game.activeDifficultyId).toBe('story');
    expect(game.player.maxHp).toBe(Math.round(baseMax * p.playerHpMult));
    expect(game.player.hp).toBe(game.player.maxHp);
    expect(game.difficultyGravityPct).toBe(p.gravityPct);
  });

  it('applyDifficulty(fomorian) folds the XP bonus into the run multiplier', () => {
    const p = preset('fomorian');
    game.applyDifficulty('fomorian');
    expect(game.xpMultiplier).toBeCloseTo(p.xpMult);
    expect(game.difficultyGravityPct).toBe(p.gravityPct);
  });

  it('an unknown difficulty id is a no-op (stays standard)', () => {
    const hp = game.player.maxHp;
    game.applyDifficulty('__nope__');
    expect(game.activeDifficultyId).toBe('standard');
    expect(game.player.maxHp).toBe(hp);
    expect(game.difficultyGravityPct).toBe(0);
  });

  it('monster spawns are harder on the Fomorian way and softer on the Storyteller way', () => {
    const spawnRat = (g: Game) => {
      g.spawnTutorialFoe();  // deterministic: a plain rat, never elite
      return g.monsters[g.monsters.length - 1]!;
    };
    const standardRat = spawnRat(game);

    const hardGame = new Game(makeCallbacks());
    hardGame.applyDifficulty('fomorian');
    const hardRat = spawnRat(hardGame);
    expect(hardRat.maxHp).toBeGreaterThan(standardRat.maxHp);
    expect(hardRat.atk).toBeGreaterThanOrEqual(standardRat.atk);

    const softGame = new Game(makeCallbacks());
    softGame.applyDifficulty('story');
    const softRat = spawnRat(softGame);
    expect(softRat.maxHp).toBeLessThan(standardRat.maxHp);
    expect(softRat.atk).toBeLessThanOrEqual(standardRat.atk);
  });

  it('Bres himself scales with the chosen difficulty', () => {
    const p = preset('fomorian');
    game.applyDifficulty('fomorian');
    game.summonGorgoth();
    const bres = game.monsters.find(m => m.isGorgoth)!;
    expect(bres.maxHp).toBe(Math.floor(Balance.CONFIG.gorgoth.maxHp * p.monsterHpMult));
    expect(bres.atk).toBe(Math.floor(Balance.CONFIG.gorgoth.atk * p.monsterAtkMult));
  });

  it('line-clear gold is leaner on the Fomorian way', () => {
    const clear = (g: Game): number => {
      for (let x = 0; x < 10; x++) g.map[x]![24] = Tile.FLOOR;
      (g as unknown as { checkLineClears: () => void }).checkLineClears();
      return g.gold;
    };
    const standardGold = clear(game);
    const hardGame = new Game(makeCallbacks());
    hardGame.applyDifficulty('fomorian');
    const hardGold = clear(hardGame);
    expect(standardGold).toBeGreaterThan(0);
    expect(hardGold).toBe(Math.floor(standardGold * preset('fomorian').goldMult));
  });

  it('the chosen difficulty survives a save/resume round trip', () => {
    game.applyDifficulty('fomorian');
    const save = JSON.parse(JSON.stringify(game.serialize())) as SavedRun;
    const restored = new Game(makeCallbacks(), { forRestore: true });
    restored.applySave(save);
    expect(restored.activeDifficultyId).toBe('fomorian');
    expect(restored.difficultyGravityPct).toBe(preset('fomorian').gravityPct);
  });
});
