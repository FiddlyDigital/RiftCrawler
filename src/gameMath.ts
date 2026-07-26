import { Balance } from './balance';
import type { CellValue } from './types';

/** Pure tetromino/timing/scoring math shared by `Game` and the tick loop in `main.ts`. */
export class GameMath {
  /** Rotates a piece matrix 90° clockwise. @throws {TypeError} If `matrix` is null/undefined/empty. */
  static rotateMatrix(matrix: CellValue[][]): CellValue[][] {
    if (!matrix || matrix.length === 0) throw new TypeError('GameMath.rotateMatrix: "matrix" must be a non-empty 2D array');
    const rows = matrix.length;
    const cols = matrix[0]!.length;
    const out: CellValue[][] = Array.from({ length: cols }, () => Array(rows).fill(0) as CellValue[]);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        out[c]![rows - 1 - r] = matrix[r]![c]!;
      }
    }
    return out;
  }

  /** Milliseconds per gravity tick at the given dungeon level and slow percentage. */
  static tickMsForLevel(level: number, slowPercent: number): number {
    const base = Math.max(Balance.CONFIG.progression.tickMinMs, Balance.CONFIG.progression.tickBaseMs - (level - 1) * Balance.CONFIG.progression.tickMsPerDungeonLevel);
    return Math.floor(base * (1 + slowPercent / 100));
  }

  /** Gold awarded for clearing `count` rows at dungeon level `level`. */
  static scoreForLines(count: number, level: number): number {
    return (Balance.CONFIG.progression.lineClearScoreBase[count] ?? Balance.CONFIG.progression.lineClearScoreOverflow) * level;
  }
}
