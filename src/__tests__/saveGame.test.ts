import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Game } from '../game';
import { SAVE_VERSION, Tile } from '../types';
import type { GameCallbacks, SavedRun } from '../types';
import { Monster } from '../entities';
import { BOONS, BRANDS, BOSSES, OMENS, FLOOR_EVENTS, CLASSES } from '../content';
import { StorageService } from '../storage';
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

/** Serialize → JSON round-trip → restore into a fresh shell, exactly as the app does. */
function roundTrip(game: Game): { restored: Game; cb: ReturnType<typeof makeCallbacks> } {
  const json = JSON.stringify(game.serialize());
  const save = JSON.parse(json) as SavedRun;
  const cb = makeCallbacks();
  const restored = new Game(cb, { forRestore: true });
  restored.applySave(save);
  return { restored, cb };
}

describe('mid-run save/resume', () => {
  let cb: ReturnType<typeof makeCallbacks>;
  let game: Game;

  beforeEach(() => {
    cb = makeCallbacks();
    game = new Game(cb);
  });

  it('a forRestore shell skips run-start side effects (no platform, no piece, no logs)', () => {
    const shellCb = makeCallbacks();
    const shell = new Game(shellCb, { forRestore: true });
    expect(shell.blockMatrix).toHaveLength(0);
    expect(shell.map[4]![23]).toBe(Tile.VOID);  // no starting platform
    expect(shellCb.logs).toHaveLength(0);
  });

  it('round-trips core run state verbatim (floor, gold, grids, piece, counters)', () => {
    game.applyClass(CLASSES[0]!.id);
    game.gold = 321;
    game.dungeonLevel = 7;
    game.monstersKilled = 12;
    game.linesCleared = 5;
    game.storyBeats.push('tested the save system');
    game.map[0]![0] = Tile.FLOOR;
    game.colors[0]![0] = '#123456';

    const { restored } = roundTrip(game);
    expect(restored.activeClassId).toBe(CLASSES[0]!.id);
    expect(restored.gold).toBe(321);
    expect(restored.dungeonLevel).toBe(7);
    expect(restored.monstersKilled).toBe(12);
    expect(restored.linesCleared).toBe(5);
    expect(restored.storyBeats).toContain('tested the save system');
    expect(restored.map).toEqual(game.map);
    expect(restored.colors[0]![0]).toBe('#123456');
    expect(restored.blockMatrix).toEqual(game.blockMatrix);
    expect(restored.currentType).toBe(game.currentType);
    expect(restored.nextType).toBe(game.nextType);
    expect(restored.paused).toBe(false);
    expect(restored.active).toBe(true);
  });

  it('round-trips the player, re-resolving boon/brand defs by id without re-firing effects', () => {
    const boon = BOONS.find(b => b.tier === 1)!;
    game.player.addBoon(boon);
    game.player.addBoon(boon);
    const brand = BRANDS[0]!;
    game.player.addBrand('head', brand);
    const atkAfter = game.player.atk;
    const hpAfter = game.player.maxHp;
    game.player.hp = 17;

    const { restored } = roundTrip(game);
    const p = restored.player;
    expect(p.hp).toBe(17);
    expect(p.atk).toBe(atkAfter);       // baked-in stats, not re-applied
    expect(p.maxHp).toBe(hpAfter);
    expect(p.boons).toHaveLength(1);
    expect(p.boons[0]!.stacks).toBe(2);
    expect(p.boons[0]!.def).toBe(boon); // same live content object
    expect(p.brands).toHaveLength(1);
    expect(p.brands[0]!.brand).toBe(brand);
    expect(p.brands[0]!.slot).toBe('head');
    expect(p.brandsAcquiredTotal).toBe(1);
  });

  it('a saved boon whose id vanished from the content is dropped, not crashed on', () => {
    const boon = BOONS.find(b => b.tier === 1)!;
    game.player.addBoon(boon);
    const save = JSON.parse(JSON.stringify(game.serialize())) as SavedRun;
    save.player.boons[0]!.id = '__no_such_boon__';
    const restored = new Game(makeCallbacks(), { forRestore: true });
    restored.applySave(save);
    expect(restored.player.boons).toHaveLength(0);
  });

  it('round-trips live monsters with statuses and elite flags', () => {
    const m = new Monster(3, 20, 'sprite_rat_01', 'Saved Rat', 8, 10, 2, 5, false, 'melee');
    m.isElite = true;
    m.statuses.push({ type: 'poison', duration: 3, power: 2 });
    game.monsters.push(m);

    const { restored } = roundTrip(game);
    const rm = restored.monsters.find(x => x.name === 'Saved Rat')!;
    expect(rm).toBeDefined();
    expect(rm.hp).toBe(8);
    expect(rm.maxHp).toBe(10);
    expect(rm.isElite).toBe(true);
    expect(rm.statuses).toEqual([{ type: 'poison', duration: 3, power: 2 }]);
  });

  it('re-resolves the active omen and pending floor event by id', () => {
    const omen = OMENS[0]!;
    const event = FLOOR_EVENTS[0]!;
    game.activeOmen = omen as Game['activeOmen'];
    game.pendingFloorEvent = event as Game['pendingFloorEvent'];

    const { restored } = roundTrip(game);
    expect(restored.activeOmen).toBe(omen);           // same live content instance
    expect(restored.pendingFloorEvent).toBe(event);
  });

  it('round-trips Sets (rescued figures, spear parts, met NPCs)', () => {
    game.rescuedIds.add('goban');
    game.spearPartsHeld.add('shaft');
    game.spearPartsHeld.add('bolts');

    const { restored } = roundTrip(game);
    expect(restored.rescuedIds.has('goban')).toBe(true);
    expect(restored.spearPartsHeld.has('shaft')).toBe(true);
    expect(restored.spearPartsHeld.has('bolts')).toBe(true);
    expect(restored.spearPartsHeld.has('head')).toBe(false);
  });

  it('reattaches a biome boss\'s half-HP/death mechanics by name after restore', () => {
    const def = BOSSES.find(b => b.onHalfHp)!;
    const boss = new Monster(4, 22, def.char, def.name, 100, 100, 5, def.xpReward, true);
    game.monsters.push(boss);

    const { restored } = roundTrip(game);
    const rb = restored.monsters.find(m => m.isBoss)!;
    expect(rb.name).toBe(def.name);
    // Behavioral check: dropping the boss to half HP fires the reattached hook.
    // Place the hero adjacent and attack until the threshold crosses.
    restored.map[4]![22] = Tile.FLOOR;
    restored.map[4]![23] = Tile.FLOOR;
    restored.player.x = 4; restored.player.y = 23;
    restored.player.atk = 60;  // one hit crosses 50%
    const logsBefore = (restored.cb as unknown as { logs?: string[] }).logs?.length;
    for (let i = 0; i < 30 && rb.hp > rb.maxHp * 0.5; i++) {
      restored.handleHeroMove(0, -1);
    }
    expect(rb.hp).toBeLessThanOrEqual(rb.maxHp * 0.5 + 60);
    expect(logsBefore).toBeDefined();  // hook ran without throwing — the run continued
  });

  it('restores a mid-duel Bres (Gorgoth) with his half-HP mechanic rebuilt around the restored instance', () => {
    game.summonGorgoth();
    expect(game.gorgothSummoned).toBe(true);

    const { restored } = roundTrip(game);
    expect(restored.gorgothSummoned).toBe(true);
    const bres = restored.monsters.find(m => m.isGorgoth)!;
    expect(bres).toBeDefined();
    expect(bres.name).toBe('Bres the Beautiful');
    expect(restored.blockMatrix).toHaveLength(0);  // no falling stone mid-duel
  });

  it('a restored game keeps simulating (turns advance without crashing)', () => {
    game.applyClass(CLASSES[0]!.id);
    const { restored } = roundTrip(game);
    expect(() => {
      restored.handleHeroWait();
      restored.handleBlockSoftDrop();
      restored.autoTick();
    }).not.toThrow();
  });

  it('rejects a save with a mismatched version', () => {
    const save = game.serialize();
    save.version = SAVE_VERSION + 999;
    const restored = new Game(makeCallbacks(), { forRestore: true });
    expect(() => restored.applySave(save)).toThrow(/version/);
  });

  it('rejects a save whose piece shape no longer exists', () => {
    const save = JSON.parse(JSON.stringify(game.serialize())) as SavedRun;
    (save.scalars as Record<string, unknown>)['currentType'] = 'ZZ_GONE';
    const restored = new Game(makeCallbacks(), { forRestore: true });
    expect(() => restored.applySave(save)).toThrow(/shape/);
  });

  it('never leaks tutorial safety into a restored run', () => {
    game.tutorialSafety = true;
    const { restored } = roundTrip(game);
    expect(restored.tutorialSafety).toBe(false);
  });
});

describe('StorageService run snapshot persistence', () => {
  // Node test env has no localStorage — install a Map-backed stand-in.
  let store: Map<string, string>;

  beforeEach(() => {
    store = new Map();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('saveRun/loadRun round-trips and clearRun discards', () => {
    const game = new Game(makeCallbacks());
    game.gold = 55;
    StorageService.saveRun(game.serialize());
    const loaded = StorageService.loadRun();
    expect(loaded).not.toBeNull();
    expect(loaded!.scalars['gold']).toBe(55);
    StorageService.clearRun();
    expect(StorageService.loadRun()).toBeNull();
  });

  it('loadRun rejects a snapshot from an older save version', () => {
    const game = new Game(makeCallbacks());
    const save = game.serialize();
    save.version = SAVE_VERSION - 1;
    StorageService.saveRun(save);
    expect(StorageService.loadRun()).toBeNull();
  });

  it('a full save → load → restore round trip through storage produces a playable game', () => {
    const game = new Game(makeCallbacks());
    game.applyClass(CLASSES[0]!.id);
    game.dungeonLevel = 4;
    game.gold = Balance.CONFIG.well.baseCost + 10;
    StorageService.saveRun(game.serialize());

    const loaded = StorageService.loadRun()!;
    const restored = new Game(makeCallbacks(), { forRestore: true });
    restored.applySave(loaded);
    expect(restored.dungeonLevel).toBe(4);
    expect(() => restored.handleHeroWait()).not.toThrow();
  });
});
