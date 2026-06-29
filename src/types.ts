import type { ShapeKey } from './config';

export const Tile = { VOID: 0, FLOOR: 1, STAIRS: 2 } as const;
export type TileValue = (typeof Tile)[keyof typeof Tile];

export const Cell = {
  EMPTY: 0,
  FLOOR: 1,
  MONSTER_RAT: 2,
  MONSTER_SKEL: 3,
  ITEM_POTION: 4,
  ITEM_SWORD: 5,
  STAIRS: 6,
  BOMB: 7,
  MERCHANT: 8,
  BOSS: 9,
  ITEM_EQUIPMENT: 10,
  MONSTER_ARCHER: 11,
  MONSTER_SLIME: 12,
  MONSTER_ORC: 13,
  MONSTER_BAT: 14,
} as const;
export type CellValue = (typeof Cell)[keyof typeof Cell];

export type LogClass = 'log-neutral' | 'log-damage' | 'log-success' | 'log-tetris' | 'log-boss' | 'log-combo' | 'log-perk';

export type StatusType = 'poison' | 'stun';

export interface StatusEffect {
  type: StatusType;
  duration: number;
  power: number;
}

export type EquipSlot = 'weapon' | 'armor';
export type ItemType = 'heal' | 'stat' | 'weapon' | 'armor';

export interface UIState {
  hp: number;
  maxHp: number;
  floor: number;
  score: number;
  gravityRate: number;
  nextType: ShapeKey;
  xp: number;
  xpToNext: number;
  playerLevel: number;
  weaponName: string | null;
  armorName: string | null;
  statuses: StatusEffect[];
}

export type AudioEvent =
  | 'blockLand' | 'blockRotate' | 'blockMove'
  | 'hit' | 'playerDamage' | 'kill'
  | 'lineClear' | 'descend' | 'poison';

export interface GameCallbacks {
  log: (text: string, cls: LogClass) => void;
  updateUI: (state: UIState) => void;
  onDeath: (title: string, reason: string, floor: number, score: number) => void;
  onParticle: (gridX: number, gridY: number, text: string, color: string) => void;
  onLevelUp: (newLevel: number) => void;
  onOpenShop: (gold: number) => void;
  onAction: () => void;
  onAudio?: (event: AudioEvent, data?: number) => void;
}

export interface RunRecord {
  date: string;
  score: number;
  floor: number;
  playerLevel: number;
  cause: string;
}

// ── Content interfaces (referenced by dataLoader + entities) ──────────────────

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
  behaviorType?: string;
  attackRange?: number;
  moveSpeed?: number;
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
