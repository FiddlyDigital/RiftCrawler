import monstersData       from './data/monsters.json';
import bossesData         from './data/bosses.json';
import shapesData         from './data/shapes.json';
import boonsData          from './data/boons.json';
import brandsData         from './data/brands.json';
import modifiersData      from './data/modifiers.json';
import classesData        from './data/classes.json';
import biomesData         from './data/biomes.json';
import floorEventsData    from './data/floor-events.json';
import { Cell, type CellValue, type StatusType, type ModifierDef, type ClassDef, type BiomeDef, type FloorEventDef, type RangedAbility, type BoonDef, type BrandDef, type OfferRole, type EffectSpec } from './types';
import type { Player } from './entities';
import type { Game } from './game';
import type { MonsterDef, BossDef } from './types';
import { numOr } from './balance';

// ── Declarative effect resolver (JSON-configured boons / brands / modifiers) ───
// Boons/brands/modifiers describe their effects as data; these apply them.

interface RawBoon     { id: string; char: string; name: string; tier: number; role: string; desc: string; effects?: EffectSpec[]; special?: string }
interface RawBrand    { id: string; char: string; name: string; setSize: number; role: string; desc: string; setDesc: string; onEquip?: EffectSpec[]; onSet?: EffectSpec[] }
interface RawModifier { id: string; emoji: string; name: string; desc: string; effects?: EffectSpec[]; special?: string }
interface RawClassAbility {
  name: string; emoji: string;
  abilityType: 'bolt' | 'time_dilation' | 'gravity_well' | 'consecrate' | 'overload';
  range: number; damageMult: number; cooldownMax: number;
  statusEffect?: 'stun';
  params?: Record<string, number | string>;
}
interface RawClass {
  id: string; emoji: string; name: string; tagline: string; statPreview: string;
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

function applyEffect(obj: Record<string, number | boolean>, e: EffectSpec): void {
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

function applyToPlayer(p: Player, effects: EffectSpec[] | undefined): void {
  for (const e of effects ?? []) applyEffect(p as unknown as Record<string, number | boolean>, e);
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
const MODIFIER_SPECIALS: Record<string, (g: Game) => void> = {
  full_heal: (g) => { g.player.hp = g.player.maxHp; },
};

// ── Raw JSON shapes (local — not exposed) ─────────────────────────────────────

interface RawMonster {
  id: string; displayName: string; visualAsset: string; cellTypeId: string;
  combatLevel?: number;
  baseHp: number; baseAtk: number;
  hpScaleCoefficient: number; atkScaleCoefficient: number;
  xpValue: number; spawnMsg: string;
  statusInflict?: { type: string; chance: number; duration: number; power: number };
  behaviorType?: string;
  attackRange?: number;
  moveSpeed?: number;
}

interface RawBoss {
  id: string; displayName: string; visualAsset: string;
  hpMult: number; atkMult: number; xpValue: number; flavorText: string;
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

// ── Monsters ──────────────────────────────────────────────────────────────────

export const MONSTERS: Record<string, MonsterDef> = Object.fromEntries(
  Object.entries(monstersData as Record<string, RawMonster>).map(([key, raw]) => [
    key,
    {
      char:         raw.visualAsset,
      name:         raw.displayName,
      combatLevel:  raw.combatLevel ?? 2,
      baseHp:       raw.baseHp,
      hpPerLevel:   raw.hpScaleCoefficient,
      baseAtk:      raw.baseAtk,
      atkPerLevel:  raw.atkScaleCoefficient,
      cellState:    CELL_MAP[raw.cellTypeId] ?? Cell.FLOOR,
      spawnMsg:     raw.spawnMsg,
      xpReward:     raw.xpValue,
      statusInflict: raw.statusInflict
        ? {
            type:     raw.statusInflict.type as StatusType,
            chance:   raw.statusInflict.chance,
            duration: raw.statusInflict.duration,
            power:    raw.statusInflict.power,
          }
        : undefined,
      behaviorType: raw.behaviorType,
      attackRange:  raw.attackRange,
      moveSpeed:    raw.moveSpeed,
    } satisfies MonsterDef,
  ])
);

export const MONSTER_DEFS: MonsterDef[] = Object.values(MONSTERS);

// ── Bosses ────────────────────────────────────────────────────────────────────

export const BOSSES: BossDef[] = [
  ...(bossesData as RawBoss[]).map(raw => ({
    char:       raw.visualAsset,
    name:       raw.displayName,
    hpMult:     raw.hpMult,
    atkMult:    raw.atkMult,
    xpReward:   raw.xpValue,
    flavorText: raw.flavorText,
  })),
  // Biome-specific bosses — never appear outside their biome
  {
    biomeId:    'cavern',
    char:       'sprite_boss_crystal_golem',
    name:       "Cailleach's Stoneward",
    hpMult:     4.5,
    atkMult:    2.0,
    xpReward:   240,
    flavorText: 'The Cailleach shaped these stones. It cannot be destroyed... only shattered.',
    onDeath:    (game, x, y) => game.spawnCrystalShards(x, y),
  },
  {
    biomeId:    'rift',
    char:       'sprite_boss_rift_tyrant',
    name:       "Balor's Herald",
    hpMult:     5.0,
    atkMult:    2.5,
    xpReward:   280,
    flavorText: 'Its single eye opens, and the bridge groans closer to complete...',
    onHalfHp:   (game) => game.triggerGravityBurst(),
  },
];

// ── Boons ─────────────────────────────────────────────────────────────────────

export const BOONS: BoonDef[] = (boonsData as RawBoon[]).map(raw => ({
  id: raw.id, char: raw.char, name: raw.name, tier: raw.tier as 1 | 2 | 3, role: raw.role as OfferRole, desc: raw.desc,
  onAdd: (player: Player, stacks: number): void => {
    applyToPlayer(player, raw.effects);
    if (raw.special) BOON_SPECIALS[raw.special]?.(player, stacks);
  },
}));

export const BOONS_BY_TIER: Record<1 | 2 | 3, BoonDef[]> = {
  1: BOONS.filter(b => b.tier === 1),
  2: BOONS.filter(b => b.tier === 2),
  3: BOONS.filter(b => b.tier === 3),
};

export function getBoonTierForFloor(floor: number): 1 | 2 | 3 {
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

interface OfferItem { id: string; role: OfferRole; }

function shuffleInPlace<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

// Build a 3-choice offer that (a) nudges one pick toward a type the player
// already owns (synergy / set completion) and (b) guarantees at least two
// distinct roles, so no offer is three of the same flavour and every run can
// commit to a build. Input randomness stays high; only coherence is enforced.
function buildOffer<T extends OfferItem>(pool: T[], ownedIds: string[]): T[] {
  const shuffled = shuffleInPlace([...pool]);
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

export function getThreeRandomBoons(pool: BoonDef[], ownedIds: string[] = []): BoonDef[] {
  return buildOffer(pool, ownedIds);
}

// ── Sacred Brands ─────────────────────────────────────────────────────────────

export const BRANDS: BrandDef[] = (brandsData as RawBrand[]).map(raw => ({
  id: raw.id, char: raw.char, name: raw.name, setSize: raw.setSize as 2 | 3, role: raw.role as OfferRole,
  desc: raw.desc, setDesc: raw.setDesc,
  onEquip:       (p: Player): void => applyToPlayer(p, raw.onEquip),
  onSetComplete: (p: Player): void => applyToPlayer(p, raw.onSet),
}));

export function getThreeRandomBrands(ownedIds: string[] = []): BrandDef[] {
  return buildOffer([...BRANDS], ownedIds);
}

// ── Modifiers ─────────────────────────────────────────────────────────────────

export const MODIFIERS: ModifierDef[] = (modifiersData as RawModifier[]).map(raw => ({
  id: raw.id, emoji: raw.emoji, name: raw.name, desc: raw.desc,
  apply: (g: Game): void => {
    for (const e of raw.effects ?? []) {
      applyEffect((e.target === 'game' ? g : g.player) as unknown as Record<string, number | boolean>, e);
    }
    if (raw.special) MODIFIER_SPECIALS[raw.special]?.(g);
  },
}));

// ── Shapes ────────────────────────────────────────────────────────────────────

export type ShapeKey = 'I' | 'O' | 'T' | 'S' | 'Z' | 'J' | 'L';

export interface ShapeDef {
  matrix: number[][];
  color: string;
}

export const SHAPES = shapesData as Record<ShapeKey, ShapeDef>;

// ── Starting classes ──────────────────────────────────────────────────────────

export const CLASSES: ClassDef[] = (classesData as unknown as RawClass[]).map(raw => ({
  id: raw.id,
  emoji: raw.emoji,
  name: raw.name,
  tagline: raw.tagline,
  statPreview: raw.statPreview,
  tPieceCdReduction: raw.tPieceCdReduction ?? 2,
  apply: (p: Player): void => {
    applyToPlayer(p, raw.effects);
    p.hp = Math.min(p.hp, p.maxHp);
    if (raw.ability) {
      p.rangedAbility = { ...raw.ability } satisfies RangedAbility;
    }
  },
}));

// ── Biomes ────────────────────────────────────────────────────────────────────
// Ordered highest minFloor first so getBiomeForFloor can use .find()

export const BIOMES: BiomeDef[] = biomesData as BiomeDef[];

export function getBiomeForFloor(floor: number): BiomeDef {
  return BIOMES.find(b => floor >= b.minFloor) ?? BIOMES[BIOMES.length - 1]!;
}

// ── Floor events ──────────────────────────────────────────────────────────────

type FloorEventHandler = (game: Game, opt: RawFloorEventOption) => string;

const FLOOR_EVENT_HANDLERS: Record<string, FloorEventHandler> = {
  static_message: (_game, opt) => opt.resultMsg ?? 'Nothing happened.',

  shrine_offer_hp: (game, opt) => {
    const hpCost = numOr(opt.params?.hpCost, 20);
    game.player.hp = Math.max(1, game.player.hp - hpCost);
    game.damageTaken += hpCost;
    const pool = [...BOONS_BY_TIER[1], ...BOONS_BY_TIER[2]];
    const boon = pool[Math.floor(Math.random() * pool.length)]!;
    game.player.addBoon(boon);
    return `The shrine grants: ${boon.name}! (${boon.desc})`;
  },

  spring_full_heal: (game, _opt) => {
    const gained = game.player.heal(game.player.maxHp);
    return `The spring restores you fully. +${gained} HP`;
  },

  spring_fill_flask: (game, opt) => {
    const healAmount = numOr(opt.params?.healAmount, 25);
    // regenPerTick is a fraction of maxHp (0.02 = 2%/tick), not a flat amount
    const regenBonus = numOr(opt.params?.regenBonus, 0.02);
    const gained = game.player.heal(healAmount);
    game.player.regenPerTick += regenBonus;
    return `Healed ${gained} HP and gained passive regeneration.`;
  },

  champion_take_boon: (game, opt) => {
    const tierBreakFloor = numOr(opt.params?.tierBreakFloor, 5);
    const tier = game.dungeonLevel >= tierBreakFloor ? 2 : 1;
    const pool = BOONS_BY_TIER[tier as 1 | 2];
    const def = pool[Math.floor(Math.random() * pool.length)]!;
    game.player.addBoon(def);
    return `You absorb the champion's power: ${def.name}!`;
  },

  champion_rations: (game, opt) => {
    const healAmount = numOr(opt.params?.healAmount, 35);
    const gained = game.player.heal(healAmount);
    return `You eat the champion's rations. +${gained} HP`;
  },

  bargain_accept: (game, opt) => {
    const atkBonus = numOr(opt.params?.atkBonus, 12);
    const hpCost = numOr(opt.params?.hpCost, 25);
    game.player.atk += atkBonus;
    game.player.maxHp = Math.max(10, game.player.maxHp - hpCost);
    game.player.hp = Math.min(game.player.hp, game.player.maxHp);
    return `Power surges through you — at terrible cost. +${atkBonus} ATK, −${hpCost} Max HP.`;
  },

  tome_tactics: (game, opt) => {
    const xpGain = numOr(opt.params?.xpGain, 150);
    const levelled = game.player.gainXP(xpGain);
    if (levelled) {
      game.cb.log(`LEVEL UP! Now level ${game.player.playerLevel}!`, 'log-perk', 'special_sacred');
      game.openLevelUpBoons();
    }
    return `You absorb the battle tactics. +${xpGain} XP`;
  },

  tome_lore: (game, opt) => {
    const visionBonus = numOr(opt.params?.visionBonus, 2);
    game.player.visionRadius += visionBonus;
    return `Your perception expands. +${visionBonus} vision radius.`;
  },

  cache_search: (game, opt) => {
    const gold = numOr(opt.params?.gold, 800);
    game.gold += gold;
    return `You find ${gold} gold worth of loot!`;
  },

  cache_gamble: (game, opt) => {
    const successChance = numOr(opt.params?.successChance, 0.5);
    const jackpotGold = numOr(opt.params?.jackpotGold, 2000);
    const trapDamage = numOr(opt.params?.trapDamage, 30);
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
    const atkBonus = numOr(opt.params?.atkBonus, 2);
    game.player.atk += atkBonus;
    return `Rift energy floods your muscles. +${atkBonus} ATK.`;
  },

  armory_cursed_blade: (game, opt) => {
    const atkBonus = numOr(opt.params?.atkBonus, 8);
    const poisonDuration = numOr(opt.params?.poisonDuration, 3);
    const poisonPower = numOr(opt.params?.poisonPower, 4);
    game.player.atk += atkBonus;
    game.player.statuses.push({ type: 'poison', duration: poisonDuration, power: poisonPower });
    return `Dark power flows through you. +${atkBonus} ATK, but the blade bites back.`;
  },

  scholar_combat_theory: (game, opt) => {
    const xpGain = numOr(opt.params?.xpGain, 50);
    const combatLevelBonus = numOr(opt.params?.combatLevelBonus, 1);
    const levelled = game.player.gainXP(xpGain);
    game.player.baseCombatLevel += combatLevelBonus;
    if (levelled) {
      game.cb.log(`LEVEL UP! Now level ${game.player.playerLevel}!`, 'log-perk', 'special_sacred');
      game.openLevelUpBoons();
    }
    return `Combat mastery expands. +${xpGain} XP, +${combatLevelBonus} combat level.`;
  },

  scholar_wisdom: (game, opt) => {
    const visionBonus = numOr(opt.params?.visionBonus, 3);
    // regenPerTick is a fraction of maxHp (0.02 = 2%/tick), not a flat amount
    const regenBonus = numOr(opt.params?.regenBonus, 0.02);
    game.player.visionRadius += visionBonus;
    game.player.regenPerTick += regenBonus;
    return `Ancient wisdom seeps in. +${visionBonus} vision, +${Math.round(regenBonus * 100)}% Max HP regen/tick.`;
  },
};

export const FLOOR_EVENTS: FloorEventDef[] = (floorEventsData as RawFloorEvent[]).map(raw => ({
  id: raw.id,
  emoji: raw.emoji,
  title: raw.title,
  flavor: raw.flavor,
  options: raw.options.map(opt => ({
    label: opt.label,
    desc: opt.desc,
    apply: (game: Game): string => (FLOOR_EVENT_HANDLERS[opt.handler] ?? (() => 'Nothing happened.'))(game, opt),
  })),
}));

export function getRandomFloorEvent(): FloorEventDef {
  return FLOOR_EVENTS[Math.floor(Math.random() * FLOOR_EVENTS.length)]!;
}
