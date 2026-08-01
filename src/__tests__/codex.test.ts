import { describe, it, expect } from 'vitest';
import { Codex } from '../codex';
import { Boss, Npc, Biome, Patron } from '../content';
import { Game } from '../game';
import { Balance } from '../balance';
import type { CodexState, GameCallbacks } from '../types';

const empty = (): CodexState => ({ bosses: [], npcs: [], biomes: [], patrons: [] });

function makeCallbacks(): GameCallbacks {
  const noop = (): void => {};
  return {
    log: noop, updateUI: noop, onAction: noop, onParticle: noop, onParticleBurst: noop,
    onDeath: noop, onVictory: noop,
    onLevelUp: (_c: unknown, f: (i: number) => void) => f(0),
    onBossWarning: (_b: unknown, done: () => void) => done(),
  } as unknown as GameCallbacks;
}

describe('Codex progress', () => {
  it('counts every boss (plus Bres), NPC, biome and patron', () => {
    expect(Codex.total()).toBe(Boss.ALL.length + 1 + Npc.ALL.length + Biome.ALL.length + Patron.ALL.length);
  });

  it('an empty record is 0%', () => {
    expect(Codex.progress(empty())).toEqual({ discovered: 0, total: Codex.total(), pct: 0 });
  });

  it('a full record is 100%', () => {
    const full: CodexState = {
      bosses: [...Boss.ALL.map(b => b.name), 'gorgoth'],
      npcs: Npc.ALL.map(n => n.id),
      biomes: Biome.ALL.map(b => b.id),
      patrons: Patron.ALL.map(p => p.id),
    };
    expect(Codex.progress(full).pct).toBe(100);
  });

  it('ignores ids that no longer match live content', () => {
    // Renamed/retired entries in an old save must not inflate the count.
    const stale: CodexState = { ...empty(), npcs: ['scathach', 'fedelm', 'bricriu'] };
    expect(Codex.discovered(stale)).toBe(0);
  });

  it('counts Bres separately from the data-driven bosses', () => {
    expect(Codex.discovered({ ...empty(), bosses: ['gorgoth'] })).toBe(1);
  });

  it('rejects a null state', () => {
    expect(() => Codex.discovered(null as unknown as CodexState)).toThrow(TypeError);
  });
});

describe('Codex unlock ladder', () => {
  it('is ordered lowest rung first', () => {
    const pcts = Codex.unlocks().map(u => u.atPct);
    expect(pcts).toEqual([...pcts].sort((a, b) => a - b));
  });

  it('earns rungs cumulatively as the percentage rises', () => {
    expect(Codex.earned(0)).toHaveLength(0);
    expect(Codex.earned(25)).toHaveLength(1);
    expect(Codex.earned(74)).toHaveLength(2);
    expect(Codex.earned(100)).toHaveLength(Codex.unlocks().length);
  });
});

describe('applyCodexUnlocks', () => {
  it('grants nothing at 0%', () => {
    const game = new Game(makeCallbacks(), { seed: 1 });
    const gold = game.gold, wards = game.player.deathwardCharges, boons = game.player.boons.length;
    expect(game.applyCodexUnlocks(0)).toHaveLength(0);
    expect(game.gold).toBe(gold);
    expect(game.player.deathwardCharges).toBe(wards);
    expect(game.player.boons.length).toBe(boons);
  });

  it('grants the gold rung at 25%', () => {
    const game = new Game(makeCallbacks(), { seed: 1 });
    const before = game.gold;
    const earned = game.applyCodexUnlocks(25);
    expect(earned).toHaveLength(1);
    const reward = earned[0]!.reward;
    expect(reward.kind).toBe('gold');
    expect(game.gold).toBe(before + (reward.kind === 'gold' ? reward.amount : 0));
  });

  it('grants every rung at 100% — gold, a deathward, and two boons', () => {
    const game = new Game(makeCallbacks(), { seed: 1 });
    const gold = game.gold, wards = game.player.deathwardCharges, boons = game.player.boons.length;
    const earned = game.applyCodexUnlocks(100);
    expect(earned).toHaveLength(Codex.unlocks().length);
    expect(game.gold).toBeGreaterThan(gold);
    expect(game.player.deathwardCharges).toBeGreaterThan(wards);
    expect(game.player.boons.length).toBeGreaterThan(boons);
  });

  it('is deterministic for a given seed (the boon rolls come from the run rng)', () => {
    const ids = (): string[] => {
      const g = new Game(makeCallbacks(), { seed: 4242 });
      g.applyCodexUnlocks(100);
      return g.player.boons.map(b => b.id);
    };
    expect(ids()).toEqual(ids());
  });

  it('rejects a non-finite percentage', () => {
    const game = new Game(makeCallbacks(), { seed: 1 });
    expect(() => game.applyCodexUnlocks(Number.NaN)).toThrow(TypeError);
  });

  it('every configured reward kind is one the code knows how to apply', () => {
    const kinds = new Set(Balance.CONFIG.codex.unlocks.map(u => u.reward.kind));
    for (const k of kinds) expect(['gold', 'deathward', 'boon']).toContain(k);
    expect(kinds.size).toBeGreaterThan(0);
  });
});
