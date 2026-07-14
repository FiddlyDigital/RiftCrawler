import colorsData from './data/colors.json';

/** A single altar/reward tier's color pair, as authored in `data/colors.json`. */
export interface TierColor {
  /** Bare `"r,g,b"` triple (no `rgb()` wrapper) — feeds `rgba(${rgb},alpha)` glow gradients. */
  rgb: string;
  /** CSS hex color used for flat tile-background fills. */
  bg: string;
}

interface ColorsConfig {
  tiers: Record<'1' | '2' | '3', TierColor>;
}

/**
 * Single source of truth for the tier→color mapping shared by the renderer
 * and game logic. Backed by `src/data/colors.json` — edit that file to
 * retune, not this class.
 */
export class Colors {
  private static readonly config = colorsData as ColorsConfig;

  /** Tier 1/2/3 → `{ rgb, bg }` color pair, keyed by numeric tier. */
  static readonly TIERS: Record<1 | 2 | 3, TierColor> = {
    1: Colors.config.tiers['1'],
    2: Colors.config.tiers['2'],
    3: Colors.config.tiers['3'],
  };

  /**
   * Looks up the color pair for a reward tier.
   * @param tier - Reward tier, must be `1`, `2`, or `3`.
   * @throws {RangeError} If `tier` is not one of `1`, `2`, or `3`.
   */
  static forTier(tier: number): TierColor {
    const color = Colors.TIERS[tier as 1 | 2 | 3];
    if (!color) throw new RangeError(`Colors.forTier: unknown tier "${tier}" (expected 1, 2, or 3)`);
    return color;
  }
}
