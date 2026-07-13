import type { RunRecord, RunStats, GhostRecord } from './types';
import type { Game } from './game';
import { BALANCE } from './balance';

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

// Master volume: 0..1, default full (matches the pre-volume-control loudness).
const VOLUME_KEY = 'riftcrawler_volume';
export function saveVolume(v: number): void {
  try { localStorage.setItem(VOLUME_KEY, String(v)); } catch { /* quota */ }
}
export function loadVolume(): number {
  try {
    const raw = localStorage.getItem(VOLUME_KEY);
    const v = raw === null ? 1 : Number(raw);
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1;
  } catch { return 1; }
}

// Ghost files — fallen characters that may haunt future runs.
const GHOSTS_KEY = 'riftcrawler_ghosts_v1';
export function loadGhosts(): GhostRecord[] {
  try {
    const raw = localStorage.getItem(GHOSTS_KEY);
    return raw ? (JSON.parse(raw) as GhostRecord[]) : [];
  } catch { return []; }
}
export function saveGhostRecord(rec: GhostRecord): void {
  const ghosts = loadGhosts();
  ghosts.unshift(rec);
  try { localStorage.setItem(GHOSTS_KEY, JSON.stringify(ghosts.slice(0, BALANCE.ghosts.maxStored))); } catch { /* quota */ }
}
export function removeGhostRecord(id: string): void {
  try { localStorage.setItem(GHOSTS_KEY, JSON.stringify(loadGhosts().filter(g => g.id !== id))); } catch { /* quota */ }
}

// Reduced motion: null = no stored preference yet (fall back to the OS setting).
const MOTION_KEY = 'riftcrawler_reduced_motion';
export function saveReducedMotion(on: boolean): void {
  try { localStorage.setItem(MOTION_KEY, on ? '1' : '0'); } catch { /* quota */ }
}
export function loadReducedMotion(): boolean | null {
  try {
    const raw = localStorage.getItem(MOTION_KEY);
    return raw === null ? null : raw === '1';
  } catch { return null; }
}
