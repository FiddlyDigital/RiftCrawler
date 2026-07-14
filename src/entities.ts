import { GameConfig } from './config';
import { SpriteService } from './sprites';
import { Balance } from './balance';
import type { StatusEffect, MonsterDef, RangedAbility, BoonDef, BrandDef, BodyPart } from './types';

/**
 * Small stat-math helpers shared by the player/monster/combat/status systems.
 */
export class StatMath {
  /**
   * Many boon/brand effects are stored as a fraction of a reference stat
   * (maxHp for defense/sustain, atk for offense) rather than a flat number,
   * so they keep scaling as that reference stat grows over a run. Converts
   * the fraction into a whole-number amount, guaranteeing at least 1
   * whenever the fraction is nonzero so a small early-game percentage
   * doesn't round away to nothing.
   */
  static pctOf(base: number, fraction: number): number {
    return fraction > 0 ? Math.max(1, Math.round(base * fraction)) : 0;
  }
}

/**
 * The hero. Holds every run-scoped stat (HP/ATK/XP/level), perk bonuses from
 * boons/brands, the active ranged ability/spellbook, and status effects.
 * `Game` is the controller that reads and mutates these fields turn to turn;
 * this class itself only encapsulates the handful of derived/internal
 * concerns (Void Prism's live recompute) that shouldn't be poked at directly.
 */
export class Player {
  x: number;
  y: number;
  /** Board sprite — replaced by the class's own portrait in `Game.applyClass`, so what you picked on the class card is what you play. */
  char = 'sprite_player';

  hp: number;
  maxHp: number;
  atk: number;

  // Progression
  xp = 0;
  playerLevel = 1;
  xpToNext = Balance.CONFIG.player.xpToNextStart;

  // Perk-granted bonuses
  visionRadius = 4;
  regenPerTick = 0;
  poisonImmune = false;
  killHeal = 0;
  damageReduction = 0;
  tickSlowPercent = 0;

  /** Combat dice level (1=D4 … 6=D20); overridden by class, scales with `playerLevel` via {@link combatLevel}. */
  baseCombatLevel = 2;

  /** Consecutive whiffs; the 3rd is upgraded to a guaranteed weak hit (miss-pity). */
  missStreak = 0;

  /** Effective combat dice level for the current player level, floored/overridden by `baseCombatLevel`'s bands. */
  get combatLevel(): number {
    const lvl = this.playerLevel;
    for (const band of Balance.CONFIG.player.combatLevelBands) {
      if (lvl < band.minPlayerLevel) continue;
      if (band.combatLevel !== undefined) return band.combatLevel;
      if (band.combatLevelFloor !== undefined) return Math.max(this.baseCombatLevel, band.combatLevelFloor);
    }
    return this.baseCombatLevel;
  }

  // Class-set multipliers
  /** Architect doubles line-clear XP. */
  lineClearXpMult = 1;
  /** Line clears deal `lineClearDmgMult`×rows×floor damage (unused by current classes). */
  lineClearDmgMult = 0;
  /** Resists teleport traps (unused by current classes). */
  teleportImmune = false;

  // Perk-granted bonuses (boons & brands)
  dodgeChance = 0;
  dodgeHeal = 0;
  lineClearDamage = 0;
  statusDurationBonus = 0;
  auraStunRadius = 0;
  critEvery = 0;
  critCount = 0;

  /**
   * The player's active ranged/special ability (set by class; `null` for a
   * class with no ability). For An Draoi, this is the ACTIVE spell — the
   * full unlocked spellbook lives in {@link spellbook} and cycling swaps
   * which entry this points at (shared cooldown).
   */
  rangedAbility: RangedAbility | null = null;
  rangedCooldown = 0;
  /** `-1` = infinite, `>= 0` = finite (Rogue darts). */
  rangedAmmo = -1;
  spellbook: RangedAbility[] = [];
  activeSpellIndex = 0;

  /** Féth Fíada (Manannán pact): while > 0, monsters can't see or attack you. */
  veiledTurns = 0;

  statuses: StatusEffect[] = [];

  /** Run total XP (display metric — accumulates every {@link gainXP} call). */
  totalXpEarned = 0;

  boons: Array<{ id: string; stacks: number; def: BoonDef }> = [];
  thornDamage = 0;

  /** Equipped brands (Ogham Marks), one entry per body-slot equip. */
  brands: Array<{ slot: BodyPart; brand: BrandDef }> = [];
  /** Lifetime brand count — survives the Life Mark's brands-wipe, unlike `brands.length`. */
  brandsAcquiredTotal = 0;
  poisonAttackChance = 0;
  stunAttackChance = 0;
  ghostDodgeCharges = 0;
  bonusHeroMoves = 0;
  lifeBrandRevive = false;
  killAtkBonus = 0;
  killAtkFloorBonus = 0;
  lineClearAoeDmgMult = 0;
  deathwardCharges = 0;

  /** Void Prism's currently-applied bonus, tracked so its live recompute can subtract the old value before adding the new one. */
  private voidPrismBonus = { atk: 0, hp: 0 };

  /**
   * @param x - Starting board column.
   * @param y - Starting board row.
   * @throws {TypeError} If `x` or `y` is not a finite number.
   */
  constructor(x: number, y: number) {
    if (typeof x !== 'number' || !Number.isFinite(x)) throw new TypeError('Player: "x" must be a finite number');
    if (typeof y !== 'number' || !Number.isFinite(y)) throw new TypeError('Player: "y" must be a finite number');
    this.x = x;
    this.y = y;
    this.hp = Balance.CONFIG.player.startingHp;
    this.maxHp = Balance.CONFIG.player.startingHp;
    this.atk = Balance.CONFIG.player.startingAtk;
  }

  /** Total attack, after any future attack-modifying derivations (currently just `atk`). */
  get totalAtk(): number {
    return this.atk;
  }

  /** Flat damage reduction per hit. `damageReduction` is a fraction of `maxHp` (e.g. 0.1 = 10%), not a flat number — see {@link StatMath.pctOf}. */
  get totalDef(): number {
    return StatMath.pctOf(this.maxHp, this.damageReduction);
  }

  /** Whether the player has reached the lifetime brand cap. */
  get brandsCapped(): boolean {
    return this.brandsAcquiredTotal >= Balance.CONFIG.brands.maxLifetime;
  }

  /** Brands remaining before the lifetime cap. */
  get brandsRemaining(): number {
    return Math.max(0, Balance.CONFIG.brands.maxLifetime - this.brandsAcquiredTotal);
  }

  get isStunned(): boolean {
    return this.statuses.some(s => s.type === 'stun');
  }

  /** Heals up to `maxHp`; returns the amount actually gained. */
  heal(amount: number): number {
    const prev = this.hp;
    this.hp = Math.min(this.maxHp, this.hp + amount);
    return this.hp - prev;
  }

  /** Applies `amount` damage after {@link totalDef}; returns the amount actually taken. */
  takeDamage(amount: number): number {
    const actual = Math.max(0, amount - this.totalDef);
    this.hp = Math.max(0, this.hp - actual);
    return actual;
  }

  /** Adds XP, leveling up (possibly more than once worth, though only one level is granted per call) when the threshold is crossed. Returns whether a level-up occurred. */
  gainXP(amount: number): boolean {
    this.totalXpEarned += amount;
    this.xp += amount;
    if (this.xp >= this.xpToNext) {
      this.xp -= this.xpToNext;
      this.playerLevel++;
      this.xpToNext = Math.floor(this.xpToNext * Balance.CONFIG.player.xpToNextGrowth);
      return true;
    }
    return false;
  }

  /** Grants a boon, stacking if already owned, and applies its effect. */
  addBoon(def: BoonDef): void {
    const entry = this.boons.find(b => b.id === def.id);
    const newStacks = entry ? ++entry.stacks : 1;
    if (!entry) this.boons.push({ id: def.id, stacks: newStacks, def });
    def.onAdd(this, newStacks);
    this.recomputeVoidPrism();
  }

  /**
   * Removes a boon entirely (all stacks) — used by the trade-up NPC. Doesn't
   * undo the boon's already-applied stat effects (matches how brands work:
   * Ogham Marks don't unwind their bonuses on death/removal either), but does
   * recompute Void Prism's distinct-boon-count bonus since that scales live.
   */
  removeBoon(id: string): void {
    this.boons = this.boons.filter(b => b.id !== id);
    this.recomputeVoidPrism();
  }

  /** Equips a brand in `slot`, applying its own effect and any set-completion bonus. */
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

/** A live monster instance on the board — a `MonsterTemplate`'s stats, scaled and placed. */
export class Monster {
  statuses: StatusEffect[] = [];
  isBoss: boolean;
  isElite = false;
  /** The final boss — killing it wins the run. */
  isGorgoth = false;
  /** Paces Gorgoth's slow descent (moves once per N turns). */
  stepCharge = 0;
  combatLevel = 2;

  /**
   * @throws {TypeError} If `x`/`y` are not finite numbers, `char`/`name` are empty, or `hp`/`maxHp`/`atk`/`xpReward` are not finite numbers.
   */
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
    if (typeof x !== 'number' || !Number.isFinite(x)) throw new TypeError('Monster: "x" must be a finite number');
    if (typeof y !== 'number' || !Number.isFinite(y)) throw new TypeError('Monster: "y" must be a finite number');
    if (typeof char !== 'string' || char.length === 0) throw new TypeError('Monster: "char" must be a non-empty string');
    if (typeof name !== 'string' || name.length === 0) throw new TypeError('Monster: "name" must be a non-empty string');
    if (typeof hp !== 'number' || !Number.isFinite(hp)) throw new TypeError('Monster: "hp" must be a finite number');
    if (typeof maxHp !== 'number' || !Number.isFinite(maxHp)) throw new TypeError('Monster: "maxHp" must be a finite number');
    if (typeof atk !== 'number' || !Number.isFinite(atk)) throw new TypeError('Monster: "atk" must be a finite number');
    if (typeof xpReward !== 'number' || !Number.isFinite(xpReward)) throw new TypeError('Monster: "xpReward" must be a finite number');
    this.isBoss = isBoss;
  }

  get isStunned(): boolean {
    return this.statuses.some(s => s.type === 'stun');
  }
}

/**
 * A poolable floating-text/icon particle (damage numbers, heal ticks, crit
 * bursts). `reset()` replaces `new()` when recycled from a {@link ParticlePool}
 * to avoid GC pressure.
 */
export class Particle {
  private x = 0;
  private y = 0;
  private text = '';
  private icon = '';
  private color = '';
  /** Fraction of lifetime remaining, `1` (just spawned) down to `<= 0` (recyclable). Read by `ParticlePool.tick()` to know when to recycle. */
  life = 0;
  private fontSize = 13;
  private vx = 0;
  private vy = -0.7;
  /** `1` = no decay (today's constant-rise drift); `< 1` = outward-then-settle for bursts. */
  private drag = 1;

  /** Reinitializes a recycled (or fresh) particle in place. */
  reset(
    gridX: number, gridY: number, text: string, color: string, fontSize = 13, icon = '',
    vx = 0, vy = -0.7, drag = 1,
  ): void {
    this.x = gridX * GameConfig.TILE_SIZE + GameConfig.TILE_SIZE / 2 + (Math.random() - 0.5) * GameConfig.TILE_SIZE * 0.4;
    this.y = gridY * GameConfig.TILE_SIZE + GameConfig.TILE_SIZE / 4 + Math.random() * GameConfig.TILE_SIZE * 0.3;
    this.text = text;
    this.icon = icon;
    this.color = color;
    this.life = 1.0;
    this.fontSize = fontSize;
    this.vx = vx;
    this.vy = vy;
    this.drag = drag;
  }

  /** Advances one animation frame: position, velocity decay, and lifetime countdown. */
  update(): void {
    this.x += this.vx;
    this.y += this.vy;
    this.vx *= this.drag;
    this.vy *= this.drag;
    this.life -= 0.04;
  }

  /** Draws the particle's current frame (icon and/or text, with pop-in scale and a stroke outline). */
  draw(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.globalAlpha = this.life;
    // Pop-in: spawn at ~1.5× size and settle over the first few frames, so
    // damage numbers (and burst motes) punch instead of drifting into view.
    const pop = 1 + 0.55 * Math.max(0, (this.life - 0.78) / 0.22);
    const size = Math.round(this.fontSize * pop);
    ctx.font = `bold ${size}px monospace`;
    const tw = this.text ? ctx.measureText(this.text).width : 0;
    const iconSize = this.icon ? size : 0;
    const totalW = tw + (this.icon && this.text ? iconSize + 2 : iconSize);
    let cursorX = this.x - totalW / 2;

    if (this.icon) {
      const coord = SpriteService.MAP[this.icon];
      const img = coord && SpriteService.getImage(coord.sheet);
      if (img) {
        const scale = Math.min(iconSize / coord.sw, iconSize / coord.sh);
        const iw = coord.sw * scale, ih = coord.sh * scale;
        ctx.drawImage(img, coord.sx, coord.sy, coord.sw, coord.sh, cursorX, this.y - ih / 2 - size * 0.15, iw, ih);
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

/** Fixed-capacity object pool of {@link Particle}s, recycled to avoid per-frame GC churn. */
export class ParticlePool {
  private pool: Particle[] = [];
  private active: Particle[] = [];

  /** @throws {TypeError} If `size` is not a finite number. */
  constructor(size = 60) {
    if (typeof size !== 'number' || !Number.isFinite(size)) throw new TypeError('ParticlePool: "size" must be a finite number');
    for (let i = 0; i < size; i++) this.pool.push(new Particle());
  }

  /** Spawns a single particle (damage number, heal tick, etc.), reusing a pooled instance when available. */
  spawn(gridX: number, gridY: number, text: string, color: string, fontSize = 13, icon = '', vx = 0, vy = -0.7, drag = 1): void {
    const p = this.pool.pop() ?? new Particle();
    p.reset(gridX, gridY, text, color, fontSize, icon, vx, vy, drag);
    this.active.push(p);
  }

  /**
   * Radial burst: `count` icon/dot particles fly outward from the tile then
   * settle (drag < 1), for high-impact moments (crits, kills, level-ups, ...).
   */
  spawnBurst(gridX: number, gridY: number, count: number, color: string, icon = '', fontSize = 10): void {
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.6;
      const speed = 0.5 + Math.random() * 0.7;
      const p = this.pool.pop() ?? new Particle();
      p.reset(gridX, gridY, '', color, fontSize, icon, Math.cos(angle) * speed, Math.sin(angle) * speed, 0.90);
      this.active.push(p);
    }
  }

  /** Advances and draws every active particle for one frame, recycling any that have expired. */
  tick(ctx: CanvasRenderingContext2D): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const p = this.active[i]!;
      p.update();
      p.draw(ctx);
      if (p.life <= 0) this.pool.push(this.active.splice(i, 1)[0]!);
    }
  }
}
