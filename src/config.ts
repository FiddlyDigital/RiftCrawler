/**
 * Fixed board geometry for the Tetris/dungeon grid.
 *
 * These are physical layout constants (column/row count, pixel tile size),
 * not gameplay tuning — gameplay numbers live in {@link Balance} and the
 * `src/data/*.json` files instead.
 */
export class GameConfig {
  /** Number of playable columns on the board. */
  static readonly COLS = 10;

  /** Number of playable rows on the board. */
  static readonly ROWS = 25;

  /** Pixel size (width and height) of a single square tile at 1x scale. */
  static readonly TILE_SIZE = 17;
}

export { SHAPES } from './dataLoader';
export type { ShapeKey, ShapeDef } from './dataLoader';
