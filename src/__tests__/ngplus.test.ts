import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Game } from '../game';
import { Tile } from '../types';
import type { GameCallbacks, SavedRun } from '../types';
import { Balance } from '../balance';
import { StorageService } from '../storage';

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

const tier = (level: number) => Balance.CONFIG.ngplus.tiers.find(t => t.level === level)!;

describe('New Game+ heat', () => {
  let game: Game;

  beforeEach(() => {
    game = new Game(makeCallbacks());
  });

  it('balance.json ships a heat ladder with monotonically-rising levels', () => {
    const tiers = Balance.CONFIG.ngplus.tiers;
    expect(tiers.length).toBeGreaterThanOrEqual(3);
    tiers.forEach((t, i) => expect(t.level).toBe(i + 1));
    expect(Balance.CONFIG.ngplus.xpBonusPerHeat).toBeGreaterThan(0);
  });

  it('a fresh game is heat 0 with no gravity handicap', () => {
    expect(game.heatLevel).toBe(0);
    expect(game.heatGravityPct).toBe(0);
  });

  it('applyHeat(0) is a clean run — no XP bonus, no handicaps', () => {
    const xpBefore = game.xpMultiplier;
    game.applyHeat(0);
    expect(game.heatLevel).toBe(0);
    expect(game.xpMultiplier).toBe(xpBefore);
  });

  it('applyHeat(N) grants the cumulative XP bonus and records the story beat', () => {
    game.applyHeat(2);
    expect(game.heatLevel).toBe(2);
    expect(game.xpMultiplier).toBeCloseTo(1 + Balance.CONFIG.ngplus.xpBonusPerHeat * 2);
    expect(game.storyBeats.some(b => b.includes('geasa of the victorious'))).toBe(true);
  });

  it('applyHeat clamps above the ladder length and below zero', () => {
    const max = Balance.CONFIG.ngplus.tiers.length;
    game.applyHeat(999);
    expect(game.heatLevel).toBe(max);
    const g2 = new Game(makeCallbacks());
    g2.applyHeat(-3);
    expect(g2.heatLevel).toBe(0);
  });

  it('the Geis of the Crow (heat 1) hardens every monster spawn', () => {
    const spawnRat = (g: Game) => { g.spawnTutorialFoe(); return g.monsters[g.monsters.length - 1]!; };
    const base = spawnRat(game);
    const hot = new Game(makeCallbacks());
    hot.applyHeat(1);
    const hotRat = spawnRat(hot);
    // Heat 1's monsterAtkMult > 1, so ATK rises (HP is unchanged by heat 1).
    expect(tier(1).params['monsterAtkMult']).toBeGreaterThan(1);
    expect(hotRat.atk).toBeGreaterThanOrEqual(base.atk);
  });

  it('heat stacks cumulatively — higher heat carries every lower geis', () => {
    // Heat 3 includes tier 3's gravityPct (a negative = faster).
    game.applyHeat(3);
    const expected = Balance.CONFIG.ngplus.tiers
      .filter(t => t.level <= 3)
      .reduce((sum, t) => sum + (typeof t.params['gravityPct'] === 'number' ? t.params['gravityPct'] : 0), 0);
    expect(game.heatGravityPct).toBe(expected);
  });

  it('the Empty Purse geis (heat 4) thins line-clear gold', () => {
    const clear = (g: Game): number => {
      for (let x = 0; x < 10; x++) g.map[x]![24] = Tile.FLOOR;
      (g as unknown as { checkLineClears: () => void }).checkLineClears();
      return g.gold;
    };
    const base = clear(game);
    const hot = new Game(makeCallbacks());
    hot.applyHeat(4);
    const hotGold = clear(hot);
    expect(base).toBeGreaterThan(0);
    expect(hotGold).toBeLessThan(base);
  });

  it('heat level rides a save/resume round trip', () => {
    game.applyHeat(2);
    const save = JSON.parse(JSON.stringify(game.serialize())) as SavedRun;
    const restored = new Game(makeCallbacks(), { forRestore: true });
    restored.applySave(save);
    expect(restored.heatLevel).toBe(2);
    expect(restored.heatGravityPct).toBe(game.heatGravityPct);
  });

  it('a heat-0 run surfaces no heat badge; a heated run does', () => {
    const pushed: Array<{ heatLevel: number | null }> = [];
    const g = new Game({ ...makeCallbacks(), updateUI: (s) => pushed.push({ heatLevel: s.heatLevel }) });
    const last = (): { heatLevel: number | null } => pushed[pushed.length - 1]!;
    g.applyHeat(0);
    expect(last().heatLevel).toBeNull();
    g.applyHeat(2);
    expect(last().heatLevel).toBe(2);
  });
});

describe('StorageService heat unlock ladder', () => {
  let store: Map<string, string>;

  beforeEach(() => {
    store = new Map();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('starts locked at 0 and unlocks one level per win', () => {
    expect(StorageService.loadMaxHeat()).toBe(0);
    // Clear heat 0 → unlock heat 1.
    expect(StorageService.unlockHeat(1)).toBe(1);
    expect(StorageService.loadMaxHeat()).toBe(1);
    // Clear heat 1 → unlock heat 2.
    expect(StorageService.unlockHeat(2)).toBe(2);
    expect(StorageService.loadMaxHeat()).toBe(2);
  });

  it('never lowers the unlocked ceiling (winning a lower heat than your max)', () => {
    StorageService.unlockHeat(4);
    StorageService.unlockHeat(2);  // won a heat-1 run after already unlocking 4
    expect(StorageService.loadMaxHeat()).toBe(4);
  });
});
