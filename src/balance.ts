// Central typed loader for gameplay-balance JSON — the "tuning knobs" layer.
// (src/dataLoader.ts is for "content" — offers/grants with closures. This
// file is flat numbers consumed by simulation code in systems/*.ts, game.ts,
// entities.ts.) Edit the JSON files in src/data/ to retune the game; nothing
// here needs to change.
import combatData from './data/combat.json';
import hazardsData from './data/hazards.json';
import monsterAiData from './data/monster-ai.json';
import balanceData from './data/balance.json';

/** Per-outcome dice/combat tuning, loaded from `data/combat.json`. */
export interface CombatBalance {
  diceSidesByLevel: number[];
  outcomeMultipliers: Record<'miss' | 'weak' | 'normal' | 'power' | 'critical', number>;
  marginThresholds: { weakMax: number; normalMax: number };
  missPityStreak: number;
  grazeDamagePct: number;
  critStun: { duration: number; power: number };
  rewards: { goldOnKill: number; goldOnBossKill: number; eliteGoldBonusPerFloor: number; healOnKill: number };
}

/** Trap-hazard tuning, loaded from `data/hazards.json`. */
export interface HazardBalance {
  spike: {
    rearmMinTurns: number; rearmRandomTurns: number; warningThreshold: number;
    damagePerDungeonLevel: number; minDamage: number; fieldFixedTimer: number;
  };
}

/** Per-behavior-type monster AI tuning, loaded from `data/monster-ai.json`. */
export interface MonsterAiConfig {
  common:    { contactDistance: number };
  melee:     { chaseRange: number };
  berserker: { chaseRange: number; enrageHpFraction: number };
  swift:     { chaseRange: number; doubleMoveOnChase: boolean };
  ranged:    { retreatDistance: number; advanceRangeBonus: number };
  healer:    { healRadius: number; healFraction: number };
  gorgoth:   { stepTurns: number };
}

/** Top-level gameplay tuning knobs, loaded from `data/balance.json`. */
export interface BalanceConfig {
  player: {
    startingHp: number; startingAtk: number;
    xpToNextStart: number; xpToNextGrowth: number;
    combatLevelBands: Array<{ minPlayerLevel: number; combatLevel?: number; combatLevelFloor?: number }>;
  };
  progression: {
    tickBaseMs: number; tickMinMs: number; tickMsPerDungeonLevel: number;
    lineClearScoreBase: number[]; lineClearScoreOverflow: number;
  };
  economy: {
    geasaRerollBaseCost: number; geasaRerollCostGrowth: number;
    ogmRerollBaseCost: number; ogmRerollCostGrowth: number;
    shop: {
      descentModulo: number; descentRemainder: number;
      prices: Record<'heal' | 'maxhp' | 'atk' | 'ward', { base: number; perFloor: number }>;
    };
  };
  ammo: { replenishOnDescend: number; maxAmmo: number };
  altars: { vaultTierMinFloorT3: number; vaultTierMinFloorT2: number };
  brands: { maxLifetime: number };
  floors: { bossFloorInterval: number; floorEventInterval: number; dungeonRoomChance: number };
  boss: { baseHpFloor1: number; baseHpPerDungeonLevel: number; baseAtkFloor1: number; baseAtkPerDungeonLevel: number; combatLevel: number };
  gorgoth: { maxHp: number; atk: number; xpReward: number; combatLevel: number };
  crystalShards: { baseHp: number; hpPerDungeonLevel: number; baseAtk: number; atkPerDungeonLevel: number };
  spawnRates: {
    cursedPieceChance: number; blessedPieceChance: number;
    stairsForcedAfterBlocks: number; stairsRandomChance: number;
    merchantChance: number; maxTattooTilesPerFloor: number; altarChance: number;
    npcChance: number; maxNpcTilesPerFloor: number;
    trapWeights: Record<'spike' | 'smoke' | 'teleport', number>;
    monsterBaseChance: number; monsterChancePerDungeonLevel: number; monsterChanceCap: number;
    hauntedMonsterChanceMult: number;
    monsterWeights: Record<string, number>;
    oPieceAltarChance: number; oPieceAltarChanceArchitect: number;
  };
  eliteMonsters: { spawnChance: number; hpMult: number; atkMult: number; combatLevelBonus: number };
  ghosts: { encounterChance: number; levelTolerance: number; maxStored: number };
  narrative: { closeCallHpFraction: number };
  smiths: { floorInterval: number; pieceThreshold: number; warningThreshold: number };
  omens: { rollChance: number };
  well: { baseCost: number; costPerFloor: number; baseXp: number; xpPerFloor: number };
  waystation: { tattooistChance: number; stashRecoveryPct: number };
  rescues: { rollChance: number; pieceThreshold: number; portionAtk: number; healerBaseCost: number; healerCostPerFloor: number; healerHpGain: number };
  spearOfLugh: { dmgMult: number; cooldownMax: number };
  difficulty: { presets: DifficultyPreset[] };
  ngplus: { xpBonusPerHeat: number; tiers: HeatTier[] };
}

/** One New-Game+ heat tier (see `balance.json` → `ngplus.tiers`). Heat N applies every tier with `level <= N`. */
export interface HeatTier {
  level: number;
  /** Sprite-map key for the picker card / badge. */
  icon: string;
  name: string;
  desc: string;
  /**
   * The tier's handicap knobs, combined cumulatively across active tiers:
   * `*Mult` keys multiply, the rest add. Consumed at the same choke points
   * as the difficulty/omen multipliers.
   */
  params: Record<string, number>;
}

/** A run-start difficulty preset (see `balance.json` → `difficulty.presets`). */
export interface DifficultyPreset {
  id: string;
  /** Sprite-map key for the picker card. */
  icon: string;
  name: string;
  desc: string;
  /** Percent adjustment to gravity tick speed (positive = slower/easier, matching `tickSlowPercent`). */
  gravityPct: number;
  /** Applied once to the hero's Max HP at run start. */
  playerHpMult: number;
  /** Applied to every monster/boss attack stat at spawn. */
  monsterAtkMult: number;
  /** Applied to every monster/boss max HP at spawn. */
  monsterHpMult: number;
  /** Applied to line-clear gold. */
  goldMult: number;
  /** Folded into the run's XP multiplier at run start. */
  xpMult: number;
}

/**
 * Static home for every gameplay tuning JSON blob, plus the small pure
 * helpers ({@link weightedPick}, {@link numOr}) simulation code uses to
 * consume them. Edit the JSON files in `src/data/` to retune the game —
 * nothing in this class needs to change for balance tweaks.
 */
export class Balance {
  // JSON literal inference gives each ngplus/difficulty entry's params an
  // exact optional-key type that clashes with Record<string, number>; hop
  // through unknown (mirrors the omens.json loader in dataLoader.ts).
  /** Top-level tuning knobs (`data/balance.json`). */
  static readonly CONFIG = balanceData as unknown as BalanceConfig;

  /** Combat/dice tuning (`data/combat.json`). */
  static readonly COMBAT = combatData as CombatBalance;

  /** Hazard/trap tuning (`data/hazards.json`). */
  static readonly HAZARD = hazardsData as HazardBalance;

  /** Monster AI tuning (`data/monster-ai.json`). */
  static readonly MONSTER_AI = monsterAiData as MonsterAiConfig;

  /**
   * Returns `value` if defined, otherwise `fallback` — a `??` with an
   * explicit name for use inside object-literal expressions.
   * @param value - The optional value to prefer.
   * @param fallback - The value to use when `value` is undefined.
   * @throws {TypeError} If `fallback` is not a finite number.
   */
  static numOr(value: number | undefined, fallback: number): number {
    if (typeof fallback !== 'number' || !Number.isFinite(fallback)) {
      throw new TypeError('Balance.numOr: "fallback" must be a finite number');
    }
    return value === undefined ? fallback : value;
  }

  /**
   * Converts independent per-key weights into the same cumulative-cutoff
   * behavior a chain of `if (r < cutoff) ...` checks would implement,
   * without anyone having to hand-compute cumulative bounds in the JSON.
   * @param weights - Map of key to its (not-necessarily-normalized) weight.
   * @param roll - A roll in `[0, 1)` (or whatever scale the weights sum to).
   * @returns The key whose cumulative range contains `roll`, or `null` if
   * `roll` lands past the last cutoff — a legal "no match" outcome (e.g.
   * trap rolls, where "no trap" is the common case).
   * @throws {TypeError} If `weights` is null/undefined or `roll` is not a finite number.
   */
  static weightedPick<T extends string>(weights: Record<T, number>, roll: number): T | null {
    if (weights === null || weights === undefined) {
      throw new TypeError('Balance.weightedPick: "weights" must not be null/undefined');
    }
    if (typeof roll !== 'number' || !Number.isFinite(roll)) {
      throw new TypeError('Balance.weightedPick: "roll" must be a finite number');
    }
    let acc = 0;
    for (const key of Object.keys(weights) as T[]) {
      acc += weights[key];
      if (roll < acc) return key;
    }
    return null;
  }
}
