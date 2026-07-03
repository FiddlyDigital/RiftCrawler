import { CONFIG } from './config';
import type { StatusEffect, MonsterDef, RelicDef, RangedAbility, BoonDef } from './types';

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

  // Combat dice level (1=D4 … 6=D20); overridden by class, scales with playerLevel
  baseCombatLevel = 2;

  get combatLevel(): number {
    const lvl = this.playerLevel;
    if (lvl >= 9) return 6;
    if (lvl >= 7) return 5;
    if (lvl >= 5) return 4;
    if (lvl >= 3) return Math.max(this.baseCombatLevel, 3);
    return this.baseCombatLevel;
  }

  // Class-set multipliers
  lineClearXpMult = 1;  // Architect doubles line-clear XP
  teleportImmune  = false;  // Rift Weaver resists teleport traps

  // Relic bonuses
  dodgeChance = 0;
  dodgeHeal = 0;
  lineClearDamage = 0;
  statusDurationBonus = 0;
  auraStunRadius = 0;
  critEvery = 0;
  critCount = 0;

  // Ranged ability (set by class; null = Warrior / no class)
  rangedAbility: RangedAbility | null = null;
  rangedCooldown = 0;
  rangedAmmo = -1;  // -1 = infinite, ≥0 = finite (Rogue darts)

  // Status effects
  statuses: StatusEffect[] = [];

  // Relics (max 2)
  relics: RelicDef[] = [];

  // Run total XP (display metric — accumulates every gainXP call)
  totalXpEarned = 0;

  // Boons
  boons: Array<{ id: string; stacks: number; def: BoonDef }> = [];
  thornDamage = 0;
  killAtkBonus = 0;
  killAtkFloorBonus = 0;
  lineClearAoeDmgMult = 0;
  deathwardCharges = 0;
  voidPrismBonus = { atk: 0, hp: 0 };

  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
    this.hp = 45;
    this.maxHp = 45;
    this.atk = 6;
  }

  get totalAtk(): number {
    return this.atk;
  }

  get totalDef(): number {
    return this.damageReduction;
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
    this.totalXpEarned += amount;
    this.xp += amount;
    if (this.xp >= this.xpToNext) {
      this.xp -= this.xpToNext;
      this.playerLevel++;
      this.xpToNext = Math.floor(this.xpToNext * 1.5);
      return true;
    }
    return false;
  }

  addBoon(def: BoonDef): void {
    const entry = this.boons.find(b => b.id === def.id);
    const newStacks = entry ? ++entry.stacks : 1;
    if (!entry) this.boons.push({ id: def.id, stacks: newStacks, def });
    def.onAdd(this, newStacks);
    this.recomputeVoidPrism();
  }

  private recomputeVoidPrism(): void {
    const prism = this.boons.find(b => b.id === 'void_prism');
    if (!prism) return;
    const distinct = this.boons.length;
    const bonus = distinct * prism.stacks;
    this.atk += bonus - this.voidPrismBonus.atk;
    const hpDelta = (bonus * 2) - this.voidPrismBonus.hp;
    this.maxHp += hpDelta;
    this.hp = Math.min(this.hp + hpDelta, this.maxHp);
    this.voidPrismBonus = { atk: bonus, hp: bonus * 2 };
  }
}

export class Monster {
  statuses: StatusEffect[] = [];
  isBoss: boolean;
  isElite = false;
  combatLevel = 2;

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
    public readonly type: 'heal' | 'stat' | 'mana' | 'grenade' | 'cure' | 'shock' | 'relic',
    public readonly statValue: number,
    public readonly relicDef?: RelicDef,
  ) {}
}

// Poolable particle — reset() replaces new() to avoid GC pressure
export class Particle {
  x = 0;
  y = 0;
  text = '';
  color = '';
  life = 0;
  fontSize = 13;

  reset(gridX: number, gridY: number, text: string, color: string, fontSize = 13): void {
    this.x = gridX * CONFIG.TILE_SIZE + CONFIG.TILE_SIZE / 2 + (Math.random() - 0.5) * CONFIG.TILE_SIZE * 0.4;
    this.y = gridY * CONFIG.TILE_SIZE + CONFIG.TILE_SIZE / 4 + Math.random() * CONFIG.TILE_SIZE * 0.3;
    this.text = text;
    this.color = color;
    this.life = 1.0;
    this.fontSize = fontSize;
  }

  update(): void {
    this.y -= 0.7;
    this.life -= 0.04;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.globalAlpha = this.life;
    ctx.font = `bold ${this.fontSize}px monospace`;
    const tw = ctx.measureText(this.text).width;
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.strokeText(this.text, this.x - tw / 2, this.y);
    ctx.fillStyle = this.color;
    ctx.fillText(this.text, this.x - tw / 2, this.y);
    ctx.restore();
  }
}

export class ParticlePool {
  private pool: Particle[] = [];
  private active: Particle[] = [];

  constructor(size = 60) {
    for (let i = 0; i < size; i++) this.pool.push(new Particle());
  }

  spawn(gridX: number, gridY: number, text: string, color: string, fontSize = 13): void {
    const p = this.pool.pop() ?? new Particle();
    p.reset(gridX, gridY, text, color, fontSize);
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
