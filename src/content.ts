import { Cell, type CellValue } from './types';

export interface MonsterDef {
  char: string;
  name: string;
  baseHp: number;
  hpPerLevel: number;
  baseAtk: number;
  atkPerLevel: number;
  cellState: CellValue;
  spawnMsg: string;
}

export interface ItemDef {
  char: string;
  name: string;
  type: 'heal' | 'stat';
  statValue: number;
  cellState: CellValue;
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
  },
};

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

export const MONSTER_DEFS = Object.values(MONSTERS);
export const ITEM_DEFS = Object.values(ITEMS);
