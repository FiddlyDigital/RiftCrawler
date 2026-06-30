import visualRegistryData from './data/visual-registry.json';
import monstersData       from './data/monsters.json';
import bossesData         from './data/bosses.json';
import itemsData          from './data/items.json';
import equipmentData      from './data/equipment.json';
import perksData          from './data/perks.json';
import merchantData       from './data/merchant.json';
import shapesData         from './data/shapes.json';
import { Cell, type CellValue, type StatusType, type EquipSlot, type RelicDef, type ModifierDef } from './types';
import type { Player } from './entities';
import type { MonsterDef, BossDef, ItemDef, EquipmentDef } from './types';

// ── Visual registry ───────────────────────────────────────────────────────────

export const VISUAL_REGISTRY: Record<string, string> = visualRegistryData as Record<string, string>;

function vis(assetId: string): string {
  return VISUAL_REGISTRY[assetId] ?? '❓';
}

// ── Runtime interface types (exported for consumers) ──────────────────────────

export interface PerkDef {
  id: string;
  name: string;
  desc: string;
  apply: (player: Player) => void;
}

export interface MerchantItem {
  name: string;
  char: string;
  cost: number;
  apply: (player: Player) => string;
}

// ── Raw JSON shapes (local — not exposed) ─────────────────────────────────────

interface RawMonster {
  id: string; displayName: string; visualAsset: string; cellTypeId: string;
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

interface RawItem {
  id: string; displayName: string; visualAsset: string; cellTypeId: string;
  effectType: string; effectValue: number;
}

interface RawEquipment {
  id: string; displayName: string; visualAsset: string;
  slot: string; atkBonus: number; defBonus: number; tier: number;
}

interface RawPerk {
  id: string; name: string; desc: string; effectType: string; effectValue: number;
}

interface RawMerchantItem {
  id: string; displayName: string; visualAsset: string;
  cost: number; effectType: string; effectValue: number; effectLabel: string;
}

interface RawShape {
  matrix: number[][]; color: string; preview: string;
}

// ── Cell type ID → CellValue ──────────────────────────────────────────────────

const CELL_MAP: Record<string, CellValue> = {
  MONSTER_RAT:    Cell.MONSTER_RAT,
  MONSTER_SKEL:   Cell.MONSTER_SKEL,
  ITEM_POTION:    Cell.ITEM_POTION,
  ITEM_SWORD:     Cell.ITEM_SWORD,
  ITEM_EQUIPMENT: Cell.ITEM_EQUIPMENT,
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
      char:        vis(raw.visualAsset),
      name:        raw.displayName,
      baseHp:      raw.baseHp,
      hpPerLevel:  raw.hpScaleCoefficient,
      baseAtk:     raw.baseAtk,
      atkPerLevel: raw.atkScaleCoefficient,
      cellState:   CELL_MAP[raw.cellTypeId] ?? Cell.FLOOR,
      spawnMsg:    raw.spawnMsg,
      xpReward:    raw.xpValue,
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

export const BOSSES: BossDef[] = (bossesData as RawBoss[]).map(raw => ({
  char:       vis(raw.visualAsset),
  name:       raw.displayName,
  hpMult:     raw.hpMult,
  atkMult:    raw.atkMult,
  xpReward:   raw.xpValue,
  flavorText: raw.flavorText,
}));

// ── Items ─────────────────────────────────────────────────────────────────────

const ITEM_EFFECT_TO_TYPE: Record<string, 'heal' | 'stat'> = {
  heal: 'heal',
  atk:  'stat',
};

export const ITEMS: Record<string, ItemDef> = Object.fromEntries(
  Object.entries(itemsData as Record<string, RawItem>).map(([key, raw]) => [
    key,
    {
      char:      vis(raw.visualAsset),
      name:      raw.displayName,
      type:      ITEM_EFFECT_TO_TYPE[raw.effectType] ?? 'heal',
      statValue: raw.effectValue,
      cellState: CELL_MAP[raw.cellTypeId] ?? Cell.FLOOR,
    } satisfies ItemDef,
  ])
);

// ── Equipment ─────────────────────────────────────────────────────────────────

export const EQUIPMENT: EquipmentDef[] = (equipmentData as RawEquipment[]).map(raw => ({
  char:     vis(raw.visualAsset),
  name:     raw.displayName,
  slot:     raw.slot as EquipSlot,
  atkBonus: raw.atkBonus,
  defBonus: raw.defBonus,
  tier:     raw.tier,
}));

// ── Perk effect resolvers ─────────────────────────────────────────────────────

const PERK_RESOLVERS: Record<string, (player: Player, value: number) => void> = {
  maxHpIncrease:           (p, v) => { p.maxHp += v; p.hp = Math.min(p.hp + v, p.maxHp); },
  atkIncrease:             (p, v) => { p.atk += v; },
  visionIncrease:          (p, v) => { p.visionRadius += v; },
  regenIncrease:           (p, v) => { p.regenPerTick += v; },
  poisonImmune:            (p)    => { p.poisonImmune = true; },
  killHealIncrease:        (p, v) => { p.killHeal += v; },
  damageReductionIncrease: (p, v) => { p.damageReduction += v; },
  tickSlowIncrease:        (p, v) => { p.tickSlowPercent += v; },
};

export const PERKS: PerkDef[] = (perksData as RawPerk[]).map(raw => ({
  id:    raw.id,
  name:  raw.name,
  desc:  raw.desc,
  apply: (player: Player) => {
    PERK_RESOLVERS[raw.effectType]?.(player, raw.effectValue);
  },
}));

// ── Merchant effect resolvers ─────────────────────────────────────────────────

const MERCHANT_RESOLVERS: Record<string, (player: Player, value: number, label: string) => string> = {
  heal:       (p, v, l) => { const h = p.heal(v); return l.replace('{value}', String(h)); },
  atkBoost:   (p, v, l) => { p.atk += v; return l; },
  maxHpBoost: (p, v, l) => { p.maxHp += v; p.hp = Math.min(p.hp + v, p.maxHp); return l; },
  visionBoost:(p, v, l) => { p.visionRadius += v; return l; },
  curePoison: (p, _v, l) => { p.statuses = p.statuses.filter(s => s.type !== 'poison'); return l; },
  regenBoost: (p, v, l)  => { p.regenPerTick += v; return l; },
};

export const MERCHANT_STOCK: MerchantItem[] = (merchantData as RawMerchantItem[]).map(raw => ({
  name: raw.displayName,
  char: vis(raw.visualAsset),
  cost: raw.cost,
  apply: (player: Player) => {
    const resolve = MERCHANT_RESOLVERS[raw.effectType];
    return resolve ? resolve(player, raw.effectValue, raw.effectLabel) : raw.effectLabel;
  },
}));

// ── Relics ────────────────────────────────────────────────────────────────────

export const RELICS: RelicDef[] = [
  {
    id: 'vampire_ring',
    char: '💍',
    name: 'Vampire Ring',
    desc: '+2 HP on every kill',
    onPickup: (p: Player) => { p.killHeal += 2; },
  },
  {
    id: 'echo_stone',
    char: '🌀',
    name: 'Echo Stone',
    desc: '20% chance to dodge attacks',
    onPickup: (p: Player) => { p.dodgeChance += 0.20; },
  },
  {
    id: 'ember_core',
    char: '🔥',
    name: 'Ember Core',
    desc: 'Line clears deal 5 dmg to all visible monsters',
    onPickup: (p: Player) => { p.lineClearDamage += 5; },
  },
  {
    id: 'soul_lantern',
    char: '🕯️',
    name: 'Soul Lantern',
    desc: 'Vision radius +3',
    onPickup: (p: Player) => { p.visionRadius += 3; },
  },
  {
    id: 'talisman',
    char: '🪬',
    name: 'Talisman',
    desc: 'Status effects expire 1 turn sooner',
    onPickup: (p: Player) => { p.statusDurationBonus += 1; },
  },
  {
    id: 'lodestone',
    char: '🧲',
    name: 'Lodestone',
    desc: 'Stun adjacent monsters each tick',
    onPickup: (p: Player) => { p.auraStunRadius = 1; },
  },
  {
    id: 'mana_beads',
    char: '📿',
    name: 'Mana Beads',
    desc: 'Every 5th attack deals double damage',
    onPickup: (p: Player) => { p.critEvery = 5; p.critCount = 0; },
  },
  {
    id: 'blood_pact',
    char: '🩸',
    name: 'Blood Pact',
    desc: '+8 ATK, -10 Max HP',
    onPickup: (p: Player) => {
      p.atk += 8;
      p.maxHp = Math.max(10, p.maxHp - 10);
      p.hp = Math.min(p.hp, p.maxHp);
    },
  },
];

// ── Modifiers ─────────────────────────────────────────────────────────────────

export const MODIFIERS: ModifierDef[] = [
  {
    id: 'glass_cannon',
    emoji: '🩸',
    name: 'Glass Cannon',
    desc: '+8 ATK, −15 Max HP',
    apply: (g) => { g.player.atk += 8; g.player.maxHp = Math.max(10, g.player.maxHp - 15); g.player.hp = g.player.maxHp; },
  },
  {
    id: 'blessed',
    emoji: '🍀',
    name: 'Blessed',
    desc: 'Potions heal double',
    apply: (g) => { g.potionHealMult = 2; },
  },
  {
    id: 'overclock',
    emoji: '⚡',
    name: 'Overclock',
    desc: 'Gravity 20% faster, score ×1.5',
    apply: (g) => { g.player.tickSlowPercent -= 20; g.scoreMultiplier = 1.5; },
  },
  {
    id: 'cursed',
    emoji: '💀',
    name: 'Cursed',
    desc: 'Score ×2 — but line clears don\'t heal',
    apply: (g) => { g.scoreMultiplier = 2.0; g.noLineHeal = true; },
  },
  {
    id: 'blind_run',
    emoji: '🌑',
    name: 'Blind Run',
    desc: 'Vision radius halved',
    apply: (g) => { g.player.visionRadius = Math.max(1, Math.floor(g.player.visionRadius / 2)); },
  },
  {
    id: 'ironclad',
    emoji: '🛡️',
    name: 'Ironclad',
    desc: '+3 Damage Reduction, −3 ATK',
    apply: (g) => { g.player.damageReduction += 3; g.player.atk = Math.max(1, g.player.atk - 3); },
  },
  {
    id: 'haunted',
    emoji: '👁️',
    name: 'Haunted',
    desc: 'Double monster spawn rate',
    apply: (g) => { g.haunted = true; },
  },
  {
    id: 'frozen_rift',
    emoji: '🧊',
    name: 'Frozen Rift',
    desc: 'All monsters spawn stunned for 1 turn',
    apply: (g) => { g.frozenRift = true; },
  },
  {
    id: 'lucky',
    emoji: '✨',
    name: 'Lucky',
    desc: 'Every 5th block contains a guaranteed item',
    apply: (g) => { g.luckyEvery = 0; },
  },
  {
    id: 'berserker',
    emoji: '🔥',
    name: 'Berserker',
    desc: 'ATK doubled, Max HP halved',
    apply: (g) => { g.player.atk = g.player.atk * 2; g.player.maxHp = Math.max(10, Math.floor(g.player.maxHp / 2)); g.player.hp = g.player.maxHp; },
  },
];

// ── Shapes ────────────────────────────────────────────────────────────────────

export type ShapeKey = 'I' | 'O' | 'T' | 'S' | 'Z' | 'J' | 'L';

export interface ShapeDef {
  matrix: number[][];
  color: string;
}

export const SHAPES = shapesData as Record<ShapeKey, ShapeDef>;

export const NEXT_PREVIEWS: Record<ShapeKey, string> = Object.fromEntries(
  Object.entries(shapesData as Record<ShapeKey, RawShape>).map(([k, v]) => [k, v.preview])
) as Record<ShapeKey, string>;
