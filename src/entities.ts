import { CONFIG } from './config';
import { SPRITE_MAP, getSpriteImage } from './sprites';
import { BALANCE } from './balance';
import type { StatusEffect, MonsterDef, RangedAbility, BoonDef, BrandDef, BodyPart } from './types';

export class Player {
  x: number;
  y: number;
  readonly char = 'sprite_player';

  hp: number;
  maxHp: number;
  atk: number;

  // Progression
  xp = 0;
  playerLevel = 1;
  xpToNext = BALANCE.player.xpToNextStart;

  // Perk-granted bonuses
  visionRadius = 4;
  regenPerTick = 0;
  poisonImmune = false;
  killHeal = 0;
  damageReduction = 0;
  tickSlowPercent = 0;

  // Combat dice level (1=D4 … 6=D20); overridden by class, scales with playerLevel
  baseCombatLevel = 2;

  // Miss-pity: consecutive whiffs; the 3rd is upgraded to a guaranteed weak hit
  missStreak = 0;

  get combatLevel(): number {
    const lvl = this.playerLevel;
    for (const band of BALANCE.player.combatLevelBands) {
      if (lvl < band.minPlayerLevel) continue;
      if (band.combatLevel !== undefined) return band.combatLevel;
      if (band.combatLevelFloor !== undefined) return Math.max(this.baseCombatLevel, band.combatLevelFloor);
    }
    return this.baseCombatLevel;
  }

  // Class-set multipliers
  lineClearXpMult = 1;  // Architect doubles line-clear XP
  lineClearDmgMult = 0;  // Cascade: line clears deal lineClearDmgMult×rows×floor dmg
  teleportImmune  = false;  // Rift Weaver resists teleport traps

  // Perk-granted bonuses (boons & brands)
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

  // Run total XP (display metric — accumulates every gainXP call)
  totalXpEarned = 0;

  // Boons
  boons: Array<{ id: string; stacks: number; def: BoonDef }> = [];
  thornDamage = 0;

  // Brands (Ogham Marks)
  brands: Array<{ slot: BodyPart; brand: BrandDef }> = [];
  brandsAcquiredTotal = 0;  // lifetime count — survives the Life Mark's brands-wipe, unlike brands.length
  poisonAttackChance = 0;
  stunAttackChance = 0;
  ghostDodgeCharges = 0;
  bonusHeroMoves = 0;
  lifeBrandRevive = false;
  killAtkBonus = 0;
  killAtkFloorBonus = 0;
  lineClearAoeDmgMult = 0;
  deathwardCharges = 0;
  voidPrismBonus = { atk: 0, hp: 0 };

  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
    this.hp = BALANCE.player.startingHp;
    this.maxHp = BALANCE.player.startingHp;
    this.atk = BALANCE.player.startingAtk;
  }

  get totalAtk(): number {
    return this.atk;
  }

  get totalDef(): number {
    return this.damageReduction;
  }

  get brandsCapped(): boolean {
    return this.brandsAcquiredTotal >= BALANCE.brands.maxLifetime;
  }

  get brandsRemaining(): number {
    return Math.max(0, BALANCE.brands.maxLifetime - this.brandsAcquiredTotal);
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
      this.xpToNext = Math.floor(this.xpToNext * BALANCE.player.xpToNextGrowth);
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

  addBrand(slot: BodyPart, def: BrandDef): void {
    this.brands.push({ slot, brand: def });
    this.brandsAcquiredTotal++;
    def.onEquip(this);
    const count = this.brands.filter(b => b.brand.id === def.id).length;
    if (count % def.setSize === 0) def.onSetComplete(this);
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
  isGorgoth = false;  // the final boss — killing it wins the run
  stepCharge = 0;     // paces Gorgoth's slow descent (moves once per N turns)
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

// Poolable particle — reset() replaces new() to avoid GC pressure
export class Particle {
  x = 0;
  y = 0;
  text = '';
  icon = '';
  color = '';
  life = 0;
  fontSize = 13;
  vx = 0;
  vy = -0.7;
  drag = 1;  // 1 = no decay (today's constant-rise drift); <1 = outward-then-settle for bursts

  reset(
    gridX: number, gridY: number, text: string, color: string, fontSize = 13, icon = '',
    vx = 0, vy = -0.7, drag = 1,
  ): void {
    this.x = gridX * CONFIG.TILE_SIZE + CONFIG.TILE_SIZE / 2 + (Math.random() - 0.5) * CONFIG.TILE_SIZE * 0.4;
    this.y = gridY * CONFIG.TILE_SIZE + CONFIG.TILE_SIZE / 4 + Math.random() * CONFIG.TILE_SIZE * 0.3;
    this.text = text;
    this.icon = icon;
    this.color = color;
    this.life = 1.0;
    this.fontSize = fontSize;
    this.vx = vx;
    this.vy = vy;
    this.drag = drag;
  }

  update(): void {
    this.x += this.vx;
    this.y += this.vy;
    this.vx *= this.drag;
    this.vy *= this.drag;
    this.life -= 0.04;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.globalAlpha = this.life;
    ctx.font = `bold ${this.fontSize}px monospace`;
    const tw = this.text ? ctx.measureText(this.text).width : 0;
    const iconSize = this.icon ? this.fontSize : 0;
    const totalW = tw + (this.icon && this.text ? iconSize + 2 : iconSize);
    let cursorX = this.x - totalW / 2;

    if (this.icon) {
      const coord = SPRITE_MAP[this.icon];
      const img = coord && getSpriteImage(coord.sheet);
      if (img) {
        const scale = Math.min(iconSize / coord.sw, iconSize / coord.sh);
        const iw = coord.sw * scale, ih = coord.sh * scale;
        ctx.drawImage(img, coord.sx, coord.sy, coord.sw, coord.sh, cursorX, this.y - ih / 2 - this.fontSize * 0.15, iw, ih);
      }
      cursorX += iconSize + (this.text ? 2 : 0);
    }

    if (this.text) {
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.strokeText(this.text, cursorX, this.y);
      ctx.fillStyle = this.color;
      ctx.fillText(this.text, cursorX, this.y);
    }
    ctx.restore();
  }
}

export class ParticlePool {
  private pool: Particle[] = [];
  private active: Particle[] = [];

  constructor(size = 60) {
    for (let i = 0; i < size; i++) this.pool.push(new Particle());
  }

  spawn(gridX: number, gridY: number, text: string, color: string, fontSize = 13, icon = ''): void {
    const p = this.pool.pop() ?? new Particle();
    p.reset(gridX, gridY, text, color, fontSize, icon);
    this.active.push(p);
  }

  // Radial burst: `count` icon/dot particles fly outward from the tile then
  // settle (drag < 1), for high-impact moments (crits, kills, level-ups, ...).
  spawnBurst(gridX: number, gridY: number, count: number, color: string, icon = '', fontSize = 10): void {
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.6;
      const speed = 0.5 + Math.random() * 0.7;
      const p = this.pool.pop() ?? new Particle();
      p.reset(gridX, gridY, '', color, fontSize, icon, Math.cos(angle) * speed, Math.sin(angle) * speed, 0.90);
      this.active.push(p);
    }
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
