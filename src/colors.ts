// Single source of truth for colors shared across renderer.ts/game.ts —
// previously the tier→color mapping was hand-written independently in three
// places and had drifted out of sync. Edit src/data/colors.json to retune.
import colorsData from './data/colors.json';

export interface TierColor {
  rgb: string;  // bare "r,g,b" for drawPulseGlow
  bg: string;   // hex for tile background fill
}

interface ColorsConfig {
  tiers: Record<'1' | '2' | '3', TierColor>;
}

const COLORS = colorsData as ColorsConfig;

export const TIER_COLORS: Record<1 | 2 | 3, TierColor> = {
  1: COLORS.tiers['1'],
  2: COLORS.tiers['2'],
  3: COLORS.tiers['3'],
};
