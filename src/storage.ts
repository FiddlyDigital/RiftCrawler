import type { RunRecord } from './types';
import type { Game } from './game';

const KEY     = 'riftcrawler_v2';
const HIS_KEY = 'riftcrawler_history_v1';
const MAX_HISTORY = 5;

interface StoredData {
  highScore: number;
  deepestFloor: number;
}

function load(): StoredData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { highScore: 0, deepestFloor: 1 };
    return JSON.parse(raw) as StoredData;
  } catch { return { highScore: 0, deepestFloor: 1 }; }
}

function save(data: StoredData): void {
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* quota */ }
}

export function getHighScore(): number { return load().highScore; }

export function recordRunEnd(game: Game, cause: string): { highScore: number; history: RunRecord[] } {
  const prev = load();
  const updated: StoredData = {
    highScore: Math.max(prev.highScore, game.score),
    deepestFloor: Math.max(prev.deepestFloor, game.dungeonLevel),
  };
  save(updated);

  // Run history
  const record: RunRecord = {
    date: new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    score: game.score,
    floor: game.dungeonLevel,
    playerLevel: game.player.playerLevel,
    cause,
  };
  const history = loadHistory();
  history.unshift(record);
  const trimmed = history.slice(0, MAX_HISTORY);
  try { localStorage.setItem(HIS_KEY, JSON.stringify(trimmed)); } catch { /* quota */ }

  return { highScore: updated.highScore, history: trimmed };
}

export function loadHistory(): RunRecord[] {
  try {
    const raw = localStorage.getItem(HIS_KEY);
    return raw ? (JSON.parse(raw) as RunRecord[]) : [];
  } catch { return []; }
}
