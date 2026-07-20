import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Game } from '../game';
import { Tile } from '../types';
import type { GameCallbacks, LogClass, BossDef } from '../types';

function makeCallbacks(): GameCallbacks & { logs: string[]; deaths: string[] } {
  const logs: string[] = [];
  const deaths: string[] = [];
  return {
    logs, deaths,
    log: (text: string, _cls: LogClass) => { logs.push(text); },
    updateUI: vi.fn(),
    onDeath: (_title: string, reason: string) => { deaths.push(reason); },
    onParticle: vi.fn(),
    onParticleBurst: vi.fn(),
    onLevelUp: vi.fn(),
    onOpenShop: vi.fn(),
    onOpenTattooArtist: vi.fn(),
    onVictory: vi.fn(),
    onBossWarning: (_boss: BossDef, onDone: () => void) => onDone(),
    onAction: vi.fn(),
    onBeam: vi.fn(),
    onToast: vi.fn(),
    onBlockLand: vi.fn(),
  } as unknown as GameCallbacks & { logs: string[]; deaths: string[] };
}

/** Reach into the duel's private helpers/state without widening the public API. */
type DuelInternals = {
  duelOwner: number[][];
  duelBoss: import('../entities').Monster | null;
  duelResolved: boolean;
  duelBossTurn: () => void;
  duelPlacePiece: () => void;
  duelLightSwitch: (sw: { x: number; y: number; lit: boolean }) => void;
  duelBossLaneColumn: () => number;
  duelClaim: (cells: Array<{ x: number; y: number }>, owner: number, color: string) => void;
  duelSwitches: Array<{ x: number; y: number; lit: boolean }>;
  duelWall: Array<{ x: number; y: number }>;
  duelBoons: Array<{ x: number; y: number; kind: string; taken: boolean }>;
  blockMatrix: unknown[];
};
const priv = (g: Game): DuelInternals => g as unknown as DuelInternals;

describe('Causeway Duel', () => {
  let cb: ReturnType<typeof makeCallbacks>;
  let game: Game;

  beforeEach(() => {
    cb = makeCallbacks();
    game = new Game(cb);
    game.dungeonLevel = 5;
  });

  it('startCausewayDuel sets up the board: hero home tile, boss at the top, a piece in hand', () => {
    game.startCausewayDuel();
    expect(game.inCausewayDuel).toBe(true);
    const mid = 5;
    // hero home at bottom-centre, owned by the player; boss home at top-centre, owned by the boss
    expect(priv(game).duelOwner[mid]![24]).toBe(1);
    expect(priv(game).duelOwner[mid]![0]).toBe(2);
    expect(game.player.x).toBe(mid);
    expect(game.player.y).toBe(24);
    expect(priv(game).duelBoss).not.toBeNull();
    expect(priv(game).duelBoss!.isBoss).toBe(true);
    expect(priv(game).blockMatrix.length).toBeGreaterThan(0);  // a placement piece is dealt
    // the Tetris layer is suspended so no gravity drives the cursor
    expect((game as unknown as { tetrisSuspended: boolean }).tetrisSuspended).toBe(true);
  });

  it('a placement only takes when it connects to the player causeway; a disconnected one is rejected', () => {
    game.startCausewayDuel();
    const ownedBefore = priv(game).duelOwner.flat().filter(o => o === 1).length;
    // Steer the cursor far from the home tile (top-left) and place: not connected → rejected.
    game.blockX = 0; game.blockY = 0;
    priv(game).duelPlacePiece();
    const ownedAfterBad = priv(game).duelOwner.flat().filter(o => o === 1).length;
    expect(ownedAfterBad).toBe(ownedBefore);  // nothing claimed
    expect(cb.logs.some(l => l.includes('build out from your own causeway'))).toBe(true);

    // Steer over the home column and place: connects → claims tiles (causeway grows).
    game.blockX = 4;
    priv(game).duelPlacePiece();
    const ownedAfterGood = priv(game).duelOwner.flat().filter(o => o === 1).length;
    expect(ownedAfterGood).toBeGreaterThan(ownedBefore);
  });

  it('the boss causeway advances downward each boss turn (coming to meet the hero)', () => {
    game.startCausewayDuel();
    const boss = priv(game).duelBoss!;
    const y0 = boss.y;
    priv(game).duelBossTurn();
    expect(boss.y).toBeGreaterThan(y0);  // the pawn walked down its new causeway
    const bossTiles = priv(game).duelOwner.flat().filter(o => o === 2).length;
    expect(bossTiles).toBeGreaterThan(1);
  });

  it('killing the duel boss ends the duel and raises victory stairs next to the hero', () => {
    game.startCausewayDuel();
    const boss = priv(game).duelBoss!;
    // Place the hero adjacent to the boss on an owned tile, then one-shot it.
    game.map[boss.x]![boss.y + 1] = Tile.FLOOR;
    priv(game).duelOwner[boss.x]![boss.y + 1] = 1;
    game.player.x = boss.x; game.player.y = boss.y + 1;
    game.player.atk = 100000;
    game.player.baseCombatLevel = 6;
    let guard = 0;
    while (priv(game).duelBoss && guard++ < 50) game.handleHeroMove(0, -1);  // attack upward
    expect(priv(game).duelResolved).toBe(true);
    // a stairs tile now exists on the board
    let stairs = 0;
    for (let x = 0; x < 10; x++) for (let y = 0; y < 25; y++) if (game.map[x]![y] === Tile.STAIRS) stairs++;
    expect(stairs).toBeGreaterThan(0);
  });

  it('the run is lost when the boss causeway reaches the shore (adjacent to the home tile)', () => {
    game.startCausewayDuel();
    const home = { x: 5, y: 24 };
    // Hand-build a broad boss causeway down to just above the shore; the boss
    // pushes its bridge the last row or two and lands it on the home tile.
    for (let y = 0; y <= 22; y++) for (const x of [4, 5, 6]) priv(game).duelOwner[x]![y] = 2;
    priv(game).duelBoss!.x = home.x; priv(game).duelBoss!.y = 22;
    let guard = 0;
    while (!priv(game).duelResolved && guard++ < 8) priv(game).duelBossTurn();
    expect(priv(game).duelResolved).toBe(true);
    expect(game.player.hp).toBe(0);
    expect(cb.deaths.some(r => r.includes('causeway'))).toBe(true);
  });

  it('sets up a sealed center wall, two switch-islands, and two boon-islands', () => {
    game.startCausewayDuel();
    expect(priv(game).duelWall.length).toBe(10);       // full-width wall
    expect(priv(game).duelSwitches.length).toBe(2);
    expect(priv(game).duelBoons.length).toBe(2);
    // the hero cannot walk a sealed wall tile
    const w = priv(game).duelWall[0]!;
    expect(game.isValidMove(w.x, w.y)).toBe(false);
  });

  it('the hero lights an ogham switch by stepping onto it, and lighting all opens the wall', () => {
    game.startCausewayDuel();
    expect(priv(game).duelWall.length).toBeGreaterThan(0);
    const switches = priv(game).duelSwitches;
    // Build a causeway tile just below the first switch, stand on it, and step up.
    const s0 = switches[0]!;
    priv(game).duelClaim([{ x: s0.x, y: s0.y + 1 }], 1, '#fff');
    game.player.x = s0.x; game.player.y = s0.y + 1;
    game.handleHeroMove(0, -1);  // step onto the switch tile
    expect(s0.lit).toBe(true);
    expect(game.player.y).toBe(s0.y);  // the hero is standing on it now
    // Light the remaining switch(es); the last one opens the wall.
    for (const sw of switches) if (!sw.lit) priv(game).duelLightSwitch(sw);
    expect(switches.every(s => s.lit)).toBe(true);
    expect(priv(game).duelWall.length).toBe(0);  // wall opened
  });

  it('the hero collects a boon-island by stepping onto it', () => {
    game.startCausewayDuel();
    const boon = priv(game).duelBoons[0]!;
    const goldBefore = game.gold, hpBefore = game.player.hp, boonsBefore = game.player.boons.length;
    // Stand on a causeway tile below the boon-island and step up onto it.
    priv(game).duelClaim([{ x: boon.x, y: boon.y + 1 }], 1, '#fff');
    game.player.x = boon.x; game.player.y = boon.y + 1;
    game.handleHeroMove(0, -1);
    expect(priv(game).duelBoons[0]!.taken).toBe(true);
    // a reward of some kind landed (gold up, or healed, or a new geis)
    const rewarded = game.gold > goldBefore || game.player.hp > hpBefore || game.player.boons.length > boonsBefore;
    expect(rewarded).toBe(true);
  });

  it('the boss routes toward an open lane, not into the player\'s wall', () => {
    game.startCausewayDuel();
    // The hero walls off the whole home column with player causeway.
    const home = { x: 5, y: 24 };
    for (let y = 14; y <= 23; y++) priv(game).duelClaim([{ x: home.x, y }], 1, '#fff');
    // The boss should now prefer a different, unobstructed column to reach the shore.
    const lane = priv(game).duelBossLaneColumn();
    expect(lane).not.toBe(home.x);
  });

  it('a mid-duel state survives a save/resume round trip', () => {
    game.startCausewayDuel();
    // Advance the duel a bit: light a switch, let the boss build.
    priv(game).duelLightSwitch(priv(game).duelSwitches[0]!);
    priv(game).duelBossTurn();
    const ownerBefore = JSON.stringify(priv(game).duelOwner);
    const litBefore = priv(game).duelSwitches.filter(s => s.lit).length;

    const save = JSON.parse(JSON.stringify(game.serialize()));
    const restored = new Game(makeCallbacks(), { forRestore: true });
    restored.applySave(save);

    expect(restored.inCausewayDuel).toBe(true);
    expect(JSON.stringify(priv(restored).duelOwner)).toBe(ownerBefore);
    expect(priv(restored).duelSwitches.filter(s => s.lit).length).toBe(litBefore);
    expect(priv(restored).duelWall.length).toBe(priv(game).duelWall.length);
    expect(priv(restored).duelBoons.length).toBe(2);
    // the boss reference is re-linked to a live restored Monster (not a plain object)
    expect(priv(restored).duelBoss).not.toBeNull();
    expect(priv(restored).duelBoss!.isBoss).toBe(true);
    expect(restored.monsters).toContain(priv(restored).duelBoss);
    // and the restored duel still simulates
    expect(() => priv(restored).duelBossTurn()).not.toThrow();
  });

  it('a headless boss floor with the duel opt-in enters a duel instead of the normal encounter', () => {
    // simulate the opt-in flag without a DOM
    const store = new Map<string, string>([['riftcrawler_duel_boss', '1']]);
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: () => {}, removeItem: () => {} });
    try {
      const g = new Game(makeCallbacks());
      g.dungeonLevel = 4;  // descend → floor 5 (a boss floor)
      // drive the private descent used when the hero takes stairs
      (g as unknown as { descendFloor: () => void }).descendFloor();
      expect(g.dungeonLevel).toBe(5);
      expect(g.inCausewayDuel).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
