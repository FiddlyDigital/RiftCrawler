import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Game } from '../game';
import { CombatSystem } from '../systems/combat';
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

/** Reach into the duel module's helpers/state without widening the public API. */
type DuelInternals = {
  owner: number[][];
  boss: import('../entities').Monster | null;
  resolved: boolean;
  bossTurn: () => void;
  placePiece: () => void;
  lightSwitch: (sw: { x: number; y: number; lit: boolean }) => void;
  bossLaneColumn: () => number;
  claim: (cells: Array<{ x: number; y: number }>, owner: number, color: string) => void;
  switches: Array<{ x: number; y: number; lit: boolean }>;
  wall: Array<{ x: number; y: number }>;
  boons: Array<{ x: number; y: number; kind: string; taken: boolean }>;
};
const priv = (g: Game): DuelInternals => g.causewayDuel as unknown as DuelInternals;

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
    expect(priv(game).owner[mid]![24]).toBe(1);
    expect(priv(game).owner[mid]![0]).toBe(2);
    expect(game.player.x).toBe(mid);
    expect(game.player.y).toBe(24);
    expect(priv(game).boss).not.toBeNull();
    expect(priv(game).boss!.isBoss).toBe(true);
    expect(game.blockMatrix.length).toBeGreaterThan(0);  // a placement piece is dealt
    // the Blockbuilding layer is suspended so no gravity drives the cursor
    expect((game as unknown as { blockBuildingSuspended: boolean }).blockBuildingSuspended).toBe(true);
  });

  it('a placement only takes when it connects to the player causeway; a disconnected one is rejected', () => {
    game.startCausewayDuel();
    const ownedBefore = priv(game).owner.flat().filter(o => o === 1).length;
    // Steer the cursor far from the home tile (top-left) and place: not connected → rejected.
    game.blockX = 0; game.blockY = 0;
    priv(game).placePiece();
    const ownedAfterBad = priv(game).owner.flat().filter(o => o === 1).length;
    expect(ownedAfterBad).toBe(ownedBefore);  // nothing claimed
    expect(cb.logs.some(l => l.includes('build out from your own causeway'))).toBe(true);

    // Steer over the home column and place: connects → claims tiles (causeway grows).
    game.blockX = 4;
    priv(game).placePiece();
    const ownedAfterGood = priv(game).owner.flat().filter(o => o === 1).length;
    expect(ownedAfterGood).toBeGreaterThan(ownedBefore);
  });

  it('the boss causeway advances downward each boss turn (coming to meet the hero)', () => {
    game.startCausewayDuel();
    const boss = priv(game).boss!;
    const y0 = boss.y;
    priv(game).bossTurn();
    expect(boss.y).toBeGreaterThan(y0);  // the pawn walked down its new causeway
    const bossTiles = priv(game).owner.flat().filter(o => o === 2).length;
    expect(bossTiles).toBeGreaterThan(1);
  });

  it('killing the duel boss (melee) ends the duel and auto-opens the descent choice', () => {
    game.startCausewayDuel();
    const boss = priv(game).boss!;
    // Place the hero adjacent to the boss on an owned tile, then one-shot it.
    game.map[boss.x]![boss.y + 1] = Tile.FLOOR;
    priv(game).owner[boss.x]![boss.y + 1] = 1;
    game.player.x = boss.x; game.player.y = boss.y + 1;
    game.player.atk = 100000;
    game.player.baseCombatLevel = 6;
    let guard = 0;
    while (priv(game).boss && guard++ < 50) game.handleHeroMove(0, -1);  // attack upward
    expect(priv(game).resolved).toBe(true);
    expect(priv(game).boss).toBeNull();
    // The descent choice fires once the level-up boon pick (from the kill) closes.
    game.paused = false;
    (game as unknown as { settleDuel: () => void }).settleDuel();
    expect(game.inCausewayDuel).toBe(false);
  });

  it('a non-melee kill (ranged/AoE) from the shore also ends the duel and opens the descent choice', () => {
    game.startCausewayDuel();
    const boss = priv(game).boss!;
    // The hero stands on the home tile with NO causeway built up — as if they
    // shot the boss dead from the shore. Route the death through the shared
    // killMonster path (as every ranged/AoE ability does).
    game.player.x = 5; game.player.y = 24;
    boss.hp = 0;
    CombatSystem.killMonster(boss, game);
    // The duel resolves immediately — the boss can't keep building its causeway.
    expect(priv(game).resolved).toBe(true);
    expect(priv(game).boss).toBeNull();
    const bossTiles = priv(game).owner.flat().filter(o => o === 2).length;
    priv(game).bossTurn();
    expect(priv(game).owner.flat().filter(o => o === 2).length).toBe(bossTiles);
    // No stairs tile to hunt for; the delve-or-rest choice opens once the
    // level-up boon pick closes — the duel ends outright.
    game.paused = false;
    (game as unknown as { settleDuel: () => void }).settleDuel();
    expect(game.inCausewayDuel).toBe(false);
  });

  it('the run is lost when the boss causeway reaches the shore (adjacent to the home tile)', () => {
    game.startCausewayDuel();
    const home = { x: 5, y: 24 };
    // Hand-build a broad boss causeway down to just above the shore; the boss
    // pushes its bridge the last row or two and lands it on the home tile.
    for (let y = 0; y <= 22; y++) for (const x of [4, 5, 6]) priv(game).owner[x]![y] = 2;
    priv(game).boss!.x = home.x; priv(game).boss!.y = 22;
    let guard = 0;
    while (!priv(game).resolved && guard++ < 8) priv(game).bossTurn();
    expect(priv(game).resolved).toBe(true);
    expect(game.player.hp).toBe(0);
    expect(cb.deaths.some(r => r.includes('causeway'))).toBe(true);
  });

  it('sets up a sealed center wall, two switch-islands, and two boon-islands', () => {
    game.startCausewayDuel();
    expect(priv(game).wall.length).toBe(10);       // full-width wall
    expect(priv(game).switches.length).toBe(2);
    expect(priv(game).boons.length).toBe(2);
    // the hero cannot walk a sealed wall tile
    const w = priv(game).wall[0]!;
    expect(game.isValidMove(w.x, w.y)).toBe(false);
  });

  it('the hero lights an ogham switch by stepping onto it, and lighting all opens the wall', () => {
    game.startCausewayDuel();
    expect(priv(game).wall.length).toBeGreaterThan(0);
    const switches = priv(game).switches;
    // Build a causeway tile just below the first switch, stand on it, and step up.
    const s0 = switches[0]!;
    priv(game).claim([{ x: s0.x, y: s0.y + 1 }], 1, '#fff');
    game.player.x = s0.x; game.player.y = s0.y + 1;
    game.handleHeroMove(0, -1);  // step onto the switch tile
    expect(s0.lit).toBe(true);
    expect(game.player.y).toBe(s0.y);  // the hero is standing on it now
    // Light the remaining switch(es); the last one opens the wall.
    for (const sw of switches) if (!sw.lit) priv(game).lightSwitch(sw);
    expect(switches.every(s => s.lit)).toBe(true);
    expect(priv(game).wall.length).toBe(0);  // wall opened
  });

  it('the hero collects a boon-island by stepping onto it', () => {
    game.startCausewayDuel();
    const boon = priv(game).boons[0]!;
    const goldBefore = game.gold, hpBefore = game.player.hp, boonsBefore = game.player.boons.length;
    // Stand on a causeway tile below the boon-island and step up onto it.
    priv(game).claim([{ x: boon.x, y: boon.y + 1 }], 1, '#fff');
    game.player.x = boon.x; game.player.y = boon.y + 1;
    game.handleHeroMove(0, -1);
    expect(priv(game).boons[0]!.taken).toBe(true);
    // a reward of some kind landed (gold up, or healed, or a new geis)
    const rewarded = game.gold > goldBefore || game.player.hp > hpBefore || game.player.boons.length > boonsBefore;
    expect(rewarded).toBe(true);
  });

  it('the boss routes toward an open lane, not into the player\'s wall', () => {
    game.startCausewayDuel();
    // The hero walls off the whole home column with player causeway.
    const home = { x: 5, y: 24 };
    for (let y = 14; y <= 23; y++) priv(game).claim([{ x: home.x, y }], 1, '#fff');
    // The boss should now prefer a different, unobstructed column to reach the shore.
    const lane = priv(game).bossLaneColumn();
    expect(lane).not.toBe(home.x);
  });

  it('a mid-duel state survives a save/resume round trip', () => {
    game.startCausewayDuel();
    // Advance the duel a bit: light a switch, let the boss build.
    priv(game).lightSwitch(priv(game).switches[0]!);
    priv(game).bossTurn();
    const ownerBefore = JSON.stringify(priv(game).owner);
    const litBefore = priv(game).switches.filter(s => s.lit).length;

    const save = JSON.parse(JSON.stringify(game.serialize()));
    const restored = new Game(makeCallbacks(), { forRestore: true });
    restored.applySave(save);

    expect(restored.inCausewayDuel).toBe(true);
    expect(JSON.stringify(priv(restored).owner)).toBe(ownerBefore);
    expect(priv(restored).switches.filter(s => s.lit).length).toBe(litBefore);
    expect(priv(restored).wall.length).toBe(priv(game).wall.length);
    expect(priv(restored).boons.length).toBe(2);
    // the boss reference is re-linked to a live restored Monster (not a plain object)
    expect(priv(restored).boss).not.toBeNull();
    expect(priv(restored).boss!.isBoss).toBe(true);
    expect(restored.monsters).toContain(priv(restored).boss);
    // and the restored duel still simulates
    expect(() => priv(restored).bossTurn()).not.toThrow();
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

  it('reaching a gold boon-island pays out gold inline (no modal)', () => {
    game.startCausewayDuel();
    const duel = game.causewayDuel as unknown as {
      boons: Array<{ x: number; y: number; kind: string; taken: boolean }>;
      takeBoon: (b: { x: number; y: number; kind: string; taken: boolean }) => void;
    };
    const goldBoon = { x: 3, y: 3, kind: 'gold', taken: false };
    duel.boons.push(goldBoon);
    const before = game.gold;
    duel.takeBoon(goldBoon);
    expect(goldBoon.taken).toBe(true);
    expect(game.gold).toBeGreaterThan(before);
  });

  it('restoring from a snapshot with no duel state leaves the duel inactive', () => {
    game.startCausewayDuel();
    game.causewayDuel.restore(undefined);
    expect(game.inCausewayDuel).toBe(false);
    expect(game.causewayDuel.boss).toBeNull();
  });
});
