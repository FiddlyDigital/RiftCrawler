import type { StashPort } from './types';

/**
 * Default {@link StashPort} for hosts with no persistence of their own —
 * headless runs, servers, and unit tests. Keeps the cross-run stash in memory
 * for as long as the instance lives.
 *
 * Pass one shared instance to several `Game`s to model "successive characters"
 * without touching any storage API; give each `Game` its own (the default) and
 * every run starts with an empty coffer.
 */
export class MemoryStash implements StashPort {
  private total = 0;

  load(): number {
    return this.total;
  }

  /** @throws {TypeError} If `amount` is not a non-negative finite number. */
  add(amount: number): number {
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) {
      throw new TypeError('MemoryStash.add: "amount" must be a non-negative finite number');
    }
    this.total += Math.floor(amount);
    return this.total;
  }

  clear(): void {
    this.total = 0;
  }
}
