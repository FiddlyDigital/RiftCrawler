export const CONFIG = {
  COLS: 10,
  ROWS: 25,
  TILE_SIZE: 17,
} as const;

export { SHAPES } from './dataLoader';
export type { ShapeKey, ShapeDef } from './dataLoader';
