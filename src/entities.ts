import { CONFIG } from './config';
import type { StatusEffect, EquipSlot, EquipmentDef, MonsterDef } from './types';

export class Equipment {
  constructor(
    public readonly def: EquipmentDef,
  ) {}
  get name(): string { return this.def.name; }
  get char(): string { return this.def.char; }
  get slot(): EquipSlot { return this.def.slot; }
  get atkBonus(): number { return this.def.atkBonus; }
  get defBonus(): number { return this.def.defBonus; }
}

export class Player {
  x: number;
  y: number;
  readonly char = '🧙‍♂️';

  hp: number;
  maxHp: number;
  atk: number;

  // Progression
  xp = 0;
  playerLevel = 1;
  xpToNext = 50;

  // Perk-granted bonuses
  visionRadius = 4;
  regenPerTick = 0;
  poisonImmune = false;
  killHeal = 0;
  damageReduction = 0;
  tickSlowPercent = 0;

  // Status effects
  statuses: StatusEffect[] = [];

  // Equipment
  weapon: Equipment | null = null;
  armor: Equipment | null = null;

  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
    this.hp = 45;
    this.maxHp = 45;
    this.atk = 6;
  }

  get totalAtk(): number {
    return this.atk + (this.weapon?.atkBonus ?? 0);
  }

  get totalDef(): number {
    return (this.armor?.defBonus ?? 0) + this.damageReduction;
  }

  get isStunned(): boolean {
    return this.statuses.some(s => s.type === 'stun');
  }

  heal(amount: number): number {
    const prev = this.hp;
    this.hp = Math.min(this.maxHp, this.hp + amount);
    return this.hp - prev;
  }

  takeDamage(amount: number): number {
    const actual = Math.max(0, amount - this.totalDef);
    this.hp = Math.max(0, this.hp - actual);
    return actual;
  }

  gainXP(amount: number): boolean {
    this.xp += amount;
    if (this.xp >= this.xpToNext) {
      this.xp -= this.xpToNext;
      this.playerLevel++;
      this.xpToNext = Math.floor(this.xpToNext * 1.5);
      return true;
    }
    return false;
  }

  equip(equip: Equipment): Equipment | null {
    const prev = equip.slot === 'weapon' ? this.weapon : this.armor;
    if (equip.slot === 'weapon') this.weapon = equip;
    else this.armor = equip;
    return prev;
  }
}

export class Monster {
  statuses: StatusEffect[] = [];
  isBoss: boolean;

  constructor(
    public x: number,
    public y: number,
    public readonly char: string,
    public readonly name: string,
    public hp: number,
    public readonly maxHp: number,
    public readonly atk: number,
    public readonly xpReward: number,
    isBoss = false,
    public readonly behaviorType = 'melee',
    public readonly attackRange = 1,
    public readonly moveSpeed = 1,
    public readonly statusInflict?: MonsterDef['statusInflict'],
  ) {
    this.isBoss = isBoss;
  }

  get isStunned(): boolean {
    return this.statuses.some(s => s.type === 'stun');
  }
}

export class Item {
  constructor(
    public x: number,
    public y: number,
    public readonly char: string,
    public readonly name: string,
    public readonly type: 'heal' | 'stat' | 'weapon' | 'armor',
    public readonly statValue: number,
    public readonly equipDef?: EquipmentDef,
  ) {}
}

// Poolable particle — reset() replaces new() to avoid GC pressure
export class Particle {
  x = 0;
  y = 0;
  text = '';
  color = '';
  life = 0;

  reset(gridX: number, gridY: number, text: string, color: string): void {
    this.x = gridX * CONFIG.TILE_SIZE + CONFIG.TILE_SIZE / 2;
    this.y = gridY * CONFIG.TILE_SIZE + CONFIG.TILE_SIZE / 2;
    this.text = text;
    this.color = color;
    this.life = 1.0;
  }

  update(): void {
    this.y -= 0.5;
    this.life -= 0.05;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.globalAlpha = this.life;
    ctx.fillStyle = this.color;
    ctx.font = 'bold 9px monospace';
    ctx.fillText(this.text, this.x - ctx.measureText(this.text).width / 2, this.y);
    ctx.restore();
  }
}

export class ParticlePool {
  private pool: Particle[] = [];
  private active: Particle[] = [];

  constructor(size = 60) {
    for (let i = 0; i < size; i++) this.pool.push(new Particle());
  }

  spawn(gridX: number, gridY: number, text: string, color: string): void {
    const p = this.pool.pop() ?? new Particle();
    p.reset(gridX, gridY, text, color);
    this.active.push(p);
  }

  tick(ctx: CanvasRenderingContext2D): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const p = this.active[i]!;
      p.update();
      p.draw(ctx);
      if (p.life <= 0) this.pool.push(this.active.splice(i, 1)[0]!);
    }
  }
}
