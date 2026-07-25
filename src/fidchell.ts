import { GameConfig } from './config';
import { Boon } from './content';
import type { Game } from './game';

type Side = 'king' | 'raider';
type Cell = { x: number; y: number };
type Move = { fx: number; fy: number; tx: number; ty: number };

/**
 * Fidchell — "the wooden wisdom." A self-contained brandub/tafl board challenge
 * that runs on a centred 7×7 carved out of the play grid, suspending the block
 * layer (see {@link Game.blockBuildingSuspended}). Owns all its own state and
 * reaches back into the host {@link Game} only for shared services (the map/grid
 * it clears, the callback stream, floor descent, and the reward it grants).
 *
 * Rules (brandub): every piece slides like a rook; only the King may stop on a
 * corner (the escape dún) or the throne; capture is custodial (flank an enemy
 * between two of your pieces, a corner/empty-throne counting as one side); the
 * King is "weak" — taken by ordinary flanking. King reaches a corner → King
 * side wins; King is taken → raiders win. See docs/fidchell.md.
 */
export class Fidchell {
  /** Whether a match is currently in progress. */
  active = false;
  /** Board cells (7×7, local coords): 0 empty, 1 King, 2 Defender, 3 Raider. */
  board: number[][] = [];
  /** Which side the player controls this match. */
  playerSide: Side = 'king';
  /** Whose turn it is (raiders move first, tafl-style). */
  turn: Side = 'raider';
  /** The tapped piece awaiting a destination, in local coords. */
  selected: Cell | null = null;
  /** Legal destinations for the selected piece (local coords). */
  legal: Cell[] = [];
  /** Top-left of the board in grid coords (centred on the play area). */
  origin = { x: 0, y: 0 };
  /** Set once the match is decided so no further moves land. */
  resolved = false;
  /** Total plies played (for the stalemate/repeat safety cap). */
  private plies = 0;
  /** Set at match start; the rules modal opens on the next safe tick (see {@link maybeShowRules}). */
  private rulesPending = false;

  static readonly N = 7;                 // board is 7×7 (brandub)
  static readonly EMPTY = 0;
  static readonly KING = 1;
  static readonly DEFENDER = 2;
  static readonly RAIDER = 3;
  private static readonly DIRS: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  private static readonly WIN = 1e6;
  private static readonly SEARCH_DEPTH = 3;

  constructor(private readonly game: Game) {}

  // ── Geometry ───────────────────────────────────────────────────────────
  /** Local (lx,ly) → grid coords. */
  toGrid(lx: number, ly: number): Cell { return { x: lx + this.origin.x, y: ly + this.origin.y }; }
  private inBounds(lx: number, ly: number): boolean { return lx >= 0 && lx < Fidchell.N && ly >= 0 && ly < Fidchell.N; }
  /** A board corner — the escape dún (King-only). */
  private isCorner(lx: number, ly: number): boolean { const n = Fidchell.N - 1; return (lx === 0 || lx === n) && (ly === 0 || ly === n); }
  /** The central throne (King-only). */
  private isThrone(lx: number, ly: number): boolean { const c = (Fidchell.N - 1) / 2; return lx === c && ly === c; }
  /** The side a piece code belongs to. */
  private sideOf(piece: number): Side | null {
    if (piece === Fidchell.KING || piece === Fidchell.DEFENDER) return 'king';
    if (piece === Fidchell.RAIDER) return 'raider';
    return null;
  }

  /**
   * Starts a match on entering a 7th floor. Deals the player a side at random.
   * Brandub opening on a centred 7×7 — King on the throne, four defenders in the
   * cross, eight raiders on the arms. Raiders move first.
   */
  start(): void {
    const g = this.game;
    this.active = true;
    this.resolved = false;
    this.plies = 0;
    this.selected = null;
    this.legal = [];
    this.playerSide = Math.random() < 0.5 ? 'king' : 'raider';
    this.turn = 'raider';
    g.map = g.emptyMap();
    g.colors = g.emptyColors();
    g.monsters = [];
    g.hazards = [];
    g.specialTiles = [];
    g.npcTiles = [];
    g.altarTiles = [];
    g.tattooTiles = [];
    g.blockMatrix = [];
    const n = Fidchell.N;
    this.origin = { x: Math.floor((GameConfig.COLS - n) / 2), y: Math.floor((GameConfig.ROWS - n) / 2) };
    this.board = Array.from({ length: n }, () => Array<number>(n).fill(Fidchell.EMPTY));
    const c = (n - 1) / 2;
    this.board[c]![c] = Fidchell.KING;
    for (const [dx, dy] of Fidchell.DIRS) this.board[c + dx]![c + dy] = Fidchell.DEFENDER;
    for (const [dx, dy] of Fidchell.DIRS) {
      this.board[c + dx * 2]![c + dy * 2] = Fidchell.RAIDER;
      this.board[c + dx * 3]![c + dy * 3] = Fidchell.RAIDER;
    }
    // No fog — the whole board is in view. The hero isn't a piece; you command
    // from outside, so it's hidden by the renderer during a match.
    for (let x = 0; x < GameConfig.COLS; x++) for (let y = 0; y < GameConfig.ROWS; y++) { g.visibility[x]![y] = true; g.explored[x]![y] = true; }
    const asKing = this.playerSide === 'king';
    g.cb.log(`Fidchell! A Fomorian gambler bars the crossing and sets the wooden wisdom. ${asKing ? 'You hold the High King — slip him to a corner dún to win free.' : 'You command the Fomorian raiders — surround the High King before he escapes.'}`, 'log-boss', 'ui_warning');
    g.cb.onToast?.(asKing ? 'FIDCHELL — get your King to a corner!' : 'FIDCHELL — trap the King!', 'ui_warning');
    g.cb.onAudio?.('bossWarn');
    this.rulesPending = true;  // rules modal opens on the next safe tick
    if (this.turn !== this.playerSide) this.aiMove();
    g.pushUI();
  }

  /**
   * Opens the "how to play" rules modal once, on the first tick where nothing
   * else is modal (so it never stacks on the descent dialog that entered this
   * floor). Driven from {@link Game.autoTick}.
   */
  maybeShowRules(): void {
    const g = this.game;
    if (!g.cb.onFloorEvent) { this.rulesPending = false; return; }  // headless/tests: nothing to show
    if (!this.active || !this.rulesPending || this.resolved || g.paused) return;
    this.rulesPending = false;
    const asKing = this.playerSide === 'king';
    g.paused = true;
    g.cb.onFloorEvent({
      id: '__fidchell_rules__',
      emoji: 'special_sacred',
      title: 'Fidchell — the Wooden Wisdom',
      flavor: `A Fomorian gambler bars the crossing and sets the wooden wisdom. You play the ${asKing ? 'HIGH KING — slip him to any corner dún to win free' : 'FOMORIAN RAIDERS — surround the High King before he escapes'}. Tap a piece, then a glowing square; every piece slides in a straight line like a rook. Trap an enemy between two of your own to take it. Win and the gambler yields the crossing with gold and a boon; lose and you take it the hard way.`,
      options: [{ label: asKing ? 'Play the King' : 'Play the raiders', desc: 'Begin the match.', apply: () => '' }],
    }, () => { g.paused = false; g.cb.onAction?.(); });
  }

  /** HUD payload for the sidebar panel (null when not in a match). */
  uiState(): { playerSide: Side; yourTurn: boolean; defenders: number; raiders: number } | null {
    if (!this.active) return null;
    return {
      playerSide: this.playerSide,
      yourTurn: this.turn === this.playerSide && !this.resolved,
      defenders: this.board.flat().filter(p => p === Fidchell.DEFENDER).length,
      raiders: this.board.flat().filter(p => p === Fidchell.RAIDER).length,
    };
  }

  // ── Move generation & rules ────────────────────────────────────────────
  /** Legal rook-slide destinations for the piece at local (lx,ly) on `board`. */
  legalMovesOn(board: number[][], lx: number, ly: number): Cell[] {
    const piece = board[lx]?.[ly] ?? Fidchell.EMPTY;
    if (piece === Fidchell.EMPTY) return [];
    const isKing = piece === Fidchell.KING;
    const out: Cell[] = [];
    for (const [dx, dy] of Fidchell.DIRS) {
      let nx = lx + dx, ny = ly + dy;
      while (this.inBounds(nx, ny) && board[nx]![ny] === Fidchell.EMPTY) {
        const corner = this.isCorner(nx, ny), throne = this.isThrone(nx, ny);
        if (corner && !isKing) break;                            // corners bar all but the King
        if (throne && !isKing) { nx += dx; ny += dy; continue; } // pass over the empty throne, never stop
        out.push({ x: nx, y: ny });
        nx += dx; ny += dy;
      }
    }
    return out;
  }

  /** Every legal move for a side on `board`. */
  private allMoves(board: number[][], side: Side): Move[] {
    const moves: Move[] = [];
    for (let x = 0; x < Fidchell.N; x++) for (let y = 0; y < Fidchell.N; y++) {
      if (this.sideOf(board[x]![y]!) !== side) continue;
      for (const d of this.legalMovesOn(board, x, y)) moves.push({ fx: x, fy: y, tx: d.x, ty: d.y });
    }
    return moves;
  }

  /** Custodial captures triggered by the piece that just moved to (mx,my). Mutates `board`, returns removed cells. */
  private capturesOn(board: number[][], mx: number, my: number): Cell[] {
    const side = this.sideOf(board[mx]![my]!);
    const removed: Cell[] = [];
    for (const [dx, dy] of Fidchell.DIRS) {
      const ax = mx + dx, ay = my + dy, bx = mx + 2 * dx, by = my + 2 * dy;
      if (!this.inBounds(ax, ay)) continue;
      const adj = board[ax]![ay]!;
      if (adj === Fidchell.EMPTY || this.sideOf(adj) === side) continue;  // a "weak" King is flanked like any soldier
      let anvil = false;
      if (this.inBounds(bx, by)) {
        const beyond = board[bx]![by]!;
        if (this.sideOf(beyond) === side) anvil = true;
        else if (beyond === Fidchell.EMPTY && (this.isCorner(bx, by) || this.isThrone(bx, by))) anvil = true;  // a hostile square is an anvil
      }
      if (anvil) { board[ax]![ay] = Fidchell.EMPTY; removed.push({ x: ax, y: ay }); }
    }
    return removed;
  }

  /** The King's location on `board`, or null. */
  private kingAt(board: number[][]): Cell | null {
    for (let x = 0; x < Fidchell.N; x++) for (let y = 0; y < Fidchell.N; y++) if (board[x]![y] === Fidchell.KING) return { x, y };
    return null;
  }

  /** With the weak-King rule, capture removes it during the move, so "captured" simply means the King is gone. */
  kingCaptured(board: number[][]): boolean {
    return this.kingAt(board) === null;
  }

  // ── Input ──────────────────────────────────────────────────────────────
  /** Handles a tap at grid (gx,gy): select one of your pieces, or move the selected one to a highlighted square. */
  handleTap(gx: number, gy: number): void {
    if (!this.active || this.resolved || this.game.paused || this.turn !== this.playerSide) return;
    const lx = gx - this.origin.x, ly = gy - this.origin.y;
    if (!this.inBounds(lx, ly)) { this.selected = null; this.legal = []; this.game.pushUI(); return; }
    if (this.selected && this.legal.some(d => d.x === lx && d.y === ly)) {
      this.applyMove(this.selected.x, this.selected.y, lx, ly);
      return;
    }
    if (this.sideOf(this.board[lx]![ly]!) === this.playerSide) {
      this.selected = { x: lx, y: ly };
      this.legal = this.legalMovesOn(this.board, lx, ly);
      this.game.cb.onAudio?.('blockMove');
    } else {
      this.selected = null; this.legal = [];
    }
    this.game.pushUI();
  }

  /** Applies a move on the live board, resolves captures, checks the result, then hands the turn on (to the AI or back to you). */
  private applyMove(fx: number, fy: number, tx: number, ty: number): void {
    if (this.resolved) return;
    const g = this.game;
    const piece = this.board[fx]![fy]!;
    const side = this.sideOf(piece)!;
    this.board[fx]![fy] = Fidchell.EMPTY;
    this.board[tx]![ty] = piece;
    this.selected = null; this.legal = [];
    this.plies++;
    g.cb.onAudio?.('blockLand');
    const removed = this.capturesOn(this.board, tx, ty);
    for (const r of removed) { const gr = this.toGrid(r.x, r.y); g.cb.onParticleBurst?.(gr.x, gr.y, 8, side === 'king' ? '#69f0ae' : '#c1443c', 'fx_impact'); }
    if (removed.length > 0) g.cb.onAudio?.('hit');
    const dst = this.toGrid(tx, ty);
    g.cb.onRingPulse?.(dst.x, dst.y, side === 'king' ? '105,240,174' : '193,68,59');
    if (piece === Fidchell.KING && this.isCorner(tx, ty)) { this.finish('king'); return; }
    if (side === 'raider' && this.kingCaptured(this.board)) { this.finish('raider'); return; }
    this.turn = side === 'king' ? 'raider' : 'king';
    if (this.plies > 120) { this.finish(this.playerSide === 'king' ? 'raider' : 'king'); return; }  // anti-shuffle cap → player loses the stall
    g.pushUI();
    if (this.turn !== this.playerSide) this.aiMove();
    else if (this.allMoves(this.board, this.playerSide).length === 0) this.finish(this.playerSide === 'king' ? 'raider' : 'king');  // stalemated → you lose
  }

  // ── AI (alpha-beta) ────────────────────────────────────────────────────
  /** Applies a move to a cloned board (with captures) — for search. */
  private boardAfter(board: number[][], m: Move): number[][] {
    const nb = board.map(col => col.slice());
    nb[m.tx]![m.ty] = nb[m.fx]![m.fy]!;
    nb[m.fx]![m.fy] = Fidchell.EMPTY;
    this.capturesOn(nb, m.tx, m.ty);
    return nb;
  }

  /** Negamax with alpha-beta. Value of `board` for `side` to move, `depth` plies deep. */
  private search(board: number[][], side: Side, depth: number, alpha: number, beta: number): number {
    const k = this.kingAt(board);
    if (!k || this.kingCaptured(board)) return (side === 'raider' ? Fidchell.WIN : -Fidchell.WIN) - depth;  // sooner is better
    if (this.isCorner(k.x, k.y)) return (side === 'king' ? Fidchell.WIN : -Fidchell.WIN) - depth;
    if (depth === 0) return this.evaluate(board, side);
    const moves = this.allMoves(board, side);
    if (moves.length === 0) return -Fidchell.WIN + depth;  // no move = you lose
    let best = -Infinity;
    for (const m of moves) {
      const score = -this.search(this.boardAfter(board, m), side === 'king' ? 'raider' : 'king', depth - 1, -beta, -alpha);
      if (score > best) best = score;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;  // cutoff
    }
    return best;
  }

  /** The AI takes one move for whichever side it controls, via a shallow alpha-beta search so it plays both roles competently. */
  private aiMove(): void {
    if (this.resolved) return;
    const side = this.turn;
    const moves = this.allMoves(this.board, side);
    if (moves.length === 0) { this.finish(side === 'king' ? 'raider' : 'king'); return; }
    let best = moves[0]!, bestScore = -Infinity;
    for (const m of moves) {
      const score = -this.search(this.boardAfter(this.board, m), side === 'king' ? 'raider' : 'king', Fidchell.SEARCH_DEPTH - 1, -Infinity, Infinity) + Math.random() * 0.25;
      if (score > bestScore) { bestScore = score; best = m; }
    }
    this.applyMove(best.fx, best.fy, best.tx, best.ty);
  }

  /** Positional score of `board` from `side`'s perspective (higher = better). Symmetric: raider score negates the King-side score. */
  private evaluate(board: number[][], side: Side): number {
    const k = this.kingAt(board);
    if (!k) return side === 'raider' ? 100000 : -100000;
    if (this.isCorner(k.x, k.y)) return side === 'king' ? 100000 : -100000;
    if (this.kingCaptured(board)) return side === 'raider' ? 100000 : -100000;
    let defenders = 0, raiders = 0;
    for (let x = 0; x < Fidchell.N; x++) for (let y = 0; y < Fidchell.N; y++) {
      if (board[x]![y] === Fidchell.DEFENDER) defenders++;
      else if (board[x]![y] === Fidchell.RAIDER) raiders++;
    }
    const n = Fidchell.N - 1;
    const distToCorner = Math.min(k.x + k.y, (n - k.x) + k.y, k.x + (n - k.y), (n - k.x) + (n - k.y));
    const kingMobility = this.legalMovesOn(board, k.x, k.y).length;
    let raiderAdj = 0;
    for (const [dx, dy] of Fidchell.DIRS) { const nx = k.x + dx, ny = k.y + dy; if (this.inBounds(nx, ny) && board[nx]![ny] === Fidchell.RAIDER) raiderAdj++; }
    // Good-for-King: closer to a corner, more escape mobility, more defenders, fewer raiders pressing the King.
    const kingScore = defenders * 9 - raiders * 4 + (2 * n - distToCorner) * 5 + kingMobility * 3 - raiderAdj * 8;
    return side === 'king' ? kingScore : -kingScore;
  }

  // ── Resolution ─────────────────────────────────────────────────────────
  /** Ends the match: whichever side met its goal. Player win → shortcut + prize; loss → fight the floor. */
  private finish(winnerSide: Side): void {
    if (this.resolved) return;
    this.resolved = true;
    this.selected = null; this.legal = [];
    this.game.pushUI();
    if (winnerSide === this.playerSide) this.win(); else this.lose();
  }

  /** Player won the board: a prize and a shortcut straight past this floor. */
  private win(): void {
    const g = this.game;
    const gold = 150 + g.dungeonLevel * 30;
    g.gold += gold;
    const pool = Boon.BY_TIER[g.dungeonLevel >= 14 ? 3 : 2];
    const boon = pool[Math.floor(Math.random() * pool.length)]!;
    g.player.addBoon(boon);
    g.cb.log(`You take the wooden wisdom! The gambler yields the crossing — ${gold} gold and a boon: ${boon.name}. The way on opens.`, 'log-perk', boon.char);
    g.cb.onToast?.('You win at fidchell — passage granted!', 'special_sacred');
    const mid = this.toGrid(3, 3);
    g.cb.onParticleBurst?.(mid.x, mid.y, 18, '#d9a441', 'item_trophy');
    g.cb.onImpactGlow?.(mid.x, mid.y, '217,164,65', 24);
    g.cb.onAudio?.('bountyFulfilled');
    g.storyBeats.push('bested a Fomorian at fidchell');
    this.active = false;
    g.descendFloor();  // skip this floor's grind — the reward for winning
  }

  /** Player lost the board: no shortcut. The floor is rebuilt and the gambler drops onto it as an elite. */
  private lose(): void {
    const g = this.game;
    g.cb.log('The gambler sweeps the pieces aside with a laugh — no free passage. Take the crossing the hard way.', 'log-boss', 'ui_warning');
    g.cb.onToast?.('You lost at fidchell — fight through!', 'ui_warning');
    g.cb.onAudio?.('bossWarn');
    this.active = false;
    g.resetDungeonState();  // build the real floor underneath
    g.spawnMonster('berserker_orc', 4, 2, true, 'Fomorian Gambler');
    g.pushUI();
  }

  // ── Save / resume ──────────────────────────────────────────────────────
  /** Snapshot of the match's pure-data state (no live references). */
  serialize(): Record<string, unknown> {
    return { active: this.active, board: this.board, playerSide: this.playerSide, turn: this.turn, origin: this.origin, resolved: this.resolved, plies: this.plies };
  }

  /** Restore from a snapshot (tolerates a missing/legacy value — a mid-match fidchell save is rare and transient). */
  restore(s: Record<string, unknown> | undefined): void {
    this.selected = null; this.legal = [];
    if (!s) { this.active = false; return; }
    this.active = s['active'] as boolean;
    this.board = s['board'] as number[][];
    this.playerSide = s['playerSide'] as Side;
    this.turn = s['turn'] as Side;
    this.origin = s['origin'] as { x: number; y: number };
    this.resolved = s['resolved'] as boolean;
    this.plies = s['plies'] as number;
  }
}
