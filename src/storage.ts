import type { RunRecord, RunStats, GhostRecord } from './types';
import type { Game } from './game';
import { Balance } from './balance';

const KEY     = 'riftcrawler_v2';
const HIS_KEY = 'riftcrawler_history_v2';
const MAX_HISTORY = 5;
const MUTE_KEY = 'riftcrawler_mute';
const VOLUME_KEY = 'riftcrawler_volume';
const GHOSTS_KEY = 'riftcrawler_ghosts_v1';
const MOTION_KEY = 'riftcrawler_reduced_motion';

interface StoredData {
  highXp: number;
  deepestFloor: number;
}

/**
 * All `localStorage`-backed persistence for the game: best score, run
 * history, mute/volume, ghost files, and the reduced-motion preference.
 * Every read/write is wrapped so a full or disabled `localStorage` (private
 * browsing, quota errors) degrades to sensible defaults instead of throwing.
 */
export class StorageService {
  private static load(): StoredData {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return { highXp: 0, deepestFloor: 1 };
      return JSON.parse(raw) as StoredData;
    } catch { return { highXp: 0, deepestFloor: 1 }; }
  }

  private static save(data: StoredData): void {
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* quota */ }
  }

  /** The best total-XP-earned across all past runs (0 if none recorded). */
  static getHighXp(): number {
    return StorageService.load().highXp ?? 0;
  }

  /**
   * Records the end of a run: updates the best-score/deepest-floor record
   * and prepends a run-history entry.
   * @param game - The finished run's `Game` instance.
   * @param cause - Human-readable cause of death/victory.
   * @param stats - Optional extended run stats for the recap screen.
   * @returns The updated high score and the trimmed run history.
   * @throws {TypeError} If `game` is null/undefined or `cause` is not a non-empty string.
   */
  static recordRunEnd(game: Game, cause: string, stats?: RunStats): { highXp: number; history: RunRecord[] } {
    if (game === null || game === undefined) throw new TypeError('StorageService.recordRunEnd: "game" must not be null/undefined');
    if (typeof cause !== 'string' || cause.length === 0) throw new TypeError('StorageService.recordRunEnd: "cause" must be a non-empty string');

    const prev = StorageService.load();
    const updated: StoredData = {
      highXp: Math.max(prev.highXp ?? 0, game.player.totalXpEarned),
      deepestFloor: Math.max(prev.deepestFloor, game.dungeonLevel),
    };
    StorageService.save(updated);

    const record: RunRecord = {
      date: new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      totalXpEarned: game.player.totalXpEarned,
      floor: game.dungeonLevel,
      playerLevel: game.player.playerLevel,
      cause,
      stats,
    };
    const history = StorageService.loadHistory();
    history.unshift(record);
    const trimmed = history.slice(0, MAX_HISTORY);
    try { localStorage.setItem(HIS_KEY, JSON.stringify(trimmed)); } catch { /* quota */ }

    return { highXp: updated.highXp, history: trimmed };
  }

  /** The most recent run-history entries (newest first, capped at 5). */
  static loadHistory(): RunRecord[] {
    try {
      const raw = localStorage.getItem(HIS_KEY);
      return raw ? (JSON.parse(raw) as RunRecord[]) : [];
    } catch { return []; }
  }

  /**
   * Persists the mute toggle.
   * @throws {TypeError} If `on` is not a boolean.
   */
  static saveMute(on: boolean): void {
    if (typeof on !== 'boolean') throw new TypeError('StorageService.saveMute: "on" must be a boolean');
    try { localStorage.setItem(MUTE_KEY, on ? '1' : '0'); } catch { /* quota */ }
  }

  /** The persisted mute toggle (defaults to `false`). */
  static loadMute(): boolean {
    try { return localStorage.getItem(MUTE_KEY) === '1'; } catch { return false; }
  }

  /**
   * Persists the master volume.
   * @param v - Volume, expected in `[0, 1]` (matches the pre-volume-control loudness at `1`).
   * @throws {TypeError} If `v` is not a finite number.
   */
  static saveVolume(v: number): void {
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new TypeError('StorageService.saveVolume: "v" must be a finite number');
    try { localStorage.setItem(VOLUME_KEY, String(v)); } catch { /* quota */ }
  }

  /** The persisted master volume, clamped to `[0, 1]` (defaults to `1`). */
  static loadVolume(): number {
    try {
      const raw = localStorage.getItem(VOLUME_KEY);
      const v = raw === null ? 1 : Number(raw);
      return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1;
    } catch { return 1; }
  }

  /** Fallen characters from past runs who may haunt future ones. */
  static loadGhosts(): GhostRecord[] {
    try {
      const raw = localStorage.getItem(GHOSTS_KEY);
      return raw ? (JSON.parse(raw) as GhostRecord[]) : [];
    } catch { return []; }
  }

  /**
   * Prepends a new ghost record, trimmed to `Balance.CONFIG.ghosts.maxStored`.
   * @throws {TypeError} If `rec` is null/undefined.
   */
  static saveGhostRecord(rec: GhostRecord): void {
    if (rec === null || rec === undefined) throw new TypeError('StorageService.saveGhostRecord: "rec" must not be null/undefined');
    const ghosts = StorageService.loadGhosts();
    ghosts.unshift(rec);
    try { localStorage.setItem(GHOSTS_KEY, JSON.stringify(ghosts.slice(0, Balance.CONFIG.ghosts.maxStored))); } catch { /* quota */ }
  }

  /**
   * Removes a ghost record by id (a no-op if no ghost has that id).
   * @throws {TypeError} If `id` is not a non-empty string.
   */
  static removeGhostRecord(id: string): void {
    if (typeof id !== 'string' || id.length === 0) throw new TypeError('StorageService.removeGhostRecord: "id" must be a non-empty string');
    try { localStorage.setItem(GHOSTS_KEY, JSON.stringify(StorageService.loadGhosts().filter(g => g.id !== id))); } catch { /* quota */ }
  }

  /**
   * Persists the reduced-motion preference.
   * @throws {TypeError} If `on` is not a boolean.
   */
  static saveReducedMotion(on: boolean): void {
    if (typeof on !== 'boolean') throw new TypeError('StorageService.saveReducedMotion: "on" must be a boolean');
    try { localStorage.setItem(MOTION_KEY, on ? '1' : '0'); } catch { /* quota */ }
  }

  /** The persisted reduced-motion preference, or `null` if never set (fall back to the OS setting). */
  static loadReducedMotion(): boolean | null {
    try {
      const raw = localStorage.getItem(MOTION_KEY);
      return raw === null ? null : raw === '1';
    } catch { return null; }
  }
}
