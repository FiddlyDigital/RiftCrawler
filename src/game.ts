import { CONFIG, SHAPES, type ShapeKey } from './config';
import { Tile, Cell, type TileValue, type CellValue, type GameCallbacks, type HazardTile, type RunStats, type ModifierDef, type RelicDef, type InspectInfo } from './types';
import { Player, Monster, Item, Equipment } from './entities';
import { MONSTERS, BOSSES, ITEMS, EQUIPMENT, PERKS, RELICS, MODIFIERS, CLASSES, getBiomeForFloor, getRandomFloorEvent, type PerkDef, type ClassDef } from './content';
import { applyStatusEffects, applyRegen, applyAuraStun } from './systems/statusEffects';
import { processHazards, checkHazardTrigger } from './systems/hazards';
import { killMonster, triggerDeath } from './systems/combat';
import { processMonsterTurns } from './systems/monsterAI';

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
  private comboCount = 0;
  private lastLineClearMs = 0;
  private merchantTiles: Array<{ x: number; y: number }> = [];
  private luckyBlockCount = 0;

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
          return Math.random() < 0.6 ? Cell.ITEM_POTION : Cell.ITEM_EQUIPMENT;
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
        if (rand < monsterChance + 0.11) return Cell.ITEM_EQUIPMENT;
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
    return this.map[x]![y] === Tile.FLOOR || this.map[x]![y] === Tile.STAIRS || this.isMerchantTile(x, y);
  }

  private isMerchantTile(x: number, y: number): boolean {
    return this.merchantTiles.some(t => t.x === x && t.y === y);
  }

  getHazardAt(x: number, y: number): HazardTile | undefined {
    return this.hazards.find(h => h.x === x && h.y === y);
  }

  // ── Block locking ────────────────────────────────────────────────────────

  private lockBlock(): void {
    const bombPositions: Array<{ x: number; y: number }> = [];
    const landedCells: Array<{ x: number; y: number }> = [];

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
        } else if (cell === Cell.MERCHANT) {
          this.map[tx]![ty] = Tile.FLOOR;
          this.colors[tx]![ty] = '#1a4a1a';
          this.merchantTiles.push({ x: tx, y: ty });
        } else if (cell === Cell.TRAP_SPIKE) {
          this.map[tx]![ty] = Tile.FLOOR;
          this.colors[tx]![ty] = this.blockColor;
          this.hazards.push({ x: tx, y: ty, type: 'spike', timer: 5 + Math.floor(Math.random() * 4), warning: false });
        } else if (cell === Cell.TRAP_SMOKE) {
          this.map[tx]![ty] = Tile.FLOOR;
          this.colors[tx]![ty] = this.blockColor;
          this.hazards.push({ x: tx, y: ty, type: 'smoke', timer: 0, warning: false });
        } else if (cell === Cell.TRAP_TELEPORT) {
          this.map[tx]![ty] = Tile.FLOOR;
          this.colors[tx]![ty] = this.blockColor;
          this.hazards.push({ x: tx, y: ty, type: 'teleport', timer: 0, warning: false });
        } else {
          this.map[tx]![ty] = Tile.FLOOR;
          this.colors[tx]![ty] = this.blockColor;
        }

        this.instantiateRider(cell, tx, ty);
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

  // ── Monster spawning helper ───────────────────────────────────────────────

  private spawnMonster(key: string, tx: number, ty: number): void {
    const def = MONSTERS[key];
    if (!def) return;
    const hp  = Math.floor((def.baseHp  + (this.dungeonLevel - 1) * def.hpPerLevel) * this.biomeMonsterHpMult);
    const atk = def.baseAtk + (this.dungeonLevel - 1) * def.atkPerLevel;
    const m = new Monster(
      tx, ty, def.char, def.name, hp, hp, atk, def.xpReward,
      false,
      def.behaviorType ?? 'melee',
      def.attackRange  ?? 1,
      def.moveSpeed    ?? 1,
      def.statusInflict,
    );
    if (this.frozenRift) {
      m.statuses.push({ type: 'stun', duration: 1, power: 0 });
    }
    this.monsters.push(m);
    this.cb.onParticle(tx, ty, def.spawnMsg, '#e57373');
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
        this.hazards = this.hazards.filter(h => !(h.x === x && h.y === y));
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
      const bossDef = BOSSES[(Math.floor(this.dungeonLevel / 5) - 1) % BOSSES.length]!;
      const baseHp = 18 + (this.dungeonLevel - 1) * 3;
      const baseAtk = 5 + (this.dungeonLevel - 1);
      const hp = Math.floor(baseHp * bossDef.hpMult);
      const atk = Math.floor(baseAtk * bossDef.atkMult);
      this.monsters.push(new Monster(tx, ty, bossDef.char, bossDef.name, hp, hp, atk, bossDef.xpReward, true));
      this.cb.log(`⚠️ ${bossDef.flavorText} ${bossDef.name} descends!`, 'log-boss');
      this.cb.onParticle(tx, ty, '⚠️ BOSS', '#ff0000');
      // Boss cinematic pause
      this.paused = true;
      this.cb.onBossWarning?.(bossDef, () => { this.paused = false; });

    } else if (cell === Cell.RELIC) {
      const def = RELICS[Math.floor(Math.random() * RELICS.length)]!;
      this.items.push(new Item(tx, ty, def.char, def.name, 'relic', 0, undefined, def));

    } else if (cell === Cell.ITEM_POTION) {
      const def = ITEMS['potion']!;
      this.items.push(new Item(tx, ty, def.char, def.name, def.type, def.statValue));

    } else if (cell === Cell.ITEM_SWORD) {
      const def = ITEMS['sword']!;
      this.items.push(new Item(tx, ty, def.char, def.name, def.type, def.statValue));

    } else if (cell === Cell.ITEM_EQUIPMENT) {
      const tier = Math.min(3, 1 + Math.floor(this.dungeonLevel / 4));
      const eligible = EQUIPMENT.filter(e => e.tier <= tier);
      const equipDef = eligible[Math.floor(Math.random() * eligible.length)]!;
      this.items.push(new Item(tx, ty, equipDef.char, equipDef.name, equipDef.slot, 0, equipDef));
    }
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
      this.hazards = this.hazards
        .filter(h => h.y !== y)
        .map(h => h.y < y ? { ...h, y: h.y + 1 } : h);
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

      let added = Math.floor(scoreForLines(rowsCleared, this.dungeonLevel) * this.scoreMultiplier);
      if (this.comboCount > 0) {
        const mult = 1 + this.comboCount * 0.5;
        added = Math.floor(added * mult);
        this.cb.log(`🔥 COMBO x${this.comboCount + 1}! +${added} Score`, 'log-combo');
      }
      this.score += added;

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
    this.hazards = [];
    this.player.x = 4;
    this.player.y = 23;
    this.generateStartPlatform();
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
    this.moveGravity();
    processMonsterTurns(this);
    this.updateVisibility();
    this.pushUI();
  }

  // ── Player turn (action-driven) ──────────────────────────────────────────

  private advanceTurn(): void {
    if (this.player.hp <= 0) return;
    applyStatusEffects(this);
    applyRegen(this);
    applyAuraStun(this);
    processHazards(this);
    this.moveGravity();
    processMonsterTurns(this);
    this.updateVisibility();
    this.pushUI();
    this.cb.onAction();
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

    // Attack monster — crit every N moves if Mana Beads active
    const monster = this.getMonsterAt(nx, ny);
    if (monster) {
      let dmg = this.player.totalAtk;
      if (this.player.critEvery > 0) {
        this.player.critCount++;
        if (this.player.critCount >= this.player.critEvery) {
          dmg = dmg * 2;
          this.player.critCount = 0;
          this.cb.onParticle(nx, ny, '💥 CRIT!', '#ffd54f');
        }
      }
      monster.hp -= dmg;
      this.cb.log(`Hit ${monster.name} for ${dmg}.${monster.isBoss ? ' (BOSS)' : ''}`, 'log-success');
      this.cb.onParticle(monster.x, monster.y, `-${dmg}`, '#69f0ae');
      this.cb.onAudio?.('hit');

      if (Math.random() < 0.10 && !monster.isStunned) {
        monster.statuses.push({ type: 'stun', duration: 1, power: 0 });
        this.cb.log(`${monster.name} is stunned!`, 'log-success');
      }

      if (monster.hp <= 0) killMonster(monster, this);
      this.advanceTurn(); return;
    }

    // Pick up item
    const item = this.getItemAt(nx, ny);
    if (item) {
      this.itemsPickedUp++;
      if (item.type === 'heal') {
        const healAmt = Math.floor(item.statValue * this.potionHealMult);
        const healed = this.player.heal(healAmt);
        this.cb.log(`Recovered ${healed} HP.`, 'log-success');
        this.cb.onParticle(nx, ny, `+${healed} HP`, '#69f0ae');
      } else if (item.type === 'stat') {
        this.player.atk += item.statValue;
        this.cb.log(`ATK +${item.statValue}.`, 'log-success');
        this.cb.onParticle(nx, ny, `+${item.statValue} ATK`, '#ffd54f');
      } else if ((item.type === 'weapon' || item.type === 'armor') && item.equipDef) {
        const equip = new Equipment(item.equipDef);
        const prev = this.player.equip(equip);
        this.cb.log(`Equipped ${item.name}!${prev ? ` (replaced ${prev.name})` : ''}`, 'log-perk');
        this.cb.onParticle(nx, ny, `⚔️ Equip!`, '#ffd54f');
      } else if (item.type === 'relic' && item.relicDef) {
        this.pickupRelic(item.relicDef);
      }
      this.items = this.items.filter(i => i !== item);
    }

    this.player.x = nx; this.player.y = ny;

    // Check hazard triggers on new tile
    checkHazardTrigger(this.player, this, true);

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
    this.advanceTurn();
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
      if (this.player.weapon) lines.push(`⚔️ ${this.player.weapon.name}`);
      if (this.player.armor) lines.push(`🛡️ ${this.player.armor.name}`);
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
        return { icon: item.char, title: item.name, lines: [`Restores ${item.statValue} HP`] };
      }
      if (item.type === 'stat') {
        return { icon: item.char, title: item.name, lines: [`+${item.statValue} ATK`] };
      }
      if ((item.type === 'weapon' || item.type === 'armor') && item.equipDef) {
        const lines = [`Tier ${item.equipDef.tier}`];
        if (item.equipDef.atkBonus) lines.push(`+${item.equipDef.atkBonus} ATK`);
        if (item.equipDef.defBonus) lines.push(`+${item.equipDef.defBonus} DEF`);
        return { icon: item.char, title: item.name, lines };
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
      xp: this.player.xp,
      xpToNext: this.player.xpToNext,
      playerLevel: this.player.playerLevel,
      weaponName: this.player.weapon?.name ?? null,
      armorName: this.player.armor?.name ?? null,
      statuses: this.player.statuses,
      activeModifier: activeMod ? { emoji: activeMod.emoji, name: activeMod.name } : null,
      activeClass: activeCls ? { emoji: activeCls.emoji, name: activeCls.name } : null,
      biomeName: biome.name,
      relics: this.player.relics,
    });
  }
}
