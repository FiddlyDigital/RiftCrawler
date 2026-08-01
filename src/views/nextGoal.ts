/**
 * The "next goal" line on the death/victory screen.
 *
 * A run ending is the highest-leverage moment in the game: the player is
 * deciding right then whether to hit Restart. Showing raw stats alone gives
 * them nothing to aim at, so this picks the single nearest unfinished thing
 * and names it concretely.
 *
 * Pure and host-free — the caller supplies the cross-run records (which live
 * in `localStorage`, outside the simulation). Ordered by how *close* a goal
 * is, not how big: "two floors from your record" pulls harder than "collect
 * everything".
 */

/** Everything {@link buildNextGoal} needs: this run's result plus the records it was measured against. */
export interface NextGoalInput {
  /** Deepest floor reached this run. */
  floor: number;
  /** Deepest floor of any *previous* run (1 if none). */
  deepestFloor: number;
  /** XP earned this run. */
  totalXpEarned: number;
  /** Best XP of any *previous* run (0 if none). */
  highXp: number;
  codexDiscovered: number;
  codexTotal: number;
  /** Legendary smiths met this run (0-3). */
  smithsMet: number;
  smithsTotal: number;
  spearForged: boolean;
  /** Fomorian captives freed this run. */
  rescuedCount: number;
  rescuesTotal: number;
  /** Current Daily Rift streak, 0 if none. */
  dailyStreak: number;
  /** Whether the run ended in victory rather than death. */
  won: boolean;
}

/** How near a record has to be before it's worth naming as "almost". */
const FLOORS_WITHIN = 3;
const XP_WITHIN_FRACTION = 0.75;
const CODEX_NEARLY_DONE = 3;

/**
 * The one line to show under the run's stats, or `null` when nothing
 * meaningful is close (a first run with no records to chase).
 *
 * @throws {TypeError} If `input` is null/undefined.
 */
export function buildNextGoal(input: NextGoalInput): string | null {
  if (input === null || input === undefined) {
    throw new TypeError('buildNextGoal: "input" must not be null/undefined');
  }
  const {
    floor, deepestFloor, totalXpEarned, highXp,
    codexDiscovered, codexTotal, smithsMet, smithsTotal, spearForged,
    rescuedCount, rescuesTotal, dailyStreak, won,
  } = input;

  const codexLeft = Math.max(0, codexTotal - codexDiscovered);

  // A win reframes everything — the ladder above is what's left.
  if (won) {
    if (codexLeft > 0) return `Bres is down. ${codexLeft} codex ${codexLeft === 1 ? 'entry' : 'entries'} still unfound — and the heat ladder just opened a rung.`;
    return 'Bres is down and the codex is complete. The heat ladder is the only thing left to climb.';
  }

  // 1. A new depth record this run — name it, then point one floor further.
  if (floor > deepestFloor) {
    return `A new deepest floor: ${floor}. Floor ${floor + 1} has never seen you.`;
  }

  // 2. Within touching distance of the depth record.
  const floorsShort = deepestFloor - floor;
  if (floorsShort > 0 && floorsShort <= FLOORS_WITHIN) {
    return floorsShort === 1
      ? `One floor short of your deepest (${deepestFloor}). One.`
      : `${floorsShort} floors short of your deepest (${deepestFloor}).`;
  }

  // 3. The codex is nearly full — a concrete, finite chase.
  if (codexLeft > 0 && codexLeft <= CODEX_NEARLY_DONE) {
    return `${codexLeft} codex ${codexLeft === 1 ? 'entry' : 'entries'} from complete — ${codexDiscovered}/${codexTotal} found.`;
  }

  // 4. The Spear questline left half-finished.
  if (!spearForged && smithsMet > 0) {
    const left = smithsTotal - smithsMet;
    return `You found ${smithsMet} of ${smithsTotal} smiths — the Spear of Lugh needs ${left} more.`;
  }

  // 5. Close to the XP record.
  if (highXp > 0 && totalXpEarned >= highXp * XP_WITHIN_FRACTION && totalXpEarned < highXp) {
    return `${totalXpEarned.toLocaleString()} XP against your best of ${highXp.toLocaleString()} — close.`;
  }

  // 6. Captives still in Fomorian hands.
  if (rescuedCount < rescuesTotal) {
    const left = rescuesTotal - rescuedCount;
    return `${left} of the ${rescuesTotal} captives are still down there.`;
  }

  // 7. Keep a daily streak alive — it's the thing with a deadline.
  if (dailyStreak > 0) {
    return `Your Daily Rift streak stands at ${dailyStreak}. It only survives if you come back tomorrow.`;
  }

  // 8. Fallbacks: name the depth record, or admit there's nothing to chase yet.
  if (deepestFloor > 1) return `Your deepest is floor ${deepestFloor}. Beat it.`;
  return null;
}
