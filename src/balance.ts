// Central typed loader for gameplay-balance JSON — the "tuning knobs" layer.
// (src/dataLoader.ts is for "content" — offers/grants with closures. This
// file is flat numbers consumed by simulation code in systems/*.ts, game.ts,
// entities.ts.) Edit the JSON files in src/data/ to retune the game; nothing
// here needs to change.
import combatData from './data/combat.json';
import hazardsData from './data/hazards.json';
import monsterAiData from './data/monster-ai.json';
import balanceData from './data/balance.json';

export function numOr(value: number | undefined, fallback: number): number {
  return value === undefined ? fallback : value;
}

// Converts independent per-key weights into the same cumulative-cutoff
// behavior a chain of `if (r < cutoff) ...` checks would implement, without
// anyone having to hand-compute cumulative bounds in the JSON. Returns null
// if `roll` lands past the last cutoff — a legal "no match" outcome (e.g.
// trap rolls, where "no trap" is the common case).
export function weightedPick<T extends string>(weights: Record<T, number>, roll: number): T | null {
  let acc = 0;
  for (const key of Object.keys(weights) as T[]) {
    acc += weights[key];
    if (roll < acc) return key;
  }
  return null;
}

export interface CombatBalance {
  diceSidesByLevel: number[];
  outcomeMultipliers: Record<'miss' | 'weak' | 'normal' | 'power' | 'critical', number>;
  marginThresholds: { weakMax: number; normalMax: number };
  missPityStreak: number;
  grazeDamagePct: number;
  critStun: { duration: number; power: number };
  rewards: { goldOnKill: number; goldOnBossKill: number; eliteGoldBonusPerFloor: number; healOnKill: number };
}
export const COMBAT_BALANCE = combatData as CombatBalance;

export interface HazardBalance {
  spike: {
    rearmMinTurns: number; rearmRandomTurns: number; warningThreshold: number;
    damagePerDungeonLevel: number; minDamage: number; fieldFixedTimer: number;
  };
}
export const HAZARD_BALANCE = hazardsData as HazardBalance;

export interface MonsterAiConfig {
  common:    { contactDistance: number };
  melee:     { chaseRange: number };
  berserker: { chaseRange: number; enrageHpFraction: number };
  swift:     { chaseRange: number; doubleMoveOnChase: boolean };
  ranged:    { retreatDistance: number; advanceRangeBonus: number };
  healer:    { healRadius: number; healFraction: number };
  gorgoth:   { stepTurns: number };
}
export const MONSTER_AI = monsterAiData as MonsterAiConfig;

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
  gorgoth: { maxHp: number; atk: number; xpReward: number; combatLevel: number; causewayDamagePerRowPerFloor: number };
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
}
export const BALANCE = balanceData as BalanceConfig;
