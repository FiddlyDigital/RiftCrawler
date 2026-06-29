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
} as const;
export type CellValue = (typeof Cell)[keyof typeof Cell];

export type LogClass = 'log-neutral' | 'log-damage' | 'log-success' | 'log-tetris';

export interface UIState {
  hp: number;
  maxHp: number;
  floor: number;
  score: number;
  gravityRate: number;
  nextType: ShapeKey;
}

export interface GameCallbacks {
  log: (text: string, cls: LogClass) => void;
  updateUI: (state: UIState) => void;
  onDeath: (title: string, reason: string, floor: number, score: number) => void;
  onParticle: (gridX: number, gridY: number, text: string, color: string) => void;
}
