export const CONFIG = {
  COLS: 10,
  ROWS: 15,
  TILE_SIZE: 17,
} as const;

export const SHAPES = {
  I: { matrix: [[1, 1, 1, 1]], color: '#4fc3f7' },
  O: { matrix: [[1, 1], [1, 1]], color: '#fff176' },
  T: { matrix: [[0, 1, 0], [1, 1, 1]], color: '#ba68c8' },
  S: { matrix: [[0, 1, 1], [1, 1, 0]], color: '#81c784' },
  Z: { matrix: [[1, 1, 0], [0, 1, 1]], color: '#e57373' },
  J: { matrix: [[1, 0, 0], [1, 1, 1]], color: '#7986cb' },
  L: { matrix: [[0, 0, 1], [1, 1, 1]], color: '#ffb74d' },
} as const;

export const NEXT_PREVIEWS: Record<string, string> = {
  I: '🩵🩵🩵🩵',
  O: '💛💛<br>💛💛',
  T: '&nbsp;💜<br>💜💜💜',
  S: '&nbsp;💚💚<br>💚💚',
  Z: '❤️❤️<br>&nbsp;❤️❤️',
  J: '💙<br>💙💙💙',
  L: '&nbsp;&nbsp;🧡<br>🧡🧡🧡',
};

export type ShapeKey = keyof typeof SHAPES;
