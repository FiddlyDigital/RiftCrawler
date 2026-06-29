export const CONFIG = {
  COLS: 10,
  ROWS: 15,
  TILE_SIZE: 17,
} as const;

export { SHAPES, NEXT_PREVIEWS } from './dataLoader';
export type { ShapeKey, ShapeDef } from './dataLoader';
