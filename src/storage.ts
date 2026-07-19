import { SAVE_VERSION, type RunRecord, type RunStats, type GhostRecord, type CodexKind, type CodexState, type SavedRun } from './types';
import type { Game } from './game';
import { Balance } from './balance';

const KEY     = 'riftcrawler_v2';
const HIS_KEY = 'riftcrawler_history_v2';
const MAX_HISTORY = 5;
const MUTE_KEY = 'riftcrawler_mute';
const VOLUME_KEY = 'riftcrawler_volume';
const GHOSTS_KEY = 'riftcrawler_ghosts_v1';
const MOTION_KEY = 'riftcrawler_reduced_motion';
const CODEX_KEY = 'riftcrawler_codex_v1';
const STASH_KEY = 'riftcrawler_stash_v1';
const TUTORIAL_KEY = 'riftcrawler_tutorial_done_v1';
const RUN_KEY = 'riftcrawler_run_v1';
const DIFFICULTY_KEY = 'riftcrawler_difficulty_v1';

/** Maps a {@link CodexKind} to its plural key on {@link CodexState}. */
const CODEX_LIST_KEY: Record<CodexKind, keyof CodexState> = {
  boss: 'bosses', npc: 'npcs', biome: 'biomes', patron: 'patrons',
};

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

  /** Whether the first-run tutorial has already been shown (completed, skipped, or interrupted). */
  static loadTutorialDone(): boolean {
    try { return localStorage.getItem(TUTORIAL_KEY) === '1'; } catch { return false; }
  }

  /** Marks the first-run tutorial as shown. */
  static saveTutorialDone(): void {
    try { localStorage.setItem(TUTORIAL_KEY, '1'); } catch { /* quota */ }
  }

  /** Gold left with the Sídhe by past characters, not yet claimed (0 if none). */
  static loadStash(): number {
    try {
      const v = Number(localStorage.getItem(STASH_KEY) ?? 0);
      return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
    } catch { return 0; }
  }

  /**
   * Adds gold to the cross-run stash.
   * @param amount - Gold to deposit; must be a non-negative finite number.
   * @returns The new stash total.
   * @throws {TypeError} If `amount` is not a non-negative finite number.
   */
  static addToStash(amount: number): number {
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) {
      throw new TypeError('StorageService.addToStash: "amount" must be a non-negative finite number');
    }
    const total = StorageService.loadStash() + Math.floor(amount);
    try { localStorage.setItem(STASH_KEY, String(total)); } catch { /* quota */ }
    return total;
  }

  /**
   * Empties the stash and returns the inheritance: the stored gold scaled by
   * `waystation.stashRecoveryPct` (the Sídhe keep their tithe). Called once
   * per new run; a second call returns 0 until something is deposited again.
   */
  static claimStash(): number {
    const total = StorageService.loadStash();
    if (total <= 0) return 0;
    try { localStorage.removeItem(STASH_KEY); } catch { /* quota */ }
    return Math.floor(total * Balance.CONFIG.waystation.stashRecoveryPct);
  }

  /**
   * Persists the mid-run snapshot (see `Game.serialize`). Overwrites any
   * previous snapshot — there is exactly one resumable run at a time.
   * @throws {TypeError} If `run` is null/undefined.
   */
  static saveRun(run: SavedRun): void {
    if (run === null || run === undefined) throw new TypeError('StorageService.saveRun: "run" must not be null/undefined');
    try { localStorage.setItem(RUN_KEY, JSON.stringify(run)); } catch { /* quota */ }
  }

  /** The stored mid-run snapshot, or `null` if none exists / it predates the current {@link SAVE_VERSION} / it can't be parsed. */
  static loadRun(): SavedRun | null {
    try {
      const raw = localStorage.getItem(RUN_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as SavedRun;
      return parsed.version === SAVE_VERSION ? parsed : null;
    } catch { return null; }
  }

  /** Discards the stored mid-run snapshot (run ended, or a fresh run began). */
  static clearRun(): void {
    try { localStorage.removeItem(RUN_KEY); } catch { /* unavailable */ }
  }

  /**
   * Persists the last-chosen difficulty preset id (the picker marks it next run).
   * @throws {TypeError} If `id` is not a non-empty string.
   */
  static saveDifficulty(id: string): void {
    if (typeof id !== 'string' || id.length === 0) throw new TypeError('StorageService.saveDifficulty: "id" must be a non-empty string');
    try { localStorage.setItem(DIFFICULTY_KEY, id); } catch { /* quota */ }
  }

  /** The last-chosen difficulty preset id, or `null` if never chosen. */
  static loadDifficulty(): string | null {
    try { return localStorage.getItem(DIFFICULTY_KEY); } catch { return null; }
  }

  /** The lore codex: every boss/NPC/biome/patron discovered across all past runs. */
  static loadCodex(): CodexState {
    try {
      const raw = localStorage.getItem(CODEX_KEY);
      if (!raw) return { bosses: [], npcs: [], biomes: [], patrons: [] };
      const parsed = JSON.parse(raw) as Partial<CodexState>;
      return {
        bosses: parsed.bosses ?? [], npcs: parsed.npcs ?? [],
        biomes: parsed.biomes ?? [], patrons: parsed.patrons ?? [],
      };
    } catch { return { bosses: [], npcs: [], biomes: [], patrons: [] }; }
  }

  /**
   * Marks `id` as discovered under `kind`, if it isn't already (idempotent —
   * safe to call on every encounter, not just the first).
   * @throws {TypeError} If `kind` isn't a valid {@link CodexKind} or `id` is not a non-empty string.
   */
  static recordCodexDiscovery(kind: CodexKind, id: string): CodexState {
    if (!Object.prototype.hasOwnProperty.call(CODEX_LIST_KEY, kind)) {
      throw new TypeError('StorageService.recordCodexDiscovery: "kind" must be a valid CodexKind');
    }
    if (typeof id !== 'string' || id.length === 0) {
      throw new TypeError('StorageService.recordCodexDiscovery: "id" must be a non-empty string');
    }
    const state = StorageService.loadCodex();
    const listKey = CODEX_LIST_KEY[kind];
    if (!state[listKey].includes(id)) {
      state[listKey] = [...state[listKey], id];
      try { localStorage.setItem(CODEX_KEY, JSON.stringify(state)); } catch { /* quota */ }
    }
    return state;
  }
}
