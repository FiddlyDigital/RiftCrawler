import { CONFIG, SHAPES, type ShapeKey } from './config';
import { Tile, Cell, type TileValue, type CellValue, type GameCallbacks, type HazardTile, type SpecialTile, type RunStats, type ModifierDef, type InspectInfo, type AltarTile } from './types';
import { Player, Monster } from './entities';
import { MONSTERS, BOSSES, BOONS_BY_TIER, getBoonTierForFloor, getThreeRandomBoons, MODIFIERS, CLASSES, getBiomeForFloor, getRandomFloorEvent, getThreeRandomBrands, type ClassDef } from './content';
import { applyStatusEffects, applyRegen, applyAuraStun } from './systems/statusEffects';
import { processHazards, checkHazardTrigger } from './systems/hazards';
import { killMonster, playerAttackMonster, estimateHitChance } from './systems/combat';
import { processMonsterTurns, hasLineOfSight } from './systems/monsterAI';
import { spriteIconHTML } from './sprites';

// ── Pure helpers (exported for unit tests) ───────────────────────────────────

export function rotateMatrix(matrix: CellValue[][]): CellValue[][] {
  const rows = matrix.length;
  const cols = matrix[0]!.length;
  const out: CellValue[][] = Array.from({ length: cols }, () => Array(rows).fill(0) as CellValue[]);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      out[c]![rows - 1 - r] = matrix[r]![c]!;
    }
  }
  return out;
}

export function tickMsForLevel(level: number, slowPercent: number): number {
  const base = Math.max(400, 3000 - (level - 1) * 100);
  return Math.floor(base * (1 + slowPercent / 100));
}

export function scoreForLines(count: number, level: number): number {
  const base = [0, 100, 300, 600, 1000];
  return (base[count] ?? 1200) * level;
}

// Gold cost of the first reroll at an altar / tattoo artist; escalates ×1.6 per reroll this visit.
const REROLL_BASE_COST = 120;

// Gorgoth's full health. His remaining HP persists across escapes so you can
// whittle him down over multiple attempts.
const GORGOTH_MAX_HP = 1400;

// ── Game class ───────────────────────────────────────────────────────────────

export class Game {
  // Map state
  map: TileValue[][];
  colors: (string | null)[][];
  visibility: boolean[][];
  explored: boolean[][];

  // Entities
  player: Player;
  monsters: Monster[];

  // Active block
  blockMatrix: CellValue[][] = [];
  blockX = 0;
  blockY = 0;
  blockColor = '';
  currentType: ShapeKey = 'I';
  nextType: ShapeKey = 'I';

  // Game state
  active = true;
  paused = false;
  gold = 0;
  dungeonLevel = 1;

  // Hazard tiles (persist per floor)
  public hazards: HazardTile[] = [];

  // Shape-based special terrain tiles
  public specialTiles: SpecialTile[] = [];

  // Piece state (set fresh each spawn)
  public currentCursed = false;
  public currentBlessed = false;

  // Hold mechanic
  public heldType: ShapeKey | null = null;
  public canHold = true;

  // Modifier state (active for the whole run)
  public activeModifierId: string | null = null;
  public xpMultiplier = 1.0;
  public noLineHeal = false;
  public haunted = false;
  public frozenRift = false;

  // Class state
  public activeClassId: string | null = null;
  public timeDilationTurns = 0;  // Chronomancer: turns remaining at +100 slow
  public killsThisFloor    = 0;  // Cascade: kill counter for Overload

  // Biome state
  public biomeId = 'stone';
  public biomeMonsterHpMult = 1.0;
  public biomeGravityPct = 0;

  // Run stats
  public monstersKilled = 0;
  public bossesKilled = 0;
  public linesCleared = 0;
  public biggestCombo = 0;
  public damageTaken = 0;

  // Internal counters
  private floorsDescended = 0;
  private blocksPlacedSinceStairs = 0;
  private pendingBossFloor = false;
  public comboCount = 0;
  private lastLineClearMs = 0;
  private tattooTiles: Array<{ x: number; y: number }> = [];
  public altarTiles: AltarTile[] = [];

  // Active boss mechanics (set at spawn, cleared on floor reset)
  private activeBossOnHalfHp: ((game: Game) => void) | null = null;
  private activeBossOnDeath:   ((game: Game, x: number, y: number) => void) | null = null;
  private bossHalfHpTriggered = false;

  // Endgame: overflowing the stack summons Gorgoth the Returned. While summoned,
  // no tetrominoes fall — the run becomes a boss duel. Killing him wins.
  public gorgothSummoned = false;
  public won = false;
  private gorgothHintShown = false;   // one-time nudge toward the win condition
  private gorgothHp = GORGOTH_MAX_HP;  // carries over between summons (escape & retry)
  private gorgothHalfTriggered = false;

  readonly cb: GameCallbacks;

  constructor(callbacks: GameCallbacks) {
    this.cb = callbacks;
    this.map = this.emptyMap();
    this.colors = this.emptyColors();
    this.visibility = this.emptyBoolGrid(false);
    this.explored = this.emptyBoolGrid(false);
    this.player = new Player(4, 23);
    this.monsters = [];
    this.generateStartPlatform();
    this.currentType = this.randomShapeKey();
    this.nextType = this.randomShapeKey();
    this.spawnBlock();
    this.updateVisibility();
    this.pushUI();
  }

  // ── Grid helpers ─────────────────────────────────────────────────────────

  private emptyMap(): TileValue[][] {
    return Array.from({ length: CONFIG.COLS }, () => Array<TileValue>(CONFIG.ROWS).fill(Tile.VOID));
  }

  private emptyColors(): (string | null)[][] {
    return Array.from({ length: CONFIG.COLS }, () => Array<string | null>(CONFIG.ROWS).fill(null));
  }

  private emptyBoolGrid(val: boolean): boolean[][] {
    return Array.from({ length: CONFIG.COLS }, () => Array(CONFIG.ROWS).fill(val) as boolean[]);
  }

  private generateStartPlatform(): void {
    for (let x = 2; x < 8; x++) {
      this.map[x]![23] = Tile.FLOOR; this.colors[x]![23] = '#333344';
      this.map[x]![24] = Tile.FLOOR; this.colors[x]![24] = '#333344';
    }
  }

  private randomShapeKey(): ShapeKey {
    const keys = Object.keys(SHAPES) as ShapeKey[];
    return keys[Math.floor(Math.random() * keys.length)]!;
  }

  // ── Fog of war ───────────────────────────────────────────────────────────

  updateVisibility(): void {
    // During the Gorgoth duel the whole arena stays lit (revealed at summon) so
    // the player can watch him descend — don't re-fog to the vision radius.
    if (this.gorgothSummoned) return;
    const onSmoke = this.hazards.some(h => h.type === 'smoke' && h.x === this.player.x && h.y === this.player.y);
    const r = onSmoke ? 1 : this.player.visionRadius;
    for (let x = 0; x < CONFIG.COLS; x++) {
      for (let y = 0; y < CONFIG.ROWS; y++) {
        const dist = Math.hypot(x - this.player.x, y - this.player.y);
        const visible = dist <= r;
        this.visibility[x]![y] = visible;
        if (visible) this.explored[x]![y] = true;
      }
    }
    // Falling block is always visible
    for (let r2 = 0; r2 < this.blockMatrix.length; r2++) {
      for (let c = 0; c < this.blockMatrix[r2]!.length; c++) {
        if (this.blockMatrix[r2]![c] !== Cell.EMPTY) {
          const tx = this.blockX + c, ty = this.blockY + r2;
          if (tx >= 0 && tx < CONFIG.COLS && ty >= 0 && ty < CONFIG.ROWS) {
            this.visibility[tx]![ty] = true;
            this.explored[tx]![ty] = true;
          }
        }
      }
    }
  }

  // ── Block spawning ───────────────────────────────────────────────────────

  private spawnBlock(): void {
    this.currentType = this.nextType;
    this.nextType = this.randomShapeKey();
    const shape = SHAPES[this.currentType];
    this.blockColor = shape.color;
    this.blocksPlacedSinceStairs++;

    // Roll cursed/blessed for this piece (8% cursed, 4% blessed, 88% normal)
    const pieceRoll = Math.random();
    this.currentCursed  = pieceRoll < 0.08;
    this.currentBlessed = !this.currentCursed && pieceRoll < 0.12;

    let stairsInjected = false;
    let bossInjected = false;
    let bombInjected = false;
    let merchantInjected = false;
    let altarInjected = false;
    let trapInjected = false;
    let monsterInjected = false;

    this.blockMatrix = shape.matrix.map(row =>
      row.map((cell): CellValue => {
        if (cell === 0) return Cell.EMPTY;

        // Boss cell — once per boss floor, one guaranteed slot
        if (this.pendingBossFloor && !bossInjected) {
          bossInjected = true;
          this.pendingBossFloor = false;
          return Cell.BOSS;
        }

        // Stairs
        if (!stairsInjected && (this.blocksPlacedSinceStairs >= 12 || Math.random() < 0.10)) {
          stairsInjected = true;
          this.blocksPlacedSinceStairs = 0;
          return Cell.STAIRS;
        }

        // Special blocks
        if (!bombInjected && Math.random() < 0.03) {
          bombInjected = true;
          return Cell.BOMB;
        }
        if (!merchantInjected && Math.random() < 0.04) {
          merchantInjected = true;
          return Cell.MERCHANT;
        }
        if (!altarInjected && Math.random() < 0.035) {
          altarInjected = true;
          return Cell.ALTAR;
        }
        // Hazard traps — one type per block, ~2% each
        if (!trapInjected) {
          const r = Math.random();
          if (r < 0.02) { trapInjected = true; return Cell.TRAP_SPIKE; }
          if (r < 0.04) { trapInjected = true; return Cell.TRAP_SMOKE; }
          if (r < 0.06) { trapInjected = true; return Cell.TRAP_TELEPORT; }
        }

        // Monster spawn — at most one per block (no random dumps), and the rate
        // ramps gently with depth instead of a flat spike. Haunted doubles it.
        const baseMonsterChance = Math.min(0.16, 0.06 + this.dungeonLevel * 0.005);
        const monsterChance = this.haunted ? baseMonsterChance * 2 : baseMonsterChance;
        const rand = Math.random();
        if (rand < monsterChance) {
          if (monsterInjected) return Cell.FLOOR;  // cap: one monster per block
          monsterInjected = true;
          const r = Math.random();
          if (r < 0.25) return Cell.MONSTER_RAT;
          if (r < 0.50) return Cell.MONSTER_SKEL;
          if (r < 0.65) return Cell.MONSTER_ARCHER;
          if (r < 0.78) return Cell.MONSTER_SLIME;
          if (r < 0.89) return Cell.MONSTER_ORC;
          return Cell.MONSTER_BAT;
        }
        return Cell.FLOOR;
      }),
    );

    this.injectShapeBonusRiders();

    this.blockX = Math.floor((CONFIG.COLS - this.blockMatrix[0]!.length) / 2);
    this.blockY = 0;

    // Stack topped out — the rift yields no more blocks and summons Gorgoth.
    if (this.checkBlockCollision(this.blockX, this.blockY, this.blockMatrix)) {
      this.summonGorgoth();
    }
  }

  // Decide shape/curse bonus riders at spawn (not at lock) so an O-piece's altar
  // or a cursed piece's monster rides the block as a visible cell during descent,
  // instead of popping into existence when the piece locks.
  private injectShapeBonusRiders(): void {
    const plain: Array<{ r: number; c: number }> = [];
    for (let r = 0; r < this.blockMatrix.length; r++) {
      for (let c = 0; c < this.blockMatrix[r]!.length; c++) {
        if (this.blockMatrix[r]![c] === Cell.FLOOR) plain.push({ r, c });
      }
    }
    const take = (): { r: number; c: number } | null =>
      plain.length ? plain.splice(Math.floor(Math.random() * plain.length), 1)[0]! : null;

    // O-piece: a chance to carry an altar (Architect class rolls it more often).
    if (this.currentType === 'O' && Math.random() < (this.activeClassId === 'architect' ? 0.80 : 0.40)) {
      const p = take();
      if (p) this.blockMatrix[p.r]![p.c] = Cell.ALTAR;
    }
    // Cursed piece: carries a monster that crawls out where it lands.
    if (this.currentCursed) {
      const p = take();
      if (p) this.blockMatrix[p.r]![p.c] = MONSTERS[this.getRandomMonsterKey()]!.cellState;
    }
  }

  // ── Collision ────────────────────────────────────────────────────────────

  checkBlockCollision(bx: number, by: number, matrix: CellValue[][]): boolean {
    for (let r = 0; r < matrix.length; r++) {
      for (let c = 0; c < matrix[r]!.length; c++) {
        if (matrix[r]![c] !== Cell.EMPTY) {
          const tx = bx + c, ty = by + r;
          if (tx < 0 || tx >= CONFIG.COLS || ty >= CONFIG.ROWS) return true;
          if (ty >= 0 && this.map[tx]![ty] !== Tile.VOID) return true;
        }
      }
    }
    return false;
  }

  computeGhostBlockY(): number {
    // No active piece (e.g. during the Gorgoth duel): an empty matrix never
    // collides, so the loop below would spin forever and freeze the renderer.
    if (this.blockMatrix.length === 0) return this.blockY;
    let ghostY = this.blockY;
    while (!this.checkBlockCollision(this.blockX, ghostY + 1, this.blockMatrix)) ghostY++;
    return ghostY;
  }

  isValidMove(x: number, y: number): boolean {
    if (x < 0 || x >= CONFIG.COLS || y < 0 || y >= CONFIG.ROWS) return false;
    return this.map[x]![y] === Tile.FLOOR || this.map[x]![y] === Tile.STAIRS || this.isTattooTile(x, y) || this.isAltarTile(x, y);
  }

  private isTattooTile(x: number, y: number): boolean {
    return this.tattooTiles.some(t => t.x === x && t.y === y);
  }

  private isAltarTile(x: number, y: number): boolean {
    return this.altarTiles.some(a => a.x === x && a.y === y);
  }

  getHazardAt(x: number, y: number): HazardTile | undefined {
    return this.hazards.find(h => h.x === x && h.y === y);
  }

  // ── Block locking ────────────────────────────────────────────────────────

  private lockBlock(): void {
    const bombPositions: Array<{ x: number; y: number }> = [];
    const landedCells: Array<{ x: number; y: number }> = [];
    const lockedFloorCells: Array<{ x: number; y: number }> = [];
    this.canHold = true;

    for (let r = 0; r < this.blockMatrix.length; r++) {
      for (let c = 0; c < this.blockMatrix[r]!.length; c++) {
        const cell = this.blockMatrix[r]![c]!;
        if (cell === Cell.EMPTY) continue;
        const tx = this.blockX + c, ty = this.blockY + r;
        if (tx < 0 || tx >= CONFIG.COLS || ty < 0 || ty >= CONFIG.ROWS) continue;
        landedCells.push({ x: tx, y: ty });

        if (cell === Cell.STAIRS) {
          this.map[tx]![ty] = Tile.STAIRS;
          this.colors[tx]![ty] = '#8e24aa';
        } else if (cell === Cell.BOMB) {
          this.map[tx]![ty] = Tile.FLOOR;
          this.colors[tx]![ty] = this.blockColor;
          bombPositions.push({ x: tx, y: ty });
          lockedFloorCells.push({ x: tx, y: ty });
        } else if (cell === Cell.MERCHANT) {
          this.map[tx]![ty] = Tile.FLOOR;
          this.colors[tx]![ty] = '#2a0a3a';
          this.tattooTiles.push({ x: tx, y: ty });
          lockedFloorCells.push({ x: tx, y: ty });
        } else if (cell === Cell.ALTAR) {
          const tier = getBoonTierForFloor(this.dungeonLevel);
          const altarColor = tier === 3 ? '#2a1a00' : tier === 2 ? '#001a2a' : '#1a0a2a';
          this.map[tx]![ty] = Tile.FLOOR;
          this.colors[tx]![ty] = altarColor;
          this.altarTiles.push({ x: tx, y: ty, tier });
          lockedFloorCells.push({ x: tx, y: ty });
        } else if (cell === Cell.TRAP_SPIKE) {
          this.map[tx]![ty] = Tile.FLOOR;
          this.colors[tx]![ty] = this.blockColor;
          this.hazards.push({ x: tx, y: ty, type: 'spike', timer: 5 + Math.floor(Math.random() * 4), warning: false });
          lockedFloorCells.push({ x: tx, y: ty });
        } else if (cell === Cell.TRAP_SMOKE) {
          this.map[tx]![ty] = Tile.FLOOR;
          this.colors[tx]![ty] = this.blockColor;
          this.hazards.push({ x: tx, y: ty, type: 'smoke', timer: 0, warning: false });
          lockedFloorCells.push({ x: tx, y: ty });
        } else if (cell === Cell.TRAP_TELEPORT) {
          this.map[tx]![ty] = Tile.FLOOR;
          this.colors[tx]![ty] = this.blockColor;
          this.hazards.push({ x: tx, y: ty, type: 'teleport', timer: 0, warning: false });
          lockedFloorCells.push({ x: tx, y: ty });
        } else {
          this.map[tx]![ty] = Tile.FLOOR;
          this.colors[tx]![ty] = this.blockColor;
          lockedFloorCells.push({ x: tx, y: ty });
        }

        this.instantiateRider(cell, tx, ty);
      }
    }

    // Shape-based tile effects on lock
    if (lockedFloorCells.length > 0) {
      if (this.currentType === 'S' || this.currentType === 'L' || this.currentType === 'J') {
        const tileType =
          this.currentType === 'S' ? 'swamp' :
          this.currentType === 'J' ? 'ice' : 'sacred';
        const msgs = { swamp: 'Swamp — monsters take 1 dmg/turn!', sacred: 'Sacred ground — Wait here for bonus heal!', ice: 'Ice — entities slide across!' };
        const icons = { swamp: 'special_swamp', sacred: 'special_sacred', ice: 'special_ice' };
        for (const fc of lockedFloorCells) {
          if (!this.hazards.some(h => h.x === fc.x && h.y === fc.y) &&
              !this.tattooTiles.some(t => t.x === fc.x && t.y === fc.y)) {
            this.specialTiles.push({ x: fc.x, y: fc.y, type: tileType as SpecialTile['type'] });
          }
        }
        this.cb.log(msgs[tileType as keyof typeof msgs]!, 'log-tetris', icons[tileType as keyof typeof icons]);
      } else if (this.currentType === 'Z') {
        for (const fc of lockedFloorCells) {
          if (!this.hazards.some(h => h.x === fc.x && h.y === fc.y) &&
              !this.tattooTiles.some(t => t.x === fc.x && t.y === fc.y)) {
            this.hazards.push({ x: fc.x, y: fc.y, type: 'spike', timer: 5, warning: false });
          }
        }
        this.cb.log('Spike Field — fires every 5 ticks!', 'log-tetris', 'trap_spike');
      } else if (this.currentType === 'T' && this.player.rangedCooldown > 0) {
        const cdReduce = this.activeClassId === 'architect' ? 4 : 2;
        this.player.rangedCooldown = Math.max(0, this.player.rangedCooldown - cdReduce);
        this.cb.log('Arcane resonance — ranged cooldown reduced!', 'log-perk', 'fx_arcane');
      }
    }

    // (Cursed pieces carry their monster as a visible rider — injected at spawn.)

    // Blessed piece: consecrate one cell as sacred ground
    if (this.currentBlessed && lockedFloorCells.length > 0) {
      const eligible = lockedFloorCells.filter(fc =>
        !this.specialTiles.some(t => t.x === fc.x && t.y === fc.y)
      );
      if (eligible.length > 0) {
        const fc = eligible[Math.floor(Math.random() * eligible.length)]!;
        this.specialTiles.push({ x: fc.x, y: fc.y, type: 'sacred' });
        this.cb.log('A blessed rift — holy ground consecrated!', 'log-perk', 'special_sacred');
        this.cb.onParticle(fc.x, fc.y, 'BLESSED!', '#ffb74d', undefined, 'special_sacred');
      }
    }

    this.cb.onBlockLand?.(landedCells);

    // Trigger bombs after all cells written
    for (const pos of bombPositions) {
      this.triggerBomb(pos.x, pos.y);
    }

    this.checkLineClears();
    this.cb.onAudio?.('blockLand');
    this.maybeHintGorgoth();
    this.spawnBlock();
  }

  // One-time teaching nudge: when the stack climbs near the ceiling, tell the
  // player that topping out summons Gorgoth — the win condition.
  private maybeHintGorgoth(): void {
    if (this.gorgothHintShown || this.gorgothSummoned) return;
    let stackTop: number = CONFIG.ROWS;
    for (let x = 0; x < CONFIG.COLS; x++) {
      for (let y = 0; y < CONFIG.ROWS; y++) {
        if (this.map[x]![y] === Tile.FLOOR) { if (y < stackTop) stackTop = y; break; }
      }
    }
    if (stackTop <= 5) {
      this.gorgothHintShown = true;
      this.cb.log('The stack climbs high — let it top out to summon GORGOTH THE RETURNED and win the Rift!', 'log-boss', 'ui_warning');
    }
  }

  // ── Special tile processing ──────────────────────────────────────────────

  private processSpecialTiles(): void {
    const deadFromTerrain: Monster[] = [];

    for (const t of this.specialTiles) {
      if (t.type === 'swamp') {
        for (const m of this.monsters) {
          if (m.x === t.x && m.y === t.y && !deadFromTerrain.includes(m)) {
            m.hp -= 1;
            this.cb.onParticle(t.x, t.y, '-1', '#66bb6a');
            if (m.hp <= 0) deadFromTerrain.push(m);
          }
        }
      }
    }

    for (const m of deadFromTerrain) {
      killMonster(m, this);
    }
  }

  // ── Monster spawning helper ───────────────────────────────────────────────

  private spawnMonster(key: string, tx: number, ty: number): void {
    const def = MONSTERS[key];
    if (!def) return;
    const isElite = Math.random() < 0.12;
    const baseHp  = Math.floor((def.baseHp  + (this.dungeonLevel - 1) * def.hpPerLevel) * this.biomeMonsterHpMult);
    const baseAtk = def.baseAtk + (this.dungeonLevel - 1) * def.atkPerLevel;
    const hp  = isElite ? baseHp * 2 : baseHp;
    const atk = isElite ? Math.floor(baseAtk * 1.5) : baseAtk;
    const name = isElite ? `Elite ${def.name}` : def.name;
    const m = new Monster(
      tx, ty, def.char, name, hp, hp, atk, def.xpReward,
      false,
      def.behaviorType ?? 'melee',
      def.attackRange  ?? 1,
      def.moveSpeed    ?? 1,
      def.statusInflict,
    );
    m.isElite = isElite;
    m.combatLevel = Math.min(6, def.combatLevel + (isElite ? 1 : 0));
    if (this.frozenRift) {
      m.statuses.push({ type: 'stun', duration: 1, power: 0 });
    }
    this.monsters.push(m);
    if (isElite) {
      this.cb.onParticle(tx, ty, 'ELITE!', '#ffd700', undefined, 'special_sacred');
      this.cb.log(`Elite ${def.name} stalks out of the dark!`, 'log-boss', 'special_sacred');
    } else {
      this.cb.onParticle(tx, ty, def.spawnMsg, '#e57373', undefined, def.char);
    }
  }

  // Called by Crystal Golem onDeath
  spawnCrystalShards(bx: number, by: number): void {
    const shardHp  = 8 + this.dungeonLevel * 2;
    const shardAtk = 3 + Math.floor(this.dungeonLevel * 0.5);
    const dirs: Array<[number, number]> = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    let spawned = 0;
    for (const [dx, dy] of dirs) {
      if (spawned >= 2) break;
      const sx = bx + dx, sy = by + dy;
      if (this.isValidMove(sx, sy) && !this.getMonsterAt(sx, sy)) {
        const shard = new Monster(sx, sy, 'sprite_crystal_shard', 'Crystal Shard', shardHp, shardHp, shardAtk, 30);
        shard.combatLevel = 3;
        this.monsters.push(shard);
        this.cb.onParticle(sx, sy, '', '#80d8ff', undefined, 'sprite_crystal_shard');
        spawned++;
      }
    }
    this.cb.log('The Crystal Golem shatters — shards emerge!', 'log-boss', 'sprite_boss_crystal_golem');
  }

  // Called by Rift Tyrant onHalfHp
  triggerGravityBurst(): void {
    this.blockY = Math.max(0, this.blockY - 5);
    this.cb.log('Rift Tyrant tears the weave — gravity surges!', 'log-boss', 'fx_impact');
    this.cb.onParticle(this.player.x, this.player.y, 'SURGE!', '#aa00ff', undefined, 'fx_impact');
    this.cb.onAudio?.('bossWarn');
  }

  // ── Dungeon rooms ────────────────────────────────────────────────────────

  private maybeSpawnDungeonRoom(): void {
    if (Math.random() > 0.25) return;
    this.spawnRoom(Math.random() < 0.5 ? 'vault' : 'den');
  }

  private getRandomMonsterKey(): string {
    const all = ['rat', 'skeleton', 'goblin_archer', 'cave_slime', 'berserker_orc', 'plague_bat'];
    const maxIdx = Math.min(all.length - 1, 1 + Math.floor(this.dungeonLevel / 3));
    return all[Math.floor(Math.random() * (maxIdx + 1))]!;
  }

  private spawnRoom(type: 'vault' | 'den'): void {
    // Rooms are lateral 2×3 extensions of the starting platform (x=2..7, y=23..24).
    // Left side: x=0..1. Right side: x=8..9. y=22..24 (one row above platform top).
    // This keeps the centre columns clear so falling blocks are never intercepted.
    const colors = { vault: '#3d2b00', den: '#2d0000' } as const;
    const side = Math.random() < 0.5 ? 'left' : 'right';
    const roomX = side === 'left' ? 0 : CONFIG.COLS - 2;  // 0 or 8
    const roomY = CONFIG.ROWS - 3;                         // 22 (rows 22..24)
    const color = colors[type];

    for (let dx = 0; dx < 2; dx++) {
      for (let dy = 0; dy < 3; dy++) {
        const x = roomX + dx, y = roomY + dy;
        this.map[x]![y]    = Tile.FLOOR;
        this.colors[x]![y] = color;
      }
    }

    const innerX = roomX + (side === 'left' ? 1 : 0);  // column closer to starting platform
    const midY   = roomY + 1;                           // middle row of the room

    if (type === 'vault') {
      // Place a bonus altar in the vault, guarded by a monster.
      const altarX = roomX + (side === 'left' ? 0 : 1);
      const altarTier: 1 | 2 | 3 = this.dungeonLevel >= 8 ? 3 : this.dungeonLevel >= 4 ? 2 : 1;
      const altarColor = altarTier === 3 ? '#2a1a00' : altarTier === 2 ? '#001a2a' : '#1a0a2a';
      this.colors[altarX]![midY] = altarColor;
      this.altarTiles.push({ x: altarX, y: midY, tier: altarTier });
      this.spawnMonster(this.getRandomMonsterKey(), innerX, roomY);
      this.cb.log(`A Treasure Vault lies to the ${side} — guarded.`, 'log-perk', 'item_gold_pouch');
    } else {
      const positions: Array<[number, number]> = [[0, 0], [1, 0], [0, 1]];
      for (const [pdx, pdy] of positions) {
        this.spawnMonster(this.getRandomMonsterKey(), roomX + pdx, roomY + pdy);
      }
      this.cb.log(`A Monster Den lurks to the ${side}...`, 'log-damage', 'status_poison');
    }
  }

  private triggerBomb(cx: number, cy: number): void {
    this.cb.log('BOOM! Bomb block detonated!', 'log-tetris', 'fx_impact');
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const x = cx + dx, y = cy + dy;
        if (x < 0 || x >= CONFIG.COLS || y < 0 || y >= CONFIG.ROWS) continue;
        this.map[x]![y] = Tile.VOID;
        this.colors[x]![y] = null;
        this.monsters = this.monsters.filter(m => !(m.x === x && m.y === y));
        this.tattooTiles = this.tattooTiles.filter(t => !(t.x === x && t.y === y));
        this.altarTiles = this.altarTiles.filter(a => !(a.x === x && a.y === y));
        this.hazards = this.hazards.filter(h => !(h.x === x && h.y === y));
        this.specialTiles = this.specialTiles.filter(t => !(t.x === x && t.y === y));
        this.cb.onParticle(x, y, '', '#ff6b35', undefined, 'fx_impact');
      }
    }
    this.gold += Math.floor(50 * this.dungeonLevel);
  }

  private instantiateRider(cell: CellValue, tx: number, ty: number): void {
    if (cell === Cell.MONSTER_RAT)    { this.spawnMonster('rat',            tx, ty); return; }
    if (cell === Cell.MONSTER_SKEL)   { this.spawnMonster('skeleton',       tx, ty); return; }
    if (cell === Cell.MONSTER_ARCHER) { this.spawnMonster('goblin_archer',  tx, ty); return; }
    if (cell === Cell.MONSTER_SLIME)  { this.spawnMonster('cave_slime',     tx, ty); return; }
    if (cell === Cell.MONSTER_ORC)    { this.spawnMonster('berserker_orc',  tx, ty); return; }
    if (cell === Cell.MONSTER_BAT)    { this.spawnMonster('plague_bat',     tx, ty); return; }

    if (cell === Cell.BOSS) {
      // Prefer a biome-specific boss; fall back to generic pool
      const biomeBosses   = BOSSES.filter(b => b.biomeId === this.biomeId);
      const genericBosses = BOSSES.filter(b => !b.biomeId);
      const bossPool = biomeBosses.length > 0 ? biomeBosses : genericBosses;
      const bossDef = bossPool[(Math.floor(this.dungeonLevel / 5) - 1) % bossPool.length]!;
      const baseHp = 18 + (this.dungeonLevel - 1) * 3;
      const baseAtk = 5 + (this.dungeonLevel - 1);
      const hp = Math.floor(baseHp * bossDef.hpMult);
      const atk = Math.floor(baseAtk * bossDef.atkMult);
      const boss = new Monster(tx, ty, bossDef.char, bossDef.name, hp, hp, atk, bossDef.xpReward, true);
      boss.combatLevel = 5;
      this.monsters.push(boss);
      this.activeBossOnHalfHp = bossDef.onHalfHp ?? null;
      this.activeBossOnDeath   = bossDef.onDeath  ?? null;
      this.bossHalfHpTriggered = false;
      this.cb.log(`${bossDef.flavorText} ${bossDef.name} descends!`, 'log-boss', 'ui_warning');
      this.cb.onParticle(tx, ty, 'BOSS', '#ff0000', undefined, 'ui_warning');
      // Boss cinematic pause
      this.paused = true;
      this.cb.onBossWarning?.(bossDef, () => { this.paused = false; });
    }
  }

  public isIceTile(x: number, y: number): boolean {
    return this.specialTiles.some(t => t.type === 'ice' && t.x === x && t.y === y);
  }

  // ── Line clears ──────────────────────────────────────────────────────────

  private checkLineClears(): void {
    let rowsCleared = 0;

    for (let y = CONFIG.ROWS - 1; y >= 0; y--) {
      let rowFull = true;
      for (let x = 0; x < CONFIG.COLS; x++) {
        if (this.map[x]![y] === Tile.VOID) { rowFull = false; break; }
      }
      if (!rowFull) continue;

      rowsCleared++;
      for (let x = 0; x < CONFIG.COLS; x++) {
        this.map[x]![y] = Tile.VOID;
        this.colors[x]![y] = null;
      }
      for (let shiftY = y; shiftY > 0; shiftY--) {
        for (let x = 0; x < CONFIG.COLS; x++) {
          this.map[x]![shiftY] = this.map[x]![shiftY - 1]!;
          this.colors[x]![shiftY] = this.colors[x]![shiftY - 1]!;
        }
      }
      for (let x = 0; x < CONFIG.COLS; x++) { this.map[x]![0] = Tile.VOID; this.colors[x]![0] = null; }
      this.shiftEntitiesDown(y);
      this.tattooTiles = this.tattooTiles
        .filter(t => t.y !== y)
        .map(t => t.y < y ? { x: t.x, y: t.y + 1 } : t);
      this.altarTiles = this.altarTiles
        .filter(a => a.y !== y)
        .map(a => a.y < y ? { ...a, y: a.y + 1 } : a);
      this.hazards = this.hazards
        .filter(h => h.y !== y)
        .map(h => h.y < y ? { ...h, y: h.y + 1 } : h);
      this.specialTiles = this.specialTiles
        .filter(t => t.y !== y)
        .map(t => t.y < y ? { ...t, y: t.y + 1 } : t);
      y++;
    }

    if (rowsCleared > 0) {
      this.linesCleared += rowsCleared;
      this.cb.onAudio?.('lineClear', rowsCleared);
      const now = performance.now();
      const isCombo = now - this.lastLineClearMs < 2000;
      this.comboCount = isCombo ? this.comboCount + 1 : 0;
      this.lastLineClearMs = now;
      if (this.comboCount > this.biggestCombo) this.biggestCombo = this.comboCount;

      let goldAdded = Math.floor(scoreForLines(rowsCleared, this.dungeonLevel));
      if (this.comboCount > 0) {
        const mult = 1 + this.comboCount * 0.5;
        goldAdded = Math.floor(goldAdded * mult);
        this.cb.log(`COMBO x${this.comboCount + 1}! +${goldAdded} Gold`, 'log-combo', 'fx_fire');
        this.cb.onCombo?.(this.comboCount + 1);
        if (this.comboCount >= 2) this.cb.onAudio?.('comboMilestone', this.comboCount + 1);
      }
      this.gold += goldAdded;

      // XP for line clears — multi-row clears give a stacked bonus; Architect doubles it; Rift Tide stacks on top
      const LINE_CLEAR_XP = [0, 15, 40, 80, 150];
      const xpGain = Math.round((LINE_CLEAR_XP[Math.min(rowsCleared, 4)] ?? 150) * this.player.lineClearXpMult);
      this.cb.onParticle(this.player.x, this.player.y, `+${xpGain}XP`, '#ce93d8', 14);
      const levelled = this.player.gainXP(Math.floor(xpGain * this.xpMultiplier));
      if (levelled) {
        this.cb.log(`LEVEL UP! Now level ${this.player.playerLevel}!`, 'log-perk', 'special_sacred');
        this.openLevelUpBoons();
      }

      // Perk: line clears deal damage to all visible monsters
      if (this.player.lineClearDamage > 0) {
        for (const m of this.monsters) {
          if (this.visibility[m.x]?.[m.y]) {
            m.hp -= this.player.lineClearDamage;
            this.cb.onParticle(m.x, m.y, `-${this.player.lineClearDamage}`, '#ff6b35', undefined, 'fx_fire');
          }
        }
        this.monsters = this.monsters.filter(m => m.hp > 0);
      }

      // Cascade passive: line clears deal scaled damage to all visible monsters
      if (this.activeClassId === 'cascade') {
        const dmg = 4 * rowsCleared * this.dungeonLevel;
        for (const m of this.monsters) {
          if (this.visibility[m.x]?.[m.y]) {
            m.hp -= dmg;
            this.cb.onParticle(m.x, m.y, `-${dmg}`, '#ff6d00', 14, 'fx_impact');
          }
        }
        this.monsters = this.monsters.filter(m => m.hp > 0);
      }

      // Annihilation Rune: line clears deal floor×mult dmg to ALL monsters
      if (this.player.lineClearAoeDmgMult > 0) {
        const aoeDmg = Math.floor(this.player.lineClearAoeDmgMult * this.dungeonLevel);
        for (const m of this.monsters) {
          m.hp -= aoeDmg;
          this.cb.onParticle(m.x, m.y, `-${aoeDmg}`, '#ff6d00', undefined, 'fx_impact');
        }
        this.monsters = this.monsters.filter(m => m.hp > 0);
      }

      if (!this.noLineHeal) {
        const lineHeal = this.player.heal(10);
        if (lineHeal > 0) {
          this.cb.onParticle(this.player.x, this.player.y, `+${lineHeal} HP`, '#69f0ae');
          if (this.comboCount === 0) this.cb.log(`Row cleared! +${lineHeal} HP.`, 'log-tetris');
        } else if (this.comboCount === 0) {
          this.cb.log(`Dungeon Row Cleared! +${goldAdded} Gold.`, 'log-tetris');
        }
      } else if (this.comboCount === 0) {
        this.cb.log(`Dungeon Row Cleared! +${goldAdded} Gold. (Cursed — no heal)`, 'log-tetris');
      }
    }
  }

  private shiftEntitiesDown(thresholdY: number): void {
    for (const m of this.monsters) { if (m.y < thresholdY) m.y++; }
    if (this.player.y < thresholdY) {
      this.player.y++;
      if (this.player.y >= CONFIG.ROWS) this.transitionToNextFloor();
    }
  }

  // ── Floor transitions ────────────────────────────────────────────────────

  private transitionToNextFloor(): void {
    this.dungeonLevel++;
    this.floorsDescended++;
    if (this.dungeonLevel % 5 === 0) this.pendingBossFloor = true;
    this.updateBiome();
    this.cb.log(`Collapsed down to depth floor ${this.dungeonLevel}!`, 'log-tetris');
    this.resetDungeonState();
  }

  private updateBiome(): void {
    const biome = getBiomeForFloor(this.dungeonLevel);
    this.biomeId = biome.id;
    this.biomeMonsterHpMult = biome.monsterHpMult;
    this.biomeGravityPct = biome.gravityPctBonus;
  }

  resetDungeonState(): void {
    this.map = this.emptyMap();
    this.colors = this.emptyColors();
    this.visibility = this.emptyBoolGrid(false);
    this.explored = this.emptyBoolGrid(false);
    this.monsters = [];
    this.tattooTiles = [];
    this.altarTiles = [];
    this.hazards = [];
    this.specialTiles = [];
    this.killsThisFloor = 0;
    this.heldType = null;
    this.canHold = true;
    this.activeBossOnHalfHp = null;
    this.activeBossOnDeath   = null;
    this.bossHalfHpTriggered = false;
    this.player.x = 4;
    this.player.y = 23;
    // Replenish finite ammo on descent (Rogue darts: +3, cap 5)
    if (this.player.rangedAmmo >= 0) {
      this.player.rangedAmmo = Math.min(5, this.player.rangedAmmo + 3);
    }
    // Cruelty Core: reset per-floor ATK bonus
    this.player.atk -= this.player.killAtkFloorBonus;
    this.player.killAtkFloorBonus = 0;
    // Deathward Rune: replenish charges from stacks
    this.player.deathwardCharges = this.player.boons
      .filter(b => b.id === 'deathward')
      .reduce((sum, b) => sum + b.stacks, 0);
    // Life Brand: replenish revive flag each floor if set was completed
    if (this.player.brands.filter(b => b.brand.id === 'life').length >= 3) {
      this.player.lifeBrandRevive = true;
    }
    this.generateStartPlatform();
    this.maybeSpawnDungeonRoom();
    this.spawnBlock();
    this.updateVisibility();
  }

  // ── Gravity ──────────────────────────────────────────────────────────────

  private moveGravity(): void {
    if (!this.checkBlockCollision(this.blockX, this.blockY + 1, this.blockMatrix)) {
      this.blockY++;
    } else {
      this.lockBlock();
    }
  }

  // ── Auto-tick (timer-driven) ─────────────────────────────────────────────

  autoTick(): void {
    if (this.player.hp <= 0 || this.paused) return;
    applyStatusEffects(this);
    applyRegen(this);
    applyAuraStun(this);
    processHazards(this);
    this.processSpecialTiles();
    if (!this.gorgothSummoned) this.moveGravity();  // no falling blocks during the Gorgoth duel
    processMonsterTurns(this);
    this.tickRangedCooldown();
    this.updateVisibility();
    this.pushUI();
    if (this.timeDilationTurns > 0) {
      this.timeDilationTurns--;
      if (this.timeDilationTurns === 0) {
        this.cb.log('⌛ Time Dilation fades.', 'log-neutral');
        this.cb.onAction();  // reset tick interval to normal speed
      }
    }
  }

  // ── Player turn (action-driven) ──────────────────────────────────────────

  private advanceTurn(): void {
    if (this.player.hp <= 0) return;
    applyStatusEffects(this);
    applyRegen(this);
    applyAuraStun(this);
    processHazards(this);
    this.processSpecialTiles();
    this.moveGravity();
    processMonsterTurns(this);
    this.tickRangedCooldown();
    this.updateVisibility();
    this.pushUI();
    if (this.timeDilationTurns > 0) {
      this.timeDilationTurns--;
      if (this.timeDilationTurns === 0) {
        this.cb.log('⌛ Time Dilation fades.', 'log-neutral');
      }
    }
    this.cb.onAction();
  }

  private tickRangedCooldown(): void {
    if (this.player.rangedCooldown > 0) this.player.rangedCooldown--;
  }

  getRunStats(): RunStats {
    return {
      monstersKilled: this.monstersKilled,
      bossesKilled:   this.bossesKilled,
      linesCleared:   this.linesCleared,
      biggestCombo:   this.biggestCombo,
      damageTaken:    this.damageTaken,
    };
  }

  // ── Level-up boon pick ───────────────────────────────────────────────────

  openLevelUpBoons(): void {
    this.paused = true;
    const tier = getBoonTierForFloor(this.dungeonLevel);
    const pool = BOONS_BY_TIER[tier];
    const choices = getThreeRandomBoons(pool, this.player.boons.map(b => b.id));
    this.cb.onLevelUp?.(choices, (index) => {
      this.player.addBoon(choices[index]!);
      this.paused = false;
      this.pushUI();
      this.cb.onAction?.();
    });
  }

  // ── Class selection ──────────────────────────────────────────────────────

  getRandomClasses(count = 4): ClassDef[] {
    return CLASSES.slice(0, count);
  }

  applyClass(id: string): void {
    const cls = CLASSES.find(c => c.id === id);
    if (!cls) return;
    cls.apply(this.player);
    this.activeClassId = id;
    this.cb.log(`Playing as ${cls.name}: ${cls.tagline}`, 'log-perk', cls.emoji);
    this.pushUI();
  }

  // ── Modifier selection ───────────────────────────────────────────────────

  getRandomModifiers(count = 3): ModifierDef[] {
    const shuffled = [...MODIFIERS].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, count);
  }

  applyModifier(id: string): void {
    const mod = MODIFIERS.find(m => m.id === id);
    if (!mod) return;
    mod.apply(this);
    this.activeModifierId = id;
    this.cb.log(`Rift Curse active: ${mod.name} — ${mod.desc}`, 'log-perk', mod.emoji);
    this.pushUI();
  }

  // ── Tattoo Artist ─────────────────────────────────────────────────────────

  openTattooArtist(): void {
    this.paused = true;
    const ownedIds = (): string[] => this.player.brands.map(b => b.brand.id);
    let cost = REROLL_BASE_COST;
    let choices = getThreeRandomBrands(ownedIds());
    const commit = (index: number): void => {
      const slot = this.player.brands.length < 5
        ? (['body', 'left_arm', 'right_arm', 'legs', 'head'] as const)[this.player.brands.length]!
        : 'body' as const;
      this.player.addBrand(slot, choices[index]!);
      this.cb.log(`${choices[index]!.name} Brand tattooed on ${slot.replace('_', ' ')}!`, 'log-perk', 'tile_altar');
      this.paused = false;
      this.pushUI();
      this.cb.onAction?.();
    };
    this.cb.onOpenTattooArtist?.(choices, commit, {
      gold: this.gold,
      cost,
      run: () => {
        if (this.gold < cost) return null;
        this.gold -= cost;
        cost = Math.floor(cost * 1.6);
        choices = getThreeRandomBrands(ownedIds());
        this.pushUI();
        return { choices, gold: this.gold, cost };
      },
    });
  }

  openAltar(tier: 1 | 2 | 3): void {
    this.paused = true;
    const pool = BOONS_BY_TIER[tier];
    const ownedIds = (): string[] => this.player.boons.map(b => b.id);
    let cost = REROLL_BASE_COST;
    let choices = getThreeRandomBoons(pool, ownedIds());
    const commit = (index: number): void => {
      this.player.addBoon(choices[index]!);
      this.paused = false;
      this.pushUI();
      this.cb.onAction?.();
    };
    this.cb.onOpenAltar?.(tier, choices, commit, {
      gold: this.gold,
      cost,
      run: () => {
        if (this.gold < cost) return null;
        this.gold -= cost;
        cost = Math.floor(cost * 1.6);
        choices = getThreeRandomBoons(pool, ownedIds());
        this.pushUI();
        return { choices, gold: this.gold, cost };
      },
    });
  }

  // ── Action handlers ──────────────────────────────────────────────────────

  handleHeroMove(dx: number, dy: number): void {
    if (this.player.hp <= 0 || this.paused) return;
    if (this.player.isStunned) {
      this.cb.log('You are stunned!', 'log-damage');
      this.player.statuses = this.player.statuses.map(s => s.type === 'stun' ? { ...s, duration: s.duration - 1 } : s).filter(s => s.duration > 0);
      this.advanceTurn(); return;
    }

    const nx = this.player.x + dx, ny = this.player.y + dy;
    if (nx < 0 || nx >= CONFIG.COLS || ny < 0 || ny >= CONFIG.ROWS) return;

    // Combat has priority and reaches any adjacent tile — even one the hero
    // can't stand on (e.g. Gorgoth phasing down through the void/stack). An
    // enemy on an interactable tile is attacked rather than triggering the tile.
    const monster = this.getMonsterAt(nx, ny);
    if (monster) {
      let forceCrit = false;
      if (this.player.critEvery > 0) {
        this.player.critCount++;
        if (this.player.critCount >= this.player.critEvery) {
          forceCrit = true;
          this.player.critCount = 0;
        }
      }
      playerAttackMonster(monster, this, forceCrit);

      // Biome boss half-HP mechanic
      if (monster.isBoss && !this.bossHalfHpTriggered && monster.hp <= monster.maxHp * 0.5 && this.activeBossOnHalfHp) {
        this.bossHalfHpTriggered = true;
        this.activeBossOnHalfHp(this);
      }

      if (monster.hp <= 0) {
        const bx = monster.x, by = monster.y;
        killMonster(monster, this);
        if (monster.isBoss && this.activeBossOnDeath) {
          this.activeBossOnDeath(this, bx, by);
          this.activeBossOnDeath = null;
        }
      }
      this.advanceTurn(); return;
    }

    if (!this.isValidMove(nx, ny)) {
      this.cb.log('Cannot cross the deep abyss void!', 'log-neutral');
      return;
    }

    // Tattoo Artist tile — consumed on use (like an altar)
    if (this.isTattooTile(nx, ny)) {
      this.player.x = nx; this.player.y = ny;
      this.tattooTiles = this.tattooTiles.filter(t => !(t.x === nx && t.y === ny));
      this.openTattooArtist();
      return;
    }

    // Altar tile
    const altar = this.altarTiles.find(a => a.x === nx && a.y === ny);
    if (altar) {
      this.player.x = nx; this.player.y = ny;
      this.altarTiles = this.altarTiles.filter(a => a !== altar);
      this.openAltar(altar.tier);
      return;
    }

    this.player.x = nx; this.player.y = ny;

    // Check hazard triggers on new tile
    checkHazardTrigger(this.player, this, true);

    // Ice sliding — continue in same direction until hitting wall, monster, or non-ice
    while (this.isIceTile(this.player.x, this.player.y)) {
      const sx = this.player.x + dx, sy = this.player.y + dy;
      if (!this.isValidMove(sx, sy) || this.getMonsterAt(sx, sy) || this.isTattooTile(sx, sy)) break;
      this.player.x = sx; this.player.y = sy;
      checkHazardTrigger(this.player, this, true);
      if (this.map[sx]?.[sy] === Tile.STAIRS) break;
    }

    if (this.map[this.player.x]![this.player.y] === Tile.STAIRS) {
      // Fleeing down a ladder escapes a summoned Gorgoth — the next floor plays
      // as normal. His remaining HP is banked, so you can retreat, grow
      // stronger, and re-summon him to keep whittling him down.
      if (this.gorgothSummoned) {
        const boss = this.monsters.find(m => m.isGorgoth);
        if (boss) this.gorgothHp = Math.max(1, boss.hp);
        this.gorgothSummoned = false;
        this.cb.log('You slip down the ladder — Gorgoth\'s wounds will still be there when you face him again.', 'log-perk', 'tile_stairs');
      }
      this.dungeonLevel++;
      this.floorsDescended++;
      if (this.dungeonLevel % 5 === 0) this.pendingBossFloor = true;
      this.cb.onAudio?.('descend');
      this.updateBiome();
      this.cb.log(`Stepped down to floor ${this.dungeonLevel}!`, 'log-success');
      this.resetDungeonState();
      // Floor event fires every 3 voluntary descents (skip boss floors)
      const isBossFloor = this.dungeonLevel % 5 === 0;
      if (!isBossFloor && this.floorsDescended % 3 === 0 && this.cb.onFloorEvent) {
        const event = getRandomFloorEvent();
        this.paused = true;
        this.cb.onFloorEvent(event, (index) => {
          const msg = event.options[index]?.apply(this) ?? 'Nothing happened.';
          this.cb.log(msg, 'log-perk', event.emoji);
          this.paused = false;
          this.cb.onAction();
        });
      }
    } else {
      this.advanceTurn();
    }
  }

  handleHeroWait(): void {
    if (this.player.hp <= 0 || this.paused) return;
    const nearbyMonster = this.monsters.some(m => Math.abs(m.x - this.player.x) <= 1 && Math.abs(m.y - this.player.y) <= 1);
    const healAmt = nearbyMonster ? 1 : 4;
    const healed = this.player.heal(healAmt);
    if (healed > 0) {
      this.cb.onParticle(this.player.x, this.player.y, `+${healed} HP`, '#69f0ae');
      this.cb.log(`Rested. +${healed} HP.`, 'log-success');
    } else {
      this.cb.log('You wait.', 'log-neutral');
    }
    // Sacred ground bonus heal
    if (this.specialTiles.some(t => t.type === 'sacred' && t.x === this.player.x && t.y === this.player.y)) {
      const bonus = this.player.heal(2);
      if (bonus > 0) {
        this.cb.onParticle(this.player.x, this.player.y, `+${bonus}`, '#ffb74d', undefined, 'special_sacred');
        this.cb.log('Sacred ground — blessed rest!', 'log-success');
      }
    }
    this.advanceTurn();
  }

  handleRangedAttack(): void {
    if (this.player.hp <= 0 || this.paused) return;
    const ability = this.player.rangedAbility;
    if (!ability) {
      this.cb.log('Your class has no ranged ability. (Q)', 'log-neutral');
      return;
    }
    if (this.player.isStunned) {
      this.cb.log('You are stunned!', 'log-damage');
      this.advanceTurn();
      return;
    }
    if (this.player.rangedCooldown > 0) {
      this.cb.log(`${ability.name} on cooldown (${this.player.rangedCooldown} turns).`, 'log-neutral', ability.emoji);
      return;
    }

    switch (ability.abilityType) {
      case 'time_dilation': this.activateTimeDilation(ability); break;
      case 'gravity_well':  this.activateGravityWell(ability);  break;
      case 'consecrate':    this.activateConsecrate(ability);    break;
      case 'overload':      this.activateOverload(ability);      break;
      default:              this.activateBolt(ability);          break;
    }
  }

  private activateBolt(ability: import('./types').RangedAbility): void {
    if (this.player.rangedAmmo === 0) {
      this.cb.log(`No ${ability.name}s left! (Replenish on next floor)`, 'log-neutral');
      return;
    }

    const target = this.findRangedTarget(ability.range);
    if (!target) {
      this.cb.log(`No target in range (${ability.range} tiles).`, 'log-neutral', ability.emoji);
      return;
    }

    this.emitProjectileTrail(target.x, target.y, ability.emoji);
    playerAttackMonster(target, this, false, ability.damageMult);

    if (ability.statusEffect === 'stun' && target.hp > 0 && !target.isStunned) {
      target.statuses.push({ type: 'stun', duration: 1, power: 0 });
      this.cb.log(`${target.name} is smited and stunned!`, 'log-success');
    }

    if (this.player.rangedAmmo > 0) this.player.rangedAmmo--;
    if (ability.cooldownMax > 0) this.player.rangedCooldown = ability.cooldownMax;

    if (target.hp <= 0) {
      const bx = target.x, by = target.y;
      killMonster(target, this);
      if (target.isBoss && this.activeBossOnDeath) {
        this.activeBossOnDeath(this, bx, by);
        this.activeBossOnDeath = null;
      }
    }

    this.advanceTurn();
  }

  private activateTimeDilation(ability: import('./types').RangedAbility): void {
    this.timeDilationTurns = 15;
    this.player.rangedCooldown = ability.cooldownMax;
    this.cb.log('⌛ Time Dilation! Gravity slowed for 15 turns.', 'log-perk');
    this.cb.onParticle(this.player.x, this.player.y, '⌛ SLOW!', '#b39ddb', 16);
    this.cb.onAction();  // immediately restart tick interval with new slow value
    this.advanceTurn();
  }

  private activateGravityWell(ability: import('./types').RangedAbility): void {
    const mdist = (m: Monster) => Math.abs(m.x - this.player.x) + Math.abs(m.y - this.player.y);
    const eligible = [...this.monsters]
      .filter(m => mdist(m) <= ability.range && (this.visibility[m.x]?.[m.y] ?? false))
      .sort((a, b) => mdist(a) - mdist(b));
    const moved = new Set<Monster>();
    for (let step = 0; step < 2; step++) {
      for (const m of eligible) {
        const sx = Math.sign(this.player.x - m.x);
        const sy = Math.sign(this.player.y - m.y);
        for (const [dx, dy] of [[sx, 0], [0, sy]] as [number, number][]) {
          if (dx === 0 && dy === 0) continue;
          const nx = m.x + dx, ny = m.y + dy;
          if (this.map[nx]?.[ny] === Tile.FLOOR && !this.getMonsterAt(nx, ny)) {
            m.x = nx; m.y = ny; moved.add(m);
            this.cb.onParticle(nx, ny, '', '#7e57c2', undefined, 'trap_teleport');
            break;
          }
        }
      }
    }
    for (const m of moved) {
      if (!m.isStunned) m.statuses.push({ type: 'stun', duration: 1, power: 0 });
    }
    this.player.rangedCooldown = ability.cooldownMax;
    this.cb.log(`Gravity Well! ${moved.size} monster(s) pulled & stunned.`, 'log-perk', 'trap_teleport');
    this.advanceTurn();
  }

  private activateConsecrate(ability: import('./types').RangedAbility): void {
    const r = this.player.visionRadius;
    let count = 0;
    for (let cx = 0; cx < CONFIG.COLS; cx++) {
      for (let cy = 0; cy < CONFIG.ROWS; cy++) {
        if (Math.hypot(cx - this.player.x, cy - this.player.y) > r) continue;
        if (this.map[cx]?.[cy] !== Tile.FLOOR) continue;
        if (this.specialTiles.some(t => t.x === cx && t.y === cy)) continue;
        this.specialTiles.push({ x: cx, y: cy, type: 'sacred' });
        count++;
      }
    }
    this.player.rangedCooldown = ability.cooldownMax;
    this.cb.log(`Sacred Grounds! ${count} tiles consecrated.`, 'log-perk', 'special_sacred');
    this.cb.onParticle(this.player.x, this.player.y, 'HOLY', '#fff176', 18, 'special_sacred');
    this.advanceTurn();
  }

  private activateOverload(ability: import('./types').RangedAbility): void {
    const dmg = Math.max(this.dungeonLevel * 5, 8 * this.killsThisFloor);
    const targets = this.monsters.filter(m => this.visibility[m.x]?.[m.y]);
    for (const m of targets) {
      m.hp -= dmg;
      this.cb.onParticle(m.x, m.y, `-${dmg}`, '#ff6d00', 16, 'fx_impact');
    }
    const killed = targets.filter(m => m.hp <= 0);
    this.monsters = this.monsters.filter(m => m.hp > 0);
    for (const m of killed) killMonster(m, this);
    this.cb.log(`Overload! ${targets.length} monsters hit for ${dmg} dmg (${this.killsThisFloor} kills × 8, min floor×5).`, 'log-combo', 'fx_impact');
    this.cb.onParticle(this.player.x, this.player.y, 'BOOM!', '#ff6d00', 18, 'fx_impact');
    this.killsThisFloor = 0;
    this.player.rangedCooldown = ability.cooldownMax;
    this.advanceTurn();
  }

  private findRangedTarget(range: number): import('./entities').Monster | null {
    const inRange = this.monsters.filter(m => {
      const dist = Math.abs(m.x - this.player.x) + Math.abs(m.y - this.player.y);
      return dist <= range
        && (this.visibility[m.x]?.[m.y] ?? false)
        && hasLineOfSight(this.player.x, this.player.y, m.x, m.y, this);
    });
    inRange.sort((a, b) => {
      const da = Math.abs(a.x - this.player.x) + Math.abs(a.y - this.player.y);
      const db = Math.abs(b.x - this.player.x) + Math.abs(b.y - this.player.y);
      return da - db;
    });
    return inRange[0] ?? null;
  }

  private emitProjectileTrail(tx: number, ty: number, icon: string): void {
    // Bresenham path from player to target, emit a dot particle at each step
    let x = this.player.x, y = this.player.y;
    const dx = Math.abs(tx - x), dy = Math.abs(ty - y);
    const sx = x < tx ? 1 : -1, sy = y < ty ? 1 : -1;
    let err = dx - dy;
    while (!(x === tx && y === ty)) {
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x += sx; }
      if (e2 < dx)  { err += dx; y += sy; }
      if (x !== tx || y !== ty) this.cb.onParticle(x, y, '·', '#ffcc02');
    }
    this.cb.onParticle(tx, ty, '', '#ffcc02', undefined, icon);
  }

  handleBlockHold(): void {
    if (this.player.hp <= 0 || this.paused || this.gorgothSummoned) return;
    if (!this.canHold) {
      this.cb.log('Already held this piece — lock it first.', 'log-neutral');
      return;
    }
    if (this.heldType === null) {
      this.heldType = this.currentType;
      this.spawnBlock();
    } else {
      const swapType = this.heldType;
      this.heldType = this.currentType;
      this.setBlockType(swapType);
    }
    this.canHold = false;
    this.cb.onAudio?.('blockMove');
    this.pushUI();
    this.cb.onAction();
  }

  private setBlockType(type: ShapeKey): void {
    this.currentType = type;
    const shape = SHAPES[type];
    this.blockColor = shape.color;
    const roll = Math.random();
    this.currentCursed  = roll < 0.08;
    this.currentBlessed = !this.currentCursed && roll < 0.12;
    this.blockMatrix = shape.matrix.map(row =>
      row.map((cell): CellValue => cell === 0 ? Cell.EMPTY : Cell.FLOOR)
    );
    this.blockX = Math.floor((CONFIG.COLS - this.blockMatrix[0]!.length) / 2);
    this.blockY = 0;
    if (this.checkBlockCollision(this.blockX, this.blockY, this.blockMatrix)) {
      this.summonGorgoth();
    }
  }

  // ── Endgame: Gorgoth the Returned ─────────────────────────────────────────

  /** Overflowing the stack summons the final boss into a cleared arena. */
  summonGorgoth(): void {
    if (this.gorgothSummoned) return;
    this.gorgothSummoned = true;

    // The board the player built stays exactly as it is — no arena reset; only
    // the tetromino supply stops.
    this.blockMatrix = [];
    this.heldType = null;

    // Gorgoth looms in at the very top-centre and grinds his way down to the
    // hero — slow, unstoppable, phasing through the stack. Fixed, brutal stats
    // so descending floors only ever helps you.
    const gx = Math.floor(CONFIG.COLS / 2);
    const boss = new Monster(gx, 0, 'sprite_boss_gorgoth', 'Gorgoth the Returned', this.gorgothHp, GORGOTH_MAX_HP, 48, 2000, true, 'gorgoth', 1, 1);
    boss.combatLevel = 6;  // D20 — even a maxed hero misses ~half the time
    boss.isGorgoth = true;
    this.monsters.push(boss);

    // Half-HP: roar and raise two of the Returned beside him — but only the
    // first time he crosses the threshold this run (persists across summons).
    this.activeBossOnHalfHp = (g) => {
      g.gorgothHalfTriggered = true;
      g.cb.log('GORGOTH ROARS — the Returned claw their way up!', 'log-boss', 'sprite_boss_gorgoth');
      for (const [dx, dy] of [[-1, 0], [1, 0]] as Array<[number, number]>) {
        const ax = boss.x + dx, ay = boss.y + dy;
        if (ax >= 0 && ax < CONFIG.COLS && ay >= 0 && ay < CONFIG.ROWS && g.isValidMove(ax, ay) && !g.getMonsterAt(ax, ay)) {
          g.spawnMonster(g.getRandomMonsterKey(), ax, ay);
        }
      }
    };
    this.activeBossOnDeath = null;  // victory is fired from killMonster (covers every death path)
    this.bossHalfHpTriggered = this.gorgothHalfTriggered;

    // Reveal the whole arena — no fog for the finale.
    for (let x = 0; x < CONFIG.COLS; x++) {
      for (let y = 0; y < CONFIG.ROWS; y++) {
        this.visibility[x]![y] = true;
        this.explored[x]![y] = true;
      }
    }

    this.cb.log('The stack tops out — GORGOTH THE RETURNED looms at the rift\'s edge...', 'log-boss', 'ui_warning');
    this.cb.onParticle(gx, 0, 'GORGOTH', '#ff1744', 18, 'sprite_boss_gorgoth');

    this.paused = true;
    this.cb.onBossWarning?.(
      { char: 'sprite_boss_gorgoth', name: 'Gorgoth the Returned', hpMult: 1, atkMult: 1, xpReward: 2000, flavorText: 'The rift disgorges what it swallowed.' },
      () => { this.paused = false; },
    );
    this.pushUI();
  }

  /** Gorgoth defeated — the run is won. Idempotent. */
  triggerVictory(): void {
    if (this.won) return;
    this.won = true;
    this.cb.log('GORGOTH THE RETURNED FALLS — the rift is sealed. You win!', 'log-boss', 'item_trophy');
    this.cb.onParticle(this.player.x, this.player.y, 'VICTORY', '#ffd54f', 20, 'item_trophy');
    this.cb.onVictory?.(this.dungeonLevel, this.player.totalXpEarned, this.getRunStats());
  }

  handleBlockLeft(): void {
    if (this.player.hp <= 0 || this.paused || this.gorgothSummoned) return;
    if (!this.checkBlockCollision(this.blockX - 1, this.blockY, this.blockMatrix)) { this.blockX--; this.cb.onAudio?.('blockMove'); this.advanceTurn(); }
  }

  handleBlockRight(): void {
    if (this.player.hp <= 0 || this.paused || this.gorgothSummoned) return;
    if (!this.checkBlockCollision(this.blockX + 1, this.blockY, this.blockMatrix)) { this.blockX++; this.cb.onAudio?.('blockMove'); this.advanceTurn(); }
  }

  handleBlockRotate(): void {
    if (this.player.hp <= 0 || this.paused || this.gorgothSummoned) return;
    const rotated = rotateMatrix(this.blockMatrix);
    if (!this.checkBlockCollision(this.blockX, this.blockY, rotated)) { this.blockMatrix = rotated; this.cb.onAudio?.('blockRotate'); this.advanceTurn(); }
  }

  handleBlockSoftDrop(): void {
    if (this.player.hp <= 0 || this.paused || this.gorgothSummoned) return;
    if (!this.checkBlockCollision(this.blockX, this.blockY + 1, this.blockMatrix)) { this.blockY++; this.advanceTurn(); }
    else { this.lockBlock(); this.advanceTurn(); }
  }

  handleBlockDrop(): void {
    if (this.player.hp <= 0 || this.paused || this.gorgothSummoned) return;
    while (!this.checkBlockCollision(this.blockX, this.blockY + 1, this.blockMatrix)) this.blockY++;
    this.lockBlock();
    this.advanceTurn();
  }

  // ── Lookups ──────────────────────────────────────────────────────────────

  getMonsterAt(x: number, y: number): Monster | undefined {
    return this.monsters.find(m => m.x === x && m.y === y);
  }

  // ── Tap-to-inspect ───────────────────────────────────────────────────────

  getInspectInfo(x: number, y: number): InspectInfo | null {
    if (x < 0 || x >= CONFIG.COLS || y < 0 || y >= CONFIG.ROWS) return null;

    if (this.player.x === x && this.player.y === y) {
      const lines = [
        `HP ${this.player.hp}/${this.player.maxHp}`,
        `ATK ${this.player.totalAtk}  DEF ${this.player.totalDef}`,
        `Lv.${this.player.playerLevel}`,
      ];
      if (this.player.boons.length > 0) lines.push(`Boons: ${this.player.boons.map(b => `${spriteIconHTML(b.def.char, 12)}×${b.stacks}`).join(' ')}`);
      return { icon: this.player.char, title: 'You', lines };
    }

    const monster = this.getMonsterAt(x, y);
    if (monster) {
      const hitPct = Math.round(estimateHitChance(this.player.combatLevel, monster.combatLevel) * 100);
      const lines = [
        `HP ${Math.max(0, monster.hp)}/${monster.maxHp}`,
        `ATK ${monster.atk}`,
        `Your hit chance: ${hitPct}%`,
        `Type: ${monster.behaviorType}`,
      ];
      if (monster.statuses.length > 0) lines.push(`Status: ${monster.statuses.map(s => s.type).join(', ')}`);
      return { icon: monster.char, title: monster.name, lines };
    }

    const hazard = this.getHazardAt(x, y);
    if (hazard) {
      if (hazard.type === 'spike') {
        const line = hazard.warning ? `Firing in ${hazard.timer}!` : `Arms in ${hazard.timer} turns`;
        return { icon: 'trap_spike', title: 'Spike Trap', lines: [line] };
      }
      if (hazard.type === 'smoke') {
        return { icon: 'trap_smoke', title: 'Smoke Cloud', lines: ['Limits vision while standing inside'] };
      }
      if (hazard.type === 'teleport') {
        return { icon: 'trap_teleport', title: 'Teleport Rune', lines: ['Warps whoever steps on it to a random floor tile'] };
      }
    }

    if (this.map[x]![y] === Tile.STAIRS) {
      return { icon: 'tile_stairs', title: 'Stairs', lines: ['Descend to the next floor'] };
    }

    if (this.isTattooTile(x, y)) {
      return { icon: 'tile_merchant', title: 'Occult Tattoo Artist', lines: ['Receive a permanent Sacred Brand'] };
    }

    const altarInfo = this.altarTiles.find(a => a.x === x && a.y === y);
    if (altarInfo) {
      const tierName = altarInfo.tier === 3 ? 'Grand Altar (Tier III)' : altarInfo.tier === 2 ? 'Ruined Altar (Tier II)' : 'Minor Altar (Tier I)';
      return { icon: 'tile_altar', title: tierName, lines: ['Step on to choose a stackable boon'] };
    }

    const special = this.specialTiles.find(t => t.x === x && t.y === y);
    if (special) {
      if (special.type === 'swamp')  return { icon: 'special_swamp',  title: 'Swamp',         lines: ['Deals 1 dmg/turn to monsters'] };
      if (special.type === 'sacred') return { icon: 'special_sacred', title: 'Sacred Ground', lines: ['Wait here for +2 bonus HP per rest'] };
      if (special.type === 'ice')    return { icon: 'special_ice',    title: 'Ice',           lines: ['Slide uncontrollably in direction of travel'] };
    }

    return null;
  }

  // ── UI push ──────────────────────────────────────────────────────────────

  private pushUI(): void {
    const activeMod = MODIFIERS.find(m => m.id === this.activeModifierId);
    const activeCls = CLASSES.find(c => c.id === this.activeClassId);
    const biome = getBiomeForFloor(this.dungeonLevel);
    this.cb.updateUI({
      hp: this.player.hp,
      maxHp: this.player.maxHp,
      floor: this.dungeonLevel,
      totalXpEarned: this.player.totalXpEarned,
      gravityRate: tickMsForLevel(this.dungeonLevel, this.player.tickSlowPercent + this.biomeGravityPct),
      nextType: this.nextType,
      heldType: this.heldType,
      canHold: this.canHold,
      pieceState: this.currentCursed ? 'cursed' : this.currentBlessed ? 'blessed' : 'normal',
      xp: this.player.xp,
      xpToNext: this.player.xpToNext,
      playerLevel: this.player.playerLevel,
      boons: this.player.boons.map(b => ({ char: b.def.char, name: b.def.name, stacks: b.stacks, desc: b.def.desc })),
      brands: this.player.brands.map(b => {
        const count = this.player.brands.filter(x => x.brand.id === b.brand.id).length;
        return {
          slot: b.slot, char: b.brand.char, name: b.brand.name,
          setActive: count >= b.brand.setSize,
          desc: b.brand.desc, setDesc: b.brand.setDesc, setSize: b.brand.setSize,
        };
      }),
      statuses: this.player.statuses,
      activeModifier: activeMod ? { emoji: activeMod.emoji, name: activeMod.name } : null,
      activeClass: activeCls ? { emoji: activeCls.emoji, name: activeCls.name } : null,
      biomeName: biome.name,
      rangedAbility: this.player.rangedAbility
        ? {
            name:        this.player.rangedAbility.name,
            emoji:       this.player.rangedAbility.emoji,
            cooldown:    this.player.rangedCooldown,
            cooldownMax: this.player.rangedAbility.cooldownMax,
            ammo:        this.player.rangedAmmo >= 0 ? this.player.rangedAmmo : null,
          }
        : null,
    });
  }
}
