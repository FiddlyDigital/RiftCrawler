import { CONFIG, SHAPES, type ShapeKey } from './config';
import { Tile, Cell, type TileValue, type CellValue, type GameCallbacks, type HazardTile, type SpecialTile, type RunStats, type ModifierDef, type RelicDef, type InspectInfo, type AltarTile } from './types';
import { Player, Monster, Item } from './entities';
import { MONSTERS, BOSSES, ITEMS, BOONS_BY_TIER, getBoonTierForFloor, getThreeRandomBoons, PERKS, RELICS, MODIFIERS, CLASSES, getBiomeForFloor, getRandomFloorEvent, type PerkDef, type ClassDef } from './content';
import { applyStatusEffects, applyRegen, applyAuraStun } from './systems/statusEffects';
import { processHazards, checkHazardTrigger } from './systems/hazards';
import { killMonster, triggerDeath, playerAttackMonster } from './systems/combat';
import { processMonsterTurns, hasLineOfSight } from './systems/monsterAI';

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
  const base = Math.max(400, 1500 - (level - 1) * 100);
  return Math.floor(base * (1 + slowPercent / 100));
}

export function scoreForLines(count: number, level: number): number {
  const base = [0, 100, 300, 600, 1000];
  return (base[count] ?? 1200) * level;
}

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
  items: Item[];

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
  score = 0;
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

  // Potion pouch (manually consumed via U key, max 3)
  public potionPouch: Item[] = [];

  // Modifier state (active for the whole run)
  public activeModifierId: string | null = null;
  public scoreMultiplier = 1.0;
  public potionHealMult = 1.0;
  public noLineHeal = false;
  public haunted = false;
  public frozenRift = false;
  public luckyEvery = -1;  // -1 = disabled; 0+ = counter

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
  public itemsPickedUp = 0;

  // Internal counters
  private floorsDescended = 0;
  private blocksPlacedSinceStairs = 0;
  private pendingBossFloor = false;
  public comboCount = 0;
  private lastLineClearMs = 0;
  private merchantTiles: Array<{ x: number; y: number }> = [];
  public altarTiles: AltarTile[] = [];
  private luckyBlockCount = 0;

  // Active boss mechanics (set at spawn, cleared on floor reset)
  private activeBossOnHalfHp: ((game: Game) => void) | null = null;
  private activeBossOnDeath:   ((game: Game, x: number, y: number) => void) | null = null;
  private bossHalfHpTriggered = false;

  readonly cb: GameCallbacks;

  constructor(callbacks: GameCallbacks) {
    this.cb = callbacks;
    this.map = this.emptyMap();
    this.colors = this.emptyColors();
    this.visibility = this.emptyBoolGrid(false);
    this.explored = this.emptyBoolGrid(false);
    this.player = new Player(4, 23);
    this.monsters = [];
    this.items = [];
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

    // Lucky modifier: every 5th block guarantees an item
    if (this.luckyEvery >= 0) {
      this.luckyBlockCount++;
    }
    const luckyItemThisBlock = this.luckyEvery >= 0 && this.luckyBlockCount >= 5;
    if (luckyItemThisBlock) this.luckyBlockCount = 0;

    let stairsInjected = false;
    let bossInjected = false;
    let bombInjected = false;
    let merchantInjected = false;
    let altarInjected = false;
    let trapInjected = false;
    let relicInjected = false;
    let luckyItemInjected = false;

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

        // Lucky guaranteed item
        if (luckyItemThisBlock && !luckyItemInjected) {
          luckyItemInjected = true;
          return Math.random() < 0.6 ? Cell.ITEM_POTION : Cell.ITEM_SWORD;
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
        if (!relicInjected && Math.random() < 0.03) {
          relicInjected = true;
          return Cell.RELIC;
        }
        // Hazard traps — one type per block, ~2% each
        if (!trapInjected) {
          const r = Math.random();
          if (r < 0.02) { trapInjected = true; return Cell.TRAP_SPIKE; }
          if (r < 0.04) { trapInjected = true; return Cell.TRAP_SMOKE; }
          if (r < 0.06) { trapInjected = true; return Cell.TRAP_TELEPORT; }
        }

        // Monster spawn (haunted = double rate)
        const monsterChance = this.haunted ? 0.18 : 0.09;
        const rand = Math.random();
        if (rand < monsterChance) {
          const r = Math.random();
          if (r < 0.25) return Cell.MONSTER_RAT;
          if (r < 0.50) return Cell.MONSTER_SKEL;
          if (r < 0.65) return Cell.MONSTER_ARCHER;
          if (r < 0.78) return Cell.MONSTER_SLIME;
          if (r < 0.89) return Cell.MONSTER_ORC;
          return Cell.MONSTER_BAT;
        }
        if (rand < monsterChance + 0.09) return Math.random() < 0.6 ? Cell.ITEM_POTION : Cell.ITEM_SWORD;
        return Cell.FLOOR;
      }),
    );

    this.blockX = Math.floor((CONFIG.COLS - this.blockMatrix[0]!.length) / 2);
    this.blockY = 0;

    if (this.checkBlockCollision(this.blockX, this.blockY, this.blockMatrix)) {
      triggerDeath(this, 'DUNGEON OVERFLOW', 'Masonry blocks stacked to the ceiling!');
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
    let ghostY = this.blockY;
    while (!this.checkBlockCollision(this.blockX, ghostY + 1, this.blockMatrix)) ghostY++;
    return ghostY;
  }

  isValidMove(x: number, y: number): boolean {
    if (x < 0 || x >= CONFIG.COLS || y < 0 || y >= CONFIG.ROWS) return false;
    return this.map[x]![y] === Tile.FLOOR || this.map[x]![y] === Tile.STAIRS || this.isMerchantTile(x, y) || this.isAltarTile(x, y);
  }

  private isMerchantTile(x: number, y: number): boolean {
    return this.merchantTiles.some(t => t.x === x && t.y === y);
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
          this.colors[tx]![ty] = '#1a4a1a';
          this.merchantTiles.push({ x: tx, y: ty });
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
        const msgs = { swamp: '🌿 Swamp — monsters take 1 dmg/turn!', sacred: '✨ Sacred ground — Wait here for bonus heal!', ice: '❄️ Ice — entities slide across!' };
        for (const fc of lockedFloorCells) {
          if (!this.hazards.some(h => h.x === fc.x && h.y === fc.y) &&
              !this.merchantTiles.some(t => t.x === fc.x && t.y === fc.y)) {
            this.specialTiles.push({ x: fc.x, y: fc.y, type: tileType as SpecialTile['type'] });
          }
        }
        this.cb.log(msgs[tileType as keyof typeof msgs]!, 'log-tetris');
      } else if (this.currentType === 'Z') {
        for (const fc of lockedFloorCells) {
          if (!this.hazards.some(h => h.x === fc.x && h.y === fc.y) &&
              !this.merchantTiles.some(t => t.x === fc.x && t.y === fc.y)) {
            this.hazards.push({ x: fc.x, y: fc.y, type: 'spike', timer: 5, warning: false });
          }
        }
        this.cb.log('⬆️ Spike Field — fires every 5 ticks!', 'log-tetris');
      } else if (this.currentType === 'O' && Math.random() < (this.activeClassId === 'architect' ? 0.80 : 0.40)) {
        const eligible = lockedFloorCells.filter(fc =>
          !this.getItemAt(fc.x, fc.y) && !this.getMonsterAt(fc.x, fc.y) &&
          !this.altarTiles.some(a => a.x === fc.x && a.y === fc.y)
        );
        if (eligible.length > 0) {
          const fc = eligible[Math.floor(Math.random() * eligible.length)]!;
          const tier: 1 | 2 | 3 = 1;
          const altarColor = '#1a0a2a';
          this.colors[fc.x]![fc.y] = altarColor;
          this.altarTiles.push({ x: fc.x, y: fc.y, tier });
          this.cb.log('⛩️ Vault sealed — an Altar revealed!', 'log-perk');
          this.cb.onParticle(fc.x, fc.y, '⛩️ ALTAR!', '#ce93d8');
        }
      } else if (this.currentType === 'T' && this.player.rangedCooldown > 0) {
        const cdReduce = this.activeClassId === 'architect' ? 4 : 2;
        this.player.rangedCooldown = Math.max(0, this.player.rangedCooldown - cdReduce);
        this.cb.log('💜 Arcane resonance — ranged cooldown reduced!', 'log-perk');
      }
    }

    // Cursed piece: spawn an extra monster
    if (this.currentCursed && lockedFloorCells.length > 0) {
      const eligible = lockedFloorCells.filter(fc => !this.getMonsterAt(fc.x, fc.y));
      if (eligible.length > 0) {
        const fc = eligible[Math.floor(Math.random() * eligible.length)]!;
        this.spawnMonster(this.getRandomMonsterKey(), fc.x, fc.y);
        this.cb.log('⛧ A cursed rift tears open — something crawls out!', 'log-damage');
        this.cb.onParticle(fc.x, fc.y, '💀 CURSE!', '#ef5350');
      }
    }

    // Blessed piece: consecrate one cell as sacred ground
    if (this.currentBlessed && lockedFloorCells.length > 0) {
      const eligible = lockedFloorCells.filter(fc =>
        !this.specialTiles.some(t => t.x === fc.x && t.y === fc.y)
      );
      if (eligible.length > 0) {
        const fc = eligible[Math.floor(Math.random() * eligible.length)]!;
        this.specialTiles.push({ x: fc.x, y: fc.y, type: 'sacred' });
        this.cb.log('✨ A blessed rift — holy ground consecrated!', 'log-perk');
        this.cb.onParticle(fc.x, fc.y, '✨ BLESSED!', '#ffb74d');
      }
    }

    this.cb.onBlockLand?.(landedCells);

    // Trigger bombs after all cells written
    for (const pos of bombPositions) {
      this.triggerBomb(pos.x, pos.y);
    }

    this.checkLineClears();
    this.cb.onAudio?.('blockLand');
    this.spawnBlock();
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
    const name = isElite ? `⭐ ${def.name}` : def.name;
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
      this.cb.onParticle(tx, ty, '⭐ ELITE!', '#ffd700');
      this.cb.log(`⭐ Elite ${def.name} stalks out of the dark!`, 'log-boss');
    } else {
      this.cb.onParticle(tx, ty, def.spawnMsg, '#e57373');
    }
  }

  dropRelicAt(x: number, y: number): void {
    const def = RELICS[Math.floor(Math.random() * RELICS.length)]!;
    this.items.push(new Item(x, y, def.char, def.name, 'relic', 0, def));
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
        const shard = new Monster(sx, sy, '🔷', 'Crystal Shard', shardHp, shardHp, shardAtk, 30);
        shard.combatLevel = 3;
        this.monsters.push(shard);
        this.cb.onParticle(sx, sy, '💎', '#80d8ff');
        spawned++;
      }
    }
    this.cb.log('💎 The Crystal Golem shatters — shards emerge!', 'log-boss');
  }

  // Called by Rift Tyrant onHalfHp
  triggerGravityBurst(): void {
    this.blockY = Math.max(0, this.blockY - 5);
    this.cb.log('⚡ Rift Tyrant tears the weave — gravity surges!', 'log-boss');
    this.cb.onParticle(this.player.x, this.player.y, '⚡ SURGE!', '#aa00ff');
    this.cb.onAudio?.('bossWarn');
  }

  // ── Dungeon rooms ────────────────────────────────────────────────────────

  private maybeSpawnDungeonRoom(): void {
    if (Math.random() > 0.25) return;
    const roll = Math.random();
    if (roll < 0.33)      this.spawnRoom('vault');
    else if (roll < 0.66) this.spawnRoom('den');
    else                  this.spawnRoom('shrine');
  }

  private getRandomMonsterKey(): string {
    const all = ['rat', 'skeleton', 'goblin_archer', 'cave_slime', 'berserker_orc', 'plague_bat'];
    const maxIdx = Math.min(all.length - 1, 1 + Math.floor(this.dungeonLevel / 3));
    return all[Math.floor(Math.random() * (maxIdx + 1))]!;
  }

  private spawnRoom(type: 'vault' | 'den' | 'shrine'): void {
    // Rooms are lateral 2×3 extensions of the starting platform (x=2..7, y=23..24).
    // Left side: x=0..1. Right side: x=8..9. y=22..24 (one row above platform top).
    // This keeps the centre columns clear so falling blocks are never intercepted.
    const colors = { vault: '#3d2b00', den: '#2d0000', shrine: '#002d30' } as const;
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
      const relicDef = RELICS[Math.floor(Math.random() * RELICS.length)]!;
      this.items.push(new Item(innerX, midY, relicDef.char, relicDef.name, 'relic', 0, relicDef));
      // Place a bonus altar in the vault
      const altarX = roomX + (side === 'left' ? 0 : 1);
      const altarTier: 1 | 2 | 3 = this.dungeonLevel >= 8 ? 3 : this.dungeonLevel >= 4 ? 2 : 1;
      const altarColor = altarTier === 3 ? '#2a1a00' : altarTier === 2 ? '#001a2a' : '#1a0a2a';
      this.colors[altarX]![midY] = altarColor;
      this.altarTiles.push({ x: altarX, y: midY, tier: altarTier });
      this.spawnMonster(this.getRandomMonsterKey(), innerX, roomY);
      this.cb.log(`💰 A Treasure Vault lies to the ${side} — guarded.`, 'log-perk');
    } else if (type === 'den') {
      const positions: Array<[number, number]> = [[0, 0], [1, 0], [0, 1]];
      for (const [pdx, pdy] of positions) {
        this.spawnMonster(this.getRandomMonsterKey(), roomX + pdx, roomY + pdy);
      }
      this.cb.log(`☠️ A Monster Den lurks to the ${side}...`, 'log-damage');
    } else {
      const relicDef = RELICS[Math.floor(Math.random() * RELICS.length)]!;
      this.items.push(new Item(roomX, midY, relicDef.char, relicDef.name, 'relic', 0, relicDef));
      const potionDef = ITEMS['potion']!;
      this.items.push(new Item(innerX, midY, potionDef.char, potionDef.name, potionDef.type, potionDef.statValue));
      this.cb.log(`✨ An Ancient Shrine whispers to the ${side}...`, 'log-perk');
    }
  }

  private triggerBomb(cx: number, cy: number): void {
    this.cb.log('💣 BOOM! Bomb block detonated!', 'log-tetris');
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const x = cx + dx, y = cy + dy;
        if (x < 0 || x >= CONFIG.COLS || y < 0 || y >= CONFIG.ROWS) continue;
        this.map[x]![y] = Tile.VOID;
        this.colors[x]![y] = null;
        this.monsters = this.monsters.filter(m => !(m.x === x && m.y === y));
        this.items = this.items.filter(i => !(i.x === x && i.y === y));
        this.merchantTiles = this.merchantTiles.filter(t => !(t.x === x && t.y === y));
        this.altarTiles = this.altarTiles.filter(a => !(a.x === x && a.y === y));
        this.hazards = this.hazards.filter(h => !(h.x === x && h.y === y));
        this.specialTiles = this.specialTiles.filter(t => !(t.x === x && t.y === y));
        this.cb.onParticle(x, y, '💥', '#ff6b35');
      }
    }
    this.score += Math.floor(50 * this.dungeonLevel * this.scoreMultiplier);
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
      this.cb.log(`⚠️ ${bossDef.flavorText} ${bossDef.name} descends!`, 'log-boss');
      this.cb.onParticle(tx, ty, '⚠️ BOSS', '#ff0000');
      // Boss cinematic pause
      this.paused = true;
      this.cb.onBossWarning?.(bossDef, () => { this.paused = false; });

    } else if (cell === Cell.RELIC) {
      const def = RELICS[Math.floor(Math.random() * RELICS.length)]!;
      this.items.push(new Item(tx, ty, def.char, def.name, 'relic', 0, def));

    } else if (cell === Cell.ITEM_POTION) {
      const r = Math.random();
      const key = r < 0.45 ? 'potion'
                : r < 0.70 ? 'mana_potion'
                : r < 0.85 ? 'antidote'
                : r < 0.95 ? 'shock_flask'
                : 'grenade';
      const def = ITEMS[key]!;
      this.items.push(new Item(tx, ty, def.char, def.name, def.type as Item['type'], def.statValue));

    } else if (cell === Cell.ITEM_SWORD) {
      const def = ITEMS['sword']!;
      this.items.push(new Item(tx, ty, def.char, def.name, def.type, def.statValue));
    }
  }

  // ── Item pickup & potion use ──────────────────────────────────────────────

  public isIceTile(x: number, y: number): boolean {
    return this.specialTiles.some(t => t.type === 'ice' && t.x === x && t.y === y);
  }

  private pickupItemAt(item: Item, x: number, y: number): void {
    let removeFromMap = true;
    this.itemsPickedUp++;
    if (item.type === 'heal' || item.type === 'mana' || item.type === 'grenade' || item.type === 'cure' || item.type === 'shock') {
      if (this.potionPouch.length < 3) {
        this.potionPouch.push(item);
        this.cb.log(`Picked up ${item.name}.`, 'log-neutral');
        this.cb.onParticle(x, y, item.char, '#69f0ae', 16);
        this.cb.onAudio?.('itemPickup');
      } else {
        this.cb.log('Pouch full — drink one first (U).', 'log-neutral');
        removeFromMap = false;
        this.itemsPickedUp--;
      }
    } else if (item.type === 'stat') {
      this.player.atk += item.statValue;
      this.cb.log(`ATK +${item.statValue}.`, 'log-success');
      this.cb.onParticle(x, y, `+${item.statValue} ATK`, '#ffd54f', 16);
      this.cb.onAudio?.('itemPickup');
    } else if (item.type === 'relic' && item.relicDef) {
      this.pickupRelic(item.relicDef);
    }
    if (removeFromMap) this.items = this.items.filter(i => i !== item);
  }

  handleUseItem(): void {
    if (this.player.hp <= 0 || this.paused) return;
    if (this.potionPouch.length === 0) {
      this.cb.log('Pouch is empty!', 'log-neutral');
      return;
    }
    const item = this.potionPouch.shift()!;
    this.cb.onAudio?.('itemUse');
    if (item.type === 'heal') {
      const amt = Math.floor(item.statValue * this.potionHealMult);
      const healed = this.player.heal(amt);
      this.cb.log(`🧪 Drank ${item.name} — +${healed} HP.`, 'log-success');
      this.cb.onParticle(this.player.x, this.player.y, `+${healed}HP`, '#69f0ae', 16);
    } else if (item.type === 'mana') {
      this.player.rangedCooldown = 0;
      this.cb.log(`💧 Drank ${item.name} — ability recharged!`, 'log-success');
      this.cb.onParticle(this.player.x, this.player.y, '✨ MANA', '#7986cb', 14);
    } else if (item.type === 'cure') {
      this.player.statuses = [];
      this.cb.log(`💊 Used ${item.name} — all afflictions cured!`, 'log-success');
      this.cb.onParticle(this.player.x, this.player.y, '💊 CURED', '#a5d6a7', 14);
    } else if (item.type === 'grenade') {
      const dmg = item.statValue * this.dungeonLevel;
      const inRange = this.monsters.filter(m =>
        Math.abs(m.x - this.player.x) + Math.abs(m.y - this.player.y) <= 2
      );
      for (const m of inRange) {
        m.hp -= dmg;
        this.cb.onParticle(m.x, m.y, `💣-${dmg}`, '#ff6b35', 16);
        if (m.hp <= 0) killMonster(m, this);
      }
      this.cb.log(`💣 Grenade! Hit ${inRange.length} monster(s) for ${dmg} dmg.`, 'log-success');
      this.cb.onParticle(this.player.x, this.player.y, '💣 BOOM!', '#ff6b35', 18);
    } else if (item.type === 'shock') {
      const range = 5;
      const stunned = this.monsters.filter(m => {
        const dist = Math.abs(m.x - this.player.x) + Math.abs(m.y - this.player.y);
        return dist <= range && (this.visibility[m.x]?.[m.y] ?? false);
      });
      for (const m of stunned) {
        m.statuses.push({ type: 'stun', duration: item.statValue, power: 0 });
        this.cb.onParticle(m.x, m.y, '⚡STUN', '#ffd54f', 14);
      }
      this.cb.log(`⚡ Shock Flask! ${stunned.length} monster(s) stunned for ${item.statValue} turns.`, 'log-success');
      this.cb.onParticle(this.player.x, this.player.y, '⚡', '#ffd54f', 18);
    }
    this.advanceTurn();
  }

  // ── Relic helpers ─────────────────────────────────────────────────────────

  private pickupRelic(def: RelicDef): void {
    if (this.player.relics.length >= 2) {
      const dropped = this.player.relics.shift()!;
      this.cb.log(`Dropped ${dropped.name} (relic cap reached).`, 'log-neutral');
    }
    this.player.relics.push(def);
    def.onPickup?.(this.player);
    this.cb.log(`✨ Relic found: ${def.name} — ${def.desc}`, 'log-perk');
    this.cb.onParticle(this.player.x, this.player.y, '🔮 RELIC!', '#9c27b0');
    this.pushUI();
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
      this.merchantTiles = this.merchantTiles
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

      let added = Math.floor(scoreForLines(rowsCleared, this.dungeonLevel) * this.scoreMultiplier * this.player.lineClearScoreMult);
      if (this.comboCount > 0) {
        const mult = 1 + this.comboCount * 0.5;
        added = Math.floor(added * mult);
        this.cb.log(`🔥 COMBO x${this.comboCount + 1}! +${added} Score`, 'log-combo');
        this.cb.onCombo?.(this.comboCount + 1);
        if (this.comboCount >= 2) this.cb.onAudio?.('comboMilestone', this.comboCount + 1);
      }
      this.score += added;

      // XP for line clears — multi-row clears give a stacked bonus; Architect doubles it
      const LINE_CLEAR_XP = [0, 15, 40, 80, 150];
      const xpGain = Math.round((LINE_CLEAR_XP[Math.min(rowsCleared, 4)] ?? 150) * this.player.lineClearXpMult);
      this.cb.onParticle(this.player.x, this.player.y, `+${xpGain}XP`, '#ce93d8', 14);
      const levelled = this.player.gainXP(xpGain);
      if (levelled) {
        this.cb.log(`✨ LEVEL UP! Now level ${this.player.playerLevel}!`, 'log-perk');
        this.paused = true;
        this.cb.onLevelUp(this.player.playerLevel);
      }

      // Relic: Ember Core — deal damage to visible monsters on line clear
      if (this.player.lineClearDamage > 0) {
        for (const m of this.monsters) {
          if (this.visibility[m.x]?.[m.y]) {
            m.hp -= this.player.lineClearDamage;
            this.cb.onParticle(m.x, m.y, `-${this.player.lineClearDamage}🔥`, '#ff6b35');
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
            this.cb.onParticle(m.x, m.y, `💥-${dmg}`, '#ff6d00', 14);
          }
        }
        this.monsters = this.monsters.filter(m => m.hp > 0);
      }

      // Annihilation Rune: line clears deal floor×mult dmg to ALL monsters
      if (this.player.lineClearAoeDmgMult > 0) {
        const aoeDmg = Math.floor(this.player.lineClearAoeDmgMult * this.dungeonLevel);
        for (const m of this.monsters) {
          m.hp -= aoeDmg;
          this.cb.onParticle(m.x, m.y, `☄️-${aoeDmg}`, '#ff6d00');
        }
        this.monsters = this.monsters.filter(m => m.hp > 0);
      }

      // Relic onLineClear hooks
      for (const relic of this.player.relics) {
        relic.onLineClear?.(this.player, rowsCleared);
      }

      if (!this.noLineHeal) {
        const lineHeal = this.player.heal(10);
        if (lineHeal > 0) {
          this.cb.onParticle(this.player.x, this.player.y, `+${lineHeal} HP`, '#69f0ae');
          if (this.comboCount === 0) this.cb.log(`Row cleared! +${lineHeal} HP.`, 'log-tetris');
        } else if (this.comboCount === 0) {
          this.cb.log(`Dungeon Row Cleared! +${added} Score.`, 'log-tetris');
        }
      } else if (this.comboCount === 0) {
        this.cb.log(`Dungeon Row Cleared! +${added} Score. (Cursed — no heal)`, 'log-tetris');
      }
    }
  }

  private shiftEntitiesDown(thresholdY: number): void {
    for (const m of this.monsters) { if (m.y < thresholdY) m.y++; }
    for (const i of this.items)    { if (i.y < thresholdY) i.y++; }
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
    this.items = [];
    this.merchantTiles = [];
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
    this.moveGravity();
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
      itemsPickedUp:  this.itemsPickedUp,
    };
  }

  // ── Perk selection ───────────────────────────────────────────────────────

  getRandomPerks(count = 3): PerkDef[] {
    const shuffled = [...PERKS].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, count);
  }

  applyPerk(perkId: string): void {
    const perk = PERKS.find(p => p.id === perkId);
    if (!perk) return;
    perk.apply(this.player);
    this.cb.log(`Perk gained: ${perk.name} — ${perk.desc}`, 'log-perk');
    this.paused = false;
    this.pushUI();
    this.cb.onAction();
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
    this.cb.log(`Playing as ${cls.emoji} ${cls.name}: ${cls.tagline}`, 'log-perk');
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
    this.cb.log(`Rift Curse active: ${mod.emoji} ${mod.name} — ${mod.desc}`, 'log-perk');
    this.pushUI();
  }

  // ── Shop ─────────────────────────────────────────────────────────────────

  openShop(): void {
    this.paused = true;
    this.cb.onOpenShop(this.score);
  }

  buyMerchantItem(index: number, stock: typeof import('./content').MERCHANT_STOCK): number | null {
    const item = stock[index];
    if (!item || this.score < item.cost) {
      this.cb.log('Not enough score to purchase!', 'log-damage');
      return null;
    }
    this.score -= item.cost;
    const result = item.apply(this.player);
    this.cb.log(`Bought ${item.name}: ${result}`, 'log-success');
    this.pushUI();
    return this.score;
  }

  closeShop(): void {
    this.paused = false;
    this.cb.onAction();
  }

  openAltar(tier: 1 | 2 | 3): void {
    this.paused = true;
    const pool = BOONS_BY_TIER[tier];
    const choices = getThreeRandomBoons(pool);
    this.cb.onOpenAltar?.(tier, choices, (index) => {
      this.player.addBoon(choices[index]!);
      this.paused = false;
      this.pushUI();
      this.cb.onAction?.();
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

    if (!this.isValidMove(nx, ny)) {
      this.cb.log('Cannot cross the deep abyss void!', 'log-neutral');
      return;
    }

    // Merchant tile
    if (this.isMerchantTile(nx, ny)) {
      this.player.x = nx; this.player.y = ny;
      this.openShop();
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

    // Attack monster — Mana Beads forces a critical every N attacks
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

    // Pick up item
    const item = this.getItemAt(nx, ny);
    if (item) this.pickupItemAt(item, nx, ny);

    this.player.x = nx; this.player.y = ny;

    // Check hazard triggers on new tile
    checkHazardTrigger(this.player, this, true);

    // Ice sliding — continue in same direction until hitting wall, monster, or non-ice
    while (this.isIceTile(this.player.x, this.player.y)) {
      const sx = this.player.x + dx, sy = this.player.y + dy;
      if (!this.isValidMove(sx, sy) || this.getMonsterAt(sx, sy) || this.isMerchantTile(sx, sy)) break;
      this.player.x = sx; this.player.y = sy;
      const slideItem = this.getItemAt(sx, sy);
      if (slideItem) this.pickupItemAt(slideItem, sx, sy);
      checkHazardTrigger(this.player, this, true);
      if (this.map[sx]?.[sy] === Tile.STAIRS) break;
    }

    if (this.map[this.player.x]![this.player.y] === Tile.STAIRS) {
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
          this.cb.log(msg, 'log-perk');
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
        this.cb.onParticle(this.player.x, this.player.y, `+${bonus}✨`, '#ffb74d');
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
      this.cb.log(`${ability.emoji} ${ability.name} on cooldown (${this.player.rangedCooldown} turns).`, 'log-neutral');
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
      this.cb.log(`${ability.emoji} No target in range (${ability.range} tiles).`, 'log-neutral');
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
            this.cb.onParticle(nx, ny, '🌀', '#7e57c2');
            break;
          }
        }
      }
    }
    for (const m of moved) {
      if (!m.isStunned) m.statuses.push({ type: 'stun', duration: 1, power: 0 });
    }
    this.player.rangedCooldown = ability.cooldownMax;
    this.cb.log(`🌀 Gravity Well! ${moved.size} monster(s) pulled & stunned.`, 'log-perk');
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
    this.cb.log(`✨ Sacred Grounds! ${count} tiles consecrated.`, 'log-perk');
    this.cb.onParticle(this.player.x, this.player.y, '✨ HOLY', '#fff176', 18);
    this.advanceTurn();
  }

  private activateOverload(ability: import('./types').RangedAbility): void {
    const dmg = Math.max(this.dungeonLevel * 5, 8 * this.killsThisFloor);
    const targets = this.monsters.filter(m => this.visibility[m.x]?.[m.y]);
    for (const m of targets) {
      m.hp -= dmg;
      this.cb.onParticle(m.x, m.y, `💥-${dmg}`, '#ff6d00', 16);
    }
    const killed = targets.filter(m => m.hp <= 0);
    this.monsters = this.monsters.filter(m => m.hp > 0);
    for (const m of killed) killMonster(m, this);
    this.cb.log(`💥 Overload! ${targets.length} monsters hit for ${dmg} dmg (${this.killsThisFloor} kills × 8, min floor×5).`, 'log-combo');
    this.cb.onParticle(this.player.x, this.player.y, '💥 BOOM!', '#ff6d00', 18);
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

  private emitProjectileTrail(tx: number, ty: number, emoji: string): void {
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
    this.cb.onParticle(tx, ty, emoji, '#ffcc02');
  }

  handleBlockHold(): void {
    if (this.player.hp <= 0 || this.paused) return;
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
      triggerDeath(this, 'DUNGEON OVERFLOW', 'Masonry blocks stacked to the ceiling!');
    }
  }

  handleBlockLeft(): void {
    if (this.player.hp <= 0 || this.paused) return;
    if (!this.checkBlockCollision(this.blockX - 1, this.blockY, this.blockMatrix)) { this.blockX--; this.cb.onAudio?.('blockMove'); this.advanceTurn(); }
  }

  handleBlockRight(): void {
    if (this.player.hp <= 0 || this.paused) return;
    if (!this.checkBlockCollision(this.blockX + 1, this.blockY, this.blockMatrix)) { this.blockX++; this.cb.onAudio?.('blockMove'); this.advanceTurn(); }
  }

  handleBlockRotate(): void {
    if (this.player.hp <= 0 || this.paused) return;
    const rotated = rotateMatrix(this.blockMatrix);
    if (!this.checkBlockCollision(this.blockX, this.blockY, rotated)) { this.blockMatrix = rotated; this.cb.onAudio?.('blockRotate'); this.advanceTurn(); }
  }

  handleBlockSoftDrop(): void {
    if (this.player.hp <= 0 || this.paused) return;
    if (!this.checkBlockCollision(this.blockX, this.blockY + 1, this.blockMatrix)) { this.blockY++; this.advanceTurn(); }
    else { this.lockBlock(); this.advanceTurn(); }
  }

  handleBlockDrop(): void {
    if (this.player.hp <= 0 || this.paused) return;
    while (!this.checkBlockCollision(this.blockX, this.blockY + 1, this.blockMatrix)) this.blockY++;
    this.lockBlock();
    this.advanceTurn();
  }

  // ── Lookups ──────────────────────────────────────────────────────────────

  getMonsterAt(x: number, y: number): Monster | undefined {
    return this.monsters.find(m => m.x === x && m.y === y);
  }

  getItemAt(x: number, y: number): Item | undefined {
    return this.items.find(i => i.x === x && i.y === y);
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
      if (this.player.boons.length > 0) lines.push(`Boons: ${this.player.boons.map(b => `${b.def.char}×${b.stacks}`).join(' ')}`);
      if (this.player.relics.length > 0) lines.push(`Relics: ${this.player.relics.map(r => r.name).join(', ')}`);
      return { icon: this.player.char, title: 'You', lines };
    }

    const monster = this.getMonsterAt(x, y);
    if (monster) {
      const lines = [
        `HP ${Math.max(0, monster.hp)}/${monster.maxHp}`,
        `ATK ${monster.atk}`,
        `Type: ${monster.behaviorType}`,
      ];
      if (monster.statuses.length > 0) lines.push(`Status: ${monster.statuses.map(s => s.type).join(', ')}`);
      return { icon: monster.char, title: monster.isBoss ? `👑 ${monster.name}` : monster.name, lines };
    }

    const item = this.getItemAt(x, y);
    if (item) {
      if (item.type === 'heal') {
        return { icon: item.char, title: item.name, lines: [`Restores ${item.statValue} HP`, 'Stored in pouch (U to use)'] };
      }
      if (item.type === 'mana') {
        return { icon: item.char, title: item.name, lines: ['Recharges ranged ability instantly', 'Stored in pouch (U to use)'] };
      }
      if (item.type === 'cure') {
        return { icon: item.char, title: item.name, lines: ['Clears all poison & stun', 'Stored in pouch (U to use)'] };
      }
      if (item.type === 'grenade') {
        return { icon: item.char, title: item.name, lines: [`${item.statValue * this.dungeonLevel} dmg to monsters within 2 tiles`, 'Stored in pouch (U to use)'] };
      }
      if (item.type === 'shock') {
        return { icon: item.char, title: item.name, lines: [`Stuns all visible monsters for ${item.statValue} turns`, 'Stored in pouch (U to use)'] };
      }
      if (item.type === 'stat') {
        return { icon: item.char, title: item.name, lines: [`+${item.statValue} ATK`] };
      }
      if (item.type === 'relic' && item.relicDef) {
        return { icon: item.char, title: item.relicDef.name, lines: [item.relicDef.desc] };
      }
    }

    const hazard = this.getHazardAt(x, y);
    if (hazard) {
      if (hazard.type === 'spike') {
        const line = hazard.warning ? `⚠️ Firing in ${hazard.timer}!` : `Arms in ${hazard.timer} turns`;
        return { icon: '⬆️', title: 'Spike Trap', lines: [line] };
      }
      if (hazard.type === 'smoke') {
        return { icon: '💨', title: 'Smoke Cloud', lines: ['Limits vision while standing inside'] };
      }
      if (hazard.type === 'teleport') {
        return { icon: '🌀', title: 'Teleport Rune', lines: ['Warps whoever steps on it to a random floor tile'] };
      }
    }

    if (this.map[x]![y] === Tile.STAIRS) {
      return { icon: '🪜', title: 'Stairs', lines: ['Descend to the next floor'] };
    }

    if (this.isMerchantTile(x, y)) {
      return { icon: '🏪', title: 'Merchant', lines: ['Spend score on potions & gear'] };
    }

    const altarInfo = this.altarTiles.find(a => a.x === x && a.y === y);
    if (altarInfo) {
      const tierName = altarInfo.tier === 3 ? 'Grand Altar (Tier III)' : altarInfo.tier === 2 ? 'Ruined Altar (Tier II)' : 'Minor Altar (Tier I)';
      return { icon: '⛩️', title: tierName, lines: ['Step on to choose a stackable boon'] };
    }

    const special = this.specialTiles.find(t => t.x === x && t.y === y);
    if (special) {
      if (special.type === 'swamp')  return { icon: '🌿', title: 'Swamp',           lines: ['Deals 1 dmg/turn to monsters'] };
      if (special.type === 'sacred') return { icon: '✨', title: 'Sacred Ground',   lines: ['Wait here for +2 bonus HP per rest'] };
      if (special.type === 'ice')    return { icon: '❄️', title: 'Ice',             lines: ['Slide uncontrollably in direction of travel'] };
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
      score: this.score,
      gravityRate: tickMsForLevel(this.dungeonLevel, this.player.tickSlowPercent + this.biomeGravityPct),
      nextType: this.nextType,
      heldType: this.heldType,
      canHold: this.canHold,
      pieceState: this.currentCursed ? 'cursed' : this.currentBlessed ? 'blessed' : 'normal',
      xp: this.player.xp,
      xpToNext: this.player.xpToNext,
      playerLevel: this.player.playerLevel,
      boons: this.player.boons.map(b => ({ char: b.def.char, name: b.def.name, stacks: b.stacks })),
      statuses: this.player.statuses,
      activeModifier: activeMod ? { emoji: activeMod.emoji, name: activeMod.name } : null,
      activeClass: activeCls ? { emoji: activeCls.emoji, name: activeCls.name } : null,
      biomeName: biome.name,
      relics: this.player.relics,
      potionPouch: this.potionPouch.map(p => ({ char: p.char, name: p.name, type: p.type })),
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
