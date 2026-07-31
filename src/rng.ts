/**
 * Seedable random-number generation for the simulation.
 *
 * `Game` takes an `rng: () => number` port (like `now` and `stash`), defaulting
 * to `Math.random`. Supplying {@link makeRng} instead makes a whole run
 * reproducible from a seed — which is what the Daily Rift is built on, and
 * what lets a player share "I got floor 14 on today's seed" meaningfully.
 *
 * Only the simulation is seeded. Purely cosmetic randomness in the renderer
 * (mote drift, particle jitter) deliberately stays on `Math.random`: it never
 * affects outcomes, and seeding it would make replays look eerily identical
 * without making them any more fair.
 */

/**
 * mulberry32 — a small, fast, well-distributed 32-bit PRNG. Returns a function
 * yielding floats in `[0, 1)`, exactly like `Math.random`.
 *
 * @param seed - Any 32-bit integer. The same seed always yields the same stream.
 * @throws {TypeError} If `seed` is not a finite number.
 */
export function makeRng(seed: number): () => number {
  if (typeof seed !== 'number' || !Number.isFinite(seed)) {
    throw new TypeError('makeRng: "seed" must be a finite number');
  }
  let a = seed >>> 0;
  return function rng(): number {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Hashes an arbitrary string (a date stamp, a shared seed code) into a 32-bit
 * integer suitable for {@link makeRng}. FNV-1a — stable across platforms and
 * releases, so "2026-07-31" always means the same dungeon for everyone.
 *
 * @throws {TypeError} If `text` is not a string.
 */
export function hashSeed(text: string): number {
  if (typeof text !== 'string') throw new TypeError('hashSeed: "text" must be a string');
  let h = 0x811C9DC5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * The daily seed string for a given date, in UTC so every player worldwide
 * gets the same rift on the same calendar day.
 *
 * @param date - Defaults to now.
 */
export function dailySeedString(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);  // YYYY-MM-DD
}
