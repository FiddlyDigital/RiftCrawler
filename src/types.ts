import type { ShapeKey } from './config';
import type { Player } from './entities';

export interface ClassDef {
  id: string;
  emoji: string;
  name: string;
  tagline: string;
  statPreview: string;
  apply: (player: Player) => void;
}

export interface BiomeDef {
  id: string;
  name: string;
  minFloor: number;
  tileRgb: string;
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
  ITEM_POTION: 4,
  ITEM_SWORD: 5,
  STAIRS: 6,
  BOMB: 7,
  MERCHANT: 8,
  BOSS: 9,
  ITEM_EQUIPMENT: 10,
  MONSTER_ARCHER: 11,
  MONSTER_SLIME: 12,
  MONSTER_ORC: 13,
  MONSTER_BAT: 14,
  RELIC: 15,
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

export type ItemType = 'heal' | 'stat' | 'mana' | 'grenade' | 'cure' | 'shock' | 'relic';

// Role used to guarantee variety in a 3-choice offer (>=2 distinct roles)
export type OfferRole = 'offense' | 'defense' | 'utility';

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

export interface RelicDef {
  id: string;
  char: string;
  name: string;
  desc: string;
  onPickup?: (player: Player) => void;
  onKill?: (player: Player) => void;
  onLineClear?: (player: Player, count: number) => void;
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
  itemsPickedUp: number;
}

export interface RangedAbility {
  name: string;
  emoji: string;
  range: number;
  damageMult: number;
  cooldownMax: number;
  statusEffect?: 'stun';
  abilityType?: 'bolt' | 'time_dilation' | 'gravity_well' | 'consecrate' | 'overload';
}

export interface UIState {
  hp: number;
  maxHp: number;
  floor: number;
  totalXpEarned: number;
  gravityRate: number;
  nextType: ShapeKey;
  heldType: ShapeKey | null;
  canHold: boolean;
  pieceState: 'normal' | 'cursed' | 'blessed';
  xp: number;
  xpToNext: number;
  playerLevel: number;
  boons: Array<{ char: string; name: string; stacks: number }>;
  brands: Array<{ slot: BodyPart; char: string; name: string; setActive: boolean }>;
  statuses: StatusEffect[];
  activeModifier: { emoji: string; name: string } | null;
  activeClass: { emoji: string; name: string } | null;
  biomeName: string;
  relics: RelicDef[];
  rangedAbility: { name: string; emoji: string; cooldown: number; cooldownMax: number; ammo: number | null } | null;
  potionPouch: Array<{ char: string; name: string; type: string }>;
}

export type AudioEvent =
  | 'blockLand' | 'blockRotate' | 'blockMove'
  | 'hit' | 'playerDamage' | 'kill'
  | 'lineClear' | 'descend' | 'poison' | 'bossWarn'
  | 'itemPickup' | 'itemUse' | 'teleport' | 'comboMilestone';

export interface GameCallbacks {
  log: (text: string, cls: LogClass) => void;
  updateUI: (state: UIState) => void;
  onDeath: (title: string, reason: string, floor: number, totalXpEarned: number, stats: RunStats) => void;
  onParticle: (gridX: number, gridY: number, text: string, color: string, fontSize?: number) => void;
  onLevelUp?: (choices: BoonDef[], onChoice: (index: number) => void) => void;
  onOpenShop?: (gold: number) => void;
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

export interface ItemDef {
  char: string;
  name: string;
  type: 'heal' | 'stat' | 'mana' | 'grenade' | 'cure' | 'shock';
  statValue: number;
  cellState: CellValue;
}

