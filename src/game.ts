import { CONFIG, SHAPES, type ShapeKey } from './config';
import { Tile, Cell, type TileValue, type CellValue, type GameCallbacks, type HazardTile, type RunStats, type ModifierDef, type RelicDef } from './types';
import { Player, Monster, Item, Equipment } from './entities';
import { MONSTERS, BOSSES, ITEMS, EQUIPMENT, PERKS, RELICS, MODIFIERS, type PerkDef } from './content';

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

  // Run stats
  public monstersKilled = 0;
  public bossesKilled = 0;
  public linesCleared = 0;
  public biggestCombo = 0;
  public damageTaken = 0;
  public itemsPickedUp = 0;

  // Internal counters
  private blocksPlacedSinceStairs = 0;
  private pendingBossFloor = false;
  private comboCount = 0;
  private lastLineClearMs = 0;
  private merchantTiles: Array<{ x: number; y: number }> = [];
  private luckyBlockCount = 0;

  private readonly cb: GameCallbacks;

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
      this.triggerDeath('DUNGEON OVERFLOW', 'Masonry blocks stacked to the ceiling!');
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

    for (let r = 0; r < this.blockMatrix.length; r++) {
      for (let c = 0; c < this.blockMatrix[r]!.length; c++) {
        const cell = this.blockMatrix[r]![c]!;
        if (cell === Cell.EMPTY) continue;
        const tx = this.blockX + c, ty = this.blockY + r;
        if (tx < 0 || tx >= CONFIG.COLS || ty < 0 || ty >= CONFIG.ROWS) continue;

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
    const hp  = def.baseHp  + (this.dungeonLevel - 1) * def.hpPerLevel;
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

  // ── Hazard processing ─────────────────────────────────────────────────────

  private processHazards(): void {
    const spikeFirePositions: HazardTile[] = [];

    for (const h of this.hazards) {
      if (h.type !== 'spike') continue;
      h.timer--;
      h.warning = h.timer <= 2;
      if (h.timer <= 0) {
        h.timer = 5 + Math.floor(Math.random() * 4);
        h.warning = false;
        spikeFirePositions.push(h);
      }
    }

    for (const h of spikeFirePositions) {
      const damage = Math.max(1, this.dungeonLevel * 3);
      if (this.player.x === h.x && this.player.y === h.y) {
        const actual = this.player.takeDamage(damage);
        this.damageTaken += actual;
        this.cb.log(`⬆️ Spikes fire! -${actual} HP`, 'log-damage');
        this.cb.onParticle(h.x, h.y, `⬆️ -${actual}`, '#ff5722');
        this.cb.onAudio?.('playerDamage');
        if (this.player.hp <= 0) { this.triggerDeath('SPIKED', 'Impaled by floor spikes.'); return; }
      }
      for (const m of this.monsters) {
        if (m.x === h.x && m.y === h.y) {
          m.hp -= damage;
          this.cb.onParticle(m.x, m.y, `⬆️ -${damage}`, '#ff5722');
        }
      }
      this.monsters = this.monsters.filter(m => m.hp > 0);
    }
  }

  private checkHazardTrigger(entity: { x: number; y: number }, isPlayer: boolean): void {
    const h = this.hazards.find(hz => hz.x === entity.x && hz.y === entity.y);
    if (!h) return;
    if (h.type === 'teleport') {
      this.hazards = this.hazards.filter(hz => hz !== h);
      const oldX = entity.x, oldY = entity.y;
      this.teleportEntity(entity);
      this.cb.onParticle(oldX, oldY, '🌀', '#673ab7');
      if (isPlayer) {
        this.cb.log('🌀 Teleport trap! You vanish in a swirl!', 'log-damage');
        this.cb.onParticle(entity.x, entity.y, '⚡', '#673ab7');
      }
    }
  }

  private teleportEntity(entity: { x: number; y: number }): void {
    const floorTiles: Array<{ x: number; y: number }> = [];
    for (let x = 0; x < CONFIG.COLS; x++) {
      for (let y = 0; y < CONFIG.ROWS; y++) {
        if (this.map[x]![y] !== Tile.FLOOR) continue;
        if (this.getMonsterAt(x, y)) continue;
        if (this.player.x === x && this.player.y === y && entity !== this.player) continue;
        floorTiles.push({ x, y });
      }
    }
    if (floorTiles.length === 0) return;
    const dest = floorTiles[Math.floor(Math.random() * floorTiles.length)]!;
    entity.x = dest.x;
    entity.y = dest.y;
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
        .map(t => t.y < y ? { x: t.x, y: t.y + 1 } : t)
        .filter(t => t.y < CONFIG.ROWS);
      this.hazards = this.hazards
        .map(h => h.y < y ? { ...h, y: h.y + 1 } : h)
        .filter(h => h.y < CONFIG.ROWS);
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

  // ── Status effects ───────────────────────────────────────────────────────

  private applyStatusEffects(): void {
    // Player statuses
    const next: typeof this.player.statuses = [];
    for (const s of this.player.statuses) {
      if (s.type === 'poison' && !this.player.poisonImmune) {
        const dmg = Math.max(0, s.power - this.player.totalDef);
        if (dmg > 0) {
          this.player.hp = Math.max(0, this.player.hp - dmg);
          this.damageTaken += dmg;
          this.cb.onParticle(this.player.x, this.player.y, `☠ -${dmg}`, '#9c27b0');
          this.cb.onAudio?.('poison');
          this.cb.log(`Poison deals ${dmg} damage!`, 'log-damage');
          if (this.player.hp <= 0) { this.triggerDeath('HERO DEFEATED', 'Succumbed to poison.'); return; }
        }
      }
      const remaining = s.duration - 1 - this.player.statusDurationBonus;
      if (remaining > 0) next.push({ ...s, duration: remaining + this.player.statusDurationBonus });
      else this.cb.log(`${s.type.charAt(0).toUpperCase() + s.type.slice(1)} wore off.`, 'log-neutral');
    }
    this.player.statuses = next;

    // Monster statuses
    for (const m of this.monsters) {
      const nextM: typeof m.statuses = [];
      for (const s of m.statuses) {
        if (s.type === 'poison') {
          m.hp -= s.power;
          this.cb.onParticle(m.x, m.y, `☠ -${s.power}`, '#9c27b0');
          if (m.hp <= 0) break;
        }
        if (s.duration > 1) nextM.push({ ...s, duration: s.duration - 1 });
      }
      m.statuses = nextM;
    }
    this.monsters = this.monsters.filter(m => m.hp > 0);
  }

  private applyRegen(): void {
    if (this.player.regenPerTick > 0) {
      const gained = this.player.heal(this.player.regenPerTick);
      if (gained > 0) this.cb.onParticle(this.player.x, this.player.y, `+${gained}`, '#2e7d32');
    }
  }

  private applyAuraStun(): void {
    if (this.player.auraStunRadius <= 0) return;
    for (const m of this.monsters) {
      const dist = Math.abs(m.x - this.player.x) + Math.abs(m.y - this.player.y);
      if (dist <= this.player.auraStunRadius && !m.isStunned) {
        m.statuses.push({ type: 'stun', duration: 1, power: 0 });
      }
    }
  }

  // ── Floor transitions ────────────────────────────────────────────────────

  private transitionToNextFloor(): void {
    this.dungeonLevel++;
    if (this.dungeonLevel % 5 === 0) this.pendingBossFloor = true;
    this.cb.log(`Collapsed down to depth floor ${this.dungeonLevel}!`, 'log-tetris');
    this.resetDungeonState();
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
    this.applyStatusEffects();
    this.applyRegen();
    this.applyAuraStun();
    this.processHazards();
    this.moveGravity();
    this.processMonsterTurns();
    this.updateVisibility();
    this.pushUI();
  }

  // ── Player turn (action-driven) ──────────────────────────────────────────

  private advanceTurn(): void {
    if (this.player.hp <= 0) return;
    this.applyStatusEffects();
    this.applyRegen();
    this.applyAuraStun();
    this.processHazards();
    this.moveGravity();
    this.processMonsterTurns();
    this.updateVisibility();
    this.pushUI();
    this.cb.onAction();
  }

  // ── Monster AI ───────────────────────────────────────────────────────────

  private processMonsterTurns(): void {
    if (this.player.hp <= 0) return;
    for (const m of this.monsters) {
      if (this.player.hp <= 0) return;
      if (m.isStunned) {
        m.statuses = m.statuses
          .map(s => s.type === 'stun' ? { ...s, duration: s.duration - 1 } : s)
          .filter(s => s.duration > 0);
        continue;
      }
      switch (m.behaviorType) {
        case 'ranged':    this.processRangedMonster(m);    break;
        case 'healer':    this.processHealerMonster(m);    break;
        case 'berserker': this.processBerserkerMonster(m); break;
        case 'swift':     this.processSwiftMonster(m);     break;
        default:          this.processMeleeMonster(m);     break;
      }
    }
  }

  private monsterAttackPlayer(m: Monster): void {
    // Dodge chance from Echo Stone relic
    if (this.player.dodgeChance > 0 && Math.random() < this.player.dodgeChance) {
      this.cb.log(`${m.name} attacks — you dodge!`, 'log-success');
      this.cb.onParticle(this.player.x, this.player.y, 'DODGE!', '#29b6f6');
      return;
    }
    const actual = this.player.takeDamage(Math.max(1, m.atk));
    this.damageTaken += actual;
    this.cb.log(`${m.name} hits you! -${actual} HP`, 'log-damage');
    this.cb.onParticle(this.player.x, this.player.y, `-${actual}`, '#ef5350');
    this.cb.onAudio?.('playerDamage');
    if (m.statusInflict && Math.random() < m.statusInflict.chance) {
      if (!this.player.statuses.some(s => s.type === m.statusInflict!.type)) {
        this.player.statuses.push({ type: m.statusInflict.type, duration: m.statusInflict.duration, power: m.statusInflict.power });
        this.cb.log(`You are ${m.statusInflict.type}ed!`, 'log-damage');
      }
    }
    if (this.player.hp <= 0) this.triggerDeath('HERO DEFEATED', 'Your health pool dropped to zero.');
  }

  private moveMonsterToward(m: Monster): void {
    const sx = Math.sign(this.player.x - m.x);
    const sy = Math.sign(this.player.y - m.y);
    let nx = m.x + sx, ny = m.y;
    if (!this.isValidMove(nx, ny) || this.getMonsterAt(nx, ny)) { nx = m.x; ny = m.y + sy; }
    if (this.isValidMove(nx, ny) && !this.getMonsterAt(nx, ny)) {
      m.x = nx; m.y = ny;
      this.checkHazardTrigger(m, false);
    }
  }

  // Simple Bresenham check for ranged line-of-sight
  private hasLineOfSight(x1: number, y1: number, x2: number, y2: number): boolean {
    const absDx = Math.abs(x2 - x1);
    const absDy = Math.abs(y2 - y1);
    const sx = x1 < x2 ? 1 : -1;
    const sy = y1 < y2 ? 1 : -1;
    let err = absDx - absDy;
    let x = x1, y = y1;
    for (;;) {
      if (x === x2 && y === y2) break;
      if (this.map[x]?.[y] === Tile.VOID && !(x === x1 && y === y1)) return false;
      const e2 = 2 * err;
      if (e2 > -absDy) { err -= absDy; x += sx; }
      if (e2 < absDx)  { err += absDx; y += sy; }
    }
    return true;
  }

  private processMeleeMonster(m: Monster): void {
    const dist = Math.abs(m.x - this.player.x) + Math.abs(m.y - this.player.y);
    if (dist === 1) { this.monsterAttackPlayer(m); }
    else if (dist <= 5) { this.moveMonsterToward(m); }
  }

  private processRangedMonster(m: Monster): void {
    const dx   = this.player.x - m.x;
    const dy   = this.player.y - m.y;
    const dist = Math.abs(dx) + Math.abs(dy);
    if (dist <= m.attackRange && this.hasLineOfSight(m.x, m.y, this.player.x, this.player.y)) {
      this.monsterAttackPlayer(m);
    } else if (dist <= 2) {
      const nx = m.x - Math.sign(dx), ny = m.y - Math.sign(dy);
      if (this.isValidMove(nx, ny) && !this.getMonsterAt(nx, ny)) { m.x = nx; m.y = ny; }
    } else if (dist <= m.attackRange + 3) {
      this.moveMonsterToward(m);
    }
  }

  private processHealerMonster(m: Monster): void {
    const wounded = this.monsters.find(other =>
      other !== m && other.hp < other.maxHp &&
      Math.abs(other.x - m.x) + Math.abs(other.y - m.y) <= 1,
    );
    if (wounded) {
      const healAmt = Math.max(1, Math.floor(wounded.maxHp * 0.25));
      wounded.hp = Math.min(wounded.maxHp, wounded.hp + healAmt);
      this.cb.onParticle(wounded.x, wounded.y, `+${healAmt}`, '#4caf50');
      this.cb.log(`${m.name} heals ${wounded.name}!`, 'log-damage');
      return;
    }
    this.processMeleeMonster(m);
  }

  private processBerserkerMonster(m: Monster): void {
    const dist = Math.abs(m.x - this.player.x) + Math.abs(m.y - this.player.y);
    if (dist === 1) {
      const enraged = m.hp < m.maxHp * 0.5;
      this.monsterAttackPlayer(m);
      if (enraged && this.player.hp > 0) {
        this.cb.log(`${m.name} rages and strikes again!`, 'log-damage');
        this.monsterAttackPlayer(m);
      }
    } else if (dist <= 5) {
      this.moveMonsterToward(m);
    }
  }

  private processSwiftMonster(m: Monster): void {
    const dist = Math.abs(m.x - this.player.x) + Math.abs(m.y - this.player.y);
    if (dist === 1) {
      this.monsterAttackPlayer(m);
    } else if (dist <= 7) {
      this.moveMonsterToward(m);
      if (this.player.hp > 0 && Math.abs(m.x - this.player.x) + Math.abs(m.y - this.player.y) > 1) {
        this.moveMonsterToward(m); // Second step
      }
    }
  }

  // ── Combat helpers ───────────────────────────────────────────────────────

  private killMonster(m: Monster): void {
    this.cb.onAudio?.('kill');
    this.monstersKilled++;
    if (m.isBoss) this.bossesKilled++;
    this.score += Math.floor((m.isBoss ? 500 : 80) * this.scoreMultiplier);
    this.monsters = this.monsters.filter(x => x !== m);
    const levelled = this.player.gainXP(m.xpReward);
    if (levelled) {
      this.cb.log(`✨ LEVEL UP! Now level ${this.player.playerLevel}!`, 'log-perk');
      this.paused = true;
      this.cb.onLevelUp(this.player.playerLevel);
    }
    const killHeal = this.player.heal(this.player.killHeal);
    if (killHeal > 0) this.cb.onParticle(this.player.x, this.player.y, `+${killHeal} HP`, '#69f0ae');
    // Relic onKill hooks
    for (const relic of this.player.relics) {
      relic.onKill?.(this.player);
    }
    if (m.isBoss) {
      this.cb.log(`⚔️ BOSS SLAIN: ${m.name}!`, 'log-boss');
      this.cb.onParticle(m.x, m.y, '🏆 BOSS!', '#ffd54f');
    } else {
      const healBonus = this.player.heal(3);
      if (healBonus > 0) {
        this.cb.onParticle(this.player.x, this.player.y, `+${healBonus} HP`, '#69f0ae');
        this.cb.log(`Siphoned essence of ${m.name}! +${healBonus} HP`, 'log-success');
      } else {
        this.cb.log(`Defeated ${m.name}!`, 'log-success');
      }
    }
  }

  private triggerDeath(title: string, reason: string): void {
    this.cb.onDeath(title, reason, this.dungeonLevel, this.score, this.getRunStats());
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

  buyMerchantItem(index: number, stock: typeof import('./content').MERCHANT_STOCK): void {
    const item = stock[index];
    if (!item || this.score < item.cost) {
      this.cb.log('Not enough score to purchase!', 'log-damage');
      return;
    }
    this.score -= item.cost;
    const result = item.apply(this.player);
    this.cb.log(`Bought ${item.name}: ${result}`, 'log-success');
    this.paused = false;
    this.pushUI();
    this.cb.onAction();
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

      if (monster.hp <= 0) this.killMonster(monster);
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
    this.checkHazardTrigger(this.player, true);

    if (this.map[this.player.x]![this.player.y] === Tile.STAIRS) {
      this.dungeonLevel++;
      if (this.dungeonLevel % 5 === 0) this.pendingBossFloor = true;
      this.cb.onAudio?.('descend');
      this.cb.log(`Stepped down to floor ${this.dungeonLevel}!`, 'log-success');
      this.resetDungeonState();
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

  // ── UI push ──────────────────────────────────────────────────────────────

  private pushUI(): void {
    const activeMod = MODIFIERS.find(m => m.id === this.activeModifierId);
    this.cb.updateUI({
      hp: this.player.hp,
      maxHp: this.player.maxHp,
      floor: this.dungeonLevel,
      score: this.score,
      gravityRate: tickMsForLevel(this.dungeonLevel, this.player.tickSlowPercent),
      nextType: this.nextType,
      xp: this.player.xp,
      xpToNext: this.player.xpToNext,
      playerLevel: this.player.playerLevel,
      weaponName: this.player.weapon?.name ?? null,
      armorName: this.player.armor?.name ?? null,
      statuses: this.player.statuses,
      activeModifier: activeMod ? { emoji: activeMod.emoji, name: activeMod.name } : null,
      relics: this.player.relics,
    });
  }
}
