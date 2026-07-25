import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Game } from '../game';
import { Tile } from '../types';
import type { GameCallbacks, LogClass } from '../types';

function makeCallbacks(): GameCallbacks {
  return {
    log: (_t: string, _c: LogClass) => {},
    updateUI: vi.fn(), onDeath: vi.fn(), onParticle: vi.fn(), onParticleBurst: vi.fn(),
    onLevelUp: vi.fn(), onOpenShop: vi.fn(), onOpenTattooArtist: vi.fn(), onVictory: vi.fn(),
    onBossWarning: (_b: unknown, done: () => void) => done(), onAction: vi.fn(), onBeam: vi.fn(),
    onToast: vi.fn(), onBlockLand: vi.fn(), onRingPulse: vi.fn(), onImpactGlow: vi.fn(), onAudio: vi.fn(),
    onCodexDiscover: vi.fn(), onFloorEvent: vi.fn(),
  } as unknown as GameCallbacks;
}

describe('InspectView (tap-to-inspect)', () => {
  let game: Game;
  beforeEach(() => {
    game = new Game(makeCallbacks());
    game.player.x = 0; game.player.y = 0;   // park the hero out of the way
  });

  it('rejects non-finite coordinates and returns null out of bounds', () => {
    expect(() => game.getInspectInfo(NaN, 0)).toThrow(TypeError);
    expect(() => game.getInspectInfo(0, Infinity)).toThrow(TypeError);
    expect(game.getInspectInfo(-1, 0)).toBeNull();
    expect(game.getInspectInfo(0, 999)).toBeNull();
  });

  it('describes the hero, including geasa once held', () => {
    const info = game.getInspectInfo(0, 0)!;
    expect(info.title).toBe('You');
    expect(info.lines.some(l => l.startsWith('HP'))).toBe(true);
    expect(info.lines.some(l => l.includes('Geasa'))).toBe(false);
  });

  it('describes a monster with a hit-chance readout and statuses', () => {
    game.spawnMonster('rat', 5, 5, false);
    const m = game.getMonsterAt(5, 5)!;
    m.statuses.push({ type: 'stun', duration: 1, power: 0 });
    const info = game.getInspectInfo(5, 5)!;
    expect(info.title).toBe(m.name);
    expect(info.lines.some(l => l.includes('hit chance'))).toBe(true);
    expect(info.lines.some(l => l.includes('Status'))).toBe(true);
  });

  it('describes each hazard type', () => {
    game.hazards.push({ x: 6, y: 6, type: 'spike', timer: 2, warning: false });
    game.hazards.push({ x: 6, y: 7, type: 'smoke', timer: 0, warning: false });
    game.hazards.push({ x: 6, y: 8, type: 'teleport', timer: 0, warning: false });
    expect(game.getInspectInfo(6, 6)!.title).toBe('Spike Trap');
    expect(game.getInspectInfo(6, 7)!.title).toBe('Smoke Cloud');
    expect(game.getInspectInfo(6, 8)!.title).toBe('Teleport Rune');
  });

  it('describes stairs, altars by tier, and floor features', () => {
    game.map[3]![3] = Tile.STAIRS;
    expect(game.getInspectInfo(3, 3)!.title).toBe('Stairs');

    game.altarTiles.push({ x: 2, y: 4, tier: 3 });
    expect(game.getInspectInfo(2, 4)!.title).toContain('Tier III');

    game.specialTiles.push({ x: 7, y: 4, type: 'swamp' });
    game.specialTiles.push({ x: 7, y: 5, type: 'sacred' });
    game.specialTiles.push({ x: 7, y: 6, type: 'ice' });
    expect(game.getInspectInfo(7, 4)!.title).toBe('Swamp');
    expect(game.getInspectInfo(7, 5)!.title).toBe('Sacred Ground');
    expect(game.getInspectInfo(7, 6)!.title).toBe('Ice');
  });

  it('distinguishes a ghost tile from an ordinary wanderer', () => {
    game.npcTiles.push({ x: 1, y: 4, npcId: '__ghost__' });
    game.npcTiles.push({ x: 1, y: 5, npcId: 'fionnuala' });
    expect(game.getInspectInfo(1, 4)!.title).toBe('A Restless Ghost');
    expect(game.getInspectInfo(1, 5)!.title).toBe('A Wandering Stranger');
  });

  it('returns null for a bare floor tile with nothing on it', () => {
    game.map[8]![8] = Tile.FLOOR;
    expect(game.getInspectInfo(8, 8)).toBeNull();
  });
});

describe('CharacterSheetView', () => {
  let game: Game;
  beforeEach(() => { game = new Game(makeCallbacks()); });

  it('always returns the four stat sections', () => {
    const sheet = game.characterSheetView.build();
    expect(sheet.map(s => s.title)).toEqual(['Offense', 'Defense', 'Sustain', 'Utility']);
    for (const section of sheet) expect(section.stats.length).toBeGreaterThan(0);
  });

  it('shows placeholder dashes for stats the fresh hero lacks', () => {
    const sheet = game.characterSheetView.build();
    const offense = sheet.find(s => s.title === 'Offense')!;
    expect(offense.stats.find(s => s.label === 'Thorn Reflect')!.value).toBe('—');
    const utility = sheet.find(s => s.title === 'Utility')!;
    expect(utility.stats.find(s => s.label === 'Sworn Patron')!.value).toBe('—');
  });

  it("surfaces a draoi's patron and spellbook once a pact is sworn", () => {
    game.applyClass('draoi');
    game.dungeonLevel = 2;
    game.applyPatron('morrigan');
    const utility = game.characterSheetView.build().find(s => s.title === 'Utility')!;
    expect(utility.stats.find(s => s.label === 'Sworn Patron')!.value).not.toBe('—');
    expect(utility.stats.find(s => s.label === 'Spells Known')!.value).not.toBe('—');
  });

  it('reflects a boon that raises an offense stat', () => {
    const before = game.characterSheetView.build().find(s => s.title === 'Offense')!
      .stats.find(s => s.label === 'Attack')!.value;
    game.player.atk += 25;
    const after = game.characterSheetView.build().find(s => s.title === 'Offense')!
      .stats.find(s => s.label === 'Attack')!.value;
    expect(Number(after)).toBeGreaterThan(Number(before));
  });
});
