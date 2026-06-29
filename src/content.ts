import { Cell, type CellValue, type StatusType, type EquipSlot } from './types';
import type { Player } from './entities';

export interface MonsterDef {
  char: string;
  name: string;
  baseHp: number;
  hpPerLevel: number;
  baseAtk: number;
  atkPerLevel: number;
  cellState: CellValue;
  spawnMsg: string;
  xpReward: number;
  statusInflict?: { type: StatusType; chance: number; duration: number; power: number };
}

export interface BossDef {
  char: string;
  name: string;
  hpMult: number;
  atkMult: number;
  xpReward: number;
  flavorText: string;
}

export interface ItemDef {
  char: string;
  name: string;
  type: 'heal' | 'stat';
  statValue: number;
  cellState: CellValue;
}

export interface EquipmentDef {
  char: string;
  name: string;
  slot: EquipSlot;
  atkBonus: number;
  defBonus: number;
  tier: number;
}

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

export const MONSTERS: Record<string, MonsterDef> = {
  rat: {
    char: '🐀',
    name: 'Cave Rat',
    baseHp: 10,
    hpPerLevel: 2,
    baseAtk: 3,
    atkPerLevel: 1,
    cellState: Cell.MONSTER_RAT,
    spawnMsg: '👾 Spawn',
    xpReward: 20,
  },
  skeleton: {
    char: '💀',
    name: 'Skeleton Guard',
    baseHp: 18,
    hpPerLevel: 3,
    baseAtk: 5,
    atkPerLevel: 1,
    cellState: Cell.MONSTER_SKEL,
    spawnMsg: '👾 Spawn',
    xpReward: 35,
    statusInflict: { type: 'poison', chance: 0.25, duration: 3, power: 3 },
  },
};

export const BOSSES: BossDef[] = [
  { char: '🐉', name: 'Stone Dragon',    hpMult: 5, atkMult: 2,   xpReward: 200, flavorText: 'The earth trembles...' },
  { char: '👑', name: 'Bone King',       hpMult: 4, atkMult: 2.5, xpReward: 250, flavorText: 'Death itself walks.' },
  { char: '👻', name: 'Shadow Wraith',   hpMult: 4, atkMult: 2,   xpReward: 220, flavorText: 'Cold seeps in...' },
  { char: '🦇', name: 'Vampire Lord',    hpMult: 5, atkMult: 1.5, xpReward: 230, flavorText: 'Wings blot the light.' },
  { char: '🕷️', name: 'Brood Mother',   hpMult: 3, atkMult: 3,   xpReward: 260, flavorText: 'Thousands of eyes open.' },
];

export const ITEMS: Record<string, ItemDef> = {
  potion: {
    char: '🧪',
    name: 'Health Potion',
    type: 'heal',
    statValue: 15,
    cellState: Cell.ITEM_POTION,
  },
  sword: {
    char: '🗡️',
    name: 'Steel Sword',
    type: 'stat',
    statValue: 3,
    cellState: Cell.ITEM_SWORD,
  },
};

export const EQUIPMENT: EquipmentDef[] = [
  { char: '🔪', name: 'Rusty Dagger',   slot: 'weapon', atkBonus: 2,  defBonus: 0, tier: 1 },
  { char: '⚔️', name: 'Iron Sword',      slot: 'weapon', atkBonus: 5,  defBonus: 0, tier: 2 },
  { char: '🪓', name: 'War Axe',         slot: 'weapon', atkBonus: 9,  defBonus: 0, tier: 3 },
  { char: '🛡️', name: 'Leather Buckler', slot: 'armor',  atkBonus: 0,  defBonus: 1, tier: 1 },
  { char: '🦺', name: 'Chain Mail',      slot: 'armor',  atkBonus: 0,  defBonus: 2, tier: 2 },
  { char: '🪖', name: 'Plate Helm',      slot: 'armor',  atkBonus: 0,  defBonus: 3, tier: 3 },
];

export const PERKS: PerkDef[] = [
  { id: 'hp_up',      name: '💪 Toughness',     desc: '+20 Max HP',              apply: (p) => { p.maxHp += 20; p.hp = Math.min(p.hp + 20, p.maxHp); } },
  { id: 'atk_up',     name: '⚔️ Sharpness',      desc: '+5 Attack',               apply: (p) => { p.atk += 5; } },
  { id: 'vision',     name: '👁️ Eagle Eye',       desc: '+2 Vision Radius',        apply: (p) => { p.visionRadius += 2; } },
  { id: 'regen',      name: '🌿 Regeneration',    desc: '+2 HP per tick',          apply: (p) => { p.regenPerTick += 2; } },
  { id: 'immune',     name: '🧪 Iron Stomach',    desc: 'Immune to poison',        apply: (p) => { p.poisonImmune = true; } },
  { id: 'soul_drain', name: '💫 Soul Drain',      desc: '+5 HP on every kill',     apply: (p) => { p.killHeal += 5; } },
  { id: 'bulwark',    name: '🛡️ Bulwark',         desc: 'Reduce all damage by 1',  apply: (p) => { p.damageReduction += 1; } },
  { id: 'time_warp',  name: '⏱️ Time Warp',       desc: 'Slow tick rate by 15%',   apply: (p) => { p.tickSlowPercent += 15; } },
];

export const MERCHANT_STOCK: MerchantItem[] = [
  { name: 'Health Elixir',  char: '🧪', cost: 150, apply: (p) => { const h = p.heal(30); return `Restored ${h} HP`; } },
  { name: 'Attack Tonic',   char: '⚗️',  cost: 200, apply: (p) => { p.atk += 3; return '+3 Attack'; } },
  { name: 'Max HP Crystal', char: '💎', cost: 300, apply: (p) => { p.maxHp += 10; p.hp = Math.min(p.hp + 10, p.maxHp); return '+10 Max HP'; } },
  { name: 'Vision Charm',   char: '🔮', cost: 250, apply: (p) => { p.visionRadius += 1; return '+1 Vision'; } },
  { name: 'Antidote',       char: '💊', cost: 100, apply: (p) => { p.statuses = p.statuses.filter(s => s.type !== 'poison'); return 'Cured poison!'; } },
  { name: 'Regen Salve',    char: '🌿', cost: 350, apply: (p) => { p.regenPerTick += 1; return '+1 HP/tick'; } },
];

export const MONSTER_DEFS = Object.values(MONSTERS);
