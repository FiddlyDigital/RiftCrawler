import type { ShapeKey } from './config';
import type { Player } from './entities';

/** A starting class offered at run start (e.g. Chronomancer, An Draoi). */
export interface ClassDef {
  /** Stable identifier, e.g. `'draoi'`. */
  id: string;
  /** Sprite-map key for the class's card/board portrait. */
  emoji: string;
  /** Display name. */
  name: string;
  /** One-line flavor text shown on the class-selection card. */
  tagline: string;
  /** Short labeled facts rendered as chips on the class card. */
  statChips: string[];
  /** How many turns a T-piece action reduces the class's special-ability cooldown by. */
  tPieceCdReduction: number;
  /** Applies this class's starting stat effects/ability to a freshly created player. */
  apply: (player: Player) => void;
}

/** A dungeon biome — the visual/mechanical theme active over a floor range. */
export interface BiomeDef {
  /** Stable identifier. */
  id: string;
  /** Display name. */
  name: string;
  /** Lowest dungeon floor this biome applies to (biomes are matched highest-`minFloor`-first). */
  minFloor: number;
  /** Bare `"r,g,b"` tile tint. */
  tileRgb: string;
  /** Ambient dust-mote color — each depth gets its own air. */
  moteColor: string;
  /** Multiplier applied to monster max HP while in this biome. */
  monsterHpMult: number;
  /** Percent adjustment to gravity tick speed (negative = faster/harder) while in this biome. */
  gravityPctBonus: number;
  /** Flavor description shown on the floor-transition banner. */
  desc: string;
}

/** One selectable choice within a {@link FloorEventDef}. */
export interface FloorEventOption {
  /** Button label. */
  label: string;
  /** Description of what choosing this option does. */
  desc: string;
  /** Applies the choice's effect and returns the result message to log. */
  apply: (game: import('./game').Game) => string;
}

/** A narrative floor event (shrine, spring, NPC encounter, pact ceremony, etc.). */
export interface FloorEventDef {
  /** Stable identifier. */
  id: string;
  /** Sprite-map key shown on the event modal. */
  emoji: string;
  /** Modal title. */
  title: string;
  /** Flavor/narration text. */
  flavor: string;
  /** The choices offered to the player. */
  options: FloorEventOption[];
}

/** Terrain tile values on the dungeon-floor grid (distinct from the falling-piece cell values in {@link Cell}). */
export const Tile = { VOID: 0, FLOOR: 1, STAIRS: 2 } as const;
/** Value type of {@link Tile}. */
export type TileValue = (typeof Tile)[keyof typeof Tile];

/** A sprite sheet crop — pixel rectangle `(sx, sy, sw, sh)` on the named `sheet`. */
export interface SpriteCoord { sheet: string; sx: number; sy: number; sw: number; sh: number }

/** Falling/locked tetromino cell values, including special content (monsters, traps, features) it can carry. */
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
  NPC: 20,
  GHOST: 21,
} as const;
/** Value type of {@link Cell}. */
export type CellValue = (typeof Cell)[keyof typeof Cell];

/** CSS class applied to a single log-panel line, controlling its color/emphasis. */
export type LogClass = 'log-neutral' | 'log-damage' | 'log-success' | 'log-tetris' | 'log-boss' | 'log-combo' | 'log-perk';

/** A status effect that can be applied to the player or a monster. */
export type StatusType = 'poison' | 'stun';

/** An active status effect instance (poison/stun) ticking down on an entity. */
export interface StatusEffect {
  /** Which status this is. */
  type: StatusType;
  /** Turns remaining. */
  duration: number;
  /** Per-tick magnitude (damage for poison; unused for stun). */
  power: number;
}

/** Role used to guarantee variety in a 3-choice offer (an offer must include at least 2 distinct roles). */
export type OfferRole = 'offense' | 'defense' | 'utility';

/**
 * Declarative stat mutation used by JSON-configured boons/brands/modifiers/
 * classes/patrons. Applied to the player by default, or to the `Game`
 * instance itself when `target: 'game'` (modifiers only).
 */
export interface EffectSpec {
  /** Mutation target; defaults to `'player'`. */
  target?: 'player' | 'game';
  /** Name of the numeric (or boolean, for `set`) property to mutate. */
  stat: string;
  /** Mutation operator; defaults to `'add'`. */
  op?: 'add' | 'mul' | 'set';
  /** Operand — the amount to add/multiply, or the value to set. */
  value: number | boolean;
  /** Optional floor clamp applied after the mutation. */
  min?: number;
  /** Optional ceiling clamp applied after the mutation. */
  max?: number;
  /** If true, floors the result to an integer after the mutation. */
  floor?: boolean;
}

/** One purchasable line in the wandering peddler's stock. */
export interface ShopItem {
  /** Stable identifier. */
  id: string;
  /** Sprite-map key. */
  icon: string;
  /** Display name. */
  name: string;
  /** Description of the item's effect. */
  desc: string;
  /** Gold price. */
  cost: number;
  /** Whether this line has already been bought this visit. */
  purchased: boolean;
}

/**
 * Gold-reroll configuration handed to the choice modals.
 * @typeParam T - The type of choice being rerolled (e.g. `BoonDef`, `BrandDef`).
 */
export interface RerollCfg<T> {
  /** The player's current gold. */
  gold: number;
  /** Gold cost of the next reroll. */
  cost: number;
  /** Performs the reroll; returns the new choices/gold/cost, or `null` if unaffordable. */
  run: () => { choices: T[]; gold: number; cost: number } | null;
}

/** A boon (level-up reward) definition. */
export interface BoonDef {
  /** Stable identifier. */
  id: string;
  /** Sprite-map key. */
  char: string;
  /** Display name. */
  name: string;
  /** Description of the boon's effect. */
  desc: string;
  /** Reward tier — higher tiers are rarer and stronger. */
  tier: 1 | 2 | 3;
  /** Offense/defense/utility classification, used to diversify offers. */
  role: OfferRole;
  /** Applies the boon's effect; `newStacks` is the stack count after this pickup. */
  onAdd: (player: Player, newStacks: number) => void;
}

/** A brand (tattoo) equip slot on the player's body. */
export type BodyPart = 'head' | 'body' | 'left_arm' | 'right_arm' | 'legs';
/** All body-part slots, in tattoo-artist UI display order. */
export const BODY_PARTS: BodyPart[] = ['body', 'left_arm', 'right_arm', 'legs', 'head'];

/** A brand (tattoo) definition — a body-slot-bound boon with an optional matching-set bonus. */
export interface BrandDef {
  /** Stable identifier. */
  id: string;
  /** Sprite-map key. */
  char: string;
  /** Display name. */
  name: string;
  /** Description of the brand's effect. */
  desc: string;
  /** Number of matching brands needed to trigger {@link onSetComplete}. */
  setSize: 2 | 3;
  /** Description of the set-completion bonus. */
  setDesc: string;
  /** Offense/defense/utility classification, used to diversify offers. */
  role: OfferRole;
  /** Applies this brand's own effect on equip. */
  onEquip: (player: Player) => void;
  /** Applies the bonus effect once the matching set is completed. */
  onSetComplete: (player: Player) => void;
}

/** A placed altar (boon shrine) tile on the dungeon floor. */
export interface AltarTile {
  x: number;
  y: number;
  /** Reward tier offered by this altar. */
  tier: 1 | 2 | 3;
}

/** A placed wandering-NPC tile on the dungeon floor. */
export interface NpcTile {
  x: number;
  y: number;
  /** References an {@link NpcDef} by id (or the sentinel `'__ghost__'` for a ghost encounter). */
  npcId: string;
}

/**
 * A wandering stranger, met by bumping into their tile. `flavor` NPCs are
 * pure dialogue; `bounty` NPCs name an upcoming boss for a reward on its
 * death; `trade` NPCs swap one of the player's current Geasa for a
 * guaranteed rarer one.
 */
export interface NpcDef {
  /** Stable identifier. */
  id: string;
  /** Sprite-map key. */
  char: string;
  /** Display name. */
  name: string;
  /** Encounter category. */
  kind: 'flavor' | 'bounty' | 'trade';
  /** Pool of flavor dialogue lines (for `kind: 'flavor'`). */
  lines?: string[];
  /** Opening line shown before any offer/dialogue. */
  introLine?: string;
}

/** A live trap-hazard tile (spike/smoke/teleport) on the dungeon floor. */
export interface HazardTile {
  x: number;
  y: number;
  type: 'spike' | 'smoke' | 'teleport';
  /** Turns until next state change (rearm, disarm, etc. — meaning is type-specific). */
  timer: number;
  /** Whether this hazard is in its telegraphed "about to trigger" state. */
  warning: boolean;
}

/** A terrain-effect tile (swamp/sacred/ice) placed by a dungeon-room feature. */
export interface SpecialTile {
  x: number;
  y: number;
  type: 'swamp' | 'sacred' | 'ice';
}

/** A run modifier (a Geis/curse-like challenge toggle chosen at run start). */
export interface ModifierDef {
  /** Stable identifier. */
  id: string;
  /** Sprite-map key. */
  emoji: string;
  /** Display name. */
  name: string;
  /** Description of the modifier's effect. */
  desc: string;
  /** Applies the modifier's effect to the game/player. */
  apply: (game: import('./game').Game) => void;
}

/** Rendered content for the board-inspect tooltip. */
export interface InspectInfo {
  icon: string;
  title: string;
  lines: string[];
}

/** Aggregate stats tracked over a single run, shown on the death/victory/recap screen. */
export interface RunStats {
  monstersKilled: number;
  bossesKilled: number;
  linesCleared: number;
  biggestCombo: number;
  damageTaken: number;
}

/** A ranged/special ability usable by the player (class ability or patron spell). */
export interface RangedAbility {
  /** Display name. */
  name: string;
  /** Sprite-map key. */
  emoji: string;
  /** Manhattan range in tiles (`0` for effects with no positional target). */
  range: number;
  /** Base damage multiplier (meaning is `abilityType`-specific). */
  damageMult: number;
  /** Cooldown length in turns after casting. */
  cooldownMax: number;
  /** Status effect this ability can inflict, if any. */
  statusEffect?: 'stun';
  /** Which activation handler in the ability-dispatch engine processes this ability. */
  abilityType?: 'bolt' | 'time_dilation' | 'gravity_well' | 'consecrate' | 'overload' | 'shriek' | 'veil' | 'drain' | 'blight' | 'blink';
  /** Ability-type-specific tuning numbers/strings (e.g. `hpCostPct`, `dmgMult`). */
  params?: Record<string, number | string>;
  /** Patron spells only: player level required to unlock this spell (`1` = the pact's signature spell). */
  unlockLevel?: number;
  /** Patron spells only: one-time stat price paid the moment this spell is granted. */
  toll?: EffectSpec[];
}

/**
 * A deity pact for An Draoi — sworn mid-run, granting a spellbook of
 * HP-cost spells (the signature at pact, the rest unlocking at player
 * levels) plus a small passive. Only 2 of the 3 deities call on any given run.
 */
export interface PatronDef {
  /** Stable identifier. */
  id: string;
  /** Sprite-map key. */
  char: string;
  /** Pact display name, e.g. `"Pact of the Morrígan"`. */
  name: string;
  /** The deity's name, e.g. `"The Morrígan"`. */
  deity: string;
  /** One-line flavor text shown on the pact-ceremony card. */
  tagline: string;
  /** Description of the per-spell toll this patron exacts. */
  tollDesc: string;
  /** Passive stat effects applied once, at the moment the pact is sworn. */
  effects: EffectSpec[];
  /** The patron's spellbook (3 spells, gated by {@link RangedAbility.unlockLevel}). */
  spells: RangedAbility[];
}

/** One labeled stat row in a character-sheet section. */
export interface CharacterSheetStat { label: string; value: string; }
/** A titled group of stat rows in the character sheet. */
export interface CharacterSheetSection { title: string; icon: string; stats: CharacterSheetStat[]; }

/** The full renderable HUD/state snapshot pushed to the UI layer each update. */
export interface UIState {
  hp: number;
  maxHp: number;
  floor: number;
  totalXpEarned: number;
  gold: number;
  /** Milliseconds per gravity tick at the current floor/effects. */
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
  rangedAbility: { name: string; emoji: string; cooldown: number; cooldownMax: number; ammo: number | null; hpCostPct: number | null; spellIndex: number; spellCount: number } | null;
  characterSheet: CharacterSheetSection[];
}

/** Named sound-effect/haptic trigger passed through {@link GameCallbacks.onAudio}. */
export type AudioEvent =
  | 'blockLand' | 'blockRotate' | 'blockMove'
  | 'hit' | 'playerDamage' | 'kill'
  | 'lineClear' | 'descend' | 'poison' | 'bossWarn'
  | 'teleport' | 'comboMilestone'
  | 'npcEncounter' | 'ghostEncounter' | 'bountyFulfilled' | 'pactSworn';

/**
 * A fallen character from a previous run — may reappear as a wandering ghost
 * in later runs when the current hero's level is close to theirs.
 */
export interface GhostRecord {
  id: string;
  playerLevel: number;
  floor: number;
  classId: string | null;
  cause: string;
  date: string;
}

/** The full set of host-provided hooks a `Game` instance uses to reach the UI/renderer/audio layers. */
export interface GameCallbacks {
  log: (text: string, cls: LogClass, icon?: string) => void;
  updateUI: (state: UIState) => void;
  onDeath: (title: string, reason: string, floor: number, totalXpEarned: number, stats: RunStats, story?: string) => void;
  onVictory?: (floor: number, totalXpEarned: number, stats: RunStats, story?: string) => void;
  onGhostLaidToRest?: (id: string) => void;
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

/** A single completed run's summary, kept in the run-history list. */
export interface RunRecord {
  date: string;
  totalXpEarned: number;
  floor: number;
  playerLevel: number;
  cause: string;
  stats?: RunStats;
}

// ── Content interfaces (referenced by dataLoader + entities) ──────────────────

/** A monster species/template loaded from `data/monsters.json`. */
export interface MonsterDef {
  /** Sprite-map key. */
  char: string;
  /** Display name. */
  name: string;
  /** D-sides used for this monster's attack/defense rolls. */
  combatLevel: number;
  /** Base max HP at dungeon level 1. */
  baseHp: number;
  /** Additional max HP per dungeon level. */
  hpPerLevel: number;
  /** Base attack at dungeon level 1. */
  baseAtk: number;
  /** Additional attack per dungeon level. */
  atkPerLevel: number;
  /** Falling-piece cell value used when this monster rides a tetromino down. */
  cellState: CellValue;
  /** Log message shown when this monster spawns. */
  spawnMsg: string;
  /** XP awarded on kill. */
  xpReward: number;
  /** Status effect this monster's attacks can inflict, if any. */
  statusInflict?: { type: StatusType; chance: number; duration: number; power: number };
  /** AI behavior key (see `Balance.MONSTER_AI`), e.g. `'melee'`, `'ranged'`, `'healer'`. */
  behaviorType?: string;
  /** Attack range in tiles (Manhattan), for ranged behaviors. */
  attackRange?: number;
  /** Movement-speed multiplier for swift-type behaviors. */
  moveSpeed?: number;
}

/** A floor boss template loaded from `data/bosses.json`. */
export interface BossDef {
  /** Sprite-map key. */
  char: string;
  /** Display name. */
  name: string;
  /** Max-HP multiplier applied over the scaled base boss stats. */
  hpMult: number;
  /** Attack multiplier applied over the scaled base boss stats. */
  atkMult: number;
  /** XP awarded on kill. */
  xpReward: number;
  /** Flavor text shown on the boss-warning banner. */
  flavorText: string;
  /** Restricts this boss to a specific biome, if set. */
  biomeId?: string;
  /** One-time effect fired when the boss first drops to/below half HP. */
  onHalfHp?: (game: import('./game').Game) => void;
  /** One-time effect fired when the boss dies. */
  onDeath?:  (game: import('./game').Game, x: number, y: number) => void;
}
