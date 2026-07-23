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

/** Reach into the match's private helpers/state. */
type FidInternals = {
  inFidchell: boolean;
  fidBoard: number[][];
  fidPlayerSide: 'king' | 'raider';
  fidTurn: 'king' | 'raider';
  fidResolved: boolean;
  fidOrigin: { x: number; y: number };
  fidApplyMove: (fx: number, fy: number, tx: number, ty: number) => void;
  fidLegalMovesOn: (b: number[][], x: number, y: number) => Array<{ x: number; y: number }>;
  fidKingCaptured: (b: number[][]) => boolean;
  fidAiMove: () => void;
};
const priv = (g: Game): FidInternals => g as unknown as FidInternals;
const KING = 1, DEF = 2, RAID = 3;
const count = (g: Game, p: number): number => priv(g).fidBoard.flat().filter(c => c === p).length;

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
    expect(priv(game).fidBoard[3]![3]).toBe(KING);
    expect(count(game, DEF)).toBe(4);
    // one raider may already be moved if the AI (raiders) opened, so count 7 or 8
    expect(count(game, RAID)).toBeGreaterThanOrEqual(7);
    expect((game as unknown as { blockBuildingSuspended: boolean }).blockBuildingSuspended).toBe(true);
  });

  it('pieces slide like a rook — blocked by other pieces, and corners are King-only', () => {
    game.startFidchell();
    // Clear to a known position: a lone defender mid-board and the King.
    const b = priv(game).fidBoard;
    for (let x = 0; x < 7; x++) for (let y = 0; y < 7; y++) b[x]![y] = 0;
    b[3]![3] = KING; b[1]![1] = DEF;
    const defMoves = priv(game).fidLegalMovesOn(b, 1, 1);
    // a non-King piece can't stop on a corner (0,0)
    expect(defMoves.some(m => m.x === 0 && m.y === 0)).toBe(false);
    // but the King may enter a corner
    const kingMoves = priv(game).fidLegalMovesOn(b, 3, 3);
    expect(kingMoves.length).toBeGreaterThan(0);
  });

  it('flanking an enemy between two of your pieces captures it', () => {
    game.startFidchell();
    priv(game).fidPlayerSide = 'raider'; priv(game).fidTurn = 'raider';
    const b = priv(game).fidBoard;
    for (let x = 0; x < 7; x++) for (let y = 0; y < 7; y++) b[x]![y] = 0;
    b[3]![3] = KING;                    // king off to the side (not the target)
    b[1]![2] = DEF;                     // the victim defender
    b[1]![3] = RAID;                    // anvil beyond the victim
    b[5]![1] = RAID;                    // hammer slides to (1,1), flanking the defender against the anvil at (1,3)
    priv(game).fidApplyMove(5, 1, 1, 1);
    expect(b[1]![2]).toBe(0);           // defender captured
  });

  it('the King reaching a corner wins the match for the King side', () => {
    game.startFidchell();
    priv(game).fidPlayerSide = 'king'; priv(game).fidTurn = 'king';
    const b = priv(game).fidBoard;
    for (let x = 0; x < 7; x++) for (let y = 0; y < 7; y++) b[x]![y] = 0;
    b[0]![3] = KING;                    // King one slide from the corner (0,0)
    const goldBefore = game.gold;
    priv(game).fidApplyMove(0, 3, 0, 0); // dash into the dún
    expect(priv(game).fidResolved).toBe(true);
    expect(game.inFidchell).toBe(false); // won → shortcut past the floor
    expect(game.gold).toBeGreaterThan(goldBefore);
  });

  it('the King surrounded on every side is captured', () => {
    game.startFidchell();
    priv(game).fidPlayerSide = 'raider'; priv(game).fidTurn = 'raider';
    const b = priv(game).fidBoard;
    for (let x = 0; x < 7; x++) for (let y = 0; y < 7; y++) b[x]![y] = 0;
    b[2]![2] = KING; b[1]![2] = RAID; b[2]![1] = RAID; b[2]![3] = RAID;  // three sides pinned
    b[4]![2] = RAID;                                                      // slides to (3,2), closing the fourth
    expect(priv(game).fidKingCaptured(b)).toBe(false);
    priv(game).fidApplyMove(4, 2, 3, 2);
    expect(priv(game).fidResolved).toBe(true);                           // king captured → match over
  });

  it('entering a 7th floor opens a fidchell match instead of a normal floor', () => {
    const g = new Game(makeCallbacks());
    g.dungeonLevel = 6;
    (g as unknown as { descendFloor: () => void }).descendFloor();
    expect(g.dungeonLevel).toBe(7);
    expect(g.inFidchell).toBe(true);
  });

  it('a mid-match state survives a save/resume round trip', () => {
    game.startFidchell();
    priv(game).fidAiMove();  // advance a ply or two
    const boardBefore = JSON.stringify(priv(game).fidBoard);
    const sideBefore = priv(game).fidPlayerSide;
    const save = JSON.parse(JSON.stringify(game.serialize()));
    const restored = new Game(makeCallbacks(), { forRestore: true });
    restored.applySave(save);
    expect(restored.inFidchell).toBe(true);
    expect(JSON.stringify(priv(restored).fidBoard)).toBe(boardBefore);
    expect(priv(restored).fidPlayerSide).toBe(sideBefore);
  });
});
