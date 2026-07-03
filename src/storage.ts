import type { RunRecord, RunStats } from './types';
import type { Game } from './game';

const KEY     = 'riftcrawler_v2';
const HIS_KEY = 'riftcrawler_history_v2';
const MAX_HISTORY = 5;

interface StoredData {
  highXp: number;
  deepestFloor: number;
}

function load(): StoredData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { highXp: 0, deepestFloor: 1 };
    return JSON.parse(raw) as StoredData;
  } catch { return { highXp: 0, deepestFloor: 1 }; }
}

function save(data: StoredData): void {
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* quota */ }
}

export function getHighXp(): number { return load().highXp ?? 0; }

export function recordRunEnd(game: Game, cause: string, stats?: RunStats): { highXp: number; history: RunRecord[] } {
  const prev = load();
  const updated: StoredData = {
    highXp: Math.max(prev.highXp ?? 0, game.player.totalXpEarned),
    deepestFloor: Math.max(prev.deepestFloor, game.dungeonLevel),
  };
  save(updated);

  // Run history
  const record: RunRecord = {
    date: new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    totalXpEarned: game.player.totalXpEarned,
    floor: game.dungeonLevel,
    playerLevel: game.player.playerLevel,
    cause,
    stats,
  };
  const history = loadHistory();
  history.unshift(record);
  const trimmed = history.slice(0, MAX_HISTORY);
  try { localStorage.setItem(HIS_KEY, JSON.stringify(trimmed)); } catch { /* quota */ }

  return { highXp: updated.highXp, history: trimmed };
}

export function loadHistory(): RunRecord[] {
  try {
    const raw = localStorage.getItem(HIS_KEY);
    return raw ? (JSON.parse(raw) as RunRecord[]) : [];
  } catch { return []; }
}

const MUTE_KEY = 'riftcrawler_mute';
export function saveMute(on: boolean): void {
  try { localStorage.setItem(MUTE_KEY, on ? '1' : '0'); } catch { /* quota */ }
}
export function loadMute(): boolean {
  try { return localStorage.getItem(MUTE_KEY) === '1'; } catch { return false; }
}
