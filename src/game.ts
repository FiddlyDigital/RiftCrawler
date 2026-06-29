import { CONFIG, SHAPES, type ShapeKey } from './config';
import { Tile, Cell, type TileValue, type CellValue, type GameCallbacks } from './types';
import { Player, Monster, Item } from './entities';
import { MONSTERS, ITEMS } from './content';

// ── Pure helpers (exported for unit tests) ──────────────────────────────────

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

export function gravityRateForLevel(level: number): number {
  return Math.max(1, 4 - Math.floor(level / 2));
}

export function scoreForLines(count: number, level: number): number {
  const base = [0, 100, 300, 600, 1000];
  return (base[count] ?? 1200) * level;
}

// ── Game state snapshot (used by Renderer read-only) ────────────────────────

export interface GameSnapshot {
  map: TileValue[][];
  colors: (string | null)[][];
  player: Player;
  monsters: readonly Monster[];
  items: readonly Item[];
  blockMatrix: CellValue[][];
  blockX: number;
  blockY: number;
  blockColor: string;
  active: boolean;
}

// ── Core Game class ──────────────────────────────────────────────────────────

export class Game implements GameSnapshot {
  map: TileValue[][];
  colors: (string | null)[][];
  player: Player;
  monsters: Monster[];
  items: Item[];
  blockMatrix: CellValue[][] = [];
  blockX = 0;
  blockY = 0;
  blockColor = '';
  active = true;

  score = 0;
  dungeonLevel = 1;
  currentType: ShapeKey = 'I';
  nextType: ShapeKey = 'I';

  private moveCounter = 0;
  private blocksPlacedSinceStairs = 0;
  private readonly cb: GameCallbacks;

  constructor(callbacks: GameCallbacks) {
    this.cb = callbacks;

    this.map = this.emptyMap();
    this.colors = this.emptyColors();
    this.player = new Player(4, 13);
    this.monsters = [];
    this.items = [];

    this.generateStartPlatform();
    this.currentType = this.randomShapeKey();
    this.nextType = this.randomShapeKey();
    this.spawnBlock();
    this.pushUI();
  }

  // ── Map helpers ─────────────────────────────────────────────────────────

  private emptyMap(): TileValue[][] {
    return Array.from({ length: CONFIG.COLS }, () =>
      Array<TileValue>(CONFIG.ROWS).fill(Tile.VOID),
    );
  }

  private emptyColors(): (string | null)[][] {
    return Array.from({ length: CONFIG.COLS }, () =>
      Array<string | null>(CONFIG.ROWS).fill(null),
    );
  }

  private generateStartPlatform(): void {
    for (let x = 2; x < 8; x++) {
      this.map[x]![13] = Tile.FLOOR;
      this.colors[x]![13] = '#333344';
      this.map[x]![14] = Tile.FLOOR;
      this.colors[x]![14] = '#333344';
    }
  }

  private randomShapeKey(): ShapeKey {
    const keys = Object.keys(SHAPES) as ShapeKey[];
    return keys[Math.floor(Math.random() * keys.length)]!;
  }

  // ── Block spawning ───────────────────────────────────────────────────────

  private spawnBlock(): void {
    this.currentType = this.nextType;
    this.nextType = this.randomShapeKey();
    const shape = SHAPES[this.currentType];
    this.blockColor = shape.color;
    this.blocksPlacedSinceStairs++;

    let stairsInjected = false;
    this.blockMatrix = shape.matrix.map(row =>
      row.map((cell): CellValue => {
        if (cell === 0) return Cell.EMPTY;
        if (!stairsInjected && (this.blocksPlacedSinceStairs >= 8 || Math.random() < 0.10)) {
          stairsInjected = true;
          this.blocksPlacedSinceStairs = 0;
          return Cell.STAIRS;
        }
        const rand = Math.random();
        if (rand < 0.12) return Math.random() < 0.5 ? Cell.MONSTER_RAT : Cell.MONSTER_SKEL;
        if (rand < 0.20) return Math.random() < 0.6 ? Cell.ITEM_POTION : Cell.ITEM_SWORD;
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
          const tx = bx + c;
          const ty = by + r;
          if (tx < 0 || tx >= CONFIG.COLS || ty >= CONFIG.ROWS) return true;
          if (ty >= 0 && this.map[tx]![ty] !== Tile.VOID) return true;
        }
      }
    }
    return false;
  }

  isValidMove(x: number, y: number): boolean {
    if (x < 0 || x >= CONFIG.COLS || y < 0 || y >= CONFIG.ROWS) return false;
    return this.map[x]![y] === Tile.FLOOR || this.map[x]![y] === Tile.STAIRS;
  }

  // ── Block locking ────────────────────────────────────────────────────────

  private lockBlock(): void {
    for (let r = 0; r < this.blockMatrix.length; r++) {
      for (let c = 0; c < this.blockMatrix[r]!.length; c++) {
        const cell = this.blockMatrix[r]![c]!;
        if (cell === Cell.EMPTY) continue;

        const tx = this.blockX + c;
        const ty = this.blockY + r;
        if (tx < 0 || tx >= CONFIG.COLS || ty < 0 || ty >= CONFIG.ROWS) continue;

        if (cell === Cell.STAIRS) {
          this.map[tx]![ty] = Tile.STAIRS;
          this.colors[tx]![ty] = '#8e24aa';
        } else {
          this.map[tx]![ty] = Tile.FLOOR;
          this.colors[tx]![ty] = this.blockColor;
        }

        this.instantiateRider(cell, tx, ty);
      }
    }

    this.checkLineClears();
    this.spawnBlock();
  }

  private instantiateRider(cell: CellValue, tx: number, ty: number): void {
    if (cell === Cell.MONSTER_RAT) {
      const def = MONSTERS['rat']!;
      const hp = def.baseHp + (this.dungeonLevel - 1) * def.hpPerLevel;
      const atk = def.baseAtk + (this.dungeonLevel - 1) * def.atkPerLevel;
      this.monsters.push(new Monster(tx, ty, def.char, def.name, hp, hp, atk));
      this.cb.onParticle(tx, ty, def.spawnMsg, '#e57373');
    } else if (cell === Cell.MONSTER_SKEL) {
      const def = MONSTERS['skeleton']!;
      const hp = def.baseHp + (this.dungeonLevel - 1) * def.hpPerLevel;
      const atk = def.baseAtk + (this.dungeonLevel - 1) * def.atkPerLevel;
      this.monsters.push(new Monster(tx, ty, def.char, def.name, hp, hp, atk));
      this.cb.onParticle(tx, ty, def.spawnMsg, '#e57373');
    } else if (cell === Cell.ITEM_POTION) {
      const def = ITEMS['potion']!;
      this.items.push(new Item(tx, ty, def.char, def.name, def.type, def.statValue));
    } else if (cell === Cell.ITEM_SWORD) {
      const def = ITEMS['sword']!;
      this.items.push(new Item(tx, ty, def.char, def.name, def.type, def.statValue));
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
      for (let x = 0; x < CONFIG.COLS; x++) {
        this.map[x]![0] = Tile.VOID;
        this.colors[x]![0] = null;
      }
      this.shiftEntitiesDown(y);
      y++;
    }

    if (rowsCleared > 0) {
      const added = scoreForLines(rowsCleared, this.dungeonLevel);
      this.score += added;
      const lineHeal = this.player.heal(10);
      if (lineHeal > 0) {
        this.cb.onParticle(this.player.x, this.player.y, `+${lineHeal} HP`, '#69f0ae');
        this.cb.log(`Row collapsed! Clear reward: +${lineHeal} HP.`, 'log-tetris');
      } else {
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

  // ── Floor transitions ────────────────────────────────────────────────────

  private transitionToNextFloor(): void {
    this.dungeonLevel++;
    this.cb.log(`Collapsed down to depth floor ${this.dungeonLevel}!`, 'log-tetris');
    this.resetDungeonState();
  }

  resetDungeonState(): void {
    this.map = this.emptyMap();
    this.colors = this.emptyColors();
    this.monsters = [];
    this.items = [];
    this.player.x = 4;
    this.player.y = 13;
    this.generateStartPlatform();
    this.spawnBlock();
  }

  // ── Turn engine ──────────────────────────────────────────────────────────

  advanceTurn(): void {
    if (this.player.hp <= 0) return;
    this.moveCounter++;

    const rate = gravityRateForLevel(this.dungeonLevel);
    if (this.moveCounter % rate === 0) {
      if (!this.checkBlockCollision(this.blockX, this.blockY + 1, this.blockMatrix)) {
        this.blockY++;
      } else {
        this.lockBlock();
      }
    }

    this.processMonsterTurns();
    this.pushUI();
  }

  private processMonsterTurns(): void {
    if (this.player.hp <= 0) return;
    for (const m of this.monsters) {
      const dx = Math.abs(m.x - this.player.x);
      const dy = Math.abs(m.y - this.player.y);

      if (dx + dy === 1) {
        const dmg = Math.max(1, m.atk);
        this.damagePlayer(dmg, `${m.name} bites you!`);
        this.cb.onParticle(this.player.x, this.player.y, `-${dmg}`, '#ef5350');
      } else if (dx + dy <= 5) {
        const sx = Math.sign(this.player.x - m.x);
        const sy = Math.sign(this.player.y - m.y);
        let nx = m.x + sx;
        let ny = m.y;
        if (!this.isValidMove(nx, ny) || this.getMonsterAt(nx, ny)) {
          nx = m.x;
          ny = m.y + sy;
        }
        if (this.isValidMove(nx, ny) && !this.getMonsterAt(nx, ny)) {
          m.x = nx;
          m.y = ny;
        }
      }
    }
  }

  private damagePlayer(amount: number, reason: string): void {
    this.player.takeDamage(amount);
    this.cb.log(`${reason} -${amount} HP`, 'log-damage');
    if (this.player.hp <= 0) {
      this.triggerDeath('HERO DEFEATED', 'Your health pool dropped to zero.');
    }
  }

  private triggerDeath(title: string, reason: string): void {
    this.cb.onDeath(title, reason, this.dungeonLevel, this.score);
  }

  // ── Public action handlers ───────────────────────────────────────────────

  handleHeroMove(dx: number, dy: number): void {
    if (this.player.hp <= 0) return;
    const nx = this.player.x + dx;
    const ny = this.player.y + dy;

    if (nx < 0 || nx >= CONFIG.COLS || ny < 0 || ny >= CONFIG.ROWS) return;
    if (!this.isValidMove(nx, ny)) {
      this.cb.log('Cannot cross the deep abyss void!', 'log-neutral');
      return;
    }

    const monster = this.getMonsterAt(nx, ny);
    if (monster) {
      monster.hp -= this.player.atk;
      this.cb.log(`Hit ${monster.name} for ${this.player.atk}.`, 'log-success');
      this.cb.onParticle(monster.x, monster.y, `-${this.player.atk}`, '#69f0ae');
      if (monster.hp <= 0) {
        this.score += 80;
        this.monsters = this.monsters.filter(m => m !== monster);
        const healBonus = this.player.heal(3);
        if (healBonus > 0) {
          this.cb.onParticle(this.player.x, this.player.y, `+${healBonus} HP`, '#69f0ae');
          this.cb.log(`Siphoned essence of ${monster.name}! +${healBonus} HP`, 'log-success');
        } else {
          this.cb.log(`Defeated ${monster.name}!`, 'log-success');
        }
      }
      this.advanceTurn();
      return;
    }

    const item = this.getItemAt(nx, ny);
    if (item) {
      if (item.type === 'heal') {
        const healed = this.player.heal(item.statValue);
        this.cb.log(`Recovered ${healed} HP.`, 'log-success');
        this.cb.onParticle(nx, ny, `+${healed} HP`, '#69f0ae');
      } else {
        this.player.atk += item.statValue;
        this.cb.log(`ATK increased by +${item.statValue}.`, 'log-success');
        this.cb.onParticle(nx, ny, `+${item.statValue} ATK`, '#ffd54f');
      }
      this.items = this.items.filter(i => i !== item);
    }

    this.player.x = nx;
    this.player.y = ny;

    if (this.map[nx]![ny] === Tile.STAIRS) {
      this.dungeonLevel++;
      this.cb.log(`You step down the staircase to floor ${this.dungeonLevel}!`, 'log-success');
      this.resetDungeonState();
    } else {
      this.advanceTurn();
    }
  }

  handleHeroWait(): void {
    if (this.player.hp <= 0) return;
    const nearbyMonster = this.monsters.some(
      m => Math.abs(m.x - this.player.x) <= 1 && Math.abs(m.y - this.player.y) <= 1,
    );
    const healAmt = nearbyMonster ? 1 : 4;
    const healed = this.player.heal(healAmt);
    if (healed > 0) {
      this.cb.onParticle(this.player.x, this.player.y, `+${healed} HP`, '#69f0ae');
      this.cb.log(`Rested in safety. +${healed} HP.`, 'log-success');
    } else {
      this.cb.log('You wait.', 'log-neutral');
    }
    this.advanceTurn();
  }

  handleBlockLeft(): void {
    if (this.player.hp <= 0) return;
    if (!this.checkBlockCollision(this.blockX - 1, this.blockY, this.blockMatrix)) {
      this.blockX--;
      this.advanceTurn();
    }
  }

  handleBlockRight(): void {
    if (this.player.hp <= 0) return;
    if (!this.checkBlockCollision(this.blockX + 1, this.blockY, this.blockMatrix)) {
      this.blockX++;
      this.advanceTurn();
    }
  }

  handleBlockRotate(): void {
    if (this.player.hp <= 0) return;
    const rotated = rotateMatrix(this.blockMatrix);
    if (!this.checkBlockCollision(this.blockX, this.blockY, rotated)) {
      this.blockMatrix = rotated;
      this.advanceTurn();
    }
  }

  handleBlockSoftDrop(): void {
    if (this.player.hp <= 0) return;
    if (!this.checkBlockCollision(this.blockX, this.blockY + 1, this.blockMatrix)) {
      this.blockY++;
      this.advanceTurn();
    } else {
      this.lockBlock();
      this.advanceTurn();
    }
  }

  handleBlockDrop(): void {
    if (this.player.hp <= 0) return;
    while (!this.checkBlockCollision(this.blockX, this.blockY + 1, this.blockMatrix)) {
      this.blockY++;
    }
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
      gravityRate: gravityRateForLevel(this.dungeonLevel),
      nextType: this.nextType,
    });
  }
}
