import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Game } from '../game';
import { PATRONS } from '../content';
import type { GameCallbacks, LogClass, FloorEventDef } from '../types';

function makeCallbacks(): GameCallbacks & { logs: string[]; lastEvent: () => FloorEventDef | null } {
  const logs: string[] = [];
  let lastEvent: FloorEventDef | null = null;
  return {
    logs,
    lastEvent: () => lastEvent,
    log: (t: string, _c: LogClass) => { logs.push(t); },
    onFloorEvent: (event: FloorEventDef) => { lastEvent = event; },
    updateUI: vi.fn(), onDeath: vi.fn(), onParticle: vi.fn(), onParticleBurst: vi.fn(),
    onLevelUp: vi.fn(), onOpenShop: vi.fn(), onOpenTattooArtist: vi.fn(), onVictory: vi.fn(),
    onBossWarning: (_b: unknown, done: () => void) => done(), onAction: vi.fn(), onBeam: vi.fn(),
    onToast: vi.fn(), onBlockLand: vi.fn(), onRingPulse: vi.fn(), onImpactGlow: vi.fn(), onAudio: vi.fn(),
    onCodexDiscover: vi.fn(),
  } as unknown as GameCallbacks & { logs: string[]; lastEvent: () => FloorEventDef | null };
}

describe('PactCeremony', () => {
  let cb: ReturnType<typeof makeCallbacks>;
  let game: Game;
  beforeEach(() => { cb = makeCallbacks(); game = new Game(cb); });

  it('only An Draoi is offered a pact, and only from floor 2', () => {
    game.applyClass('architect');
    expect(game.pact.offer()).toBe(false);   // wrong class
    game.applyClass('draoi');
    game.dungeonLevel = 1;
    expect(game.pact.offer()).toBe(false);   // too early
    game.dungeonLevel = 2;
    expect(game.pact.offer()).toBe(true);
  });

  it.each(PATRONS.map(p => p.id))('applying %s swaps in its signature spell as the ranged ability', (id) => {
    game.applyClass('draoi');
    game.dungeonLevel = 2;
    game.applyPatron(id);
    const patron = PATRONS.find(p => p.id === id)!;
    expect(game.activePatronId).toBe(id);
    expect(game.player.spellbook.length).toBeGreaterThanOrEqual(1);
    expect(game.player.rangedAbility!.name).toBe(patron.spells[0]!.name);
  });

  it('the pact modal describes every patron\'s signature spell (shriek / veil / drain)', () => {
    game.applyClass('draoi');
    game.dungeonLevel = 2;
    const descs: string[] = [];
    for (let i = 0; i < 40 && !(descs.some(d => d.includes('vanish')) && descs.some(d => d.includes('nearest foe')) && descs.some(d => d.includes('visible foe'))); i++) {
      game.activePatronId = null;   // keep it offerable
      game.pact.offer();
      for (const opt of cb.lastEvent()!.options) descs.push(opt.desc);
    }
    expect(descs.some(d => d.includes('visible foe'))).toBe(true);   // shriek
    expect(descs.some(d => d.includes('vanish'))).toBe(true);        // veil
    expect(descs.some(d => d.includes('nearest foe'))).toBe(true);   // drain
  });

  it('levelling up unlocks the next patron spell and logs its toll (multiplicative)', () => {
    game.applyClass('draoi');
    game.dungeonLevel = 2;
    game.applyPatron('morrigan');   // signature at L1; Fog of Blood unlocks at L4
    const before = game.player.spellbook.length;
    game.player.playerLevel = 4;
    game.pact.syncUnlocks();
    expect(game.player.spellbook.length).toBeGreaterThan(before);
    expect(cb.logs.some(l => l.includes('grants a new spell'))).toBe(true);
    expect(cb.logs.some(l => l.includes('%')))  // the toll (−N% ATK) is spelled out
      .toBe(true);
  });

  it('an additive toll (Manannán slows gravity) is also unlocked and described', () => {
    game.applyClass('draoi');
    game.dungeonLevel = 2;
    game.applyPatron('manannan');
    game.player.playerLevel = 4;
    game.pact.syncUnlocks();
    expect(game.player.spellbook.some(s => s.name === 'Tide-Grasp')).toBe(true);
  });

  it('syncUnlocks is a no-op without a sworn patron', () => {
    game.applyClass('draoi');
    const before = game.player.spellbook.length;
    game.pact.syncUnlocks();
    expect(game.player.spellbook.length).toBe(before);
  });
});
