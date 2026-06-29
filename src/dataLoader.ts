import visualRegistryData from './data/visual-registry.json';
import monstersData       from './data/monsters.json';
import bossesData         from './data/bosses.json';
import itemsData          from './data/items.json';
import equipmentData      from './data/equipment.json';
import perksData          from './data/perks.json';
import merchantData       from './data/merchant.json';
import shapesData         from './data/shapes.json';
import { Cell, type CellValue, type StatusType, type EquipSlot } from './types';
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
