import { GameConfig, SHAPES } from './config';
import { Tile, Cell, type CellValue } from './types';
import { Monster } from './entities';
import { Boon } from './content';
import { Balance } from './balance';
import { GameMath } from './gameMath';
import type { UIState } from './types';
import type { Game } from './game';

/**
 * The Causeway Duel — a boss-floor set piece. A no-gravity, turn-based duel on
 * the shared grid: the player grows a causeway up from their home row (placing
 * tetromino "stones" that must connect to their own ground) while the boss
 * grows one down toward the shore. Climb yours to cut the boss down (the duel
 * then ends and the delve-or-rest choice opens); lose if the boss's causeway
 * reaches the home row. Self-contained in this module (mirrors {@link Fidchell});
 * it owns all its own duel state and reaches back into the host {@link Game}
 * only for shared services (the grid it clears, the falling-piece cursor it
 * borrows, the callback stream, boss spawn/scaling, and floor descent).
 * See docs/causeway-duel.md.
 */
export class CausewayDuel {
  /** Whether a duel is currently in progress (mirrored by {@link Game.inCausewayDuel}). */
  active = false;
  /** Tile ownership during a duel: 0 unclaimed, 1 player, 2 boss, plus the obstacle codes below. */
  owner: number[][] = [];
  /** The boss entity for the active duel. A live ref — re-linked by SaveGame on restore, not serialized here. */
  boss: Monster | null = null;
  /** The hero's home tile (the shore). The bridge "lands" — and the run is lost — when a boss tile reaches it. */
  private home = { x: 0, y: 0 };
  /** Set once the duel has been decided, so late inputs can't re-trigger win/loss. */
  resolved = false;
  /** Switch-islands: routing the player's causeway to one flips it; all lit opens the center wall. */
  switches: Array<{ x: number; y: number; lit: boolean }> = [];
  /** Center-wall tiles that block the two halves from connecting until every switch is lit. */
  wall: Array<{ x: number; y: number }> = [];
  /** Off-the-line reward islands — routing the player's causeway onto one grants its boon. */
  boons: Array<{ x: number; y: number; kind: 'geis' | 'gold' | 'heal'; taken: boolean }> = [];
  /** Turns elapsed in the current duel (player placements). */
  private turns = 0;
  /** One-time flag so the "bridge nears your shore" warning fires only once. */
  private nearShoreWarned = false;
  /** Set when the duel is won but the delve-or-rest choice waits for another modal (e.g. a level-up boon pick) to close first. */
  private descentPending = false;

  private static readonly PLAYER_COLOR = '#2f5c8a';
  private static readonly BOSS_COLOR = '#5c2530';
  private static readonly WALL_COLOR = '#3a3550';
  private static readonly SWITCH_COLOR = '#2a4a44';
  private static readonly BOON_COLOR = '#3a2e10';
  // Duel obstacle owner codes (in `owner`, all non-zero so they block builds).
  static readonly WALL = 3;
  static readonly SWITCH = 4;
  static readonly BOON = 5;

  constructor(private readonly game: Game) {}

  // ── Geometry / claiming ──────────────────────────────────────────────────

  /** The board cells occupied by `matrix` placed at `(bx, by)`, clamped to the grid. */
  private pieceCells(matrix: CellValue[][], bx: number, by: number): Array<{ x: number; y: number }> {
    const cells: Array<{ x: number; y: number }> = [];
    for (let r = 0; r < matrix.length; r++) {
      for (let c = 0; c < matrix[r]!.length; c++) {
        if (matrix[r]![c] === Cell.EMPTY) continue;
        const x = bx + c, y = by + r;
        if (x >= 0 && x < GameConfig.COLS && y >= 0 && y < GameConfig.ROWS) cells.push({ x, y });
      }
    }
    return cells;
  }

  /** Whether any of `cells` is orthogonally adjacent to a tile owned by `owner` (1 = player, 2 = boss). */
  private cellsTouch(cells: Array<{ x: number; y: number }>, owner: number): boolean {
    return cells.some(({ x, y }) =>
      [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].some(([nx, ny]) =>
        nx! >= 0 && nx! < GameConfig.COLS && ny! >= 0 && ny! < GameConfig.ROWS && this.owner[nx!]![ny!] === owner),
    );
  }

  /** Claims `cells` for `owner`, laying them as walkable causeway tiles in the given color. */
  claim(cells: Array<{ x: number; y: number }>, owner: number, color: string): void {
    const g = this.game;
    for (const { x, y } of cells) {
      this.owner[x]![y] = owner;
      g.map[x]![y] = Tile.FLOOR;
      g.colors[x]![y] = color;
    }
  }

  /**
   * Lays the mid-field furniture for a duel: a sealed center wall the boss
   * can't cross, two switch-islands the player must route their causeway to
   * (lighting both opens the wall), and two boon-islands above the wall worth
   * a detour. Scales lightly with depth but is deliberately fixed-shape so the
   * puzzle reads clearly.
   */
  private setupObstacles(): void {
    const g = this.game;
    const wallY = Math.floor(GameConfig.ROWS * 0.55);  // ~row 13
    for (let x = 0; x < GameConfig.COLS; x++) {
      this.owner[x]![wallY] = CausewayDuel.WALL;
      g.map[x]![wallY] = Tile.FLOOR;
      g.colors[x]![wallY] = CausewayDuel.WALL_COLOR;
      this.wall.push({ x, y: wallY });
    }
    // Switch-islands sit just below the wall, off to either side — reaching
    // them means routing the causeway laterally, not just straight up.
    for (const sx of [1, GameConfig.COLS - 2]) {
      const sy = wallY + 2;
      this.owner[sx]![sy] = CausewayDuel.SWITCH;
      g.map[sx]![sy] = Tile.FLOOR;
      g.colors[sx]![sy] = CausewayDuel.SWITCH_COLOR;
      this.switches.push({ x: sx, y: sy, lit: false });
    }
    // Boon-islands hang above the wall — a detour on the climb to the boss.
    const boonKinds: Array<'geis' | 'gold' | 'heal'> = ['geis', 'heal'];
    [1, GameConfig.COLS - 2].forEach((bx, i) => {
      const by = wallY - 3;
      this.owner[bx]![by] = CausewayDuel.BOON;
      g.map[bx]![by] = Tile.FLOOR;
      g.colors[bx]![by] = CausewayDuel.BOON_COLOR;
      this.boons.push({ x: bx, y: by, kind: boonKinds[i % boonKinds.length]!, taken: false });
    });
  }

  /**
   * The hero stepped onto an unlit ogham switch: light it, claim it as walkable
   * player ground, and open the wall once every switch is lit. Switches follow
   * the game's established "activate on step" verb (like braziers/altars) — you
   * build your causeway up to one, then walk your hero onto it.
   */
  lightSwitch(sw: { x: number; y: number; lit: boolean }): void {
    const g = this.game;
    sw.lit = true;
    this.claim([{ x: sw.x, y: sw.y }], 1, '#3fb0a2');  // lit switch becomes walkable player ground
    g.cb.log('An ogham switch flares underfoot — the wards on the wall weaken.', 'log-perk', 'fx_arcane');
    g.cb.onRingPulse?.(sw.x, sw.y, '63,176,162');
    g.cb.onParticleBurst?.(sw.x, sw.y, 8, '#3fb0a2', 'fx_arcane');
    g.cb.onAudio?.('pactSworn');
    if (this.wall.length > 0 && this.switches.every(s => s.lit)) this.openWall();
  }

  /**
   * The hero stepped onto a boon-island: grant its reward and claim it as
   * walkable player ground. Boons sit on the enemy side of the wall, so
   * reaching one means opening the wall and venturing into contested territory.
   */
  takeBoon(boon: { x: number; y: number; kind: 'geis' | 'gold' | 'heal'; taken: boolean }): void {
    boon.taken = true;
    this.claim([{ x: boon.x, y: boon.y }], 1, CausewayDuel.PLAYER_COLOR);
    this.grantBoon(boon.kind, boon.x, boon.y);
  }

  /** Opens the sealed center wall once every switch is lit. */
  private openWall(): void {
    const g = this.game;
    for (const w of this.wall) {
      this.owner[w.x]![w.y] = 0;
      g.map[w.x]![w.y] = Tile.VOID;
      g.colors[w.x]![w.y] = null;
    }
    this.wall = [];
    g.cb.log('The center wall grinds open — the way to the enemy causeway is clear!', 'log-boss', 'special_sacred');
    g.cb.onToast?.('The wall opens — climb to the bridge and break it!', 'special_sacred');
    g.cb.onAudio?.('bossWarn');
  }

  /** Grants a reached boon-island's reward inline (no modal — the duel keeps flowing). */
  private grantBoon(kind: 'geis' | 'gold' | 'heal', x: number, y: number): void {
    const g = this.game;
    if (kind === 'gold') {
      const gold = 200 + g.dungeonLevel * 40;
      g.gold += gold;
      g.cb.log(`A cache on the causeway — ${gold} gold!`, 'log-perk', 'item_gold_pouch');
      g.cb.onParticleBurst?.(x, y, 8, '#d9a441', 'item_gold_pouch');
    } else if (kind === 'heal') {
      const healed = g.player.heal(Math.round(g.player.maxHp * 0.4));
      g.cb.log(`A well-spring on the causeway — +${healed} HP.`, 'log-success', 'special_sacred');
      g.cb.onParticleBurst?.(x, y, 8, '#69f0ae');
    } else {
      const pool = Boon.BY_TIER[g.dungeonLevel >= 10 ? 3 : 2];
      const boon = pool[Math.floor(Math.random() * pool.length)]!;
      g.player.addBoon(boon);
      g.cb.log(`A Geis-stone stands on the causeway — you gain ${boon.name}!`, 'log-perk', boon.char);
      g.cb.onParticleBurst?.(x, y, 10, '#b98fc4', boon.char);
    }
    g.cb.onRingPulse?.(x, y, '217,164,65');
    g.cb.onAudio?.('comboMilestone', 2);
  }

  // ── Setup ──────────────────────────────────────────────────────────────

  /**
   * Starts a Causeway Duel: clears the board, seeds the player's home tile at
   * the bottom and the boss's at the top, spawns the boss, and deals the
   * first piece. Reachable on a boss floor (and, for now, a debug entry).
   */
  start(): void {
    const g = this.game;
    this.active = true;
    this.resolved = false;
    g.map = g.emptyMap();
    g.colors = g.emptyColors();
    g.monsters = [];
    g.hazards = [];
    g.specialTiles = [];
    g.npcTiles = [];
    g.altarTiles = [];
    g.tattooTiles = [];
    this.owner = Array.from({ length: GameConfig.COLS }, () => Array<number>(GameConfig.ROWS).fill(0));
    this.switches = [];
    this.wall = [];
    this.boons = [];
    this.turns = 0;
    this.nearShoreWarned = false;

    const midX = Math.floor(GameConfig.COLS / 2);
    const homeY = GameConfig.ROWS - 1, topY = 0;
    // Player home tile (bottom, the shore) and the hero on it.
    this.claim([{ x: midX, y: homeY }], 1, CausewayDuel.PLAYER_COLOR);
    this.home = { x: midX, y: homeY };
    g.player.x = midX; g.player.y = homeY;
    // Boss home base (top) — a 3-wide root so its tetromino bridge reads as a
    // broad landing being built out, not a thread. The boss stands on the centre.
    this.claim([{ x: midX - 1, y: topY }, { x: midX, y: topY }, { x: midX + 1, y: topY }], 2, CausewayDuel.BOSS_COLOR);
    const bossDef = g.previewBossForFloor(g.dungeonLevel);
    const diff = g.difficultyTuning();
    const baseHp = Balance.CONFIG.boss.baseHpFloor1 + (g.dungeonLevel - 1) * Balance.CONFIG.boss.baseHpPerDungeonLevel;
    const baseAtk = Balance.CONFIG.boss.baseAtkFloor1 + (g.dungeonLevel - 1) * Balance.CONFIG.boss.baseAtkPerDungeonLevel;
    const boss = new Monster(midX, topY, bossDef.char, bossDef.name,
      Math.floor(baseHp * bossDef.hpMult * diff.monsterHpMult),
      Math.floor(baseHp * bossDef.hpMult * diff.monsterHpMult),
      Math.floor(baseAtk * bossDef.atkMult * diff.monsterAtkMult * g.heatMult('monsterAtkMult')),
      bossDef.xpReward, true);
    boss.combatLevel = Balance.CONFIG.boss.combatLevel;
    this.boss = boss;
    g.monsters.push(boss);
    // The duel owns the boss outright — biome half-HP/death hooks (some of
    // which pause for a cinematic or spawn adds) would fight the duel flow.
    g.activeBossOnHalfHp = null;
    g.activeBossOnDeath = null;  // win() handles the death path
    g.bossHalfHpTriggered = true;

    // No fog in a duel — the whole causeway is in view.
    for (let x = 0; x < GameConfig.COLS; x++) {
      for (let y = 0; y < GameConfig.ROWS; y++) { g.visibility[x]![y] = true; g.explored[x]![y] = true; }
    }
    this.setupObstacles();
    g.currentType = g.randomShapeKey();
    g.nextType = g.randomShapeKey();
    this.dealPiece();
    g.cb.log(`${bossDef.name} raises a causeway from the dark — build yours to meet it, and cut them down before the bridge lands!`, 'log-boss', 'ui_warning');
    g.cb.onToast?.('CAUSEWAY DUEL — build up, break through, before the bridge reaches you!', 'ui_warning');
    g.cb.onAudio?.('bossWarn');
    g.pushUI();
  }

  // ── Player piece cursor ──────────────────────────────────────────────────

  /** Deals the next placement piece as a free-floating cursor at the top-centre. */
  private dealPiece(): void {
    const g = this.game;
    g.currentType = g.nextType;
    g.nextType = g.randomShapeKey();
    const shape = SHAPES[g.currentType];
    g.blockColor = CausewayDuel.PLAYER_COLOR;
    g.currentCursed = false;
    g.currentBlessed = false;
    g.blockMatrix = shape.matrix.map(row => row.map((cell): CellValue => cell === 0 ? Cell.EMPTY : Cell.FLOOR));
    // Deal the stone at the top of the player's OWN causeway (their build
    // frontier), not the top of the board — the cursor lives on your side,
    // exactly where it will land, instead of floating in the boss's territory.
    const w = g.blockMatrix[0]!.length;
    g.blockX = Math.max(0, Math.min(this.playerPeakColumn() - Math.floor(w / 2), GameConfig.COLS - w));
    this.snapPiece();
  }

  /** The column carrying the player's highest (build-frontier) causeway tile — the home column until they've built. */
  private playerPeakColumn(): number {
    let bestX = this.home.x, bestY = GameConfig.ROWS;
    for (let x = 0; x < GameConfig.COLS; x++) {
      for (let y = 0; y < GameConfig.ROWS; y++) {
        if (this.owner[x]![y] === 1 && y < bestY) { bestY = y; bestX = x; }
      }
    }
    return bestX;
  }

  /** Snaps the cursor's row to where it would land — so the piece you steer is always shown resting on your causeway. */
  private snapPiece(): void {
    this.game.blockY = Math.max(0, this.landingY());
  }

  /** Moves the cursor piece one column (kept fully on the board), re-snapping it onto the causeway. */
  steerPiece(dir: number): void {
    const g = this.game;
    if (this.resolved) return;
    const nx = g.blockX + dir;
    const cells = this.pieceCells(g.blockMatrix, nx, g.blockY);
    if (cells.length === this.pieceCellCount() && cells.every(c => c.x >= 0 && c.x < GameConfig.COLS)) {
      g.blockX = nx;
      this.snapPiece();
      g.cb.onAudio?.('blockMove');
      g.pushUI();
    }
  }

  /** Rotates the cursor piece, nudging it back on-board if the rotation pushed it off an edge, then re-snapping. */
  rotatePiece(): void {
    const g = this.game;
    if (this.resolved) return;
    const rotated = GameMath.rotateMatrix(g.blockMatrix);
    const width = rotated[0]!.length;
    g.blockX = Math.max(0, Math.min(g.blockX, GameConfig.COLS - width));
    g.blockMatrix = rotated;
    this.snapPiece();
    g.cb.onAudio?.('blockRotate');
    g.pushUI();
  }

  /** Total filled cells in the current piece (used to detect off-board clipping while steering). */
  private pieceCellCount(): number {
    let n = 0;
    for (const row of this.game.blockMatrix) for (const c of row) if (c !== Cell.EMPTY) n++;
    return n;
  }

  /**
   * The row offset at which the cursor piece rests when placed: it climbs to
   * sit directly on top of the tallest player-owned column it spans (so the
   * causeway grows *upward* toward the boss rather than pooling at the floor).
   * Columns with no player support fall through to the board floor, which the
   * connectivity check then rejects unless a neighbour bridges them in.
   */
  private landingY(): number {
    const matrix = this.game.blockMatrix, bx = this.game.blockX;
    const colBottom = new Map<number, number>();  // piece column → its lowest filled local row
    for (let r = 0; r < matrix.length; r++) {
      for (let c = 0; c < matrix[r]!.length; c++) {
        if (matrix[r]![c] !== Cell.EMPTY) colBottom.set(c, Math.max(colBottom.get(c) ?? -1, r));
      }
    }
    let by = Infinity;  // rest on the FIRST support hit descending = the tallest = smallest offset
    for (const [c, lb] of colBottom) {
      const boardCol = bx + c;
      if (boardCol < 0 || boardCol >= GameConfig.COLS) continue;
      let frontierY = GameConfig.ROWS;  // no player tile in this column → the board floor
      for (let y = 0; y < GameConfig.ROWS; y++) { if (this.owner[boardCol]![y] === 1) { frontierY = y; break; } }
      by = Math.min(by, frontierY - 1 - lb);
    }
    return Number.isFinite(by) ? by : 0;
  }

  /**
   * Places the cursor piece: it climbs to rest on top of the player's causeway
   * (see {@link landingY}), and the placement only takes if it connects to
   * the player's own tiles and stays on-board without overlapping. A valid
   * placement claims the tiles and hands the turn to the boss.
   */
  placePiece(): void {
    const g = this.game;
    if (this.resolved) return;
    const by = this.landingY();
    const cells = this.pieceCells(g.blockMatrix, g.blockX, by);
    const reject = (): void => {
      g.cb.log('The stone will not hold there — build out from your own causeway.', 'log-neutral', 'ui_warning');
      g.cb.onToast?.('Place it touching your own causeway.', 'ui_warning');
    };
    if (cells.length === 0) return;
    // In-bounds (a rotation near the ceiling can push it off the top) and no overlap.
    if (cells.some(c => c.y < 0) || cells.some(c => this.owner[c.x]![c.y] !== 0)) { reject(); return; }
    if (!this.cellsTouch(cells, 1)) { reject(); return; }
    this.claim(cells, 1, CausewayDuel.PLAYER_COLOR);
    this.turns++;
    g.cb.onBlockLand?.(cells);
    g.cb.onAudio?.('blockLand');
    this.dealPiece();
    this.bossTurn();
    g.updateVisibility();
    g.pushUI();
    g.cb.onAction();
  }

  // ── Boss AI ──────────────────────────────────────────────────────────────

  /** The deepest (largest-y) row the boss's causeway has reached, for the HUD threat meter. */
  private bossDeepestRow(): number {
    let deepest = 0;
    for (let x = 0; x < GameConfig.COLS; x++) {
      for (let y = GameConfig.ROWS - 1; y >= 0; y--) {
        if (this.owner[x]?.[y] === 2) { if (y > deepest) deepest = y; break; }
      }
    }
    return deepest;
  }

  /** Whether `(x, y)` is the home tile or orthogonally abutting it — the shore the bridge lands on. */
  private atShore(x: number, y: number): boolean {
    return y >= GameConfig.ROWS - 1
      || (Math.abs(x - this.home.x) + Math.abs(y - this.home.y)) === 1;
  }

  /**
   * The lane the boss steers its bridge toward: the column that reaches the
   * shore with the least resistance — fewest player tiles blocking the way
   * down and nearest the home. So if the hero walls off the centre, the boss
   * routes around toward an open flank instead of butting against the wall.
   */
  bossLaneColumn(): number {
    let bestX = this.home.x, bestCost = Infinity;
    for (let x = 0; x < GameConfig.COLS; x++) {
      let blockers = 0;
      for (let y = 0; y < GameConfig.ROWS; y++) if (this.owner[x]![y] === 1) blockers++;
      const cost = blockers * 3 + Math.abs(x - this.home.x);
      if (cost < bestCost) { bestCost = cost; bestX = x; }
    }
    return bestX;
  }

  /**
   * The boss's placement turn: it is dealt a random tetromino (exactly like the
   * hero) and drops it as a connected extension of its own causeway, biased to
   * reach as deep as possible toward the open shore lane. The boss pawn walks to
   * the new leading edge — reaching the shore lands the bridge and loses the run.
   * Because the boss builds in tetromino chunks rather than flooding the board,
   * it leaves flanking columns open for the hero to climb (e.g. to the boons).
   */
  bossTurn(): void {
    const g = this.game;
    if (this.resolved || !this.boss) return;
    const laneX = this.bossLaneColumn();  // the open lane to the shore
    const shapeKey = g.randomShapeKey();
    const frontier = this.bossDeepestRow();  // the boss's current leading row
    // How broad the bridge is near its leading edge. When it has narrowed to a
    // thread the boss widens before pushing on, so the causeway advances as a
    // chunky mass of tetrominoes rather than a single-file column.
    let edgeWidth = 0;
    for (let x = 0; x < GameConfig.COLS; x++) {
      for (let y = frontier - 1; y <= frontier; y++) if (y >= 0 && this.owner[x]![y] === 2) { edgeWidth++; break; }
    }
    const wantWiden = edgeWidth < 3;
    // Search every rotation × board position for the best legal placement: it
    // must connect to boss territory and not overlap anything. Scoring rewards
    // making at least one row of downward progress, then hugging the target lane
    // and building a chunky, varied bridge — so it reads as tetromino blocks
    // being laid, not a thin line racing straight for the shore.
    let best: { cells: Array<{ x: number; y: number }>; score: number } | null = null;
    let matrix: CellValue[][] = SHAPES[shapeKey].matrix.map(row => row.map((cell): CellValue => cell === 0 ? Cell.EMPTY : Cell.FLOOR));
    for (let rot = 0; rot < 4; rot++) {
      const w = matrix[0]!.length, h = matrix.length;
      for (let bx = 0; bx <= GameConfig.COLS - w; bx++) {
        for (let by = 0; by <= GameConfig.ROWS - h; by++) {
          const cells = this.pieceCells(matrix, bx, by);
          if (cells.length === 0) continue;
          if (cells.some(c => this.owner[c.x]![c.y] !== 0)) continue;  // overlap / wall / island
          if (!this.cellsTouch(cells, 2)) continue;                    // must grow from the boss causeway
          const deepest = Math.max(...cells.map(c => c.y));
          const deepens = deepest > frontier;
          const fillsEdge = deepest >= frontier - 1;  // adds mass at/just above the leading edge
          // When the edge is a thread, prefer widening it; once broad, push down.
          const progress = wantWiden
            ? (fillsEdge && !deepens ? 1000 : deepens ? 200 : 0)
            : (deepens ? 1000 : (fillsEdge ? 300 : 0));
          const nearLane = -Math.min(...cells.map(c => Math.abs(c.x - laneX)));  // gentle pull toward the lane
          const score = progress + deepest * 2 + nearLane + cells.length + Math.random() * 6;
          if (!best || score > best.score) best = { cells, score };
        }
      }
      matrix = GameMath.rotateMatrix(matrix);
    }
    if (!best) return;  // truly walled off this turn — the player has blocked every landing

    this.claim(best.cells, 2, CausewayDuel.BOSS_COLOR);
    g.cb.onBlockLand?.(best.cells);
    g.cb.onAudio?.('blockLand');
    // The boss pawn advances to the deepest new cell (breaking ties toward the lane).
    const edge = best.cells.reduce((a, c) =>
      (c.y > a.y || (c.y === a.y && Math.abs(c.x - laneX) < Math.abs(a.x - laneX))) ? c : a, best.cells[0]!);
    this.boss.x = edge.x; this.boss.y = edge.y;
    g.cb.onRingPulse?.(edge.x, edge.y, '150,40,55');  // the bridge grinds a length longer
    if (best.cells.some(c => this.atShore(c.x, c.y))) { this.lose(); return; }
    // One-time alarm once the bridge is closing on the shore.
    const gap = (GameConfig.ROWS - 1) - this.bossDeepestRow();
    if (!this.nearShoreWarned && gap <= 4 && this.wall.length === 0) {
      this.nearShoreWarned = true;
      g.cb.log('The bridge is almost across — cut them down NOW or the invasion lands!', 'log-boss', 'ui_warning');
      g.cb.onToast?.('THE BRIDGE NEARS YOUR SHORE!', 'ui_warning');
      g.cb.onAudio?.('bossWarn');
    }
  }

  // ── Resolution ─────────────────────────────────────────────────────────

  /**
   * Called from {@link CombatSystem.killMonster} (via {@link Game.notifyMonsterKilled})
   * for every monster death so the duel ends the instant its boss falls — no
   * matter how (melee, a ranged spell, thorns, or line-clear AoE).
   */
  notifyMonsterKilled(m: Monster): void {
    if (this.active && m === this.boss) this.win();
  }

  /**
   * Boss slain in the duel — the causeway is broken. Rather than dropping a
   * stairs tile the hero must find and step onto, the duel ends outright and
   * the usual delve-or-rest choice opens automatically. If a level-up boon pick
   * is already on screen (a boss kill almost always levels you), the choice
   * waits for it to close — see {@link settle}.
   */
  win(): void {
    const g = this.game;
    if (this.resolved) return;
    this.resolved = true;
    this.boss = null;
    g.blockMatrix = [];
    g.cb.log('The enemy causeway crumbles into the dark — the way on is open.', 'log-boss', 'item_trophy');
    g.cb.onToast?.('The bridge is broken! The way on opens…', 'special_sacred');
    // A victory flourish over the hero.
    g.cb.onParticleBurst?.(g.player.x, g.player.y, 18, '#d9a441', 'item_trophy');
    g.cb.onRingPulse?.(g.player.x, g.player.y, '217,164,65');
    g.cb.onImpactGlow?.(g.player.x, g.player.y, '217,164,65', 24);
    g.cb.onAudio?.('bountyFulfilled');
    g.storyBeats.push('broke a Fomorian causeway in single combat');
    this.descentPending = true;
    g.pushUI();
    this.tryFinishDescent();
  }

  /**
   * Opens the delve-or-rest choice for a won duel, but only once nothing else is
   * modal (a boss kill usually pops a level-up boon pick first, which pauses).
   * Retried every tick/turn by {@link settle} until it can fire.
   */
  tryFinishDescent(): void {
    const g = this.game;
    if (!this.descentPending || g.paused) return;
    this.descentPending = false;
    this.active = false;
    g.openStairsChoice();
  }

  /**
   * Per-tick safety net for the Causeway Duel: ends the duel the instant its
   * boss is gone by ANY death path (melee, a ranged spell, poison, thorns) —
   * not just the melee branch that used to own the win — and then opens the
   * descent choice as soon as no other modal is in the way. Cheap and idempotent.
   */
  settle(): void {
    if (this.active && !this.resolved && this.boss
        && (this.boss.hp <= 0 || !this.game.monsters.includes(this.boss))) {
      this.win();
    }
    if (this.descentPending) this.tryFinishDescent();
  }

  /** The boss's causeway reached the home row — the bridge is complete and the run ends. */
  private lose(): void {
    const g = this.game;
    if (this.resolved) return;
    this.resolved = true;
    g.cb.log('The bridge lands. The invasion crosses over you — the causeway to Ériu is complete.', 'log-boss', 'ui_warning');
    // A grim flourish at the shore before the run ends.
    g.cb.onRingPulse?.(this.home.x, this.home.y, '150,40,55');
    g.cb.onParticleBurst?.(this.home.x, this.home.y, 14, '#c1443c', 'ui_warning');
    g.cb.onAudio?.('bossWarn');
    g.player.hp = 0;
    g.cb.onDeath('THE BRIDGE LANDS', 'the Fomorian causeway reached the shore', g.dungeonLevel, g.player.totalXpEarned, g.getRunStats(), g.buildRunStory('death'));
  }

  // ── HUD / save ───────────────────────────────────────────────────────────

  /** The Causeway-Duel HUD card payload, or null when not in a duel. */
  uiState(): UIState['duel'] {
    if (!this.active || !this.boss) return null;
    return {
      bossName: this.boss.name,
      bossHp: Math.max(0, Math.round(this.boss.hp)),
      bossMaxHp: this.boss.maxHp,
      bridgeGap: Math.max(0, (GameConfig.ROWS - 1) - this.bossDeepestRow()),
      bridgeSpan: GameConfig.ROWS - 1,
      switchesLeft: this.switches.filter(s => !s.lit).length,
    };
  }

  /** Snapshot of the duel's pure-data state (no live references — the boss is re-linked by SaveGame). */
  serialize(): Record<string, unknown> {
    return {
      active: this.active, owner: this.owner, home: this.home, resolved: this.resolved,
      switches: this.switches, wall: this.wall, boons: this.boons,
      turns: this.turns, nearShoreWarned: this.nearShoreWarned, descentPending: this.descentPending,
    };
  }

  /** Restore from a snapshot (tolerates a missing/legacy value — a mid-duel save is rare and transient). The boss ref is re-linked by SaveGame afterwards. */
  restore(s: Record<string, unknown> | undefined): void {
    this.boss = null;
    if (!s) { this.active = false; return; }
    this.active = s['active'] as boolean;
    this.owner = s['owner'] as number[][];
    this.home = s['home'] as { x: number; y: number };
    this.resolved = s['resolved'] as boolean;
    this.switches = s['switches'] as Array<{ x: number; y: number; lit: boolean }>;
    this.wall = s['wall'] as Array<{ x: number; y: number }>;
    this.boons = s['boons'] as Array<{ x: number; y: number; kind: 'geis' | 'gold' | 'heal'; taken: boolean }>;
    this.turns = (s['turns'] as number) ?? 0;
    this.nearShoreWarned = (s['nearShoreWarned'] as boolean) ?? false;
    this.descentPending = (s['descentPending'] as boolean) ?? false;
  }
}
