import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Game } from '../game';
import { Tile } from '../types';
import type { GameCallbacks, LogClass, FloorEventDef, GhostRecord } from '../types';

function makeCallbacks(): GameCallbacks & { events: FloorEventDef[]; shopOpened: () => boolean } {
  const events: FloorEventDef[] = [];
  let shop = false;
  return {
    events,
    shopOpened: () => shop,
    log: (_t: string, _c: LogClass) => {},
    onFloorEvent: (event: FloorEventDef) => { events.push(event); },
    onOpenShop: () => { shop = true; },
    updateUI: vi.fn(), onDeath: vi.fn(), onParticle: vi.fn(), onParticleBurst: vi.fn(),
    onLevelUp: vi.fn(), onOpenTattooArtist: vi.fn(), onVictory: vi.fn(),
    onBossWarning: (_b: unknown, done: () => void) => done(), onAction: vi.fn(), onBeam: vi.fn(),
    onToast: vi.fn(), onBlockLand: vi.fn(), onRingPulse: vi.fn(), onImpactGlow: vi.fn(), onAudio: vi.fn(),
    onCodexDiscover: vi.fn(), onOpenCodex: vi.fn(), onGhostLaidToRest: vi.fn(),
  } as unknown as GameCallbacks & { events: FloorEventDef[]; shopOpened: () => boolean };
}

describe('Waystation — mound entry', () => {
  let game: Game;
  beforeEach(() => { game = new Game(makeCallbacks()); });

  it('entering builds the mound: hero on the floor, resident fixtures, exit stairs', () => {
    (game as unknown as { enterWaystation(): void }).enterWaystation();
    expect(game.inWaystation).toBe(true);
    const M = Game.MOUND;
    expect(game.map[M.stairs.x]![M.stairs.y]).toBe(Tile.STAIRS);
    // fixtures always present
    for (const id of ['seanchai', '__campfire__', '__peddler__', '__ogham_stone__', '__well__', '__stash__']) {
      expect(game.npcTiles.some(n => n.npcId === id)).toBe(true);
    }
  });

  it('rescued souls become mound residents on entry', () => {
    game.rescuedIds.add('goban');
    (game as unknown as { enterWaystation(): void }).enterWaystation();
    expect(game.npcTiles.some(n => n.npcId === '__rescue_goban__')).toBe(true);
  });

  it('An Dagda waits in the corner only while his gift is unclaimed', () => {
    game.dagdaGiftEarned = true; game.dagdaGiftClaimed = false;
    (game as unknown as { enterWaystation(): void }).enterWaystation();
    expect(game.npcTiles.some(n => n.npcId === '__dagda__')).toBe(true);
  });
});

describe('Waystation — bump interactions', () => {
  let cb: ReturnType<typeof makeCallbacks>;
  let game: Game;

  // Park the hero at a floor tile and drop an npc tile one step up (on floor,
  // so the move resolves to the interaction rather than an abyss bump).
  const putNpc = (npcId: string): void => {
    game.player.x = 0; game.player.y = 1;
    game.map[0]![1] = Tile.FLOOR;
    game.map[0]![0] = Tile.FLOOR;
    game.npcTiles.push({ x: 0, y: 0, npcId });
  };

  beforeEach(() => { cb = makeCallbacks(); game = new Game(cb); game.dungeonLevel = 5; });

  it('the hearth-fire heals the hero to full', () => {
    game.player.hp = 20;
    putNpc('__campfire__');
    game.handleHeroMove(0, -1);
    expect(game.player.hp).toBe(game.player.maxHp);   // fully healed
  });

  it("the Fear Dearg's stall opens the shop", () => {
    putNpc('__peddler__');
    game.handleHeroMove(0, -1);
    expect(cb.shopOpened()).toBe(true);
  });

  it('the ogham stone opens the codex and stays put (a fixture)', () => {
    putNpc('__ogham_stone__');
    game.handleHeroMove(0, -1);
    expect(cb.onOpenCodex).toHaveBeenCalled();
    expect(game.npcTiles.some(n => n.npcId === '__ogham_stone__')).toBe(true);
  });

  it('a ghost tile opens the ghost encounter', () => {
    const ghost: GhostRecord = { id: 'g', playerLevel: 2, floor: 3, classId: 'draoi', cause: 'fell', date: 'x' };
    game.activeGhost = ghost; game.availableGhosts = [ghost];
    putNpc('__ghost__');
    game.handleHeroMove(0, -1);
    expect(cb.events.some(e => e.title === 'A Ghost of Yourself')).toBe(true);
  });

  it('a smith tile opens that smith\'s encounter', () => {
    putNpc('__smith_luchta__');
    game.handleHeroMove(0, -1);
    expect(cb.events.length).toBeGreaterThan(0);
  });

  it('a wandering NPC tile opens its dialog', () => {
    putNpc('fionnuala');
    game.handleHeroMove(0, -1);
    expect(cb.events.some(e => e.title.length > 0)).toBe(true);
  });

  it('the Well of Segais grants XP for gold', () => {
    game.gold = 100000;
    putNpc('__well__');
    game.handleHeroMove(0, -1);
    const well = cb.events.find(e => e.id === '__well__')!;
    const xp0 = game.player.totalXpEarned;
    well.options[0]!.apply(game);   // drink deep
    expect(game.player.totalXpEarned).toBeGreaterThan(xp0);
  });
});
