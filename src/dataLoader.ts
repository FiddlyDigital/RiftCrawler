import monstersData       from './data/monsters.json';
import bossesData         from './data/bosses.json';
import shapesData         from './data/shapes.json';
import boonsData          from './data/boons.json';
import brandsData         from './data/brands.json';
import modifiersData      from './data/modifiers.json';
import classesData        from './data/classes.json';
import biomesData         from './data/biomes.json';
import floorEventsData    from './data/floor-events.json';
import npcsData           from './data/npcs.json';
import patronsData        from './data/patrons.json';
import { Cell, type CellValue, type StatusType, type ModifierDef, type ClassDef, type BiomeDef, type FloorEventDef, type FloorEventOption, type RangedAbility, type BoonDef, type BrandDef, type OfferRole, type EffectSpec, type NpcDef, type PatronDef } from './types';
import type { Player } from './entities';
import type { Game } from './game';
import type { MonsterDef, BossDef } from './types';
import { Balance } from './balance';

// ── Declarative effect resolver (JSON-configured boons / brands / modifiers) ───
// Boons/brands/modifiers/classes/patrons describe their stat effects as data
// (EffectSpec[]); this class is the single place that interprets that data.

interface RawBoon     { id: string; char: string; name: string; tier: number; role: string; desc: string; effects?: EffectSpec[]; special?: string }
interface RawBrand    { id: string; char: string; name: string; setSize: number; role: string; desc: string; setDesc: string; onEquip?: EffectSpec[]; onSet?: EffectSpec[] }
interface RawModifier { id: string; emoji: string; name: string; desc: string; effects?: EffectSpec[]; special?: string }
interface RawClassAbility {
  name: string; emoji: string;
  abilityType: 'bolt' | 'time_dilation' | 'gravity_well' | 'consecrate' | 'overload' | 'shriek' | 'veil' | 'drain';
  range: number; damageMult: number; cooldownMax: number;
  statusEffect?: 'stun';
  params?: Record<string, number | string>;
}
interface RawClass {
  id: string; emoji: string; name: string; tagline: string; statChips: string[];
  tPieceCdReduction?: number;
  effects?: EffectSpec[];
  ability?: RawClassAbility;
}
interface RawFloorEventOption {
  label: string; desc: string; handler: string;
  params?: Record<string, number>;
  resultMsg?: string;
}
interface RawFloorEvent { id: string; emoji: string; title: string; flavor: string; options: RawFloorEventOption[] }

/**
 * Interprets the declarative {@link EffectSpec} shape shared by boons,
 * brands, modifiers, classes, and patrons — the one place that turns "stat
 * data" into an actual mutation on a player or game object.
 */
export class EffectResolver {
  private static applyOne(obj: Record<string, number | boolean>, e: EffectSpec): void {
    const op = e.op ?? 'add';
    if (op === 'set') { obj[e.stat] = e.value; return; }
    let n = obj[e.stat] as number;
    const v = e.value as number;
    n = op === 'mul' ? n * v : n + v;
    if (e.floor) n = Math.floor(n);
    if (e.min !== undefined) n = Math.max(e.min, n);
    if (e.max !== undefined) n = Math.min(e.max, n);
    obj[e.stat] = n;
  }

  /**
   * Applies every effect in `effects` to `player`.
   * @throws {TypeError} If `player` is null/undefined.
   */
  static applyToPlayer(player: Player, effects: EffectSpec[] | undefined): void {
    if (player === null || player === undefined) {
      throw new TypeError('EffectResolver.applyToPlayer: "player" must not be null/undefined');
    }
    for (const e of effects ?? []) EffectResolver.applyOne(player as unknown as Record<string, number | boolean>, e);
  }

  /**
   * Applies every effect in `effects` to `game` or `game.player`, chosen
   * per-effect by {@link EffectSpec.target} (modifiers only — the only
   * content type whose effects can target the game object itself).
   * @throws {TypeError} If `game` is null/undefined.
   */
  static applyToGame(game: Game, effects: EffectSpec[] | undefined): void {
    if (game === null || game === undefined) {
      throw new TypeError('EffectResolver.applyToGame: "game" must not be null/undefined');
    }
    for (const e of effects ?? []) {
      EffectResolver.applyOne((e.target === 'game' ? game : game.player) as unknown as Record<string, number | boolean>, e);
    }
  }
}

interface OfferItem { id: string; role: OfferRole; }

/** Shared "3-choice offer" selection logic used by both {@link Boon} and {@link Brand}. */
export class ContentOffers {
  private static shuffleInPlace<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j]!, arr[i]!];
    }
    return arr;
  }

  /**
   * Builds a 3-choice offer that (a) nudges one pick toward a type the
   * player already owns (synergy / set completion) and (b) guarantees at
   * least two distinct roles, so no offer is three of the same flavour and
   * every run can commit to a build. Input randomness stays high; only
   * coherence is enforced.
   * @throws {TypeError} If `pool` is null/undefined.
   */
  static buildOffer<T extends OfferItem>(pool: T[], ownedIds: string[]): T[] {
    if (pool === null || pool === undefined) {
      throw new TypeError('ContentOffers.buildOffer: "pool" must not be null/undefined');
    }
    const shuffled = ContentOffers.shuffleInPlace([...pool]);
    if (shuffled.length <= 3) return shuffled;

    const chosen: T[] = [];
    // Synergy nudge: ~55% of the time seed one owned type when it's in the pool.
    if (ownedIds.length && Math.random() < 0.55) {
      const owned = shuffled.find(x => ownedIds.includes(x.id));
      if (owned) chosen.push(owned);
    }
    for (const x of shuffled) {
      if (chosen.length >= 3) break;
      if (!chosen.includes(x)) chosen.push(x);
    }
    // Guarantee >=2 distinct roles: swap the last pick for a different-role
    // candidate if all three ended up sharing a role.
    if (new Set(chosen.map(c => c.role)).size < 2) {
      const alt = shuffled.find(x => !chosen.includes(x) && x.role !== chosen[0]!.role);
      if (alt) chosen[chosen.length - 1] = alt;
    }
    return chosen.slice(0, 3);
  }
}

// Effects that can't be expressed as plain data:
const BOON_SPECIALS: Record<string, (p: Player, stacks: number) => void> = {
  // Void Loop: every Nth attack crits, N shrinking as stacks grow.
  void_loop: (p, stacks) => {
    if (stacks === 1) { p.critEvery = 6; p.critCount = 0; }
    else p.critEvery = Math.max(2, p.critEvery - 1);
  },
  // Void Prism recomputes in Player.addBoon — nothing to do per-add.
};

/** A level-up reward, loaded from `data/boons.json`. */
export class Boon implements BoonDef {
  readonly id: string;
  readonly char: string;
  readonly name: string;
  readonly desc: string;
  readonly tier: 1 | 2 | 3;
  readonly role: OfferRole;
  private readonly effects?: EffectSpec[];
  private readonly special?: string;

  /** @throws {TypeError} If `raw` is missing a non-empty `id`. */
  constructor(raw: RawBoon) {
    if (!raw || typeof raw.id !== 'string' || raw.id.length === 0) {
      throw new TypeError('Boon: raw boon data must include a non-empty "id"');
    }
    this.id = raw.id;
    this.char = raw.char;
    this.name = raw.name;
    this.desc = raw.desc;
    this.tier = raw.tier as 1 | 2 | 3;
    this.role = raw.role as OfferRole;
    this.effects = raw.effects;
    this.special = raw.special;
  }

  /**
   * Applies this boon's effect to `player`.
   * @param newStacks - The stack count after this pickup (drives specials like Void Loop).
   * @throws {TypeError} If `player` is null/undefined.
   */
  onAdd(player: Player, newStacks: number): void {
    if (player === null || player === undefined) throw new TypeError('Boon.onAdd: "player" must not be null/undefined');
    EffectResolver.applyToPlayer(player, this.effects);
    if (this.special) BOON_SPECIALS[this.special]?.(player, newStacks);
  }

  /** Every boon loaded from `data/boons.json`. */
  static readonly ALL: Boon[] = (boonsData as RawBoon[]).map(raw => new Boon(raw));

  /** {@link ALL}, partitioned by reward tier. */
  static readonly BY_TIER: Record<1 | 2 | 3, Boon[]> = {
    1: Boon.ALL.filter(b => b.tier === 1),
    2: Boon.ALL.filter(b => b.tier === 2),
    3: Boon.ALL.filter(b => b.tier === 3),
  };

  /**
   * Rolls a reward tier appropriate for the given dungeon floor (deeper
   * floors skew toward rarer tiers).
   * @throws {TypeError} If `floor` is not a finite number.
   */
  static tierForFloor(floor: number): 1 | 2 | 3 {
    if (typeof floor !== 'number' || !Number.isFinite(floor)) {
      throw new TypeError('Boon.tierForFloor: "floor" must be a finite number');
    }
    const r = Math.random();
    if (floor <= 3) {
      if (r < 0.82) return 1;
      if (r < 0.98) return 2;
      return 3;
    }
    if (floor <= 7) {
      if (r < 0.40) return 1;
      if (r < 0.85) return 2;
      return 3;
    }
    if (r < 0.15) return 1;
    if (r < 0.55) return 2;
    return 3;
  }

  /**
   * Picks a 3-choice boon offer from `pool` (see {@link ContentOffers.buildOffer}).
   * @throws {TypeError} If `pool` is null/undefined.
   */
  static pickThree(pool: Boon[], ownedIds: string[] = []): Boon[] {
    if (pool === null || pool === undefined) throw new TypeError('Boon.pickThree: "pool" must not be null/undefined');
    return ContentOffers.buildOffer(pool, ownedIds);
  }
}

/** A tattoo (equippable, body-slot-bound boon), loaded from `data/brands.json`. */
export class Brand implements BrandDef {
  readonly id: string;
  readonly char: string;
  readonly name: string;
  readonly desc: string;
  readonly setSize: 2 | 3;
  readonly setDesc: string;
  readonly role: OfferRole;
  private readonly onEquipEffects?: EffectSpec[];
  private readonly onSetEffects?: EffectSpec[];

  /** @throws {TypeError} If `raw` is missing a non-empty `id`. */
  constructor(raw: RawBrand) {
    if (!raw || typeof raw.id !== 'string' || raw.id.length === 0) {
      throw new TypeError('Brand: raw brand data must include a non-empty "id"');
    }
    this.id = raw.id;
    this.char = raw.char;
    this.name = raw.name;
    this.desc = raw.desc;
    this.setSize = raw.setSize as 2 | 3;
    this.setDesc = raw.setDesc;
    this.role = raw.role as OfferRole;
    this.onEquipEffects = raw.onEquip;
    this.onSetEffects = raw.onSet;
  }

  /** Applies this brand's own effect on equip. @throws {TypeError} If `player` is null/undefined. */
  onEquip(player: Player): void {
    if (player === null || player === undefined) throw new TypeError('Brand.onEquip: "player" must not be null/undefined');
    EffectResolver.applyToPlayer(player, this.onEquipEffects);
  }

  /** Applies the bonus effect once the matching set is completed. @throws {TypeError} If `player` is null/undefined. */
  onSetComplete(player: Player): void {
    if (player === null || player === undefined) throw new TypeError('Brand.onSetComplete: "player" must not be null/undefined');
    EffectResolver.applyToPlayer(player, this.onSetEffects);
  }

  /** Every brand loaded from `data/brands.json`. */
  static readonly ALL: Brand[] = (brandsData as RawBrand[]).map(raw => new Brand(raw));

  /** Picks a 3-choice brand offer (see {@link ContentOffers.buildOffer}). */
  static pickThree(ownedIds: string[] = []): Brand[] {
    return ContentOffers.buildOffer([...Brand.ALL], ownedIds);
  }
}

const MODIFIER_SPECIALS: Record<string, (g: Game) => void> = {
  full_heal: (g) => { g.player.hp = g.player.maxHp; },
};

/** A run modifier (a challenge/Geis toggle chosen at run start), loaded from `data/modifiers.json`. */
export class Modifier implements ModifierDef {
  readonly id: string;
  readonly emoji: string;
  readonly name: string;
  readonly desc: string;
  private readonly effects?: EffectSpec[];
  private readonly special?: string;

  /** @throws {TypeError} If `raw` is missing a non-empty `id`. */
  constructor(raw: RawModifier) {
    if (!raw || typeof raw.id !== 'string' || raw.id.length === 0) {
      throw new TypeError('Modifier: raw modifier data must include a non-empty "id"');
    }
    this.id = raw.id;
    this.emoji = raw.emoji;
    this.name = raw.name;
    this.desc = raw.desc;
    this.effects = raw.effects;
    this.special = raw.special;
  }

  /** Applies this modifier's effect to the game/player. @throws {TypeError} If `game` is null/undefined. */
  apply(game: Game): void {
    if (game === null || game === undefined) throw new TypeError('Modifier.apply: "game" must not be null/undefined');
    EffectResolver.applyToGame(game, this.effects);
    if (this.special) MODIFIER_SPECIALS[this.special]?.(game);
  }

  /** Every modifier loaded from `data/modifiers.json`. */
  static readonly ALL: Modifier[] = (modifiersData as RawModifier[]).map(raw => new Modifier(raw));
}

// ── Shapes ────────────────────────────────────────────────────────────────────
// Pure tetromino geometry/color — no behavior, so this stays plain typed data
// rather than a class (consistent with the data-contract types in types.ts).

export type ShapeKey = 'I' | 'O' | 'T' | 'S' | 'Z' | 'J' | 'L';

export interface ShapeDef {
  matrix: number[][];
  color: string;
}

export const SHAPES = shapesData as Record<ShapeKey, ShapeDef>;

/** A starting class (e.g. Chronomancer, An Draoi), loaded from `data/classes.json`. */
export class PlayerClass implements ClassDef {
  readonly id: string;
  readonly emoji: string;
  readonly name: string;
  readonly tagline: string;
  readonly statChips: string[];
  readonly tPieceCdReduction: number;
  private readonly effects?: EffectSpec[];
  private readonly ability?: RawClassAbility;

  /** @throws {TypeError} If `raw` is missing a non-empty `id`. */
  constructor(raw: RawClass) {
    if (!raw || typeof raw.id !== 'string' || raw.id.length === 0) {
      throw new TypeError('PlayerClass: raw class data must include a non-empty "id"');
    }
    this.id = raw.id;
    this.emoji = raw.emoji;
    this.name = raw.name;
    this.tagline = raw.tagline;
    this.statChips = raw.statChips;
    this.tPieceCdReduction = raw.tPieceCdReduction ?? 2;
    this.effects = raw.effects;
    this.ability = raw.ability;
  }

  /** Applies this class's starting stat effects/ability to a freshly created player. @throws {TypeError} If `player` is null/undefined. */
  apply(player: Player): void {
    if (player === null || player === undefined) throw new TypeError('PlayerClass.apply: "player" must not be null/undefined');
    EffectResolver.applyToPlayer(player, this.effects);
    player.hp = Math.min(player.hp, player.maxHp);
    if (this.ability) player.rangedAbility = { ...this.ability } satisfies RangedAbility;
  }

  /** Every starting class loaded from `data/classes.json`. */
  static readonly ALL: PlayerClass[] = (classesData as unknown as RawClass[]).map(raw => new PlayerClass(raw));
}

/** A dungeon biome, loaded from `data/biomes.json`. */
export class Biome implements BiomeDef {
  readonly id: string;
  readonly name: string;
  readonly minFloor: number;
  readonly tileRgb: string;
  readonly moteColor: string;
  readonly monsterHpMult: number;
  readonly gravityPctBonus: number;
  readonly desc: string;

  /** @throws {TypeError} If `raw` is missing a non-empty `id`. */
  constructor(raw: BiomeDef) {
    if (!raw || typeof raw.id !== 'string' || raw.id.length === 0) {
      throw new TypeError('Biome: raw biome data must include a non-empty "id"');
    }
    this.id = raw.id;
    this.name = raw.name;
    this.minFloor = raw.minFloor;
    this.tileRgb = raw.tileRgb;
    this.moteColor = raw.moteColor;
    this.monsterHpMult = raw.monsterHpMult;
    this.gravityPctBonus = raw.gravityPctBonus;
    this.desc = raw.desc;
  }

  // Ordered highest minFloor first (as authored in biomes.json) so `forFloor` can use `.find()`.
  /** Every biome loaded from `data/biomes.json`. */
  static readonly ALL: Biome[] = (biomesData as BiomeDef[]).map(raw => new Biome(raw));

  /** The biome active at the given dungeon floor. @throws {TypeError} If `floor` is not a finite number. */
  static forFloor(floor: number): Biome {
    if (typeof floor !== 'number' || !Number.isFinite(floor)) {
      throw new TypeError('Biome.forFloor: "floor" must be a finite number');
    }
    return Biome.ALL.find(b => floor >= b.minFloor) ?? Biome.ALL[Biome.ALL.length - 1]!;
  }
}

/** A narrative floor event, loaded from `data/floor-events.json`. */
export class FloorEvent implements FloorEventDef {
  readonly id: string;
  readonly emoji: string;
  readonly title: string;
  readonly flavor: string;
  readonly options: FloorEventOption[];

  private static readonly HANDLERS: Record<string, (game: Game, opt: RawFloorEventOption) => string> = {
    static_message: (_game, opt) => opt.resultMsg ?? 'Nothing happened.',

    shrine_offer_hp: (game, opt) => {
      const hpCost = Balance.numOr(opt.params?.hpCost, 20);
      game.player.hp = Math.max(1, game.player.hp - hpCost);
      game.damageTaken += hpCost;
      const pool = [...Boon.BY_TIER[1], ...Boon.BY_TIER[2]];
      const boon = pool[Math.floor(Math.random() * pool.length)]!;
      game.player.addBoon(boon);
      return `The shrine grants: ${boon.name}! (${boon.desc})`;
    },

    spring_full_heal: (game, _opt) => {
      const gained = game.player.heal(game.player.maxHp);
      return `The spring restores you fully. +${gained} HP`;
    },

    spring_fill_flask: (game, opt) => {
      const healAmount = Balance.numOr(opt.params?.healAmount, 25);
      // regenPerTick is a fraction of maxHp (0.02 = 2%/tick), not a flat amount
      const regenBonus = Balance.numOr(opt.params?.regenBonus, 0.02);
      const gained = game.player.heal(healAmount);
      game.player.regenPerTick += regenBonus;
      return `Healed ${gained} HP and gained passive regeneration.`;
    },

    champion_take_boon: (game, opt) => {
      const tierBreakFloor = Balance.numOr(opt.params?.tierBreakFloor, 5);
      const tier = game.dungeonLevel >= tierBreakFloor ? 2 : 1;
      const pool = Boon.BY_TIER[tier as 1 | 2];
      const def = pool[Math.floor(Math.random() * pool.length)]!;
      game.player.addBoon(def);
      return `You absorb the champion's power: ${def.name}!`;
    },

    champion_rations: (game, opt) => {
      const healAmount = Balance.numOr(opt.params?.healAmount, 35);
      const gained = game.player.heal(healAmount);
      return `You eat the champion's rations. +${gained} HP`;
    },

    bargain_accept: (game, opt) => {
      const atkBonus = Balance.numOr(opt.params?.atkBonus, 12);
      const hpCost = Balance.numOr(opt.params?.hpCost, 25);
      game.player.atk += atkBonus;
      game.player.maxHp = Math.max(10, game.player.maxHp - hpCost);
      game.player.hp = Math.min(game.player.hp, game.player.maxHp);
      return `Power surges through you — at terrible cost. +${atkBonus} ATK, −${hpCost} Max HP.`;
    },

    tome_tactics: (game, opt) => {
      const xpGain = Balance.numOr(opt.params?.xpGain, 150);
      const levelled = game.player.gainXP(xpGain);
      if (levelled) {
        game.cb.log(`LEVEL UP! Now level ${game.player.playerLevel}!`, 'log-perk', 'special_sacred');
        game.openLevelUpBoons();
      }
      return `You absorb the battle tactics. +${xpGain} XP`;
    },

    tome_lore: (game, opt) => {
      const visionBonus = Balance.numOr(opt.params?.visionBonus, 2);
      game.player.visionRadius += visionBonus;
      return `Your perception expands. +${visionBonus} vision radius.`;
    },

    cache_search: (game, opt) => {
      const gold = Balance.numOr(opt.params?.gold, 800);
      game.gold += gold;
      return `You find ${gold} gold worth of loot!`;
    },

    cache_gamble: (game, opt) => {
      const successChance = Balance.numOr(opt.params?.successChance, 0.5);
      const jackpotGold = Balance.numOr(opt.params?.jackpotGold, 2000);
      const trapDamage = Balance.numOr(opt.params?.trapDamage, 30);
      if (Math.random() < successChance) {
        game.gold += jackpotGold;
        return `Jackpot! +${jackpotGold} gold!`;
      }
      const dmg = game.player.takeDamage(trapDamage);
      game.damageTaken += dmg;
      return `It was booby-trapped! −${dmg} HP`;
    },

    font_purify: (game, _opt) => {
      game.player.statuses = [];
      game.player.poisonImmune = true;
      return 'All afflictions cleansed. Poison cannot touch you.';
    },

    font_empower: (game, opt) => {
      const atkBonus = Balance.numOr(opt.params?.atkBonus, 2);
      game.player.atk += atkBonus;
      return `Rift energy floods your muscles. +${atkBonus} ATK.`;
    },

    armory_cursed_blade: (game, opt) => {
      const atkBonus = Balance.numOr(opt.params?.atkBonus, 8);
      const poisonDuration = Balance.numOr(opt.params?.poisonDuration, 3);
      const poisonPower = Balance.numOr(opt.params?.poisonPower, 4);
      game.player.atk += atkBonus;
      game.player.statuses.push({ type: 'poison', duration: poisonDuration, power: poisonPower });
      return `Dark power flows through you. +${atkBonus} ATK, but the blade bites back.`;
    },

    scholar_combat_theory: (game, opt) => {
      const xpGain = Balance.numOr(opt.params?.xpGain, 50);
      const combatLevelBonus = Balance.numOr(opt.params?.combatLevelBonus, 1);
      const levelled = game.player.gainXP(xpGain);
      game.player.baseCombatLevel += combatLevelBonus;
      if (levelled) {
        game.cb.log(`LEVEL UP! Now level ${game.player.playerLevel}!`, 'log-perk', 'special_sacred');
        game.openLevelUpBoons();
      }
      return `Combat mastery expands. +${xpGain} XP, +${combatLevelBonus} combat level.`;
    },

    scholar_wisdom: (game, opt) => {
      const visionBonus = Balance.numOr(opt.params?.visionBonus, 3);
      // regenPerTick is a fraction of maxHp (0.02 = 2%/tick), not a flat amount
      const regenBonus = Balance.numOr(opt.params?.regenBonus, 0.02);
      game.player.visionRadius += visionBonus;
      game.player.regenPerTick += regenBonus;
      return `Ancient wisdom seeps in. +${visionBonus} vision, +${Math.round(regenBonus * 100)}% Max HP regen/tick.`;
    },
  };

  /** @throws {TypeError} If `raw` is missing a non-empty `id`. */
  constructor(raw: RawFloorEvent) {
    if (!raw || typeof raw.id !== 'string' || raw.id.length === 0) {
      throw new TypeError('FloorEvent: raw floor-event data must include a non-empty "id"');
    }
    this.id = raw.id;
    this.emoji = raw.emoji;
    this.title = raw.title;
    this.flavor = raw.flavor;
    this.options = raw.options.map(opt => ({
      label: opt.label,
      desc: opt.desc,
      apply: (game: Game): string => (FloorEvent.HANDLERS[opt.handler] ?? (() => 'Nothing happened.'))(game, opt),
    }));
  }

  /** Every floor event loaded from `data/floor-events.json`. */
  static readonly ALL: FloorEvent[] = (floorEventsData as RawFloorEvent[]).map(raw => new FloorEvent(raw));

  /** Picks a uniformly random floor event. */
  static random(): FloorEvent {
    return FloorEvent.ALL[Math.floor(Math.random() * FloorEvent.ALL.length)]!;
  }
}

/** A wandering NPC archetype, loaded from `data/npcs.json`. */
export class Npc implements NpcDef {
  readonly id: string;
  readonly char: string;
  readonly name: string;
  readonly kind: 'flavor' | 'bounty' | 'trade';
  readonly lines?: string[];
  readonly introLine?: string;

  /** @throws {TypeError} If `raw` is missing a non-empty `id`. */
  constructor(raw: NpcDef) {
    if (!raw || typeof raw.id !== 'string' || raw.id.length === 0) {
      throw new TypeError('Npc: raw npc data must include a non-empty "id"');
    }
    this.id = raw.id;
    this.char = raw.char;
    this.name = raw.name;
    this.kind = raw.kind;
    this.lines = raw.lines;
    this.introLine = raw.introLine;
  }

  /** Every NPC archetype loaded from `data/npcs.json`. */
  static readonly ALL: Npc[] = (npcsData as NpcDef[]).map(raw => new Npc(raw));

  /** Picks a uniformly random NPC archetype. */
  static random(): Npc {
    return Npc.ALL[Math.floor(Math.random() * Npc.ALL.length)]!;
  }
}

/** A deity pact for An Draoi, loaded from `data/patrons.json`. */
export class Patron implements PatronDef {
  readonly id: string;
  readonly char: string;
  readonly name: string;
  readonly deity: string;
  readonly tagline: string;
  readonly tollDesc: string;
  readonly effects: EffectSpec[];
  readonly spells: RangedAbility[];

  /** @throws {TypeError} If `raw` is missing a non-empty `id`. */
  constructor(raw: PatronDef) {
    if (!raw || typeof raw.id !== 'string' || raw.id.length === 0) {
      throw new TypeError('Patron: raw patron data must include a non-empty "id"');
    }
    this.id = raw.id;
    this.char = raw.char;
    this.name = raw.name;
    this.deity = raw.deity;
    this.tagline = raw.tagline;
    this.tollDesc = raw.tollDesc;
    this.effects = raw.effects;
    this.spells = raw.spells;
  }

  /** Every deity patron loaded from `data/patrons.json`. */
  static readonly ALL: Patron[] = (patronsData as unknown as PatronDef[]).map(raw => new Patron(raw));
}

// ── Cell type ID → CellValue ──────────────────────────────────────────────────

const CELL_MAP: Record<string, CellValue> = {
  MONSTER_RAT:    Cell.MONSTER_RAT,
  MONSTER_SKEL:   Cell.MONSTER_SKEL,
  MONSTER_ARCHER: Cell.MONSTER_ARCHER,
  MONSTER_SLIME:  Cell.MONSTER_SLIME,
  MONSTER_ORC:    Cell.MONSTER_ORC,
  MONSTER_BAT:    Cell.MONSTER_BAT,
};

interface RawMonster {
  displayName: string; visualAsset: string; cellTypeId: string;
  combatLevel?: number;
  baseHp: number; baseAtk: number;
  hpScaleCoefficient: number; atkScaleCoefficient: number;
  xpValue: number; spawnMsg: string;
  statusInflict?: { type: string; chance: number; duration: number; power: number };
  behaviorType?: string;
  attackRange?: number;
  moveSpeed?: number;
}

/** A monster species/template, loaded from `data/monsters.json`. */
export class MonsterTemplate implements MonsterDef {
  readonly char: string;
  readonly name: string;
  readonly combatLevel: number;
  readonly baseHp: number;
  readonly hpPerLevel: number;
  readonly baseAtk: number;
  readonly atkPerLevel: number;
  readonly cellState: CellValue;
  readonly spawnMsg: string;
  readonly xpReward: number;
  readonly statusInflict?: { type: StatusType; chance: number; duration: number; power: number };
  readonly behaviorType?: string;
  readonly attackRange?: number;
  readonly moveSpeed?: number;

  /** @throws {TypeError} If `raw` is missing a non-empty `displayName`. */
  constructor(raw: RawMonster) {
    if (!raw || typeof raw.displayName !== 'string' || raw.displayName.length === 0) {
      throw new TypeError('MonsterTemplate: raw monster data must include a non-empty "displayName"');
    }
    this.char = raw.visualAsset;
    this.name = raw.displayName;
    this.combatLevel = raw.combatLevel ?? 2;
    this.baseHp = raw.baseHp;
    this.hpPerLevel = raw.hpScaleCoefficient;
    this.baseAtk = raw.baseAtk;
    this.atkPerLevel = raw.atkScaleCoefficient;
    this.cellState = CELL_MAP[raw.cellTypeId] ?? Cell.FLOOR;
    this.spawnMsg = raw.spawnMsg;
    this.xpReward = raw.xpValue;
    this.statusInflict = raw.statusInflict
      ? {
          type:     raw.statusInflict.type as StatusType,
          chance:   raw.statusInflict.chance,
          duration: raw.statusInflict.duration,
          power:    raw.statusInflict.power,
        }
      : undefined;
    this.behaviorType = raw.behaviorType;
    this.attackRange = raw.attackRange;
    this.moveSpeed = raw.moveSpeed;
  }

  /** Every monster template loaded from `data/monsters.json`, keyed by its JSON id. */
  static readonly BY_ID: Record<string, MonsterTemplate> = Object.fromEntries(
    Object.entries(monstersData as Record<string, RawMonster>).map(([key, raw]) => [key, new MonsterTemplate(raw)])
  );

  /** {@link BY_ID}'s values, as a flat list. */
  static readonly ALL: MonsterTemplate[] = Object.values(MonsterTemplate.BY_ID);
}

interface RawBoss {
  displayName: string; visualAsset: string;
  hpMult: number; atkMult: number; xpValue: number; flavorText: string;
}

interface RawBossParams {
  char: string; name: string; hpMult: number; atkMult: number; xpReward: number; flavorText: string;
  biomeId?: string;
  onHalfHp?: (game: Game) => void;
  onDeath?: (game: Game, x: number, y: number) => void;
}

/** A floor boss template, loaded from `data/bosses.json` plus two hardcoded biome-exclusive bosses. */
export class Boss implements BossDef {
  readonly char: string;
  readonly name: string;
  readonly hpMult: number;
  readonly atkMult: number;
  readonly xpReward: number;
  readonly flavorText: string;
  readonly biomeId?: string;
  readonly onHalfHp?: (game: Game) => void;
  readonly onDeath?: (game: Game, x: number, y: number) => void;

  /** @throws {TypeError} If `raw` is missing a non-empty `name`. */
  constructor(raw: RawBossParams) {
    if (!raw || typeof raw.name !== 'string' || raw.name.length === 0) {
      throw new TypeError('Boss: raw boss data must include a non-empty "name"');
    }
    this.char = raw.char;
    this.name = raw.name;
    this.hpMult = raw.hpMult;
    this.atkMult = raw.atkMult;
    this.xpReward = raw.xpReward;
    this.flavorText = raw.flavorText;
    this.biomeId = raw.biomeId;
    this.onHalfHp = raw.onHalfHp;
    this.onDeath = raw.onDeath;
  }

  /** Every boss: the data-driven roster from `data/bosses.json`, plus the two biome-exclusive set-pieces below. */
  static readonly ALL: Boss[] = [
    ...(bossesData as RawBoss[]).map(raw => new Boss({
      char: raw.visualAsset, name: raw.displayName, hpMult: raw.hpMult, atkMult: raw.atkMult,
      xpReward: raw.xpValue, flavorText: raw.flavorText,
    })),
    // Biome-specific bosses — never appear outside their biome
    new Boss({
      biomeId: 'cavern', char: 'sprite_boss_crystal_golem', name: "Cailleach's Stoneward",
      hpMult: 4.5, atkMult: 2.0, xpReward: 240,
      flavorText: 'The Cailleach shaped these stones. It cannot be destroyed... only shattered.',
      onDeath: (game, x, y) => game.spawnCrystalShards(x, y),
    }),
    new Boss({
      biomeId: 'rift', char: 'sprite_boss_rift_tyrant', name: "Balor's Herald",
      hpMult: 5.0, atkMult: 2.5, xpReward: 280,
      flavorText: 'Its single eye opens, and the bridge groans closer to complete...',
      onHalfHp: (game) => game.triggerGravityBurst(),
    }),
  ];
}

// ── Exported bindings (preserve prior names/shapes for the many call sites
// across game.ts/ui.ts/entities.ts that just need "the full list/record") ─────

export const MONSTERS: Record<string, MonsterDef> = MonsterTemplate.BY_ID;
export const MONSTER_DEFS: MonsterDef[] = MonsterTemplate.ALL;
export const BOSSES: BossDef[] = Boss.ALL;
export const BOONS: BoonDef[] = Boon.ALL;
export const BOONS_BY_TIER: Record<1 | 2 | 3, BoonDef[]> = Boon.BY_TIER;
export const BRANDS: BrandDef[] = Brand.ALL;
export const MODIFIERS: ModifierDef[] = Modifier.ALL;
export const CLASSES: ClassDef[] = PlayerClass.ALL;
export const BIOMES: BiomeDef[] = Biome.ALL;
export const FLOOR_EVENTS: FloorEventDef[] = FloorEvent.ALL;
export const NPCS: NpcDef[] = Npc.ALL;
export const PATRONS: PatronDef[] = Patron.ALL;
