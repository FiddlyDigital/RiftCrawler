import { CONFIG, SHAPES, type ShapeKey } from './config';
import { Tile, Cell, type TileValue, type CellValue, type GameCallbacks } from './types';
import { Player, Monster, Item, Equipment } from './entities';
import { MONSTERS, BOSSES, ITEMS, EQUIPMENT, PERKS, type PerkDef } from './content';

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

  // Internal counters
  private blocksPlacedSinceStairs = 0;
  private pendingBossFloor = false;
  private comboCount = 0;
  private lastLineClearMs = 0;
  private merchantTiles: Array<{ x: number; y: number }> = [];

  private readonly cb: GameCallbacks;

  constructor(callbacks: GameCallbacks) {
    this.cb = callbacks;
    this.map = this.emptyMap();
    this.colors = this.emptyColors();
    this.visibility = this.emptyBoolGrid(false);
    this.explored = this.emptyBoolGrid(false);
    this.player = new Player(4, 13);
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
      this.map[x]![13] = Tile.FLOOR; this.colors[x]![13] = '#333344';
      this.map[x]![14] = Tile.FLOOR; this.colors[x]![14] = '#333344';
    }
  }

  private randomShapeKey(): ShapeKey {
    const keys = Object.keys(SHAPES) as ShapeKey[];
    return keys[Math.floor(Math.random() * keys.length)]!;
  }

  // ── Fog of war ───────────────────────────────────────────────────────────

  updateVisibility(): void {
    const r = this.player.visionRadius;
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

    let stairsInjected = false;
    let bossInjected = false;
    let bombInjected = false;
    let merchantInjected = false;

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
        if (!stairsInjected && (this.blocksPlacedSinceStairs >= 8 || Math.random() < 0.10)) {
          stairsInjected = true;
          this.blocksPlacedSinceStairs = 0;
          return Cell.STAIRS;
        }

        // Special blocks
        if (!bombInjected && Math.random() < 0.05) {
          bombInjected = true;
          return Cell.BOMB;
        }
        if (!merchantInjected && Math.random() < 0.04) {
          merchantInjected = true;
          return Cell.MERCHANT;
        }

        const rand = Math.random();
        if (rand < 0.12) return Math.random() < 0.5 ? Cell.MONSTER_RAT : Cell.MONSTER_SKEL;
        if (rand < 0.18) return Math.random() < 0.6 ? Cell.ITEM_POTION : Cell.ITEM_SWORD;
        if (rand < 0.20) return Cell.ITEM_EQUIPMENT;
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

  isValidMove(x: number, y: number): boolean {
    if (x < 0 || x >= CONFIG.COLS || y < 0 || y >= CONFIG.ROWS) return false;
    return this.map[x]![y] === Tile.FLOOR || this.map[x]![y] === Tile.STAIRS || this.isMerchantTile(x, y);
  }

  private isMerchantTile(x: number, y: number): boolean {
    return this.merchantTiles.some(t => t.x === x && t.y === y);
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
    this.spawnBlock();
  }

  private triggerBomb(cx: number, cy: number): void {
    this.cb.log('💣 BOOM! Bomb block detonated!', 'log-tetris');
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const x = cx + dx, y = cy + dy;
        if (x < 0 || x >= CONFIG.COLS || y < 0 || y >= CONFIG.ROWS) continue;
        this.map[x]![y] = Tile.VOID;
        this.colors[x]![y] = null;
        // Remove any monsters/items in blast radius
        this.monsters = this.monsters.filter(m => !(m.x === x && m.y === y));
        this.items = this.items.filter(i => !(i.x === x && i.y === y));
        this.merchantTiles = this.merchantTiles.filter(t => !(t.x === x && t.y === y));
        this.cb.onParticle(x, y, '💥', '#ff6b35');
      }
    }
    this.score += 50 * this.dungeonLevel;
  }

  private instantiateRider(cell: CellValue, tx: number, ty: number): void {
    if (cell === Cell.MONSTER_RAT) {
      const def = MONSTERS['rat']!;
      const hp = def.baseHp + (this.dungeonLevel - 1) * def.hpPerLevel;
      const atk = def.baseAtk + (this.dungeonLevel - 1) * def.atkPerLevel;
      this.monsters.push(new Monster(tx, ty, def.char, def.name, hp, hp, atk, def.xpReward));
      this.cb.onParticle(tx, ty, def.spawnMsg, '#e57373');

    } else if (cell === Cell.MONSTER_SKEL) {
      const def = MONSTERS['skeleton']!;
      const hp = def.baseHp + (this.dungeonLevel - 1) * def.hpPerLevel;
      const atk = def.baseAtk + (this.dungeonLevel - 1) * def.atkPerLevel;
      this.monsters.push(new Monster(tx, ty, def.char, def.name, hp, hp, atk, def.xpReward));
      this.cb.onParticle(tx, ty, def.spawnMsg, '#e57373');

    } else if (cell === Cell.BOSS) {
      const bossDef = BOSSES[(Math.floor(this.dungeonLevel / 5) - 1) % BOSSES.length]!;
      const baseHp = 18 + (this.dungeonLevel - 1) * 3;
      const baseAtk = 5 + (this.dungeonLevel - 1);
      const hp = Math.floor(baseHp * bossDef.hpMult);
      const atk = Math.floor(baseAtk * bossDef.atkMult);
      this.monsters.push(new Monster(tx, ty, bossDef.char, bossDef.name, hp, hp, atk, bossDef.xpReward, true));
      this.cb.log(`⚠️ ${bossDef.flavorText} ${bossDef.name} descends!`, 'log-boss');
      this.cb.onParticle(tx, ty, '⚠️ BOSS', '#ff0000');

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
      y++;
    }

    if (rowsCleared > 0) {
      const now = performance.now();
      const isCombo = now - this.lastLineClearMs < 2000;
      this.comboCount = isCombo ? this.comboCount + 1 : 0;
      this.lastLineClearMs = now;

      let added = scoreForLines(rowsCleared, this.dungeonLevel);
      if (this.comboCount > 0) {
        const mult = 1 + this.comboCount * 0.5;
        added = Math.floor(added * mult);
        this.cb.log(`🔥 COMBO x${this.comboCount + 1}! +${added} Score`, 'log-combo');
      }
      this.score += added;

      const lineHeal = this.player.heal(10);
      if (lineHeal > 0) {
        this.cb.onParticle(this.player.x, this.player.y, `+${lineHeal} HP`, '#69f0ae');
        if (this.comboCount === 0) this.cb.log(`Row cleared! +${lineHeal} HP.`, 'log-tetris');
      } else if (this.comboCount === 0) {
        this.cb.log(`Dungeon Row Cleared! +${added} Score.`, 'log-tetris');
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
          this.cb.onParticle(this.player.x, this.player.y, `☠ -${dmg}`, '#9c27b0');
          this.cb.log(`Poison deals ${dmg} damage!`, 'log-damage');
          if (this.player.hp <= 0) { this.triggerDeath('HERO DEFEATED', 'Succumbed to poison.'); return; }
        }
      }
      if (s.duration > 1) next.push({ ...s, duration: s.duration - 1 });
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
    this.player.x = 4;
    this.player.y = 13;
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
      if (m.isStunned) { m.statuses = m.statuses.map(s => s.type === 'stun' ? { ...s, duration: s.duration - 1 } : s).filter(s => s.duration > 0); continue; }

      const dx = Math.abs(m.x - this.player.x);
      const dy = Math.abs(m.y - this.player.y);

      if (dx + dy === 1) {
        const rawDmg = Math.max(1, m.atk);
        const actual = this.player.takeDamage(rawDmg);
        this.cb.log(`${m.name} hits you! -${actual} HP`, 'log-damage');
        this.cb.onParticle(this.player.x, this.player.y, `-${actual}`, '#ef5350');

        // Status inflict from skeleton
        const def = Object.values(MONSTERS).find(d => d.name === m.name);
        if (def?.statusInflict && Math.random() < def.statusInflict.chance) {
          if (!this.player.statuses.some(s => s.type === def.statusInflict!.type)) {
            this.player.statuses.push({ type: def.statusInflict.type, duration: def.statusInflict.duration, power: def.statusInflict.power });
            this.cb.log(`You are ${def.statusInflict.type}ed!`, 'log-damage');
          }
        }

        if (this.player.hp <= 0) { this.triggerDeath('HERO DEFEATED', 'Your health pool dropped to zero.'); return; }
      } else if (dx + dy <= 5) {
        const sx = Math.sign(this.player.x - m.x);
        const sy = Math.sign(this.player.y - m.y);
        let nx = m.x + sx, ny = m.y;
        if (!this.isValidMove(nx, ny) || this.getMonsterAt(nx, ny)) { nx = m.x; ny = m.y + sy; }
        if (this.isValidMove(nx, ny) && !this.getMonsterAt(nx, ny)) { m.x = nx; m.y = ny; }
      }
    }
  }

  // ── Combat helpers ───────────────────────────────────────────────────────

  private killMonster(m: Monster): void {
    this.score += m.isBoss ? 500 : 80;
    this.monsters = this.monsters.filter(x => x !== m);
    const levelled = this.player.gainXP(m.xpReward);
    if (levelled) {
      this.cb.log(`✨ LEVEL UP! Now level ${this.player.playerLevel}!`, 'log-perk');
      this.paused = true;
      this.cb.onLevelUp(this.player.playerLevel);
    }
    const killHeal = this.player.heal(this.player.killHeal);
    if (killHeal > 0) this.cb.onParticle(this.player.x, this.player.y, `+${killHeal} HP`, '#69f0ae');
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
    this.cb.onDeath(title, reason, this.dungeonLevel, this.score);
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

    // Attack monster
    const monster = this.getMonsterAt(nx, ny);
    if (monster) {
      const dmg = this.player.totalAtk;
      monster.hp -= dmg;
      this.cb.log(`Hit ${monster.name} for ${dmg}.${monster.isBoss ? ' (BOSS)' : ''}`, 'log-success');
      this.cb.onParticle(monster.x, monster.y, `-${dmg}`, '#69f0ae');

      // Apply stun on player attack (10% base chance)
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
      if (item.type === 'heal') {
        const healed = this.player.heal(item.statValue);
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
      }
      this.items = this.items.filter(i => i !== item);
    }

    this.player.x = nx; this.player.y = ny;

    if (this.map[nx]![ny] === Tile.STAIRS) {
      this.dungeonLevel++;
      if (this.dungeonLevel % 5 === 0) this.pendingBossFloor = true;
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
    if (!this.checkBlockCollision(this.blockX - 1, this.blockY, this.blockMatrix)) { this.blockX--; this.advanceTurn(); }
  }

  handleBlockRight(): void {
    if (this.player.hp <= 0 || this.paused) return;
    if (!this.checkBlockCollision(this.blockX + 1, this.blockY, this.blockMatrix)) { this.blockX++; this.advanceTurn(); }
  }

  handleBlockRotate(): void {
    if (this.player.hp <= 0 || this.paused) return;
    const rotated = rotateMatrix(this.blockMatrix);
    if (!this.checkBlockCollision(this.blockX, this.blockY, rotated)) { this.blockMatrix = rotated; this.advanceTurn(); }
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
    });
  }
}
