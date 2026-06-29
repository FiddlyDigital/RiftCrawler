import type { Game } from './game';

const KEY = 'riftcrawler_v1';

interface StoredData {
  highScore: number;
  deepestFloor: number;
}

function load(): StoredData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { highScore: 0, deepestFloor: 1 };
    return JSON.parse(raw) as StoredData;
  } catch {
    return { highScore: 0, deepestFloor: 1 };
  }
}

function save(data: StoredData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // localStorage unavailable (private browsing quota, etc.) — silently ignore
  }
}

export function getHighScore(): number {
  return load().highScore;
}

export function recordRunEnd(game: Game): number {
  const prev = load();
  const updated: StoredData = {
    highScore: Math.max(prev.highScore, game.score),
    deepestFloor: Math.max(prev.deepestFloor, game.dungeonLevel),
  };
  save(updated);
  return updated.highScore;
}

// ── Mid-run save / resume ────────────────────────────────────────────────────

const RUN_KEY = 'riftcrawler_run_v1';

export interface SavedRun {
  dungeonLevel: number;
  score: number;
  moveCounter: number;
  blocksPlacedSinceStairs: number;
  player: { x: number; y: number; hp: number; maxHp: number; atk: number };
  map: number[][];
  colors: (string | null)[][];
  monsters: Array<{ x: number; y: number; char: string; name: string; hp: number; maxHp: number; atk: number }>;
  items: Array<{ x: number; y: number; char: string; name: string; type: 'heal' | 'stat'; statValue: number }>;
  currentType: string;
  nextType: string;
  blockX: number;
  blockY: number;
  blockMatrix: number[][];
  blockColor: string;
}

export function saveRun(game: Game): void {
  try {
    const run: SavedRun = {
      dungeonLevel: game.dungeonLevel,
      score: game.score,
      // Access private fields via type assertion for serialisation only
      moveCounter: (game as unknown as { moveCounter: number }).moveCounter,
      blocksPlacedSinceStairs: (game as unknown as { blocksPlacedSinceStairs: number }).blocksPlacedSinceStairs,
      player: {
        x: game.player.x,
        y: game.player.y,
        hp: game.player.hp,
        maxHp: game.player.maxHp,
        atk: game.player.atk,
      },
      map: game.map.map(col => [...col]),
      colors: game.colors.map(col => [...col]),
      monsters: game.monsters.map(m => ({ x: m.x, y: m.y, char: m.char, name: m.name, hp: m.hp, maxHp: m.maxHp, atk: m.atk })),
      items: game.items.map(i => ({ x: i.x, y: i.y, char: i.char, name: i.name, type: i.type, statValue: i.statValue })),
      currentType: game.currentType,
      nextType: game.nextType,
      blockX: game.blockX,
      blockY: game.blockY,
      blockMatrix: game.blockMatrix.map(row => [...row]),
      blockColor: game.blockColor,
    };
    localStorage.setItem(RUN_KEY, JSON.stringify(run));
  } catch {
    // ignore
  }
}

export function loadRun(): SavedRun | null {
  try {
    const raw = localStorage.getItem(RUN_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as SavedRun;
  } catch {
    return null;
  }
}

export function clearRun(): void {
  try {
    localStorage.removeItem(RUN_KEY);
  } catch {
    // ignore
  }
}
