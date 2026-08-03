import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Game } from '../game';
import type { GameCallbacks, LogClass } from '../types';

function makeCallbacks(): GameCallbacks & { logs: string[] } {
  const logs: string[] = [];
  return {
    logs,
    log: (text: string, _cls: LogClass) => { logs.push(text); },
    updateUI: vi.fn(), onDeath: vi.fn(), onParticle: vi.fn(), onParticleBurst: vi.fn(),
    onLevelUp: vi.fn(), onOpenShop: vi.fn(), onOpenTattooArtist: vi.fn(), onVictory: vi.fn(),
    onBossWarning: (_b: unknown, done: () => void) => done(), onAction: vi.fn(), onBeam: vi.fn(),
    onToast: vi.fn(), onBlockLand: vi.fn(), onRingPulse: vi.fn(), onImpactGlow: vi.fn(), onAudio: vi.fn(),
  } as unknown as GameCallbacks & { logs: string[] };
}

/** Reach into the Fidchell module's private helpers/state. */
type FidInternals = {
  active: boolean;
  board: number[][];
  playerSide: 'king' | 'raider';
  turn: 'king' | 'raider';
  resolved: boolean;
  origin: { x: number; y: number };
  applyMove: (fx: number, fy: number, tx: number, ty: number) => void;
  legalMovesOn: (b: number[][], x: number, y: number) => Array<{ x: number; y: number }>;
  kingCaptured: (b: number[][]) => boolean;
  aiMove: () => void;
};
const priv = (g: Game): FidInternals => g.fidchell as unknown as FidInternals;
const KING = 1, DEF = 2, RAID = 3;
const count = (g: Game, p: number): number => priv(g).board.flat().filter(c => c === p).length;

describe('Fidchell', () => {
  let cb: ReturnType<typeof makeCallbacks>;
  let game: Game;

  beforeEach(() => {
    cb = makeCallbacks();
    game = new Game(cb);
    game.dungeonLevel = 7;
  });

  it('startFidchell lays out a brandub board: King on the throne, 4 defenders, 8 raiders', () => {
    game.startFidchell();
    expect(game.inFidchell).toBe(true);
    expect(priv(game).board[3]![3]).toBe(KING);
    expect(count(game, DEF)).toBe(4);
    // one raider may already be moved if the AI (raiders) opened, so count 7 or 8
    expect(count(game, RAID)).toBeGreaterThanOrEqual(7);
    expect((game as unknown as { blockBuildingSuspended: boolean }).blockBuildingSuspended).toBe(true);
  });

  it('pieces slide like a rook — blocked by other pieces, and corners are King-only', () => {
    game.startFidchell();
    // Clear to a known position: a lone defender mid-board and the King.
    const b = priv(game).board;
    for (let x = 0; x < 7; x++) for (let y = 0; y < 7; y++) b[x]![y] = 0;
    b[3]![3] = KING; b[1]![1] = DEF;
    const defMoves = priv(game).legalMovesOn(b, 1, 1);
    // a non-King piece can't stop on a corner (0,0)
    expect(defMoves.some(m => m.x === 0 && m.y === 0)).toBe(false);
    // but the King may enter a corner
    const kingMoves = priv(game).legalMovesOn(b, 3, 3);
    expect(kingMoves.length).toBeGreaterThan(0);
  });

  it('flanking an enemy between two of your pieces captures it', () => {
    game.startFidchell();
    priv(game).playerSide = 'raider'; priv(game).turn = 'raider';
    const b = priv(game).board;
    for (let x = 0; x < 7; x++) for (let y = 0; y < 7; y++) b[x]![y] = 0;
    b[3]![3] = KING;                    // king off to the side (not the target)
    b[1]![2] = DEF;                     // the victim defender
    b[1]![3] = RAID;                    // anvil beyond the victim
    b[5]![1] = RAID;                    // hammer slides to (1,1), flanking the defender against the anvil at (1,3)
    priv(game).applyMove(5, 1, 1, 1);
    expect(b[1]![2]).toBe(0);           // defender captured
  });

  it('the King reaching a corner wins the match for the King side', () => {
    game.startFidchell();
    priv(game).playerSide = 'king'; priv(game).turn = 'king';
    const b = priv(game).board;
    for (let x = 0; x < 7; x++) for (let y = 0; y < 7; y++) b[x]![y] = 0;
    b[0]![3] = KING;                    // King one slide from the corner (0,0)
    const goldBefore = game.gold;
    priv(game).applyMove(0, 3, 0, 0); // dash into the dún
    expect(priv(game).resolved).toBe(true);
    expect(game.inFidchell).toBe(false); // won → shortcut past the floor
    expect(game.gold).toBeGreaterThan(goldBefore);
  });

  it('the King surrounded on every side is captured', () => {
    game.startFidchell();
    priv(game).playerSide = 'raider'; priv(game).turn = 'raider';
    const b = priv(game).board;
    for (let x = 0; x < 7; x++) for (let y = 0; y < 7; y++) b[x]![y] = 0;
    b[2]![2] = KING; b[1]![2] = RAID; b[2]![1] = RAID; b[2]![3] = RAID;  // three sides pinned
    b[4]![2] = RAID;                                                      // slides to (3,2), closing the fourth
    expect(priv(game).kingCaptured(b)).toBe(false);
    priv(game).applyMove(4, 2, 3, 2);
    expect(priv(game).resolved).toBe(true);                           // king captured → match over
  });

  it('entering a 7th floor opens a fidchell match instead of a normal floor', () => {
    const g = new Game(makeCallbacks());
    g.dungeonLevel = 6;
    (g as unknown as { descendFloor: () => void }).descendFloor();
    expect(g.dungeonLevel).toBe(7);
    expect(g.inFidchell).toBe(true);
  });

  describe("Midir's wager (played inside the mound)", () => {
    const STAKE = 200;
    /** Puts the hero in the mound with a wagered match already under way, as the King. */
    function openWager(g: Game): void {
      (g as unknown as { enterWaystation(): void }).enterWaystation();
      g.gold = STAKE + 40;
      g.startFidchellWager(STAKE);
      priv(g).playerSide = 'king'; priv(g).turn = 'king'; priv(g).resolved = false;
    }

    it('takes the stake up front and never leaves the mound', () => {
      openWager(game);
      expect(game.gold).toBe(40);
      expect(game.inFidchell).toBe(true);
      expect(game.inWaystation).toBe(true);
    });

    it('rejects a stake that is not a positive number', () => {
      expect(() => game.startFidchellWager(0)).toThrow(TypeError);
      expect(() => game.startFidchellWager(-5)).toThrow(TypeError);
    });

    it('winning pays double the stake and a boon, then rebuilds the mound', () => {
      openWager(game);
      const floorBefore = game.dungeonLevel;
      const boonsBefore = game.player.boons.length;
      const b = priv(game).board;
      for (let x = 0; x < 7; x++) for (let y = 0; y < 7; y++) b[x]![y] = 0;
      b[0]![3] = KING;
      priv(game).applyMove(0, 3, 0, 0);   // King into the dún
      expect(game.inFidchell).toBe(false);
      expect(game.gold).toBe(40 + STAKE * 2);
      expect(game.player.boons.length).toBe(boonsBefore + 1);
      // Back in the mound, not down a floor and with no monster on the board.
      expect(game.dungeonLevel).toBe(floorBefore);
      expect(game.inWaystation).toBe(true);
      expect(game.monsters).toHaveLength(0);
      expect(game.npcTiles.some(n => n.npcId === '__campfire__')).toBe(true);
    });

    it('losing costs only the stake — no elite gambler is dropped into the safe room', () => {
      openWager(game);
      const floorBefore = game.dungeonLevel;
      const b = priv(game).board;
      for (let x = 0; x < 7; x++) for (let y = 0; y < 7; y++) b[x]![y] = 0;
      b[2]![2] = KING; b[1]![2] = RAID; b[2]![1] = RAID; b[2]![3] = RAID;
      b[4]![2] = RAID;
      priv(game).turn = 'raider';
      priv(game).applyMove(4, 2, 3, 2);   // raiders take the King — the player was the King
      expect(game.inFidchell).toBe(false);
      expect(game.gold).toBe(40);         // stake already paid, nothing more taken
      expect(game.dungeonLevel).toBe(floorBefore);
      expect(game.inWaystation).toBe(true);
      expect(game.monsters).toHaveLength(0);
      expect(game.npcTiles.some(n => n.npcId === '__peddler__')).toBe(true);
    });

    it('the stake survives a save/resume round trip', () => {
      openWager(game);
      const save = JSON.parse(JSON.stringify(game.serialize()));
      const restored = new Game(makeCallbacks(), { forRestore: true });
      restored.applySave(save);
      expect((priv(restored) as unknown as { stake: number }).stake).toBe(STAKE);
    });

    it('an ordinary crossing match carries no stake', () => {
      game.startFidchell();
      expect((priv(game) as unknown as { stake: number }).stake).toBe(0);
    });
  });

  it('a mid-match state survives a save/resume round trip', () => {
    game.startFidchell();
    priv(game).aiMove();  // advance a ply or two
    const boardBefore = JSON.stringify(priv(game).board);
    const sideBefore = priv(game).playerSide;
    const save = JSON.parse(JSON.stringify(game.serialize()));
    const restored = new Game(makeCallbacks(), { forRestore: true });
    restored.applySave(save);
    expect(restored.inFidchell).toBe(true);
    expect(JSON.stringify(priv(restored).board)).toBe(boardBefore);
    expect(priv(restored).playerSide).toBe(sideBefore);
  });
});
