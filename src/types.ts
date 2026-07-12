import type { ShapeKey } from './config';
import type { Player } from './entities';

export interface ClassDef {
  id: string;
  emoji: string;
  name: string;
  tagline: string;
  statChips: string[];  // short labeled facts rendered as chips on the class card
  tPieceCdReduction: number;
  apply: (player: Player) => void;
}

export interface BiomeDef {
  id: string;
  name: string;
  minFloor: number;
  tileRgb: string;
  moteColor: string;  // ambient dust-mote tint — each depth gets its own air
  monsterHpMult: number;
  gravityPctBonus: number;
  desc: string;
}

export interface FloorEventOption {
  label: string;
  desc: string;
  apply: (game: import('./game').Game) => string;
}

export interface FloorEventDef {
  id: string;
  emoji: string;
  title: string;
  flavor: string;
  options: FloorEventOption[];
}

export const Tile = { VOID: 0, FLOOR: 1, STAIRS: 2 } as const;
export type TileValue = (typeof Tile)[keyof typeof Tile];

export interface SpriteCoord { sheet: string; sx: number; sy: number; sw: number; sh: number }

export const Cell = {
  EMPTY: 0,
  FLOOR: 1,
  MONSTER_RAT: 2,
  MONSTER_SKEL: 3,
  STAIRS: 6,
  MERCHANT: 8,
  BOSS: 9,
  MONSTER_ARCHER: 11,
  MONSTER_SLIME: 12,
  MONSTER_ORC: 13,
  MONSTER_BAT: 14,
  TRAP_SPIKE: 16,
  TRAP_SMOKE: 17,
  TRAP_TELEPORT: 18,
  ALTAR: 19,
} as const;
export type CellValue = (typeof Cell)[keyof typeof Cell];

export type LogClass = 'log-neutral' | 'log-damage' | 'log-success' | 'log-tetris' | 'log-boss' | 'log-combo' | 'log-perk';

export type StatusType = 'poison' | 'stun';

export interface StatusEffect {
  type: StatusType;
  duration: number;
  power: number;
}

// Role used to guarantee variety in a 3-choice offer (>=2 distinct roles)
export type OfferRole = 'offense' | 'defense' | 'utility';

// Declarative effect used by JSON-configured boons / brands / modifiers.
// Applied to the player (default) or the game object (modifiers only).
// op: 'add' (default) | 'mul' | 'set'. Optional floor + min/max clamps.
export interface EffectSpec {
  target?: 'player' | 'game';
  stat: string;
  op?: 'add' | 'mul' | 'set';
  value: number | boolean;
  min?: number;
  max?: number;
  floor?: boolean;
}

// One purchasable line in the wandering peddler's stock.
export interface ShopItem {
  id: string;
  icon: string;
  name: string;
  desc: string;
  cost: number;
  purchased: boolean;
}

// Gold-reroll config handed to the choice modals; run() returns the new
// state (choices + remaining gold + next cost) or null when unaffordable.
export interface RerollCfg<T> {
  gold: number;
  cost: number;
  run: () => { choices: T[]; gold: number; cost: number } | null;
}

export interface BoonDef {
  id: string;
  char: string;
  name: string;
  desc: string;
  tier: 1 | 2 | 3;
  role: OfferRole;
  onAdd: (player: Player, newStacks: number) => void;
}

export type BodyPart = 'head' | 'body' | 'left_arm' | 'right_arm' | 'legs';
export const BODY_PARTS: BodyPart[] = ['body', 'left_arm', 'right_arm', 'legs', 'head'];

export interface BrandDef {
  id: string;
  char: string;
  name: string;
  desc: string;
  setSize: 2 | 3;
  setDesc: string;
  role: OfferRole;
  onEquip: (player: Player) => void;
  onSetComplete: (player: Player) => void;
}

export interface AltarTile {
  x: number;
  y: number;
  tier: 1 | 2 | 3;
}

export interface HazardTile {
  x: number;
  y: number;
  type: 'spike' | 'smoke' | 'teleport';
  timer: number;
  warning: boolean;
}

export interface SpecialTile {
  x: number;
  y: number;
  type: 'swamp' | 'sacred' | 'ice';
}

export interface ModifierDef {
  id: string;
  emoji: string;
  name: string;
  desc: string;
  apply: (game: import('./game').Game) => void;
}

export interface InspectInfo {
  icon: string;
  title: string;
  lines: string[];
}

export interface RunStats {
  monstersKilled: number;
  bossesKilled: number;
  linesCleared: number;
  biggestCombo: number;
  damageTaken: number;
}

export interface RangedAbility {
  name: string;
  emoji: string;
  range: number;
  damageMult: number;
  cooldownMax: number;
  statusEffect?: 'stun';
  abilityType?: 'bolt' | 'time_dilation' | 'gravity_well' | 'consecrate' | 'overload';
  params?: Record<string, number | string>;
}

export interface CharacterSheetStat { label: string; value: string; }
export interface CharacterSheetSection { title: string; icon: string; stats: CharacterSheetStat[]; }

export interface UIState {
  hp: number;
  maxHp: number;
  floor: number;
  totalXpEarned: number;
  gold: number;
  gravityRate: number;
  nextType: ShapeKey;
  heldType: ShapeKey | null;
  canHold: boolean;
  pieceState: 'normal' | 'cursed' | 'blessed';
  xp: number;
  xpToNext: number;
  playerLevel: number;
  boons: Array<{ char: string; name: string; stacks: number; desc: string }>;
  brands: Array<{ slot: BodyPart; char: string; name: string; setActive: boolean; desc: string; setDesc: string; setSize: number }>;
  brandsAcquiredTotal: number;
  brandsMaxLifetime: number;
  statuses: StatusEffect[];
  activeModifier: { emoji: string; name: string } | null;
  activeClass: { emoji: string; name: string } | null;
  biomeName: string;
  rangedAbility: { name: string; emoji: string; cooldown: number; cooldownMax: number; ammo: number | null } | null;
  characterSheet: CharacterSheetSection[];
}

export type AudioEvent =
  | 'blockLand' | 'blockRotate' | 'blockMove'
  | 'hit' | 'playerDamage' | 'kill'
  | 'lineClear' | 'descend' | 'poison' | 'bossWarn'
  | 'teleport' | 'comboMilestone';

export interface GameCallbacks {
  log: (text: string, cls: LogClass, icon?: string) => void;
  updateUI: (state: UIState) => void;
  onDeath: (title: string, reason: string, floor: number, totalXpEarned: number, stats: RunStats) => void;
  onVictory?: (floor: number, totalXpEarned: number, stats: RunStats) => void;
  onParticle: (gridX: number, gridY: number, text: string, color: string, fontSize?: number, icon?: string) => void;
  onParticleBurst?: (gridX: number, gridY: number, count: number, color: string, icon?: string) => void;
  onImpactGlow?: (gridX: number, gridY: number, rgb: string, frames?: number) => void;
  onRowClear?: (rows: number[]) => void;
  onHardDrop?: (columns: Array<{ x: number; fromY: number; toY: number }>, color: string) => void;
  onMonsterDeath?: (x: number, y: number, char: string) => void;
  onHitStop?: (frames: number) => void;
  onRingPulse?: (x: number, y: number, rgb: string) => void;
  onBeam?: (x: number) => void;
  onLevelUp?: (choices: BoonDef[], onChoice: (index: number) => void) => void;
  onOpenShop?: (stock: ShopItem[], gold: number, buy: (id: string) => { gold: number; ok: boolean }, close: () => void) => void;
  onOpenTattooArtist?: (choices: BrandDef[], onChoice: (index: number) => void, reroll?: RerollCfg<BrandDef>) => void;
  onAction: () => void;
  onAudio?: (event: AudioEvent, data?: number) => void;
  onBossWarning?: (boss: BossDef, onDone: () => void) => void;
  onBlockLand?: (cells: Array<{ x: number; y: number }>) => void;
  onCombo?: (multiplier: number) => void;
  onFloorEvent?: (event: import('./types').FloorEventDef, onChoice: (index: number) => void) => void;
  onOpenAltar?: (tier: 1 | 2 | 3, choices: BoonDef[], onChoice: (index: number) => void, reroll?: RerollCfg<BoonDef>) => void;
}

export interface RunRecord {
  date: string;
  totalXpEarned: number;
  floor: number;
  playerLevel: number;
  cause: string;
  stats?: RunStats;
}

// ── Content interfaces (referenced by dataLoader + entities) ──────────────────

export interface MonsterDef {
  char: string;
  name: string;
  combatLevel: number;
  baseHp: number;
  hpPerLevel: number;
  baseAtk: number;
  atkPerLevel: number;
  cellState: CellValue;
  spawnMsg: string;
  xpReward: number;
  statusInflict?: { type: StatusType; chance: number; duration: number; power: number };
  behaviorType?: string;
  attackRange?: number;
  moveSpeed?: number;
}

export interface BossDef {
  char: string;
  name: string;
  hpMult: number;
  atkMult: number;
  xpReward: number;
  flavorText: string;
  biomeId?: string;
  onHalfHp?: (game: import('./game').Game) => void;
  onDeath?:  (game: import('./game').Game, x: number, y: number) => void;
}


