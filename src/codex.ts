import { Boss, Npc, Biome, Patron } from './content';
import { Balance } from './balance';
import type { CodexState } from './types';

/**
 * Codex progress and the meta-progression it unlocks.
 *
 * The codex was a read-only trophy case: it recorded what you'd met and gave
 * nothing back. This turns it into a slow cross-run ladder — filling it grants
 * small permanent advantages at the start of every future run, so discovery is
 * worth chasing rather than merely noted.
 *
 * Pure and host-free: the caller reads the persisted {@link CodexState} out of
 * storage and passes it in. Unlock tiers are tuned in `balance.json`.
 */

/** One rung of the codex ladder, as configured in `balance.json`'s `codex.unlocks`. */
export interface CodexUnlock {
  /** Discovery percentage (0-100) at which this rung is earned. */
  atPct: number;
  name: string;
  desc: string;
  /** What the rung grants at the start of every run once earned. */
  reward:
    | { kind: 'gold'; amount: number }
    | { kind: 'deathward'; amount: number }
    | { kind: 'boon'; tier: 1 | 2 | 3 };
}

/** A snapshot of how full the codex is. */
export interface CodexProgress {
  discovered: number;
  total: number;
  /** Rounded percentage, 0-100. */
  pct: number;
}

export class Codex {
  /**
   * Every entry the codex can hold. Bosses count the five data-driven biome
   * bosses plus Bres, who is defined in code (he carries behaviour callbacks
   * data can't express) and is recorded under the id `gorgoth`.
   */
  static total(): number {
    return Boss.ALL.length + 1 + Npc.ALL.length + Biome.ALL.length + Patron.ALL.length;
  }

  /**
   * How many entries a saved discovery record actually accounts for. Ids that
   * no longer match live content (renamed NPCs, retired bosses) are ignored
   * rather than inflating the count.
   * @throws {TypeError} If `state` is null/undefined.
   */
  static discovered(state: CodexState): number {
    if (state === null || state === undefined) throw new TypeError('Codex.discovered: "state" must not be null/undefined');
    const bosses = Boss.ALL.filter(b => state.bosses.includes(b.name)).length
      + (state.bosses.includes('gorgoth') ? 1 : 0);
    const npcs    = Npc.ALL.filter(n => state.npcs.includes(n.id)).length;
    const biomes  = Biome.ALL.filter(b => state.biomes.includes(b.id)).length;
    const patrons = Patron.ALL.filter(p => state.patrons.includes(p.id)).length;
    return bosses + npcs + biomes + patrons;
  }

  /** {@link discovered} and {@link total} together, with the percentage the unlock ladder reads. */
  static progress(state: CodexState): CodexProgress {
    const total = Codex.total();
    const discovered = Codex.discovered(state);
    return { discovered, total, pct: total === 0 ? 0 : Math.round((discovered / total) * 100) };
  }

  /** The configured unlock ladder, lowest rung first. */
  static unlocks(): CodexUnlock[] {
    return [...Balance.CONFIG.codex.unlocks].sort((a, b) => a.atPct - b.atPct) as CodexUnlock[];
  }

  /** The rungs earned at a given discovery percentage. */
  static earned(pct: number): CodexUnlock[] {
    return Codex.unlocks().filter(u => pct >= u.atPct);
  }
}
