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
    // Hand-build a boss causeway straight down the home column to just above the shore.
    for (let y = 0; y <= 22; y++) priv(game).duelOwner[home.x]![y] = 2;
    priv(game).duelBoss!.x = home.x; priv(game).duelBoss!.y = 22;
    priv(game).duelBossTurn();  // its next step claims (5,23) — abutting home → bridge lands
    expect(priv(game).duelResolved).toBe(true);
    expect(game.player.hp).toBe(0);
    expect(cb.deaths.some(r => r.includes('causeway'))).toBe(true);
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
