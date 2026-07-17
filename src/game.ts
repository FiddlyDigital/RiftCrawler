import { GameConfig, SHAPES, type ShapeKey } from './config';
import { Tile, Cell, BODY_PARTS, type TileValue, type CellValue, type GameCallbacks, type HazardTile, type SpecialTile, type RunStats, type ModifierDef, type InspectInfo, type AltarTile, type NpcTile, type NpcDef, type ShopItem, type CharacterSheetSection, type FloorEventDef, type BossDef, type GhostRecord, type EffectSpec } from './types';
import { Player, Monster, StatMath } from './entities';
import { MONSTERS, BOSSES, Boon, MODIFIERS, CLASSES, Biome, FloorEvent, Brand, Npc, NPCS, PATRONS, Smith, SMITHS, RESCUES, Omen, EffectResolver, type ClassDef, type PatronDef, type RescueDef } from './content';
import { StatusEffectSystem } from './systems/statusEffects';
import { HazardSystem } from './systems/hazards';
import { CombatSystem } from './systems/combat';
import { MonsterAiSystem } from './systems/monsterAI';
import { SpriteService } from './sprites';
import { Balance } from './balance';
import { Colors } from './colors';
import { StorageService } from './storage';

const TRAP_CELL: Record<'spike' | 'smoke' | 'teleport', CellValue> = {
  spike: Cell.TRAP_SPIKE, smoke: Cell.TRAP_SMOKE, teleport: Cell.TRAP_TELEPORT,
};

// Human-readable summary of a patron's signature spell for the pact ceremony.
function describePatronSpell(p: PatronDef): string {
  const spell = p.spells[0]!;
  const params = spell.params ?? {};
  const num = (k: string, d: number): number => typeof params[k] === 'number' ? params[k] as number : d;
  const costPct = Math.round(num('hpCostPct', 0) * 100);
  switch (spell.abilityType) {
    case 'shriek':
      return `pay ${costPct}% Max HP, deal ${num('dmgMult', 2)}× the HP paid to EVERY visible foe (${Math.round(num('stunChance', 0) * 100)}% terror-stun).`;
    case 'veil':
      return `pay ${costPct}% Max HP, vanish from mortal sight for ${num('veilTurns', 6)} turns.`;
    case 'drain':
      return `pay ${costPct}% Max HP, deal ${num('dmgMult', 2)}× the HP paid to the nearest foe, heal ${Math.round(num('healPct', 0) * 100)}% of it — a kill refunds the price.`;
    default:
      return `pay ${costPct}% Max HP.`;
  }
}

// Human-readable summary of a spell's one-time toll, applied the moment the
// patron grants it (at the pact, or at each later level-gated unlock).
const TOLL_LABELS: Record<string, string> = { atk: 'ATK', maxHp: 'Max HP', tickSlowPercent: 'gravity speed' };
function describeToll(effects: EffectSpec[] | undefined): string {
  return (effects ?? []).map(e => {
    const label = TOLL_LABELS[e.stat] ?? e.stat;
    if (e.op === 'mul') {
      const pct = Math.round((1 - (e.value as number)) * 100);
      return `−${pct}% ${label}`;
    }
    const v = e.value as number;
    return `${v > 0 ? '+' : ''}${v} ${label}`;
  }).join(', ');
}

// ── Pure helpers ────────────────────────────────────────────────────────────

/** Pure tetromino/timing/scoring math shared by `Game` and the tick loop in `main.ts`. */
export class GameMath {
  /** Rotates a piece matrix 90° clockwise. @throws {TypeError} If `matrix` is null/undefined/empty. */
  static rotateMatrix(matrix: CellValue[][]): CellValue[][] {
    if (!matrix || matrix.length === 0) throw new TypeError('GameMath.rotateMatrix: "matrix" must be a non-empty 2D array');
    const rows = matrix.length;
    const cols = matrix[0]!.length;
    const out: CellValue[][] = Array.from({ length: cols }, () => Array(rows).fill(0) as CellValue[]);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        out[c]![rows - 1 - r] = matrix[r]![c]!;
      }
    }
    return out;
  }

  /** Milliseconds per gravity tick at the given dungeon level and slow percentage. */
  static tickMsForLevel(level: number, slowPercent: number): number {
    const base = Math.max(Balance.CONFIG.progression.tickMinMs, Balance.CONFIG.progression.tickBaseMs - (level - 1) * Balance.CONFIG.progression.tickMsPerDungeonLevel);
    return Math.floor(base * (1 + slowPercent / 100));
  }

  /** Gold awarded for clearing `count` rows at dungeon level `level`. */
  static scoreForLines(count: number, level: number): number {
    return (Balance.CONFIG.progression.lineClearScoreBase[count] ?? Balance.CONFIG.progression.lineClearScoreOverflow) * level;
  }
}

// ── Game class ───────────────────────────────────────────────────────────────

/**
 * The central run controller: owns the dungeon-floor grid, the falling
 * tetromino, the player and monsters, and every run-scoped counter (gold,
 * XP multipliers, biome/class/patron state, boss mechanics, and the
 * Gorgoth endgame). `main.ts`/`input.ts`/`ui.ts`/`renderer.ts` drive it
 * entirely through its public methods and read its public fields for
 * display — there is exactly one `Game` instance per run.
 */
export class Game {
  // Map state
  public map: TileValue[][];
  public colors: (string | null)[][];
  public visibility: boolean[][];
  public explored: boolean[][];

  // Entities
  public player: Player;
  public monsters: Monster[];

  // Active block
  public blockMatrix: CellValue[][] = [];
  public blockX = 0;
  public blockY = 0;
  public blockColor = '';
  public currentType: ShapeKey = 'I';
  public nextType: ShapeKey = 'I';

  // Game state
  public active = true;
  public paused = false;
  public gold = 0;
  public dungeonLevel = 1;

  /** Hazard tiles (persist per floor). */
  public hazards: HazardTile[] = [];

  /** Shape-based special terrain tiles. */
  public specialTiles: SpecialTile[] = [];

  // Piece state (set fresh each spawn)
  public currentCursed = false;
  public currentBlessed = false;

  // Hold mechanic
  public heldType: ShapeKey | null = null;
  public canHold = true;

  // Modifier state (active for the whole run)
  public activeModifierId: string | null = null;
  public xpMultiplier = 1.0;
  public noLineHeal = false;
  public haunted = false;
  public frozenRift = false;

  // Class state
  public activeClassId: string | null = null;
  /** An Draoi's sworn deity (null until the pact ceremony). */
  public activePatronId: string | null = null;
  /** Chronomancer: turns remaining at the slow below. */
  public timeDilationTurns = 0;
  /** Magnitude of the slow while `timeDilationTurns > 0` (class-configurable). */
  public timeDilationSlowPct = 0;
  /** Kill counter for the Overload ability type. */
  public killsThisFloor = 0;

  // Biome state
  public biomeId = 'stone';
  public biomeMonsterHpMult = 1.0;
  public biomeGravityPct = 0;

  // Omen state — a per-floor modifier rolled on floor entry (see maybeRollOmen)
  public activeOmen: Omen | null = null;
  /** Gravity % adjustment from the active omen (negative = faster), summed with `biomeGravityPct` at both tick-rate call sites. */
  public omenGravityPct = 0;

  // Waystation state — the safe sídhe mound offered at every staircase
  /** Whether the hero is currently inside the waystation — no falling stone, no monsters, just the mound's residents. */
  public inWaystation = false;

  /**
   * The mound chamber layout: an 8×8 square hall centered on the canvas
   * (inclusive bounds), the hearth at its heart with the seanchaí beside it,
   * the emissary aloof in a corner, the stall along a wall, and the exit
   * stairs in the far corner. Public so tests target positions by name.
   */
  public static readonly MOUND = {
    x0: 1, y0: 9, x1: 8, y1: 16,
    hero:       { x: 2, y: 15 },
    emissary:   { x: 2, y: 10 },
    seanchai:   { x: 5, y: 13 },
    campfire:   { x: 4, y: 12 },
    peddler:    { x: 7, y: 10 },
    stranger:   { x: 6, y: 15 },
    oghamStone: { x: 1, y: 12 },
    well:       { x: 5, y: 10 },
    aoife:      { x: 7, y: 13 },
    tattooist:  { x: 3, y: 11 },
    stash:      { x: 1, y: 15 },
    stairs:     { x: 8, y: 16 },
  } as const;
  /** A floor event rolled on an interval descent but embodied as a waiting stranger in the mound — held until met, across floors if need be. */
  public pendingFloorEvent: FloorEvent | null = null;

  // Rescue state — captives riding the falling stone under elite guard; once
  // freed they join the mound as residents (see openRescueService).
  /** Everyone freed so far this run — each id becomes a mound resident. */
  public rescuedIds = new Set<string>();
  /** The captive rolled for this floor's rescue piece (null once landed or when no rescue rolled). Public for the falling-piece preview. */
  public pendingRescueId: string | null = null;
  /** The captors' monster archetype, rolled with the rescue piece. Public for the falling-piece preview. */
  public pendingGuardKey: string | null = null;
  /** The live captor monsters — the captive can't be freed until every one is dead. */
  private rescueGuards: Monster[] = [];
  /** ATK granted by Bricriu's Champion's Portion, reverted on the next descent. */
  private portionAtkBonus = 0;

  /** Whether An Draoi's deity pact is still unsworn — the emissary waits in the mound until it is. */
  private get pactPending(): boolean {
    return this.activeClassId === 'draoi' && this.activePatronId === null && this.dungeonLevel >= 2;
  }

  /** Whether the Tetris layer is currently frozen (the Gorgoth duel, or a waystation rest floor). */
  private get tetrisSuspended(): boolean { return this.gorgothSummoned || this.inWaystation; }

  // Bealtaine Fires ritual state (the 'bealtaine' special omen)
  /** Braziers standing on the floor this level — walk into an unlit one to light it. */
  public brazierTiles: { x: number; y: number; lit: boolean }[] = [];
  /** Need-fires lit this floor — banked progress, kept even if a lit brazier's row later clears. */
  public brazierLitCount = 0;
  /** Set once the ritual reward has been granted, stopping further brazier riders. */
  private ritualComplete = false;

  // Run stats
  public monstersKilled = 0;
  public bossesKilled = 0;
  public linesCleared = 0;
  public biggestCombo = 0;
  public damageTaken = 0;

  // Internal counters
  private floorsDescended = 0;
  private blocksPlacedSinceStairs = 0;
  private pendingBossFloor = false;
  /** Whole-board fill fraction a pending boss waits for before riding in (see spawnBlock); also drives the HUD dial's boss marker. */
  private static readonly BOSS_FILL_FRACTION = 0.5;
  /** Set on a smith-eligible floor entry; the smith rider doesn't inject until {@link blocksSpawnedThisFloor} passes the configured threshold. */
  private pendingSmithFloor = false;
  private blocksSpawnedThisFloor = 0;
  /** Whether the "anvils are getting stronger" mid-floor warning has already fired this floor. */
  private smithWarningShown = false;
  /** Same rider-preview pattern as {@link pendingNpcId}, for the falling piece's `Cell.SMITH` cell. */
  public pendingSmithId: string | null = null;
  /** How many of the three legendary smiths have been met this run (capped at 3, once the spear is forged). */
  public smithsMetCount = 0;
  /** Which Lugh's-Spear parts have been collected this run. */
  public spearPartsHeld = new Set<'shaft' | 'bolts' | 'head'>();
  /** Whether Goibniu has reforged the complete Spear of Lugh this run. */
  public spearForged = false;
  /** Whether the one-time real-Tetris (4-line clear) reward has already been granted this run. */
  private tetrisRewardGranted = false;
  /** Set the instant a real Tetris is cleared; opened at the next safe (unpaused) moment. */
  private pendingTetrisReward = false;
  public comboCount = 0;
  private lastLineClearMs = 0;
  private tattooTiles: Array<{ x: number; y: number }> = [];
  /** Caps Ogham Mark tiles per floor. */
  private tattooTilesSpawnedThisFloor = 0;
  public altarTiles: AltarTile[] = [];
  public npcTiles: NpcTile[] = [];
  /** Caps wandering-NPC tiles per floor. */
  private npcTilesSpawnedThisFloor = 0;
  /**
   * The specific NPC archetype rolled for the falling piece's `Cell.NPC` cell
   * (if any), decided at spawn so the falling preview shows the same portrait
   * it locks in as, rather than a generic placeholder that changes on lock.
   */
  public pendingNpcId: string | null = null;
  /**
   * A vengeance bounty accepted from an NPC — persists across floors (no
   * per-floor reset) until the named boss falls, whenever/wherever that is.
   */
  public activeBountyQuest: { bossName: string; floor: number } | null = null;

  /**
   * Fallen characters from previous runs (loaded by `main.ts` after
   * construction; the first floor therefore never rolls a ghost).
   */
  public availableGhosts: GhostRecord[] = [];
  /** This floor's haunting, chosen at floor start when a stored ghost's level is within tolerance of the current hero's. */
  private activeGhost: GhostRecord | null = null;
  private ghostPlaced = false;

  /** Notable moments this run — feeds the death/victory screen's short "tale of the run" recap. */
  public storyBeats: string[] = [];
  /** Flavor-kind NPC ids already met this run, so a repeat encounter shows {@link NpcDef.returnLine} instead of a fresh random line. */
  private metFlavorNpcIds = new Set<string>();
  /** Whether the run's first elite kill has already pushed a story beat (elites can be felled many times a run — only the first is notable). */
  public firstEliteFelled = false;
  /** Whether the run's first sub-15%-HP survival has already pushed a "close call" story beat. */
  private hadCloseCall = false;

  // Active boss mechanics (set at spawn, cleared on floor reset)
  private activeBossOnHalfHp: ((game: Game) => void) | null = null;
  private activeBossOnDeath:   ((game: Game, x: number, y: number) => void) | null = null;
  private bossHalfHpTriggered = false;

  /**
   * Endgame: overflowing the stack summons Gorgoth the Returned. While
   * summoned, no tetrominoes fall — the run becomes a boss duel. Killing
   * him wins.
   */
  public gorgothSummoned = false;
  public won = false;
  /** One-time nudge toward the win condition. */
  private gorgothHintShown = false;
  private gorgothHalfTriggered = false;

  public readonly cb: GameCallbacks;

  /**
   * Starts a fresh run: builds an empty floor, places the hero on the
   * starting platform, and spawns the first falling piece.
   * @throws {TypeError} If `callbacks` is null/undefined.
   */
  constructor(callbacks: GameCallbacks) {
    if (callbacks === null || callbacks === undefined) {
      throw new TypeError('Game: "callbacks" must not be null/undefined');
    }
    this.cb = callbacks;
    this.map = this.emptyMap();
    this.colors = this.emptyColors();
    this.visibility = this.emptyBoolGrid(false);
    this.explored = this.emptyBoolGrid(false);
    this.player = new Player(4, 23);
    this.monsters = [];
    this.generateStartPlatform();
    this.currentType = this.randomShapeKey();
    this.nextType = this.randomShapeKey();
    this.spawnBlock();
    this.updateVisibility();
    this.pushUI();
    // The starting biome is never "entered" via updateBiome() (that only fires
    // on a floor transition), so it needs its own codex discovery + ambient
    // heads-up here, mirroring updateBiome()'s biome-change treatment.
    const startBiome = Biome.forFloor(this.dungeonLevel);
    const startIcon = Game.BIOME_ICON[startBiome.id] ?? 'tile_stone_a';
    this.cb.log(`${startBiome.name} — ${startBiome.desc}`, 'log-tetris', startIcon);
    this.cb.onToast?.(`Entering ${startBiome.name}...`, startIcon);
    this.cb.onCodexDiscover?.('biome', this.biomeId);
    // The Sídhe keep what past characters left with them — minus their tithe.
    const inherited = StorageService.claimStash();
    if (inherited > 0) {
      this.gold += inherited;
      this.cb.log(`The Sídhe kept faith: ${inherited} gold, left for you by one who came before.`, 'log-perk', 'item_gold_pouch');
      this.storyBeats.push('inherited gold the Sídhe kept');
    }
  }

  // ── Grid helpers ─────────────────────────────────────────────────────────

  /** A fresh all-VOID terrain grid. */
  private emptyMap(): TileValue[][] {
    return Array.from({ length: GameConfig.COLS }, () => Array<TileValue>(GameConfig.ROWS).fill(Tile.VOID));
  }

  /** A fresh all-null tile-color grid. */
  private emptyColors(): (string | null)[][] {
    return Array.from({ length: GameConfig.COLS }, () => Array<string | null>(GameConfig.ROWS).fill(null));
  }

  /** A fresh grid filled with `val` (used for visibility/explored state). */
  private emptyBoolGrid(val: boolean): boolean[][] {
    return Array.from({ length: GameConfig.COLS }, () => Array(GameConfig.ROWS).fill(val) as boolean[]);
  }

  /** Lays down the fixed 6×2 floor tile the hero stands on at run/floor start. */
  private generateStartPlatform(): void {
    for (let x = 2; x < 8; x++) {
      this.map[x]![23] = Tile.FLOOR; this.colors[x]![23] = '#333344';
      this.map[x]![24] = Tile.FLOOR; this.colors[x]![24] = '#333344';
    }
  }

  /** A uniformly random tetromino shape key. */
  private randomShapeKey(): ShapeKey {
    const keys = Object.keys(SHAPES) as ShapeKey[];
    return keys[Math.floor(Math.random() * keys.length)]!;
  }

  // ── Fog of war ───────────────────────────────────────────────────────────

  /** Recomputes visibility/explored state around the player (or reveals the whole arena during the Gorgoth duel). */
  private updateVisibility(): void {
    // During the Gorgoth duel (and inside a waystation) the whole arena stays
    // lit — revealed on entry, so don't re-fog to the vision radius.
    if (this.tetrisSuspended) return;
    const onSmoke = this.hazards.some(h => h.type === 'smoke' && h.x === this.player.x && h.y === this.player.y);
    const fogPenalty = this.activeOmen?.num('visionPenalty', 0) ?? 0;
    const r = onSmoke ? 1 : Math.max(1, this.player.visionRadius - fogPenalty);
    for (let x = 0; x < GameConfig.COLS; x++) {
      for (let y = 0; y < GameConfig.ROWS; y++) {
        const dist = Math.hypot(x - this.player.x, y - this.player.y);
        const visible = dist <= r;
        this.visibility[x]![y] = visible;
        if (visible) this.explored[x]![y] = true;
      }
    }
    // Falling block is always visible
    for (let r2 = 0; r2 < this.blockMatrix.length; r2++) {
      for (let c = 0; c < this.blockMatrix[r2]!.length; c++) {
        if (this.blockMatrix[r2]![c] !== Cell.EMPTY) {
          const tx = this.blockX + c, ty = this.blockY + r2;
          if (tx >= 0 && tx < GameConfig.COLS && ty >= 0 && ty < GameConfig.ROWS) {
            this.visibility[tx]![ty] = true;
            this.explored[tx]![ty] = true;
          }
        }
      }
    }
  }

  // ── Block spawning ───────────────────────────────────────────────────────

  // cursed/blessed are mutually exclusive independent shares of one roll
  // (e.g. 8% cursed, 4% blessed, 88% normal) — see Balance.CONFIG.spawnRates.
  // The Wild Rift-Surge omen scales both shares up together.
  private rollPieceCurseState(roll: number): { cursed: boolean; blessed: boolean } {
    const mult = this.activeOmen?.num('curseBlessMult', 1) ?? 1;
    const cursed = roll < Balance.CONFIG.spawnRates.cursedPieceChance * mult;
    const blessed = !cursed && roll < (Balance.CONFIG.spawnRates.cursedPieceChance + Balance.CONFIG.spawnRates.blessedPieceChance) * mult;
    return { cursed, blessed };
  }

  private spawnBlock(): void {
    this.currentType = this.nextType;
    this.nextType = this.randomShapeKey();
    const shape = SHAPES[this.currentType];
    this.blockColor = shape.color;
    this.blocksPlacedSinceStairs++;
    this.blocksSpawnedThisFloor++;

    const { cursed, blessed } = this.rollPieceCurseState(Math.random());
    this.currentCursed  = cursed;
    this.currentBlessed = blessed;
    this.pendingNpcId = null;
    this.pendingSmithId = null;

    if (this.pendingSmithFloor && !this.smithWarningShown && this.blocksSpawnedThisFloor >= Balance.CONFIG.smiths.warningThreshold) {
      this.smithWarningShown = true;
      this.cb.onToast?.('The sound of anvils is getting stronger!', 'fx_impact');
    }

    let stairsInjected = false;
    let bossInjected = false;
    let smithInjected = false;
    let merchantInjected = false;
    let altarInjected = false;
    let npcInjected = false;
    let trapInjected = false;
    let monsterInjected = false;

    // A pending normal boss holds off until the built floor covers at least
    // half the field overall — reaching a boss floor's stairs early no longer
    // skips it, the fight just waits for the player to build up first. This
    // is deliberately the *whole-board* fill fraction, not the tallest single
    // column, so one narrow spike from careless hard-drops can't trigger it.
    const bossReady = this.pendingBossFloor && this.filledFraction() >= Game.BOSS_FILL_FRACTION;
    // A pending smith holds off until the player has actually built out the
    // floor — a guaranteed slot on a specific piece, not a random chance.
    const smithReady = this.pendingSmithFloor && this.blocksSpawnedThisFloor >= Balance.CONFIG.smiths.pieceThreshold;
    // Bealtaine ritual: a brazier rides in every Nth piece until enough are
    // lit — unlit braziers lost to line clears are replaced by later riders.
    const ritual = this.activeOmen?.special === 'bealtaine' ? this.activeOmen : null;
    const brazierDue = ritual !== null && !this.ritualComplete
      && this.brazierLitCount + this.brazierTiles.filter(b => !b.lit).length < ritual.num('braziersRequired', 3)
      && this.blocksSpawnedThisFloor % ritual.num('brazierPieceInterval', 5) === 0;
    let brazierInjected = false;
    // A pending rescue rides one piece whole: the captive in the first cell,
    // their Fomorian captors filling the next two — freed only if the guards
    // die before a line clear swallows the captive.
    const rescueReady = this.pendingRescueId !== null
      && !this.npcTiles.some(n => n.npcId.startsWith('__rescue_'))
      && this.blocksSpawnedThisFloor >= Balance.CONFIG.rescues.pieceThreshold;
    let rescueInjected = false;
    let guardsInjected = 0;

    this.blockMatrix = shape.matrix.map(row =>
      row.map((cell): CellValue => {
        if (cell === 0) return Cell.EMPTY;

        // Boss cell — once per boss floor, one guaranteed slot
        if (bossReady && !bossInjected) {
          bossInjected = true;
          this.pendingBossFloor = false;
          return Cell.BOSS;
        }

        // Smith cell — once per smith floor, one guaranteed slot
        if (smithReady && !smithInjected) {
          smithInjected = true;
          this.pendingSmithFloor = false;
          this.pendingSmithId = this.nextSmith()?.id ?? null;
          return Cell.SMITH;
        }

        // Captive + captors — one whole piece, once per rescue floor
        if (rescueReady && !rescueInjected) {
          rescueInjected = true;
          this.pendingGuardKey = this.rollGuardKey();
          return Cell.RESCUE;
        }
        if (rescueInjected && guardsInjected < 2) {
          guardsInjected++;
          return Cell.ELITE_GUARD;
        }

        // Bealtaine need-fire — one guaranteed slot on its due piece
        if (brazierDue && !brazierInjected) {
          brazierInjected = true;
          return Cell.BRAZIER;
        }

        // Stairs
        if (!stairsInjected && (this.blocksPlacedSinceStairs >= Balance.CONFIG.spawnRates.stairsForcedAfterBlocks || Math.random() < Balance.CONFIG.spawnRates.stairsRandomChance)) {
          stairsInjected = true;
          this.blocksPlacedSinceStairs = 0;
          return Cell.STAIRS;
        }

        // Special blocks — Ogham Mark tiles are capped per floor, independent
        // of the brands-lifetime cap, so they don't all cluster early.
        if (!merchantInjected && !this.player.brandsCapped
            && this.tattooTilesSpawnedThisFloor < Balance.CONFIG.spawnRates.maxTattooTilesPerFloor
            && Math.random() < Balance.CONFIG.spawnRates.merchantChance) {
          merchantInjected = true;
          this.tattooTilesSpawnedThisFloor++;
          return Cell.MERCHANT;
        }
        if (!altarInjected && Math.random() < Balance.CONFIG.spawnRates.altarChance) {
          altarInjected = true;
          return Cell.ALTAR;
        }
        // Wandering NPC — rare, one per floor, a narrative aside rather than a
        // resource to farm.
        if (!npcInjected
            && this.npcTilesSpawnedThisFloor < Balance.CONFIG.spawnRates.maxNpcTilesPerFloor
            && Math.random() < Balance.CONFIG.spawnRates.npcChance) {
          npcInjected = true;
          this.npcTilesSpawnedThisFloor++;
          this.pendingNpcId = Npc.random().id;
          return Cell.NPC;
        }
        // This floor's ghost haunting (rolled at floor start) — a modest
        // per-cell chance so it drifts in within the first few blocks.
        if (this.activeGhost && !this.ghostPlaced && Math.random() < 0.08) {
          this.ghostPlaced = true;
          return Cell.GHOST;
        }
        // Hazard traps — one type per block
        if (!trapInjected) {
          const trapKey = Balance.weightedPick(Balance.CONFIG.spawnRates.trapWeights, Math.random());
          if (trapKey) {
            trapInjected = true;
            return TRAP_CELL[trapKey];
          }
        }

        // Monster spawn — at most one per block (no random dumps), and the rate
        // ramps gently with depth instead of a flat spike. Haunted doubles it.
        const baseMonsterChance = Math.min(
          Balance.CONFIG.spawnRates.monsterChanceCap,
          Balance.CONFIG.spawnRates.monsterBaseChance + this.dungeonLevel * Balance.CONFIG.spawnRates.monsterChancePerDungeonLevel,
        );
        const hauntedChance = this.haunted ? baseMonsterChance * Balance.CONFIG.spawnRates.hauntedMonsterChanceMult : baseMonsterChance;
        const monsterChance = hauntedChance * (this.activeOmen?.num('monsterChanceMult', 1) ?? 1);
        if (Math.random() < monsterChance) {
          if (monsterInjected) return Cell.FLOOR;  // cap: one monster per block
          monsterInjected = true;
          let key = Balance.weightedPick(Balance.CONFIG.spawnRates.monsterWeights, Math.random()) ?? 'plague_bat';
          // Unquiet Cairn omen: the dead crowd out the living spawn table.
          if (Math.random() < (this.activeOmen?.num('skeletonBias', 0) ?? 0)) key = 'skeleton';
          return MONSTERS[key]!.cellState;
        }
        return Cell.FLOOR;
      }),
    );

    this.injectShapeBonusRiders();

    this.blockX = Math.floor((GameConfig.COLS - this.blockMatrix[0]!.length) / 2);
    this.blockY = 0;

    // Stack topped out — the rift yields no more blocks and summons Gorgoth.
    if (this.checkBlockCollision(this.blockX, this.blockY, this.blockMatrix)) {
      this.summonGorgoth();
    }
  }

  // Decide shape/curse bonus riders at spawn (not at lock) so an O-piece's altar
  // or a cursed piece's monster rides the block as a visible cell during descent,
  // instead of popping into existence when the piece locks.
  private injectShapeBonusRiders(): void {
    const plain: Array<{ r: number; c: number }> = [];
    for (let r = 0; r < this.blockMatrix.length; r++) {
      for (let c = 0; c < this.blockMatrix[r]!.length; c++) {
        if (this.blockMatrix[r]![c] === Cell.FLOOR) plain.push({ r, c });
      }
    }
    const take = (): { r: number; c: number } | null =>
      plain.length ? plain.splice(Math.floor(Math.random() * plain.length), 1)[0]! : null;

    // O-piece: a chance to carry an altar (Architect class rolls it more often).
    const oAltarChance = this.activeClassId === 'architect'
      ? Balance.CONFIG.spawnRates.oPieceAltarChanceArchitect
      : Balance.CONFIG.spawnRates.oPieceAltarChance;
    if (this.currentType === 'O' && Math.random() < oAltarChance) {
      const p = take();
      if (p) this.blockMatrix[p.r]![p.c] = Cell.ALTAR;
    }
    // Cursed piece: carries a monster that crawls out where it lands.
    if (this.currentCursed) {
      const p = take();
      if (p) this.blockMatrix[p.r]![p.c] = MONSTERS[this.getRandomMonsterKey()]!.cellState;
    }
  }

  // ── Collision ────────────────────────────────────────────────────────────

  /** Whether placing `matrix` at `(bx, by)` would collide with the board edge or locked terrain. */
  public checkBlockCollision(bx: number, by: number, matrix: CellValue[][]): boolean {
    for (let r = 0; r < matrix.length; r++) {
      for (let c = 0; c < matrix[r]!.length; c++) {
        if (matrix[r]![c] !== Cell.EMPTY) {
          const tx = bx + c, ty = by + r;
          if (tx < 0 || tx >= GameConfig.COLS || ty >= GameConfig.ROWS) return true;
          if (ty >= 0 && this.map[tx]![ty] !== Tile.VOID) return true;
        }
      }
    }
    return false;
  }

  /** The row the falling piece would land on if hard-dropped now — used for the ghost-piece preview. */
  public computeGhostBlockY(): number {
    // No active piece (e.g. during the Gorgoth duel): an empty matrix never
    // collides, so the loop below would spin forever and freeze the renderer.
    if (this.blockMatrix.length === 0) return this.blockY;
    let ghostY = this.blockY;
    while (!this.checkBlockCollision(this.blockX, ghostY + 1, this.blockMatrix)) ghostY++;
    return ghostY;
  }

  /** Whether an entity can stand on `(x, y)` — floor, stairs, or an interactable tile (tattoo artist / altar). */
  public isValidMove(x: number, y: number): boolean {
    if (x < 0 || x >= GameConfig.COLS || y < 0 || y >= GameConfig.ROWS) return false;
    return this.map[x]![y] === Tile.FLOOR || this.map[x]![y] === Tile.STAIRS || this.isTattooTile(x, y) || this.isAltarTile(x, y);
  }

  /** Whether `(x, y)` is an active tattoo-artist tile. */
  public isTattooTile(x: number, y: number): boolean {
    return this.tattooTiles.some(t => t.x === x && t.y === y);
  }

  /** Whether `(x, y)` is an active altar tile. */
  private isAltarTile(x: number, y: number): boolean {
    return this.altarTiles.some(a => a.x === x && a.y === y);
  }

  private getHazardAt(x: number, y: number): HazardTile | undefined {
    return this.hazards.find(h => h.x === x && h.y === y);
  }

  // ── Block locking ────────────────────────────────────────────────────────

  private lockBlock(): void {
    const landedCells: Array<{ x: number; y: number }> = [];
    const lockedFloorCells: Array<{ x: number; y: number }> = [];
    this.canHold = true;

    for (let r = 0; r < this.blockMatrix.length; r++) {
      for (let c = 0; c < this.blockMatrix[r]!.length; c++) {
        const cell = this.blockMatrix[r]![c]!;
        if (cell === Cell.EMPTY) continue;
        const tx = this.blockX + c, ty = this.blockY + r;
        if (tx < 0 || tx >= GameConfig.COLS || ty < 0 || ty >= GameConfig.ROWS) continue;
        landedCells.push({ x: tx, y: ty });

        if (cell === Cell.STAIRS) {
          this.map[tx]![ty] = Tile.STAIRS;
          this.colors[tx]![ty] = '#6d3f7a';
        } else if (cell === Cell.MERCHANT) {
          this.map[tx]![ty] = Tile.FLOOR;
          this.colors[tx]![ty] = '#241830';
          this.tattooTiles.push({ x: tx, y: ty });
          lockedFloorCells.push({ x: tx, y: ty });
        } else if (cell === Cell.ALTAR) {
          const tier = Boon.tierForFloor(this.dungeonLevel);
          const altarColor = Colors.forTier(tier).bg;
          this.map[tx]![ty] = Tile.FLOOR;
          this.colors[tx]![ty] = altarColor;
          this.altarTiles.push({ x: tx, y: ty, tier });
          lockedFloorCells.push({ x: tx, y: ty });
        } else if (cell === Cell.NPC) {
          // Reuse the archetype rolled at spawn so the locked NPC matches the
          // portrait already shown in the falling-piece preview.
          const npc = (this.pendingNpcId && NPCS.find(n => n.id === this.pendingNpcId)) || Npc.random();
          this.pendingNpcId = null;
          this.map[tx]![ty] = Tile.FLOOR;
          this.colors[tx]![ty] = '#1c2418';
          this.npcTiles.push({ x: tx, y: ty, npcId: npc.id });
          lockedFloorCells.push({ x: tx, y: ty });
        } else if (cell === Cell.GHOST) {
          this.map[tx]![ty] = Tile.FLOOR;
          this.colors[tx]![ty] = '#101820';
          this.npcTiles.push({ x: tx, y: ty, npcId: '__ghost__' });
          lockedFloorCells.push({ x: tx, y: ty });
        } else if (cell === Cell.SMITH) {
          // Reuse the smith rolled at spawn so the locked encounter matches
          // the portrait already shown in the falling-piece preview.
          const smith = (this.pendingSmithId && SMITHS.find(s => s.id === this.pendingSmithId)) || this.nextSmith();
          this.pendingSmithId = null;
          this.map[tx]![ty] = Tile.FLOOR;
          this.colors[tx]![ty] = '#2a1c10';
          if (smith) this.npcTiles.push({ x: tx, y: ty, npcId: `__smith_${smith.id}__` });
          lockedFloorCells.push({ x: tx, y: ty });
        } else if (cell === Cell.RESCUE) {
          const rescue = RESCUES.find(r => r.id === this.pendingRescueId);
          this.pendingRescueId = null;
          this.map[tx]![ty] = Tile.FLOOR;
          this.colors[tx]![ty] = '#2e2210';
          if (rescue) {
            this.npcTiles.push({ x: tx, y: ty, npcId: `__rescue_${rescue.id}__` });
            this.cb.log(`${rescue.name} is held captive in the stone — the Fomorian guards must die first.`, 'log-boss', rescue.char);
          }
          lockedFloorCells.push({ x: tx, y: ty });
        } else if (cell === Cell.ELITE_GUARD) {
          this.map[tx]![ty] = Tile.FLOOR;
          this.colors[tx]![ty] = '#301414';
          const guardKey = this.pendingGuardKey ?? 'skeleton';
          const guardBase = MONSTERS[guardKey]?.name ?? 'Captor';
          this.spawnMonster(guardKey, tx, ty, true, guardBase.startsWith('Fomorian') ? guardBase : `Fomorian ${guardBase}`);
          const guard = this.monsters[this.monsters.length - 1];
          if (guard && guard.x === tx && guard.y === ty) this.rescueGuards.push(guard);
          lockedFloorCells.push({ x: tx, y: ty });
        } else if (cell === Cell.BRAZIER) {
          this.map[tx]![ty] = Tile.FLOOR;
          this.colors[tx]![ty] = '#2a1a10';
          this.brazierTiles.push({ x: tx, y: ty, lit: false });
          this.cb.log('A cold need-fire settles into the stone. Walk to it to light it.', 'log-tetris', 'tile_brazier');
          lockedFloorCells.push({ x: tx, y: ty });
        } else if (cell === Cell.TRAP_SPIKE) {
          this.map[tx]![ty] = Tile.FLOOR;
          this.colors[tx]![ty] = this.blockColor;
          this.hazards.push({ x: tx, y: ty, type: 'spike', timer: Balance.HAZARD.spike.rearmMinTurns + Math.floor(Math.random() * Balance.HAZARD.spike.rearmRandomTurns), warning: false });
          lockedFloorCells.push({ x: tx, y: ty });
        } else if (cell === Cell.TRAP_SMOKE) {
          this.map[tx]![ty] = Tile.FLOOR;
          this.colors[tx]![ty] = this.blockColor;
          this.hazards.push({ x: tx, y: ty, type: 'smoke', timer: 0, warning: false });
          lockedFloorCells.push({ x: tx, y: ty });
        } else if (cell === Cell.TRAP_TELEPORT) {
          this.map[tx]![ty] = Tile.FLOOR;
          this.colors[tx]![ty] = this.blockColor;
          this.hazards.push({ x: tx, y: ty, type: 'teleport', timer: 0, warning: false });
          lockedFloorCells.push({ x: tx, y: ty });
        } else {
          this.map[tx]![ty] = Tile.FLOOR;
          this.colors[tx]![ty] = this.blockColor;
          lockedFloorCells.push({ x: tx, y: ty });
        }

        this.instantiateRider(cell, tx, ty);
      }
    }

    // Shape-based tile effects on lock
    if (lockedFloorCells.length > 0) {
      if (this.currentType === 'S' || this.currentType === 'L' || this.currentType === 'J') {
        // The terrain type is a biome trait, not a piece-shape trait — every
        // biome lays down its own single kind of ground (see biomes.json).
        const tileType = Biome.forFloor(this.dungeonLevel).terrainType;
        const msgs = { swamp: 'Swamp — monsters take 1 dmg/turn!', sacred: 'Sacred ground — Wait here for bonus heal!', ice: 'Ice — entities slide across!' };
        const icons = { swamp: 'special_swamp', sacred: 'special_sacred', ice: 'special_ice' };
        for (const fc of lockedFloorCells) {
          if (!this.hazards.some(h => h.x === fc.x && h.y === fc.y) &&
              !this.tattooTiles.some(t => t.x === fc.x && t.y === fc.y)) {
            this.specialTiles.push({ x: fc.x, y: fc.y, type: tileType });
          }
        }
        this.cb.log(msgs[tileType], 'log-tetris', icons[tileType]);
      } else if (this.currentType === 'Z') {
        for (const fc of lockedFloorCells) {
          if (!this.hazards.some(h => h.x === fc.x && h.y === fc.y) &&
              !this.tattooTiles.some(t => t.x === fc.x && t.y === fc.y)) {
            this.hazards.push({ x: fc.x, y: fc.y, type: 'spike', timer: Balance.HAZARD.spike.fieldFixedTimer, warning: false });
          }
        }
        this.cb.log('Spike Field — fires every 5 ticks!', 'log-tetris', 'trap_spike');
      } else if (this.currentType === 'T' && this.player.rangedCooldown > 0) {
        const cdReduce = CLASSES.find(c => c.id === this.activeClassId)?.tPieceCdReduction ?? 2;
        this.player.rangedCooldown = Math.max(0, this.player.rangedCooldown - cdReduce);
        this.cb.log('Arcane resonance — ranged cooldown reduced!', 'log-perk', 'fx_arcane');
      }
    }

    // (Cursed pieces carry their monster as a visible rider — injected at spawn.)

    // Blessed piece: consecrate one cell as sacred ground
    if (this.currentBlessed && lockedFloorCells.length > 0) {
      const eligible = lockedFloorCells.filter(fc =>
        !this.specialTiles.some(t => t.x === fc.x && t.y === fc.y)
      );
      if (eligible.length > 0) {
        const fc = eligible[Math.floor(Math.random() * eligible.length)]!;
        this.specialTiles.push({ x: fc.x, y: fc.y, type: 'sacred' });
        this.cb.log('A blessed rift — holy ground consecrated!', 'log-perk', 'special_sacred');
        this.cb.onParticle(fc.x, fc.y, 'BLESSED!', '#ffb74d', undefined, 'special_sacred');
      }
    }

    // Rising Bog omen: floor laid in the lowest rows sinks into fen.
    const swampRows = this.activeOmen?.num('swampRows', 0) ?? 0;
    if (swampRows > 0) {
      for (const fc of lockedFloorCells) {
        if (fc.y >= GameConfig.ROWS - swampRows
            && !this.specialTiles.some(t => t.x === fc.x && t.y === fc.y)
            && !this.hazards.some(h => h.x === fc.x && h.y === fc.y)
            && !this.tattooTiles.some(t => t.x === fc.x && t.y === fc.y)) {
          this.specialTiles.push({ x: fc.x, y: fc.y, type: 'swamp' });
        }
      }
    }

    this.cb.onBlockLand?.(landedCells);

    this.checkLineClears();
    this.cb.onAudio?.('blockLand');
    this.maybeHintGorgoth();
    this.maybeOpenTetrisReward();
    this.spawnBlock();
  }

  /** Row index of the highest built floor tile across every column (`GameConfig.ROWS` if the field is empty — row 0 is the field's top). */
  private stackTopRow(): number {
    let stackTop: number = GameConfig.ROWS;
    for (let x = 0; x < GameConfig.COLS; x++) {
      for (let y = 0; y < GameConfig.ROWS; y++) {
        if (this.map[x]![y] === Tile.FLOOR) { if (y < stackTop) stackTop = y; break; }
      }
    }
    return stackTop;
  }

  /** Whether any stairs tile is currently on the board (locked terrain, not the falling piece). */
  private stairsOnBoard(): boolean {
    for (let x = 0; x < GameConfig.COLS; x++) {
      for (let y = 0; y < GameConfig.ROWS; y++) {
        if (this.map[x]![y] === Tile.STAIRS) return true;
      }
    }
    return false;
  }

  /** Fraction (0-1) of the whole field's cells currently built as floor — overall fullness, not just the single tallest column. */
  private filledFraction(): number {
    let filled = 0;
    for (let x = 0; x < GameConfig.COLS; x++) {
      for (let y = 0; y < GameConfig.ROWS; y++) {
        if (this.map[x]![y] === Tile.FLOOR) filled++;
      }
    }
    return filled / (GameConfig.COLS * GameConfig.ROWS);
  }

  // One-time teaching nudge: when the stack climbs near the ceiling, tell the
  // player that topping out summons Gorgoth — the win condition.
  private maybeHintGorgoth(): void {
    if (this.gorgothHintShown || this.tetrisSuspended) return;
    if (this.stackTopRow() <= 5) {
      this.gorgothHintShown = true;
      this.cb.log('The stack climbs high — let it top out to summon BRES THE BEAUTIFUL and win the Rift!', 'log-boss', 'ui_warning');
    }
  }

  // ── Special tile processing ──────────────────────────────────────────────

  private processSpecialTiles(): void {
    const deadFromTerrain: Monster[] = [];

    for (const t of this.specialTiles) {
      if (t.type === 'swamp') {
        for (const m of this.monsters) {
          if (m.x === t.x && m.y === t.y && !deadFromTerrain.includes(m)) {
            m.hp -= 1;
            this.cb.onParticle(t.x, t.y, '-1', '#66bb6a');
            if (m.hp <= 0) deadFromTerrain.push(m);
          }
        }
      }
    }

    for (const m of deadFromTerrain) {
      CombatSystem.killMonster(m, this);
    }
  }

  // ── Monster spawning helper ───────────────────────────────────────────────

  /** Scales a `MonsterTemplate` by dungeon level/biome/elite-roll and places the resulting `Monster` at `(tx, ty)`. */
  private spawnMonster(key: string, tx: number, ty: number, forceElite = false, nameOverride?: string): void {
    const def = MONSTERS[key];
    if (!def) return;
    const isElite = forceElite || Math.random() < Balance.CONFIG.eliteMonsters.spawnChance;
    const baseHp  = Math.floor((def.baseHp  + (this.dungeonLevel - 1) * def.hpPerLevel) * this.biomeMonsterHpMult);
    const baseAtk = def.baseAtk + (this.dungeonLevel - 1) * def.atkPerLevel;
    const hp  = isElite ? baseHp * Balance.CONFIG.eliteMonsters.hpMult : baseHp;
    const atk = isElite ? Math.floor(baseAtk * Balance.CONFIG.eliteMonsters.atkMult) : baseAtk;
    const name = nameOverride ?? (isElite ? `Elite ${def.name}` : def.name);
    const m = new Monster(
      tx, ty, def.char, name, hp, hp, atk, def.xpReward,
      false,
      def.behaviorType ?? 'melee',
      def.attackRange  ?? 1,
      def.moveSpeed    ?? 1,
      def.statusInflict,
    );
    m.isElite = isElite;
    m.combatLevel = Math.min(6, def.combatLevel + (isElite ? Balance.CONFIG.eliteMonsters.combatLevelBonus : 0));
    if (this.frozenRift) {
      m.statuses.push({ type: 'stun', duration: 1, power: 0 });
    }
    this.monsters.push(m);
    if (isElite) {
      this.cb.onParticle(tx, ty, 'ELITE!', '#ffd700', undefined, 'special_sacred');
      this.cb.log(`Elite ${def.name} stalks out of the dark!`, 'log-boss', 'special_sacred');
    } else {
      this.cb.onParticle(tx, ty, def.spawnMsg, '#e57373', undefined, def.char);
    }
  }

  /** Spawns up to two Crystal Shard adds beside a fallen Cailleach's Stoneward. Called by that boss's `onDeath` hook. */
  public spawnCrystalShards(bx: number, by: number): void {
    const shardHp  = Balance.CONFIG.crystalShards.baseHp + this.dungeonLevel * Balance.CONFIG.crystalShards.hpPerDungeonLevel;
    const shardAtk = Balance.CONFIG.crystalShards.baseAtk + Math.floor(this.dungeonLevel * Balance.CONFIG.crystalShards.atkPerDungeonLevel);
    const dirs: Array<[number, number]> = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    let spawned = 0;
    for (const [dx, dy] of dirs) {
      if (spawned >= 2) break;
      const sx = bx + dx, sy = by + dy;
      if (this.isValidMove(sx, sy) && !this.getMonsterAt(sx, sy)) {
        const shard = new Monster(sx, sy, 'sprite_crystal_shard', 'Crystal Shard', shardHp, shardHp, shardAtk, 30);
        shard.combatLevel = 3;
        this.monsters.push(shard);
        this.cb.onParticle(sx, sy, '', '#80d8ff', undefined, 'sprite_crystal_shard');
        spawned++;
      }
    }
    this.cb.log("Cailleach's Stoneward shatters — shards emerge!", 'log-boss', 'sprite_boss_crystal_golem');
  }

  /** Yanks the falling piece 5 rows down. Called by Balor's Herald's `onHalfHp` hook. */
  public triggerGravityBurst(): void {
    this.blockY = Math.max(0, this.blockY - 5);
    this.cb.log("Balor's Herald tears the weave — gravity surges!", 'log-boss', 'fx_impact');
    this.cb.onParticle(this.player.x, this.player.y, 'SURGE!', '#aa00ff', undefined, 'fx_impact');
    this.cb.onAudio?.('bossWarn');
  }

  // ── Dungeon rooms ────────────────────────────────────────────────────────

  private maybeSpawnDungeonRoom(): void {
    if (Math.random() > Balance.CONFIG.floors.dungeonRoomChance) return;
    this.spawnRoom(Math.random() < 0.5 ? 'vault' : 'den');
  }

  /** A monster key, weighted toward tougher species as the dungeon deepens. */
  private getRandomMonsterKey(): string {
    const all = ['rat', 'skeleton', 'goblin_archer', 'cave_slime', 'berserker_orc', 'plague_bat'];
    const maxIdx = Math.min(all.length - 1, 1 + Math.floor(this.dungeonLevel / 3));
    return all[Math.floor(Math.random() * (maxIdx + 1))]!;
  }

  private spawnRoom(type: 'vault' | 'den'): void {
    // Rooms are lateral 2×3 extensions of the starting platform (x=2..7, y=23..24).
    // Left side: x=0..1. Right side: x=8..9. y=22..24 (one row above platform top).
    // This keeps the centre columns clear so falling blocks are never intercepted.
    const colors = { vault: '#3d2b00', den: '#2d0000' } as const;
    const side = Math.random() < 0.5 ? 'left' : 'right';
    const roomX = side === 'left' ? 0 : GameConfig.COLS - 2;  // 0 or 8
    const roomY = GameConfig.ROWS - 3;                         // 22 (rows 22..24)
    const color = colors[type];

    for (let dx = 0; dx < 2; dx++) {
      for (let dy = 0; dy < 3; dy++) {
        const x = roomX + dx, y = roomY + dy;
        this.map[x]![y]    = Tile.FLOOR;
        this.colors[x]![y] = color;
      }
    }

    const innerX = roomX + (side === 'left' ? 1 : 0);  // column closer to starting platform
    const midY   = roomY + 1;                           // middle row of the room

    if (type === 'vault') {
      // Place a bonus altar in the vault, guarded by a monster.
      const altarX = roomX + (side === 'left' ? 0 : 1);
      const altarTier: 1 | 2 | 3 = this.dungeonLevel >= Balance.CONFIG.altars.vaultTierMinFloorT3 ? 3 : this.dungeonLevel >= Balance.CONFIG.altars.vaultTierMinFloorT2 ? 2 : 1;
      const altarColor = Colors.forTier(altarTier).bg;
      this.colors[altarX]![midY] = altarColor;
      this.altarTiles.push({ x: altarX, y: midY, tier: altarTier });
      this.spawnMonster(this.getRandomMonsterKey(), innerX, roomY);
      this.cb.log(`A Treasure Vault lies to the ${side} — guarded.`, 'log-perk', 'item_gold_pouch');
    } else {
      const positions: Array<[number, number]> = [[0, 0], [1, 0], [0, 1]];
      for (const [pdx, pdy] of positions) {
        this.spawnMonster(this.getRandomMonsterKey(), roomX + pdx, roomY + pdy);
      }
      this.cb.log(`A Monster Den lurks to the ${side}...`, 'log-damage', 'status_poison');
    }
  }

  // Boss selection is deterministic per floor (cycles through the pool in a
  // fixed order, biome permitting), and biome is itself purely a function of
  // floor number — so this can truthfully preview a boss on a floor the
  // player hasn't reached yet (used by the vengeance-bounty NPC).
  private previewBossForFloor(floor: number): BossDef {
    const biome = Biome.forFloor(floor);
    const biomeBosses   = BOSSES.filter(b => b.biomeId === biome.id);
    const genericBosses = BOSSES.filter(b => !b.biomeId);
    const bossPool = biomeBosses.length > 0 ? biomeBosses : genericBosses;
    return bossPool[(Math.floor(floor / Balance.CONFIG.floors.bossFloorInterval) - 1) % bossPool.length]!;
  }

  // ── Wandering NPCs ─────────────────────────────────────────────────────────
  // Reuses the floor-event modal/plumbing entirely — an NPC encounter is just
  // a FloorEventDef built at runtime instead of loaded from JSON, so no new
  // UI or callback wiring is needed.

  private triggerNpcEncounter(npc: NpcDef, onClosed?: () => void): void {
    this.cb.onCodexDiscover?.('npc', npc.id);
    let event: FloorEventDef;

    if (npc.kind === 'bounty') {
      const targetFloor = (Math.floor(this.dungeonLevel / Balance.CONFIG.floors.bossFloorInterval) + 1) * Balance.CONFIG.floors.bossFloorInterval;
      const targetBoss = this.previewBossForFloor(targetFloor);
      event = {
        id: npc.id, emoji: npc.char, title: npc.name,
        flavor: `${npc.introLine} ${targetBoss.name} still draws breath at Floor ${targetFloor} — finish what I started, and I'll see you rewarded.`,
        options: [
          {
            label: `Swear vengeance on ${targetBoss.name}`,
            desc: `Slay ${targetBoss.name} at Floor ${targetFloor} or beyond for a rare Geis.`,
            apply: (game): string => {
              game.activeBountyQuest = { bossName: targetBoss.name, floor: targetFloor };
              game.storyBeats.push(`swore vengeance on ${targetBoss.name}`);
              return `You swear vengeance upon ${targetBoss.name}, in ${npc.name}'s name.`;
            },
          },
          { label: 'Not now', desc: '', apply: (): string => `${npc.name} nods, unsurprised, and fades back into the dark.` },
        ],
      };
    } else if (npc.kind === 'trade' && this.player.boons.length === 0) {
      // Still a real encounter (dialog + departure beam), just with nothing
      // to trade yet — not a silent log line while the NPC vanishes.
      event = {
        id: npc.id, emoji: npc.char, title: npc.name,
        flavor: `${npc.introLine} ...but you carry nothing worth trading. Come back once you've gathered some Geasa.`,
        options: [{ label: 'Nothing to offer', desc: '', apply: (): string => `${npc.name} shrugs and fades back into the dark.` }],
      };
    } else if (npc.kind === 'trade') {
      const boonOptions = this.player.boons.map(b => ({
        label: `Give up ${b.def.name} (×${b.stacks})`,
        desc: b.def.desc,
        apply: (game: Game): string => {
          game.player.removeBoon(b.id);
          const pool = Boon.BY_TIER[3].filter(x => x.id !== b.def.id);
          const reward = (pool.length > 0 ? pool : Boon.BY_TIER[3])[Math.floor(Math.random() * (pool.length > 0 ? pool.length : Boon.BY_TIER[3].length))]!;
          game.player.addBoon(reward);
          game.storyBeats.push(`traded ${b.def.name} to a Fomorian tinker for ${reward.name}`);
          return `You trade away ${b.def.name} — the tinker presses ${reward.name} into your hand.`;
        },
      }));
      event = {
        id: npc.id, emoji: npc.char, title: npc.name, flavor: npc.introLine!,
        options: [...boonOptions, { label: 'Never mind', desc: '', apply: (): string => 'You keep your Geasa close.' }],
      };
    } else {
      const metBefore = this.metFlavorNpcIds.has(npc.id);
      const lines = npc.lines!;
      const flavor = metBefore && npc.returnLine ? npc.returnLine : lines[Math.floor(Math.random() * lines.length)]!;
      this.metFlavorNpcIds.add(npc.id);
      event = {
        id: npc.id, emoji: npc.char, title: npc.name, flavor,
        options: [{ label: 'Farewell', desc: '', apply: (): string => 'You part ways.' }],
      };
      // The seanchaí can also recite YOUR tale so far — the same story-beat
      // recap the death/victory screen builds, heard mid-run by the fire.
      if (npc.id === 'seanchai') {
        event.options.unshift({
          label: 'Ask for your own tale',
          desc: 'Hear the seanchaí recount your descent so far.',
          apply: (game: Game): string => {
            const cls = CLASSES.find(c => c.id === game.activeClassId)?.name ?? 'a wanderer';
            const beats = game.storyBeats.slice(0, 5);
            const joined = beats.length === 0
              ? 'you have only begun'
              : beats.length === 1
              ? `already you ${beats[0]!}`
              : `already you ${beats.slice(0, -1).join(', ')}, and ${beats[beats.length - 1]!}`;
            const more = game.storyBeats.length > 5 ? ' …and more besides — the verse grows long.' : '';
            return `He closes his eyes and speaks it like an old poem: "${cls}, ${game.dungeonLevel} floor${game.dungeonLevel === 1 ? '' : 's'} into the dark — ${joined}.${more}" He opens one eye. "The ending, now. That part is still yours."`;
          },
        });
      }
    }

    this.storyBeats.push(`crossed paths with ${npc.name}`);
    this.cb.onAudio?.('npcEncounter');
    this.paused = true;
    this.cb.onFloorEvent?.(event, (index) => {
      const msg = event.options[index]?.apply(this) ?? 'Nothing happened.';
      this.cb.log(msg, 'log-perk', npc.char);
      this.paused = false;
      this.cb.onAction();
      onClosed?.();
    });
  }

  // A fallen character from a previous run, met again. Laying them to rest
  // grants a fragment of their old power and removes them from the ghost
  // file permanently; turning away leaves them haunting future runs.
  private triggerGhostEncounter(onClosed?: () => void): void {
    const ghost = this.activeGhost;
    if (!ghost) { onClosed?.(); return; }
    const className = CLASSES.find(c => c.id === ghost.classId)?.name ?? 'wanderer';
    const event: FloorEventDef = {
      id: '__ghost__', emoji: 'sprite_boss_wraith', title: 'A Ghost of Yourself',
      flavor: `The mist gathers into a familiar shape — a ${className} of level ${ghost.playerLevel}, who fell on Floor ${ghost.floor} (${ghost.date}). ${ghost.cause}. It watches you with your own eyes.`,
      options: [
        {
          label: 'Lay them to rest',
          desc: 'Receive a fragment of their power. They will not return.',
          apply: (game: Game): string => {
            const pool = Boon.BY_TIER[2];
            const reward = pool[Math.floor(Math.random() * pool.length)]!;
            game.player.addBoon(reward);
            game.availableGhosts = game.availableGhosts.filter(g => g.id !== ghost.id);
            game.cb.onGhostLaidToRest?.(ghost.id);
            game.storyBeats.push('laid a ghost of yourself to rest');
            return `The ghost smiles — your smile — and dissolves into light. Gained ${reward.name}.`;
          },
        },
        {
          label: 'Turn away',
          desc: 'Leave them wandering. You may meet again.',
          apply: (): string => 'The ghost lingers at the edge of sight, keening softly, waiting for another meeting.',
        },
      ],
    };
    this.activeGhost = null;
    this.cb.onAudio?.('ghostEncounter');
    this.paused = true;
    this.cb.onFloorEvent?.(event, (index) => {
      const msg = event.options[index]?.apply(this) ?? 'Nothing happened.';
      this.cb.log(msg, 'log-perk', 'sprite_boss_wraith');
      this.paused = false;
      this.cb.onAction();
      onClosed?.();
    });
  }

  // ── Lugh's Spear questline ───────────────────────────────────────────────
  // Every few floors (skipping boss floors), one of the three legendary
  // smiths waits somewhere on that floor — embedded as a guaranteed rider
  // once the player has built enough of the floor (see spawnBlock). This
  // just announces the floor; the actual encounter is triggered on bump,
  // in triggerSmithEncounter below.

  /**
   * Steps aside into the waystation: a safe sídhe-mound rest stop offered at
   * every staircase (see {@link openStairsChoice}). The mound sits *between*
   * floors — the level counter doesn't advance until its exit stairs are
   * taken. The Tetris layer is suspended (see {@link tetrisSuspended}) and
   * the mound offers a seanchaí (lore), a hearth-fire (full heal), the Fear
   * Dearg's stall (shop), and the stairs on.
   */
  private enterWaystation(): void {
    this.inWaystation = true;
    this.blockMatrix = [];  // no falling stone inside the mound
    // Entered mid-floor, so the interrupted floor's whole state — stack,
    // monsters, hazards, tiles, ghost, omen, ritual — is swept away; the
    // mound is home ground, rebuilt from bare rock.
    this.map = this.emptyMap();
    this.colors = this.emptyColors();
    this.monsters = [];
    this.hazards = [];
    this.specialTiles = [];
    this.npcTiles = [];
    this.altarTiles = [];
    this.tattooTiles = [];
    this.activeGhost = null;
    this.activeOmen = null;
    this.omenGravityPct = 0;
    this.brazierTiles = [];
    this.brazierLitCount = 0;
    this.ritualComplete = false;
    // The mound chamber: a broad square hall centered on the canvas.
    const M = Game.MOUND;
    for (let x = M.x0; x <= M.x1; x++) {
      for (let y = M.y0; y <= M.y1; y++) {
        this.map[x]![y] = Tile.FLOOR;
        this.colors[x]![y] = '#2c2a40';
      }
    }
    this.player.x = M.hero.x; this.player.y = M.hero.y;
    this.npcTiles.push({ x: M.seanchai.x, y: M.seanchai.y, npcId: 'seanchai' });
    this.npcTiles.push({ x: M.campfire.x, y: M.campfire.y, npcId: '__campfire__' });
    this.npcTiles.push({ x: M.peddler.x, y: M.peddler.y, npcId: '__peddler__' });
    // Between-floor choices stand here in person: An Draoi's unsworn pact as
    // a deity emissary, and any pending floor event as a waiting stranger.
    if (this.pactPending) this.npcTiles.push({ x: M.emissary.x, y: M.emissary.y, npcId: '__pact__' });
    if (this.pendingFloorEvent) this.npcTiles.push({ x: M.stranger.x, y: M.stranger.y, npcId: '__event__' });
    // Fixtures of the hall: the ogham stone (lore codex), the Well of
    // Segais (gold for wisdom), and the Sídhe coffer (cross-run gold stash);
    // Aoife takes a seat only while she has a vengeance contract to offer,
    // and the Ogham-mark tattooist drifts through on some visits (never once
    // the hero's five marks are spent).
    this.npcTiles.push({ x: M.oghamStone.x, y: M.oghamStone.y, npcId: '__ogham_stone__' });
    this.npcTiles.push({ x: M.well.x, y: M.well.y, npcId: '__well__' });
    this.npcTiles.push({ x: M.stash.x, y: M.stash.y, npcId: '__stash__' });
    if (!this.activeBountyQuest) this.npcTiles.push({ x: M.aoife.x, y: M.aoife.y, npcId: 'aoife' });
    if (!this.player.brandsCapped && Math.random() < Balance.CONFIG.waystation.tattooistChance) {
      this.tattooTiles.push({ x: M.tattooist.x, y: M.tattooist.y });
    }
    // Everyone freed from Fomorian captivity settles along the north wall.
    RESCUES.filter(r => this.rescuedIds.has(r.id)).forEach((r, i) => {
      this.npcTiles.push({ x: 3 + i * 2, y: M.y0, npcId: `__rescue_${r.id}__` });
    });
    this.map[M.stairs.x]![M.stairs.y] = Tile.STAIRS;
    this.colors[M.stairs.x]![M.stairs.y] = '#6d3f7a';
    // The mound is home ground — no fog here (updateVisibility early-returns
    // while the Tetris layer is suspended, so set the full reveal directly).
    for (let x = 0; x < GameConfig.COLS; x++) {
      for (let y = 0; y < GameConfig.ROWS; y++) {
        this.visibility[x]![y] = true;
        this.explored[x]![y] = true;
      }
    }
    this.cb.onAudio?.('waystationEnter');
    this.cb.log('You surface into a sídhe mound — a hush, a hearth, and friendly faces. The stairs will keep.', 'log-success', 'special_sacred');
    this.cb.onToast?.('You surface into a sídhe mound — rest; the dark will keep.', 'special_sacred');
    this.storyBeats.push('rested in a sídhe mound');
    this.pushUI();
  }

  /**
   * A rescued resident's mound service, keyed by their `service` field:
   * the Gobán Saor shapes your next piece to order, Fedelm reads the floors
   * ahead, and Bricriu serves the Champion's Portion (+ATK until the next
   * descent, one helping per floor).
   */
  private openRescueService(rescue: RescueDef): void {
    if (!this.cb.onFloorEvent) { this.advanceTurn(); return; }
    let event: FloorEventDef;
    if (rescue.service === 'wright') {
      const shapes: ShapeKey[] = ['I', 'O', 'T', 'L', 'J', 'S', 'Z'];
      event = {
        id: `__service_${rescue.id}__`, emoji: rescue.char, title: rescue.name,
        flavor: rescue.serviceFlavor,
        options: [
          ...shapes.map(k => ({
            label: `The ${k}-stone`,
            desc: `Your next falling stone will be the ${k} shape.`,
            apply: (game: Game): string => {
              game.nextType = k;
              game.pushUI();
              return `The Gobán Saor taps the plan twice. "One ${k}-stone, cut true." It will be your next piece.`;
            },
          })),
          { label: 'No need', desc: '', apply: (): string => 'He shrugs and goes back to squaring a block that was already square.' },
        ],
      };
    } else if (rescue.service === 'seer') {
      const interval = Balance.CONFIG.floors.bossFloorInterval;
      const nextBossFloor = (Math.floor(this.dungeonLevel / interval) + 1) * interval;
      const boss = this.previewBossForFloor(nextBossFloor);
      const smithsLeft = this.smithsMetCount < SMITHS.length && !this.spearForged;
      const smithLine = smithsLeft
        ? ` The anvils still ring below — ${SMITHS.length - this.smithsMetCount} smith${SMITHS.length - this.smithsMetCount === 1 ? '' : 's'} yet to find.`
        : '';
      event = {
        id: `__service_${rescue.id}__`, emoji: rescue.char, title: rescue.name,
        flavor: `${rescue.serviceFlavor} "I see crimson at floor ${nextBossFloor} — ${boss.name} waits there, and knows you are coming.${smithLine}"`,
        options: [{ label: 'Thank her', desc: '', apply: (): string => 'The flame gutters out. Fedelm is already looking at something else — something further down.' }],
      };
    } else {
      const fed = this.portionAtkBonus > 0;
      const atk = Balance.CONFIG.rescues.portionAtk;
      event = {
        id: `__service_${rescue.id}__`, emoji: rescue.char, title: rescue.name,
        flavor: fed
          ? 'Bricriu spreads his hands over an empty table. "The Champion\'s Portion is one portion. That is the entire point of it, hero."'
          : rescue.serviceFlavor,
        options: fed
          ? [{ label: 'Leave the table', desc: '', apply: (): string => 'You leave the table before he starts a feud about it.' }]
          : [
              {
                label: "Eat the Champion's Portion",
                desc: `+${atk} ATK until your next descent.`,
                apply: (game: Game): string => {
                  game.portionAtkBonus = atk;
                  game.player.atk += atk;
                  game.pushUI();
                  return `You eat the hero's cut while Bricriu watches everyone else not eating it. +${atk} ATK until the next descent.`;
                },
              },
              { label: 'Decline politely', desc: '', apply: (): string => '"Extraordinary," Bricriu says, delighted. "A hero with manners. The portion keeps."' },
            ],
      };
    }
    this.paused = true;
    this.cb.onFloorEvent(event, (index) => {
      const msg = event.options[index]?.apply(this) ?? 'Nothing happened.';
      this.cb.log(msg, 'log-perk', rescue.char);
      this.paused = false;
      this.cb.onAction();
    });
  }

  /** Rolls this floor's omen (per-floor modifier) on entry — boss floors and floor 1 stay omen-free, and most floors still roll nothing. */
  private maybeRollOmen(isBossFloor: boolean): void {
    if (isBossFloor || this.dungeonLevel <= 1) return;
    if (Math.random() >= Balance.CONFIG.omens.rollChance) return;
    const omen = Omen.random();
    this.activeOmen = omen;
    this.omenGravityPct = omen.num('gravityPct', 0);
    this.cb.log(omen.logText, 'log-tetris', omen.icon);
    this.cb.onToast?.(omen.toastText, omen.icon);
    // Gravity-affecting omens need the host's tick timer re-armed right away.
    if (this.omenGravityPct !== 0) this.cb.onAction();
  }

  /** Sets {@link pendingSmithFloor} and gives the player an ambient heads-up, on a smith-eligible floor entry. */
  private maybeAnnounceSmithFloor(isBossFloor: boolean): void {
    if (isBossFloor || this.pendingSmithFloor || this.smithsMetCount >= SMITHS.length) return;
    if (this.dungeonLevel % Balance.CONFIG.smiths.floorInterval !== 0) return;
    this.pendingSmithFloor = true;
    this.cb.log('You hear the clang of an anvil in the distance...', 'log-perk', 'fx_impact');
    this.cb.onToast?.('You hear the clang of an anvil in the distance...', 'fx_impact');
    this.cb.onParticleBurst?.(this.player.x, this.player.y, 6, '#d9a441');
  }

  /** The next smith due to appear this run (Luchta → Credne → Goibniu), or `null` once all three have been met. */
  private nextSmith(): Smith | null {
    return (SMITHS as Smith[])[this.smithsMetCount] ?? null;
  }

  /** The captors' monster archetype for a rescue piece — nastier stock the deeper you are. */
  private rollGuardKey(): string {
    const pool = this.dungeonLevel >= 6 ? ['berserker_orc', 'skeleton'] : ['skeleton', 'goblin_archer'];
    return pool[Math.floor(Math.random() * pool.length)]!;
  }

  /** Grants the smith's part, and — on the third meeting (Goibniu) — reforges the complete Spear of Lugh. */
  private triggerSmithEncounter(smith: Smith, onClosed?: () => void): void {
    const isReforge = smith.partKey === 'head' && this.spearPartsHeld.has('shaft') && this.spearPartsHeld.has('bolts');
    const event: FloorEventDef = {
      id: smith.id, emoji: smith.char, title: smith.name,
      flavor: isReforge
        ? `${smith.flavor} He takes the shaft and the bolts from your hands without asking, and sets to work.`
        : smith.flavor,
      options: [
        {
          label: isReforge ? 'Let him reforge the spear' : `Take ${smith.partName}`,
          desc: isReforge ? 'Shaft, bolts, and head, made whole again.' : 'A piece of Lugh\'s Spear, freely given.',
          apply: (game: Game): string => {
            game.spearPartsHeld.add(smith.partKey);
            game.smithsMetCount++;
            game.storyBeats.push(`received ${smith.partName} from ${smith.name}`);
            if (isReforge) {
              game.spearForged = true;
              game.player.rangedAbility = {
                name: 'Spear of Lugh', emoji: 'item_spear_of_lugh', abilityType: 'spear_bolt',
                range: 0, damageMult: Balance.CONFIG.spearOfLugh.dmgMult, cooldownMax: Balance.CONFIG.spearOfLugh.cooldownMax,
              };
              game.storyBeats.push('saw Lugh\'s Spear reforged whole');
              return `Goibniu's forge roars once more — shaft, bolts, and head become one. The Spear of Lugh is whole again, and it answers to you now.`;
            }
            return `${smith.name} gives you ${smith.partName}.`;
          },
        },
      ],
    };
    this.paused = true;
    this.cb.onFloorEvent?.(event, (index) => {
      const msg = event.options[index]?.apply(this) ?? 'Nothing happened.';
      this.cb.log(msg, 'log-perk', smith.char);
      this.paused = false;
      this.cb.onAction();
      onClosed?.();
    });
  }

  // ── An Draoi's pact ceremony ───────────────────────────────────────────────
  // Triggered by bumping the deity emissary in the waystation (see
  // pactPending / enterWaystation): the deities call, and one must be
  // answered — the pact IS the class, so there is no decline. Returns true
  // if the ceremony modal was opened.

  private maybeOfferPact(): boolean {
    if (this.activeClassId !== 'draoi' || this.activePatronId !== null) return false;
    if (this.dungeonLevel < 2 || !this.cb.onFloorEvent) return false;

    // Only 2 of the 3 deities call on any given run — which two is the rift's whim.
    const offered = [...PATRONS].sort(() => Math.random() - 0.5).slice(0, 2);
    const event: FloorEventDef = {
      id: '__pact__', emoji: 'fx_arcane', title: 'The Deities Call',
      flavor: 'Two voices rise through the stone, each offering power for a price paid in blood. A draoi without a pact is a door without a house. Choose.',
      options: offered.map(p => ({
        label: p.deity,
        desc: `${p.tagline} — ${p.spells[0]!.name}: ${describePatronSpell(p)} ${p.tollDesc} More spells unlock as you level.`,
        apply: (game: Game): string => {
          game.applyPatron(p.id);
          return `The pact is sworn. ${p.deity} marks you as their own.`;
        },
      })),
    };

    this.paused = true;
    this.cb.onFloorEvent(event, (index) => {
      const msg = event.options[index]?.apply(this) ?? 'Nothing happened.';
      this.cb.log(msg, 'log-perk', 'fx_arcane');
      this.paused = false;
      this.cb.onAction();
    });
    return true;
  }

  /**
   * Swears An Draoi's pact with the named deity: applies the patron's
   * passive, grants the level-appropriate spells (paying each one's toll),
   * and swaps in the signature spell as the active ranged ability.
   * @throws {TypeError} If `id` is not a non-empty string.
   */
  public applyPatron(id: string): void {
    if (typeof id !== 'string' || id.length === 0) throw new TypeError('Game.applyPatron: "id" must be a non-empty string');
    const patron = PATRONS.find(p => p.id === id);
    if (!patron) return;
    this.activePatronId = id;
    EffectResolver.applyToPlayer(this.player, patron.effects);
    this.player.spellbook = patron.spells
      .filter(s => (s.unlockLevel ?? 1) <= this.player.playerLevel)
      .map(s => ({ ...s }));
    for (const spell of this.player.spellbook) EffectResolver.applyToPlayer(this.player, spell.toll);
    this.player.hp = Math.min(this.player.hp, this.player.maxHp);
    this.player.activeSpellIndex = 0;
    this.player.rangedAbility = this.player.spellbook[0] ?? null;
    this.player.rangedCooldown = 0;
    this.storyBeats.push(`swore a pact with ${patron.deity}`);
    this.cb.onCodexDiscover?.('patron', id);
    this.cb.log(`${patron.name} — ${patron.spells[0]!.name} replaces Wild Surge. (Q)`, 'log-perk', patron.char);
    this.cb.log(patron.tollDesc, 'log-neutral', patron.char);
    this.cb.onParticleBurst?.(this.player.x, this.player.y, 12, '#8d6fd4', patron.char);
    this.cb.onRingPulse?.(this.player.x, this.player.y, '141,111,212');
    this.cb.onAudio?.('pactSworn');
    this.pushUI();
  }

  // Adds any patron spells whose unlockLevel the player has now reached.
  // Called from openLevelUpBoons — the single choke point every level-up
  // passes through (kills, tomes, scholars, line-clear XP).
  private syncSpellUnlocks(): void {
    const patron = PATRONS.find(p => p.id === this.activePatronId);
    if (!patron) return;
    for (const spell of patron.spells) {
      if ((spell.unlockLevel ?? 1) > this.player.playerLevel) continue;
      if (this.player.spellbook.some(s => s.name === spell.name)) continue;
      this.player.spellbook.push({ ...spell });
      EffectResolver.applyToPlayer(this.player, spell.toll);
      this.player.hp = Math.min(this.player.hp, this.player.maxHp);
      const toll = describeToll(spell.toll);
      this.cb.log(`${patron.deity} grants a new spell: ${spell.name}! (${toll} — E cycles spells)`, 'log-perk', spell.emoji);
      this.cb.onParticleBurst?.(this.player.x, this.player.y, 8, '#8d6fd4', spell.emoji);
    }
  }

  /**
   * Cycles the active spell (An Draoi with 2+ unlocked spells). Shared
   * cooldown — switching is free but doesn't dodge the wait.
   */
  public handleCycleSpell(): void {
    if (this.player.hp <= 0 || this.paused) return;
    const book = this.player.spellbook;
    if (book.length < 2) return;
    this.player.activeSpellIndex = (this.player.activeSpellIndex + 1) % book.length;
    this.player.rangedAbility = book[this.player.activeSpellIndex]!;
    this.cb.log(`Spell ready: ${this.player.rangedAbility.name}`, 'log-neutral', this.player.rangedAbility.emoji);
    this.pushUI();
  }

  /**
   * Rotating opening sentences for {@link buildRunStory}, keyed by outcome and
   * templated with `{cls}`/`{floor}`. No leading article before `{cls}` —
   * class names already carry their own ("The Architect", "An Draoi").
   */
  private static readonly STORY_OPENERS: Record<'death' | 'victory', string[]> = {
    death: [
      "{cls}'s descent, ended on Floor {floor}.",
      "{cls} fell to the depths, no further than Floor {floor}.",
      "The rift claimed {cls}, at Floor {floor}.",
    ],
    victory: [
      "{cls} broke Bres's bridge at Floor {floor} and walked free.",
      "The causeway falls silent — {cls} saw the far side, from Floor {floor}.",
      "{cls}'s descent ended in victory, on Floor {floor}.",
    ],
  };

  /**
   * Short narrative recap for the death/victory screen, built from the
   * notable moments recorded in {@link storyBeats} over the run.
   * @param outcome - Whether the run ended in death or victory (picks the opening sentence's tone).
   * @throws {TypeError} If `outcome` is not `'death'` or `'victory'`.
   */
  public buildRunStory(outcome: 'death' | 'victory'): string {
    if (outcome !== 'death' && outcome !== 'victory') {
      throw new TypeError('Game.buildRunStory: "outcome" must be "death" or "victory"');
    }
    const cls = CLASSES.find(c => c.id === this.activeClassId)?.name ?? 'wanderer';
    const openers = Game.STORY_OPENERS[outcome];
    const opener = openers[Math.floor(Math.random() * openers.length)]!
      .replace('{cls}', cls).replace('{floor}', String(this.dungeonLevel));
    const beats = this.storyBeats.slice(0, 5);
    if (beats.length === 0) return opener;
    const joined = beats.length === 1
      ? beats[0]!
      : `${beats.slice(0, -1).join(', ')}, and ${beats[beats.length - 1]!}`;
    const more = this.storyBeats.length > 5 ? ' …and more besides.' : '';
    return `${opener} Along the way you ${joined}.${more}`;
  }

  private instantiateRider(cell: CellValue, tx: number, ty: number): void {
    if (cell === Cell.MONSTER_RAT)    { this.spawnMonster('rat',            tx, ty); return; }
    if (cell === Cell.MONSTER_SKEL)   { this.spawnMonster('skeleton',       tx, ty); return; }
    if (cell === Cell.MONSTER_ARCHER) { this.spawnMonster('goblin_archer',  tx, ty); return; }
    if (cell === Cell.MONSTER_SLIME)  { this.spawnMonster('cave_slime',     tx, ty); return; }
    if (cell === Cell.MONSTER_ORC)    { this.spawnMonster('berserker_orc',  tx, ty); return; }
    if (cell === Cell.MONSTER_BAT)    { this.spawnMonster('plague_bat',     tx, ty); return; }

    if (cell === Cell.BOSS) {
      const bossDef = this.previewBossForFloor(this.dungeonLevel);
      const baseHp = Balance.CONFIG.boss.baseHpFloor1 + (this.dungeonLevel - 1) * Balance.CONFIG.boss.baseHpPerDungeonLevel;
      const baseAtk = Balance.CONFIG.boss.baseAtkFloor1 + (this.dungeonLevel - 1) * Balance.CONFIG.boss.baseAtkPerDungeonLevel;
      const hp = Math.floor(baseHp * bossDef.hpMult);
      const atk = Math.floor(baseAtk * bossDef.atkMult);
      const boss = new Monster(tx, ty, bossDef.char, bossDef.name, hp, hp, atk, bossDef.xpReward, true);
      boss.combatLevel = Balance.CONFIG.boss.combatLevel;
      this.monsters.push(boss);
      this.activeBossOnHalfHp = bossDef.onHalfHp ?? null;
      this.activeBossOnDeath   = bossDef.onDeath  ?? null;
      this.bossHalfHpTriggered = false;
      this.cb.log(`${bossDef.flavorText} ${bossDef.name} descends!`, 'log-boss', 'ui_warning');
      this.cb.onParticle(tx, ty, 'BOSS', '#ff0000', undefined, 'ui_warning');
      this.cb.onCodexDiscover?.('boss', bossDef.name);
      // Boss cinematic pause
      this.paused = true;
      this.cb.onBossWarning?.(bossDef, () => { this.paused = false; });
    }
  }

  public isIceTile(x: number, y: number): boolean {
    return this.specialTiles.some(t => t.type === 'ice' && t.x === x && t.y === y);
  }

  // ── Line clears ──────────────────────────────────────────────────────────

  /** Clears every full row, shifts the stack down, and applies all the line-clear rewards (gold, combo, XP, heal, Gorgoth causeway chip). */
  private checkLineClears(): void {
    let rowsCleared = 0;
    const clearedRows: number[] = [];

    for (let y = GameConfig.ROWS - 1; y >= 0; y--) {
      let rowFull = true;
      for (let x = 0; x < GameConfig.COLS; x++) {
        if (this.map[x]![y] === Tile.VOID) { rowFull = false; break; }
      }
      if (!rowFull) continue;

      rowsCleared++;
      clearedRows.push(y);
      for (let x = 0; x < GameConfig.COLS; x++) {
        this.map[x]![y] = Tile.VOID;
        this.colors[x]![y] = null;
      }
      for (let shiftY = y; shiftY > 0; shiftY--) {
        for (let x = 0; x < GameConfig.COLS; x++) {
          this.map[x]![shiftY] = this.map[x]![shiftY - 1]!;
          this.colors[x]![shiftY] = this.colors[x]![shiftY - 1]!;
        }
      }
      for (let x = 0; x < GameConfig.COLS; x++) { this.map[x]![0] = Tile.VOID; this.colors[x]![0] = null; }
      this.shiftEntitiesDown(y);
      this.tattooTiles = this.tattooTiles
        .filter(t => t.y !== y)
        .map(t => t.y < y ? { x: t.x, y: t.y + 1 } : t);
      this.altarTiles = this.altarTiles
        .filter(a => a.y !== y)
        .map(a => a.y < y ? { ...a, y: a.y + 1 } : a);
      // A captive on the cleared row is swallowed by the stone — not freed,
      // so they may ride down again on a later floor.
      const lostCaptive = this.npcTiles.find(n => n.y === y && n.npcId.startsWith('__rescue_'));
      if (lostCaptive) {
        const lost = RESCUES.find(r => `__rescue_${r.id}__` === lostCaptive.npcId);
        if (lost) this.cb.log(`The stone closes over ${lost.name}. Somewhere below, the Fomorians drag them deeper.`, 'log-neutral', lost.char);
      }
      this.npcTiles = this.npcTiles
        .filter(n => n.y !== y)
        .map(n => n.y < y ? { ...n, y: n.y + 1 } : n);
      // Unlit braziers lost here are replaced by later riders; lit ones are
      // already banked in brazierLitCount, so clearing them costs nothing.
      this.brazierTiles = this.brazierTiles
        .filter(b => b.y !== y)
        .map(b => b.y < y ? { ...b, y: b.y + 1 } : b);
      this.hazards = this.hazards
        .filter(h => h.y !== y)
        .map(h => h.y < y ? { ...h, y: h.y + 1 } : h);
      this.specialTiles = this.specialTiles
        .filter(t => t.y !== y)
        .map(t => t.y < y ? { ...t, y: t.y + 1 } : t);
      y++;
    }

    if (rowsCleared > 0) {
      this.linesCleared += rowsCleared;
      this.cb.onRowClear?.(clearedRows);
      this.cb.onAudio?.('lineClear', rowsCleared);
      const now = performance.now();
      const isCombo = now - this.lastLineClearMs < 2000;
      this.comboCount = isCombo ? this.comboCount + 1 : 0;
      this.lastLineClearMs = now;
      if (this.comboCount > this.biggestCombo) this.biggestCombo = this.comboCount;

      let goldAdded = Math.floor(GameMath.scoreForLines(rowsCleared, this.dungeonLevel) * (this.activeOmen?.num('goldMult', 1) ?? 1));
      if (this.comboCount > 0) {
        const mult = 1 + this.comboCount * 0.5;
        goldAdded = Math.floor(goldAdded * mult);
        this.cb.log(`COMBO x${this.comboCount + 1}! +${goldAdded} Gold`, 'log-combo', 'fx_fire');
        this.cb.onCombo?.(this.comboCount + 1);
        if (this.comboCount >= 2) this.cb.onAudio?.('comboMilestone', this.comboCount + 1);
      }
      this.gold += goldAdded;
      this.cb.onParticleBurst?.(this.player.x, this.player.y, Math.min(6 + rowsCleared * 2 + this.comboCount * 2, 20), '#d9a441');

      // XP for line clears — multi-row clears give a stacked bonus; Architect doubles it; Rift Tide stacks on top
      const LINE_CLEAR_XP = [0, 15, 40, 80, 150];
      const xpGain = Math.round((LINE_CLEAR_XP[Math.min(rowsCleared, 4)] ?? 150) * this.player.lineClearXpMult);
      this.cb.onParticle(this.player.x, this.player.y, `+${xpGain}XP`, '#ce93d8', 14);
      const levelled = this.player.gainXP(Math.floor(xpGain * this.xpMultiplier));
      if (levelled) {
        this.cb.log(`LEVEL UP! Now level ${this.player.playerLevel}!`, 'log-perk', 'special_sacred');
        this.openLevelUpBoons();
      }

      // Perk: line clears deal a % of ATK as damage to all visible monsters
      const lineClearDmg = StatMath.pctOf(this.player.atk, this.player.lineClearDamage);
      if (lineClearDmg > 0) {
        for (const m of this.monsters) {
          if (this.visibility[m.x]?.[m.y]) {
            m.hp -= lineClearDmg;
            this.cb.onParticle(m.x, m.y, `-${lineClearDmg}`, '#ff6b35', undefined, 'fx_fire');
          }
        }
      }

      // line-clear-damage-mult passive: line clears deal scaled damage to all visible monsters
      if (this.player.lineClearDmgMult > 0) {
        const dmg = this.player.lineClearDmgMult * rowsCleared * this.dungeonLevel;
        for (const m of this.monsters) {
          if (this.visibility[m.x]?.[m.y]) {
            m.hp -= dmg;
            this.cb.onParticle(m.x, m.y, `-${dmg}`, '#ff6d00', 14, 'fx_impact');
          }
        }
      }

      // Annihilation Rune: line clears deal floor×mult dmg to ALL monsters
      if (this.player.lineClearAoeDmgMult > 0) {
        const aoeDmg = Math.floor(this.player.lineClearAoeDmgMult * this.dungeonLevel);
        for (const m of this.monsters) {
          m.hp -= aoeDmg;
          this.cb.onParticle(m.x, m.y, `-${aoeDmg}`, '#ff6d00', undefined, 'fx_impact');
        }
      }

      // Route line-clear deaths through killMonster so they award XP/gold and,
      // crucially, so dropping Bres to 0 triggers victory instead of silently
      // deleting him (which would soft-lock the run: no boss, no blocks).
      for (const m of this.monsters.filter(x => x.hp <= 0)) CombatSystem.killMonster(m, this);

      if (!this.noLineHeal) {
        const lineHeal = this.player.heal(10);
        if (lineHeal > 0) {
          this.cb.onParticle(this.player.x, this.player.y, `+${lineHeal} HP`, '#69f0ae');
          this.cb.onParticleBurst?.(this.player.x, this.player.y, 4, '#7fd488');
          if (this.comboCount === 0) this.cb.log(`Row cleared! +${lineHeal} HP.`, 'log-tetris');
        } else if (this.comboCount === 0) {
          this.cb.log(`Dungeon Row Cleared! +${goldAdded} Gold.`, 'log-tetris');
        }
      } else if (this.comboCount === 0) {
        this.cb.log(`Dungeon Row Cleared! +${goldAdded} Gold. (Cursed — no heal)`, 'log-tetris');
      }

      // A real Tetris (all 4 lines at once) is rare enough to reward once
      // per run with a one-off, unusually generous trader. Deferred rather
      // than opened immediately — a Tetris's huge XP payout can level the
      // player up in this very call, and that boon-choice modal must not be
      // stacked under/over this one.
      if (rowsCleared === 4 && !this.tetrisRewardGranted && this.cb.onOpenShop) {
        this.tetrisRewardGranted = true;
        this.pendingTetrisReward = true;
        this.cb.log('A PERFECT CLEAR! The Otherworld takes notice, and sends a trader through the rift...', 'log-combo', 'fx_arcane');
      }
    }
  }

  /** Shifts monsters and the player down one row above a just-cleared line (part of the collapse animation's bookkeeping). */
  private shiftEntitiesDown(thresholdY: number): void {
    for (const m of this.monsters) { if (m.y < thresholdY) m.y++; }
    if (this.player.y < thresholdY) {
      this.player.y++;
      if (this.player.y >= GameConfig.ROWS) this.transitionToNextFloor();
    }
  }

  // ── Floor transitions ────────────────────────────────────────────────────

  /** Ambient heads-up on entering a boss-eligible floor — mirrors {@link maybeAnnounceSmithFloor}. The boss itself doesn't spawn until the floor is built up (see `instantiateRider`'s `Cell.BOSS` case). */
  private announceBossFloor(): void {
    this.pendingBossFloor = true;
    this.cb.onToast?.('You sense dark forces lie in ambush!', 'ui_warning');
  }

  /** Advances the dungeon level counter and rebuilds the floor (used when the stack's top row itself scrolls off the bottom). */
  private transitionToNextFloor(): void {
    this.dungeonLevel++;
    this.floorsDescended++;
    const isBossFloor = this.dungeonLevel % Balance.CONFIG.floors.bossFloorInterval === 0;
    if (isBossFloor) this.announceBossFloor();
    this.updateBiome();
    this.cb.log(`Collapsed down to depth floor ${this.dungeonLevel}!`, 'log-tetris');
    this.resetDungeonState();
    this.inWaystation = false;  // defense-in-depth: a collapse can't start inside the mound, but never carry the suspension out
    // Omen first, smith second — if both toast, the more actionable smith
    // hint wins the banner while both keep their log lines.
    this.maybeRollOmen(isBossFloor);
    this.maybeAnnounceSmithFloor(isBossFloor);
  }

  /** Icon shown alongside a biome's flavor line on first entry — keyed by id since `BiomeDef` has no icon field of its own. */
  private static readonly BIOME_ICON: Record<string, string> = {
    stone: 'tile_stone_a', cavern: 'sprite_crystal', rift: 'fx_arcane',
  };

  /** Syncs `biomeId`/`biomeMonsterHpMult`/`biomeGravityPct` to the current dungeon level, logging the biome's flavor text the first time a run crosses into it. */
  private updateBiome(): void {
    const biome = Biome.forFloor(this.dungeonLevel);
    if (biome.id !== this.biomeId) {
      const icon = Game.BIOME_ICON[biome.id] ?? 'tile_stone_a';
      this.cb.log(`${biome.name} — ${biome.desc}`, 'log-tetris', icon);
      this.cb.onToast?.(`Entering ${biome.name}...`, icon);
      this.storyBeats.push(`delved into ${biome.name}`);
      this.cb.onCodexDiscover?.('biome', biome.id);
    }
    this.biomeId = biome.id;
    this.biomeMonsterHpMult = biome.monsterHpMult;
    this.biomeGravityPct = biome.gravityPctBonus;
  }

  /** Rebuilds the floor grid and per-floor state (monsters, hazards, ghost roll, tattoo/altar/NPC tiles) for a fresh descent. */
  public resetDungeonState(): void {
    this.map = this.emptyMap();
    this.colors = this.emptyColors();
    this.visibility = this.emptyBoolGrid(false);
    this.explored = this.emptyBoolGrid(false);
    this.monsters = [];
    this.tattooTiles = [];
    this.tattooTilesSpawnedThisFloor = 0;
    this.altarTiles = [];
    this.npcTiles = [];
    this.npcTilesSpawnedThisFloor = 0;
    this.blocksSpawnedThisFloor = 0;
    this.smithWarningShown = false;
    // A rescue that never landed (or was never freed) lapses with the floor —
    // the captive may ride again later; their captors stayed behind either way.
    this.pendingRescueId = null;
    this.pendingGuardKey = null;
    this.rescueGuards = [];
    // Bricriu's Champion's Portion is a single meal — it ends at the descent.
    if (this.portionAtkBonus > 0) {
      this.player.atk -= this.portionAtkBonus;
      this.portionAtkBonus = 0;
    }
    // A Bealtaine floor left with fires unlit — the ritual quietly lapses.
    if (this.activeOmen?.special === 'bealtaine' && !this.ritualComplete && this.brazierLitCount > 0) {
      this.cb.log('The need-fires gutter out below, unlit and unanswered. The Sídhe withdraw.', 'log-neutral', 'tile_brazier');
    }
    this.activeOmen = null;
    this.omenGravityPct = 0;
    this.brazierTiles = [];
    this.brazierLitCount = 0;
    this.ritualComplete = false;
    // Ghost haunting roll — a fallen character close to your current level
    // may drift up from a previous run's save.
    this.activeGhost = null;
    this.ghostPlaced = false;
    const eligibleGhosts = this.availableGhosts.filter(
      g => Math.abs(g.playerLevel - this.player.playerLevel) <= Balance.CONFIG.ghosts.levelTolerance,
    );
    if (eligibleGhosts.length > 0 && Math.random() < Balance.CONFIG.ghosts.encounterChance) {
      this.activeGhost = eligibleGhosts[Math.floor(Math.random() * eligibleGhosts.length)]!;
    }
    this.hazards = [];
    this.specialTiles = [];
    this.killsThisFloor = 0;
    this.heldType = null;
    this.canHold = true;
    this.activeBossOnHalfHp = null;
    this.activeBossOnDeath   = null;
    this.bossHalfHpTriggered = false;
    this.player.x = 4;
    this.player.y = 23;
    // Replenish finite ammo on descent (Rogue darts: +3, cap 5)
    if (this.player.rangedAmmo >= 0) {
      this.player.rangedAmmo = Math.min(Balance.CONFIG.ammo.maxAmmo, this.player.rangedAmmo + Balance.CONFIG.ammo.replenishOnDescend);
    }
    // Cruelty Core: reset per-floor ATK bonus
    this.player.atk -= this.player.killAtkFloorBonus;
    this.player.killAtkFloorBonus = 0;
    // Deathward Rune: replenish charges from stacks
    this.player.deathwardCharges = this.player.boons
      .filter(b => b.id === 'deathward')
      .reduce((sum, b) => sum + b.stacks, 0);
    // Life Mark: replenish revive flag each floor if set was completed
    if (this.player.brands.filter(b => b.brand.id === 'life').length >= 3) {
      this.player.lifeBrandRevive = true;
    }
    // Ghost Mark: replenish guaranteed-dodge charges from completed sets
    this.player.ghostDodgeCharges = Math.floor(
      this.player.brands.filter(b => b.brand.id === 'ghost').length / 2
    );
    this.generateStartPlatform();
    this.maybeSpawnDungeonRoom();
    this.spawnBlock();
    this.updateVisibility();
  }

  // ── Gravity ──────────────────────────────────────────────────────────────

  /** Drops the falling piece one row, or locks it if it can't descend further. */
  private moveGravity(): void {
    if (!this.checkBlockCollision(this.blockX, this.blockY + 1, this.blockMatrix)) {
      this.blockY++;
    } else {
      this.lockBlock();
    }
  }

  // ── Auto-tick (timer-driven) ─────────────────────────────────────────────

  /** One timer-driven simulation tick: status effects, hazards, gravity, monster turns. Called on the game loop's interval; a no-op while paused or dead. */
  public autoTick(): void {
    if (this.player.hp <= 0 || this.paused) return;
    StatusEffectSystem.applyStatusEffects(this);
    StatusEffectSystem.applyRegen(this);
    StatusEffectSystem.applyAuraStun(this);
    HazardSystem.processHazards(this);
    this.processSpecialTiles();
    if (!this.tetrisSuspended) this.moveGravity();  // no falling blocks during the Gorgoth duel or a waystation
    MonsterAiSystem.processMonsterTurns(this);
    this.checkCloseCall();
    this.tickRangedCooldown();
    this.updateVisibility();
    this.pushUI();
    if (this.timeDilationTurns > 0) {
      this.timeDilationTurns--;
      if (this.timeDilationTurns === 0) {
        this.timeDilationSlowPct = 0;
        this.cb.log('Time Dilation fades.', 'log-neutral');
        this.cb.onAction();  // reset tick interval to normal speed
      }
    }
    this.tickVeil();
  }

  // ── Player turn (action-driven) ──────────────────────────────────────────

  /** The action-driven counterpart to {@link autoTick} — runs the same per-turn resolution, then notifies the host to reset its tick timer. */
  private advanceTurn(): void {
    if (this.player.hp <= 0) return;
    StatusEffectSystem.applyStatusEffects(this);
    StatusEffectSystem.applyRegen(this);
    StatusEffectSystem.applyAuraStun(this);
    HazardSystem.processHazards(this);
    this.processSpecialTiles();
    this.moveGravity();
    MonsterAiSystem.processMonsterTurns(this);
    this.checkCloseCall();
    this.tickRangedCooldown();
    this.updateVisibility();
    this.pushUI();
    if (this.timeDilationTurns > 0) {
      this.timeDilationTurns--;
      if (this.timeDilationTurns === 0) {
        this.timeDilationSlowPct = 0;
        this.cb.log('Time Dilation fades.', 'log-neutral');
      }
    }
    this.tickVeil();
    this.cb.onAction();
  }

  /** Pushes a one-time "close call" story beat the first time this run's HP drops to/below {@link Balance.CONFIG}'s `narrative.closeCallHpFraction` and survives. */
  private checkCloseCall(): void {
    if (this.hadCloseCall || this.player.hp <= 0) return;
    if (this.player.hp <= this.player.maxHp * Balance.CONFIG.narrative.closeCallHpFraction) {
      this.hadCloseCall = true;
      this.storyBeats.push("clung to life with a hair's breadth of health left");
    }
  }

  /** Decrements the ranged-ability cooldown by one turn, if any remains. */
  private tickRangedCooldown(): void {
    if (this.player.rangedCooldown > 0) this.player.rangedCooldown--;
  }

  private tickVeil(): void {
    if (this.player.veiledTurns <= 0) return;
    this.player.veiledTurns--;
    if (this.player.veiledTurns === 0) {
      this.cb.log('The mist thins — mortal eyes find you again.', 'log-neutral', 'trap_smoke');
    }
  }

  /** Snapshot of this run's aggregate stats, for the death/victory/recap screen. */
  public getRunStats(): RunStats {
    return {
      monstersKilled: this.monstersKilled,
      bossesKilled:   this.bossesKilled,
      linesCleared:   this.linesCleared,
      biggestCombo:   this.biggestCombo,
      damageTaken:    this.damageTaken,
    };
  }

  // ── Level-up boon pick ───────────────────────────────────────────────────

  /** Opens the level-up boon-choice modal. The single choke point every level-up passes through (kills, tomes, scholars, line-clear XP), so it's also where patron spell unlocks sync. */
  public openLevelUpBoons(): void {
    this.paused = true;
    this.syncSpellUnlocks();  // patron spells gated on the level just reached
    this.cb.onBeam?.(this.player.x);
    const tier = Boon.tierForFloor(this.dungeonLevel);
    const pool = Boon.BY_TIER[tier];
    const choices = Boon.pickThree(pool, this.player.boons.map(b => b.id));
    this.cb.onLevelUp?.(choices, (index) => {
      this.player.addBoon(choices[index]!);
      this.cb.onParticleBurst?.(this.player.x, this.player.y, 8, '#8d6fd4');
      this.paused = false;
      this.pushUI();
      this.cb.onAction?.();
    });
  }

  // ── Class selection ──────────────────────────────────────────────────────

  /**
   * The classes offered on the start-screen picker.
   * @throws {TypeError} If `count` is not a positive finite number.
   */
  public getRandomClasses(count = 2): ClassDef[] {
    if (typeof count !== 'number' || !Number.isFinite(count) || count <= 0) {
      throw new TypeError('Game.getRandomClasses: "count" must be a positive finite number');
    }
    return CLASSES.slice(0, count);
  }

  /**
   * Applies the chosen starting class's stat effects/ability and sets the
   * hero's board sprite to match.
   * @throws {TypeError} If `id` is not a non-empty string.
   */
  public applyClass(id: string): void {
    if (typeof id !== 'string' || id.length === 0) throw new TypeError('Game.applyClass: "id" must be a non-empty string');
    const cls = CLASSES.find(c => c.id === id);
    if (!cls) return;
    cls.apply(this.player);
    this.player.char = cls.emoji;  // the hero looks like the card you picked
    this.activeClassId = id;
    this.cb.log(`Playing as ${cls.name}: ${cls.tagline}`, 'log-perk', cls.emoji);
    this.pushUI();
  }

  // ── Modifier selection ───────────────────────────────────────────────────

  /**
   * A random selection of run modifiers (Rift Curses) for the start-screen picker.
   * @throws {TypeError} If `count` is not a positive finite number.
   */
  public getRandomModifiers(count = 3): ModifierDef[] {
    if (typeof count !== 'number' || !Number.isFinite(count) || count <= 0) {
      throw new TypeError('Game.getRandomModifiers: "count" must be a positive finite number');
    }
    const shuffled = [...MODIFIERS].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, count);
  }

  /**
   * Applies the chosen run modifier's effect for the whole run.
   * @throws {TypeError} If `id` is not a non-empty string.
   */
  public applyModifier(id: string): void {
    if (typeof id !== 'string' || id.length === 0) throw new TypeError('Game.applyModifier: "id" must be a non-empty string');
    const mod = MODIFIERS.find(m => m.id === id);
    if (!mod) return;
    mod.apply(this);
    this.activeModifierId = id;
    this.cb.log(`Rift Curse active: ${mod.name} — ${mod.desc}`, 'log-perk', mod.emoji);
    this.pushUI();
  }

  // ── Tattoo Artist ─────────────────────────────────────────────────────────

  /** Opens the tattoo-artist brand-choice modal (reachable via a tattoo-artist tile). `onClosed` fires once a mark is chosen. */
  private openTattooArtist(onClosed?: () => void): void {
    this.paused = true;
    const ownedIds = (): string[] => this.player.brands.map(b => b.brand.id);
    let cost = Balance.CONFIG.economy.ogmRerollBaseCost;
    let choices = Brand.pickThree(ownedIds());
    const commit = (index: number): void => {
      const slot = BODY_PARTS[this.player.brands.length % BODY_PARTS.length]!;
      const chosen = choices[index]!;
      this.player.addBrand(slot, chosen);
      const setCompleted = this.player.brands.filter(b => b.brand.id === chosen.id).length % chosen.setSize === 0;
      this.cb.onParticleBurst?.(this.player.x, this.player.y, setCompleted ? 14 : 6, setCompleted ? '#d9a441' : '#9d7bc7');
      this.cb.log(`${choices[index]!.name} Ogham mark tattooed on ${slot.replace('_', ' ')}!`, 'log-perk', 'tile_altar');
      this.paused = false;
      this.pushUI();
      this.cb.onAction?.();
      onClosed?.();
    };
    this.cb.onOpenTattooArtist?.(choices, commit, {
      gold: this.gold,
      cost,
      run: () => {
        if (this.gold < cost) return null;
        this.gold -= cost;
        cost = Math.floor(cost * Balance.CONFIG.economy.ogmRerollCostGrowth);
        choices = Brand.pickThree(ownedIds());
        this.pushUI();
        return { choices, gold: this.gold, cost };
      },
    });
  }

  /**
   * The Fear Dearg's stall — the gold sink. Prices scale with depth; each
   * item can be bought once per visit.
   */
  public openPeddler(): void {
    if (!this.cb.onOpenShop) return;
    this.paused = true;
    const prices = Balance.CONFIG.economy.shop.prices;
    const cost = (p: { base: number; perFloor: number }): number => p.base + p.perFloor * this.dungeonLevel;
    const stock: ShopItem[] = [
      { id: 'heal',  icon: 'sprite_potion',           name: 'Hearth Broth',       desc: 'Restore to full HP',                     cost: cost(prices.heal),  purchased: false },
      { id: 'maxhp', icon: 'item_heart',              name: 'Bogwood Charm',      desc: '+10% Max HP',                            cost: cost(prices.maxhp), purchased: false },
      { id: 'atk',   icon: 'sprite_equip_iron_sword', name: 'Ogham-Etched Edge',  desc: '+10% ATK',                               cost: cost(prices.atk),   purchased: false },
      { id: 'ward',  icon: 'status_poison',           name: 'Deathward Sigil',    desc: 'Survive one killing blow (this floor)',  cost: cost(prices.ward),  purchased: false },
    ];
    const buy = (id: string): { gold: number; ok: boolean } => {
      const item = stock.find(s => s.id === id);
      if (!item || item.purchased || this.gold < item.cost) return { gold: this.gold, ok: false };
      this.gold -= item.cost;
      item.purchased = true;
      switch (id) {
        case 'heal':  this.player.heal(this.player.maxHp); break;
        case 'maxhp': this.player.maxHp *= 1.10; this.player.hp = Math.min(this.player.hp * 1.10, this.player.maxHp); break;
        case 'atk':   this.player.atk *= 1.10; break;
        case 'ward':  this.player.deathwardCharges += 1; break;
      }
      this.cb.log(`Bought ${item.name} for ${item.cost}g.`, 'log-perk', item.icon);
      this.pushUI();
      return { gold: this.gold, ok: true };
    };
    this.cb.log('A red-capped peddler unfolds his stall...', 'log-perk', 'tile_merchant');
    this.cb.onOpenShop(stock, this.gold, buy, () => { this.paused = false; this.pushUI(); });
  }

  /** Opens the pending Tetris-clear reward once it's actually safe to (no other modal — e.g. a level-up from the same clear's XP — already has the game paused). */
  private maybeOpenTetrisReward(): void {
    if (!this.pendingTetrisReward || this.paused || !this.cb.onOpenShop) return;
    this.pendingTetrisReward = false;
    this.openTetrisReward();
  }

  /**
   * A one-off, unusually generous trader — granted once per run, the first
   * time the player clears a real Tetris (all 4 lines at once). Flat, cheap
   * prices regardless of depth, plus one exclusive free item not sold
   * anywhere else.
   */
  private openTetrisReward(): void {
    if (!this.cb.onOpenShop) return;
    this.paused = true;
    const flatCost = 15;
    const stock: ShopItem[] = [
      { id: 'heal',  icon: 'sprite_potion',           name: 'Hearth Broth',       desc: 'Restore to full HP',                     cost: flatCost, purchased: false },
      { id: 'maxhp', icon: 'item_heart',              name: 'Bogwood Charm',      desc: '+10% Max HP',                            cost: flatCost, purchased: false },
      { id: 'atk',   icon: 'sprite_equip_iron_sword', name: 'Ogham-Etched Edge',  desc: '+10% ATK',                               cost: flatCost, purchased: false },
      { id: 'ward',  icon: 'status_poison',           name: 'Deathward Sigil',    desc: 'Survive one killing blow (this floor)',  cost: flatCost, purchased: false },
      { id: 'boon',  icon: 'fx_arcane',               name: 'Sídhe Blessing',     desc: 'A random Geis, free of charge',          cost: 0,        purchased: false },
    ];
    const buy = (id: string): { gold: number; ok: boolean } => {
      const item = stock.find(s => s.id === id);
      if (!item || item.purchased || this.gold < item.cost) return { gold: this.gold, ok: false };
      this.gold -= item.cost;
      item.purchased = true;
      switch (id) {
        case 'heal':  this.player.heal(this.player.maxHp); break;
        case 'maxhp': this.player.maxHp *= 1.10; this.player.hp = Math.min(this.player.hp * 1.10, this.player.maxHp); break;
        case 'atk':   this.player.atk *= 1.10; break;
        case 'ward':  this.player.deathwardCharges += 1; break;
        case 'boon': {
          const pool = Boon.BY_TIER[2];
          const reward = pool[Math.floor(Math.random() * pool.length)]!;
          this.player.addBoon(reward);
          break;
        }
      }
      this.cb.log(`Bought ${item.name}${item.cost > 0 ? ` for ${item.cost}g` : ''}.`, 'log-perk', item.icon);
      this.pushUI();
      return { gold: this.gold, ok: true };
    };
    this.cb.onOpenShop(
      stock, this.gold, buy, () => { this.paused = false; this.pushUI(); },
      'THE OTHERWORLD PEDDLER', 'A stranger from beyond the rift, drawn by a perfect clear. "Take your due, and be quick about it."',
    );
  }

  /** Opens the altar boon-choice modal for the given reward tier (reached by stepping on an altar tile). `onClosed` fires once a boon is chosen. */
  private openAltar(tier: 1 | 2 | 3, onClosed?: () => void): void {
    this.paused = true;
    const pool = Boon.BY_TIER[tier];
    const ownedIds = (): string[] => this.player.boons.map(b => b.id);
    let cost = Balance.CONFIG.economy.geasaRerollBaseCost;
    let choices = Boon.pickThree(pool, ownedIds());
    const commit = (index: number): void => {
      this.player.addBoon(choices[index]!);
      this.cb.onParticleBurst?.(this.player.x, this.player.y, 6, '#b98fc4');
      this.paused = false;
      this.pushUI();
      this.cb.onAction?.();
      onClosed?.();
    };
    this.cb.onOpenAltar?.(tier, choices, commit, {
      gold: this.gold,
      cost,
      run: () => {
        if (this.gold < cost) return null;
        this.gold -= cost;
        cost = Math.floor(cost * Balance.CONFIG.economy.geasaRerollCostGrowth);
        choices = Boon.pickThree(pool, ownedIds());
        this.pushUI();
        return { choices, gold: this.gold, cost };
      },
    });
  }

  // ── Action handlers ──────────────────────────────────────────────────────

  /**
   * Moves the hero one tile (or attacks, if a monster occupies the
   * destination), triggering whatever the destination tile does (combat,
   * hazard, altar, tattoo artist, NPC, stairs).
   * @param dx - Column delta, expected to be `-1`, `0`, or `1`.
   * @param dy - Row delta, expected to be `-1`, `0`, or `1`.
   * @throws {TypeError} If `dx` or `dy` is not a finite number.
   */
  public handleHeroMove(dx: number, dy: number): void {
    if (typeof dx !== 'number' || !Number.isFinite(dx)) throw new TypeError('Game.handleHeroMove: "dx" must be a finite number');
    if (typeof dy !== 'number' || !Number.isFinite(dy)) throw new TypeError('Game.handleHeroMove: "dy" must be a finite number');
    if (this.player.hp <= 0 || this.paused) return;
    if (this.player.isStunned) {
      this.cb.log('You are stunned!', 'log-damage');
      this.player.statuses = this.player.statuses.map(s => s.type === 'stun' ? { ...s, duration: s.duration - 1 } : s).filter(s => s.duration > 0);
      this.advanceTurn(); return;
    }

    const nx = this.player.x + dx, ny = this.player.y + dy;
    if (nx < 0 || nx >= GameConfig.COLS || ny < 0 || ny >= GameConfig.ROWS) return;

    // Combat has priority and reaches any adjacent tile — even one the hero
    // can't stand on (e.g. Gorgoth phasing down through the void/stack). An
    // enemy on an interactable tile is attacked rather than triggering the tile.
    const monster = this.getMonsterAt(nx, ny);
    if (monster) {
      let forceCrit = false;
      if (this.player.critEvery > 0) {
        this.player.critCount++;
        if (this.player.critCount >= this.player.critEvery) {
          forceCrit = true;
          this.player.critCount = 0;
        }
      }
      CombatSystem.playerAttackMonster(monster, this, forceCrit);

      // Biome boss half-HP mechanic
      if (monster.isBoss && !this.bossHalfHpTriggered && monster.hp <= monster.maxHp * 0.5 && this.activeBossOnHalfHp) {
        this.bossHalfHpTriggered = true;
        this.cb.onParticleBurst?.(monster.x, monster.y, 12, '#c1443c');
        this.cb.onImpactGlow?.(monster.x, monster.y, '139,26,26', 24);
        this.activeBossOnHalfHp(this);
      }

      if (monster.hp <= 0) {
        const bx = monster.x, by = monster.y;
        CombatSystem.killMonster(monster, this);
        if (monster.isBoss && this.activeBossOnDeath) {
          this.activeBossOnDeath(this, bx, by);
          this.activeBossOnDeath = null;
        }
      }
      this.advanceTurn(); return;
    }

    if (!this.isValidMove(nx, ny)) {
      this.cb.log('Cannot cross the deep abyss void!', 'log-neutral');
      return;
    }

    // Bealtaine need-fire — walk into an unlit brazier to light it
    const brazier = this.brazierTiles.find(b => b.x === nx && b.y === ny && !b.lit);
    if (brazier) {
      this.player.x = nx; this.player.y = ny;
      brazier.lit = true;
      this.brazierLitCount++;
      const needed = this.activeOmen?.num('braziersRequired', 3) ?? 3;
      this.cb.onRingPulse?.(nx, ny, '255,140,50');
      this.cb.onParticleBurst?.(nx, ny, 8, '#ff8c32', 'tile_brazier');
      this.cb.onAudio?.('npcEncounter');
      if (this.brazierLitCount >= needed && !this.ritualComplete) {
        this.ritualComplete = true;
        this.cb.log('The need-fires blaze as one — the Sídhe are appeased!', 'log-perk', 'tile_brazier');
        this.cb.onToast?.('The need-fires blaze — the Sídhe grant a Geis!', 'tile_brazier');
        this.storyBeats.push('lit the fires of Bealtaine');
        this.openAltar(3);
        return;
      }
      this.cb.log(`Need-fire lit! (${this.brazierLitCount}/${needed})`, 'log-perk', 'tile_brazier');
      this.advanceTurn();
      return;
    }

    // Tattoo Artist tile — consumed on use (like an altar)
    if (this.isTattooTile(nx, ny)) {
      this.player.x = nx; this.player.y = ny;
      this.tattooTiles = this.tattooTiles.filter(t => !(t.x === nx && t.y === ny));
      // Beams away once the interaction concludes, not on bump — the departure
      // should read as "their business here is done", after the dialog closes.
      const departInGold = (): void => { this.cb.onBeam?.(nx, '217,164,65'); };
      if (this.player.brandsCapped) {
        this.cb.log('Your body bears its fifth and final Ogham Mark — the Tattoo Artist has nothing left to offer.', 'log-neutral', 'tile_merchant');
        departInGold();
      } else {
        this.openTattooArtist(departInGold);
      }
      return;
    }

    // Altar tile
    const altar = this.altarTiles.find(a => a.x === nx && a.y === ny);
    if (altar) {
      this.player.x = nx; this.player.y = ny;
      this.altarTiles = this.altarTiles.filter(a => a !== altar);
      const tierRgb = Colors.forTier(altar.tier).rgb;
      this.openAltar(altar.tier, () => { this.cb.onBeam?.(nx, tierRgb); });
      return;
    }

    // Wandering NPC / ghost — bump to talk, consumed on interaction
    const npcTile = this.npcTiles.find(n => n.x === nx && n.y === ny);
    if (npcTile) {
      this.player.x = nx; this.player.y = ny;
      this.npcTiles = this.npcTiles.filter(n => n !== npcTile);
      // Waystation residents: the deity emissary swears An Draoi's pact, the
      // waiting stranger delivers the held floor event, the hearth-fire heals
      // in full once, and the Fear Dearg's stall opens the regular peddler shop.
      if (npcTile.npcId === '__pact__') {
        this.cb.onBeam?.(nx, '141,111,212');
        if (!this.maybeOfferPact()) this.advanceTurn();
        return;
      }
      // A rescuable captive (on the floor) or rescued resident (in the mound).
      if (npcTile.npcId.startsWith('__rescue_')) {
        const rescueId = npcTile.npcId.slice('__rescue_'.length, -2);
        const rescue = RESCUES.find(r => r.id === rescueId);
        if (!rescue) { this.advanceTurn(); return; }
        if (this.inWaystation) {
          this.npcTiles.push(npcTile);  // residents stay
          this.openRescueService(rescue);
          return;
        }
        // Still guarded: no rescue until every captor is dead.
        if (this.rescueGuards.some(g => g.hp > 0 && this.monsters.includes(g))) {
          this.npcTiles.push(npcTile);
          this.cb.log(rescue.captiveLine, 'log-neutral', rescue.char);
          this.advanceTurn();
          return;
        }
        // Freed — thanks, then away to the mounds.
        const free = (): void => {
          this.rescuedIds.add(rescue.id);
          this.storyBeats.push(`freed ${rescue.name} from Fomorian captors`);
          this.cb.onBeam?.(nx, '230,180,90');
          this.cb.onAudio?.('bountyFulfilled');
        };
        if (!this.cb.onFloorEvent) { free(); this.advanceTurn(); return; }
        const event: FloorEventDef = {
          id: npcTile.npcId, emoji: rescue.char, title: rescue.name,
          flavor: rescue.thanksLine,
          options: [{
            label: 'See them off', desc: 'They will wait for you in the sídhe mounds.',
            apply: (): string => `${rescue.name} steps into a pillar of light and is gone — away to the mounds, where the deep cannot follow.`,
          }],
        };
        this.paused = true;
        this.cb.onFloorEvent(event, (index) => {
          const msg = event.options[index]?.apply(this) ?? 'Nothing happened.';
          free();
          this.cb.log(msg, 'log-perk', rescue.char);
          this.paused = false;
          this.cb.onAction();
        });
        return;
      }
      // The ogham stone is a fixture — reading it never consumes it.
      if (npcTile.npcId === '__ogham_stone__') {
        this.npcTiles.push(npcTile);
        this.cb.log('You trace the ogham strokes. Old names surface: everything the deep has shown you.', 'log-perk', 'tile_ogham_stone');
        this.cb.onOpenCodex?.();
        return;
      }
      if (npcTile.npcId === '__stash__') {
        const stashed = StorageService.loadStash();
        const pct = Math.round(Balance.CONFIG.waystation.stashRecoveryPct * 100);
        const stashEvent: FloorEventDef = {
          id: '__stash__', emoji: 'item_gold_pouch', title: 'The Sídhe Coffer',
          flavor: `A stone coffer, older than the mound around it. ${stashed > 0 ? `Inside, ${stashed} gold glints — left by those who came before.` : 'It sits empty, waiting for an offering.'} What is left with the Sídhe passes on when you fall — less their tithe.`,
          options: [
            {
              label: this.gold > 0 ? `Leave your gold (${this.gold})` : 'Leave your gold',
              desc: `Your next self inherits ${pct}% of everything in the coffer.`,
              apply: (game: Game): string => {
                if (game.gold <= 0) return 'Your purse is empty. The coffer keeps its silence.';
                const left = game.gold;
                const total = StorageService.addToStash(left);
                game.gold = 0;
                game.storyBeats.push('left gold in the keeping of the Sídhe');
                return `You pour ${left} gold into the coffer — ${total} now waits in the Sídhe's keeping.`;
              },
            },
            { label: 'Keep your purse', desc: '', apply: (): string => 'Gold spends better in living hands. You leave the coffer be.' },
          ],
        };
        this.cb.onBeam?.(nx, '217,164,65');
        if (!this.cb.onFloorEvent) { this.npcTiles.push(npcTile); this.advanceTurn(); return; }
        this.paused = true;
        this.cb.onFloorEvent(stashEvent, (index) => {
          const msg = stashEvent.options[index]?.apply(this) ?? 'Nothing happened.';
          this.cb.log(msg, 'log-perk', 'item_gold_pouch');
          // The coffer is a fixture — it stays whether you gave or not.
          this.npcTiles.push(npcTile);
          this.paused = false;
          this.pushUI();
          this.cb.onAction();
        });
        return;
      }
      if (npcTile.npcId === '__well__') {
        const cost = Balance.CONFIG.well.baseCost + this.dungeonLevel * Balance.CONFIG.well.costPerFloor;
        const xpGain = Balance.CONFIG.well.baseXp + this.dungeonLevel * Balance.CONFIG.well.xpPerFloor;
        const wellEvent: FloorEventDef = {
          id: '__well__', emoji: 'tile_well', title: 'The Well of Segais',
          flavor: 'Nine hazels lean over black water. The salmon below watches you, unblinking. Wisdom has a price — it always has.',
          options: [
            {
              label: `Drink deep (${cost} gold)`,
              desc: `+${xpGain} XP, if you can pay.`,
              apply: (game: Game): string => {
                if (game.gold < cost) return 'The water turns dark and shows you nothing. The well does not extend credit.';
                game.gold -= cost;
                const levelled = game.player.gainXP(xpGain);
                if (levelled) {
                  game.cb.log(`LEVEL UP! Now level ${game.player.playerLevel}!`, 'log-perk', 'special_sacred');
                  game.openLevelUpBoons();
                }
                game.storyBeats.push('drank from the Well of Segais');
                return `The water is cold enough to burn. Knowing floods in behind it. +${xpGain} XP.`;
              },
            },
            { label: 'Leave it', desc: '', apply: (): string => 'The salmon sinks back into the dark, unoffended. Wisdom keeps.' },
          ],
        };
        if (!this.cb.onFloorEvent) { this.npcTiles.push(npcTile); this.advanceTurn(); return; }
        this.paused = true;
        this.cb.onFloorEvent(wellEvent, (index) => {
          const msg = wellEvent.options[index]?.apply(this) ?? 'Nothing happened.';
          this.cb.log(msg, 'log-perk', 'tile_well');
          // The well is a fixture — it stays whether you drink or not.
          this.npcTiles.push(npcTile);
          this.paused = false;
          this.cb.onAction();
        });
        return;
      }
      if (npcTile.npcId === '__event__') {
        const event = this.pendingFloorEvent;
        this.pendingFloorEvent = null;
        this.cb.onBeam?.(nx, '89,159,124');
        if (event && this.cb.onFloorEvent) {
          this.paused = true;
          this.cb.onFloorEvent(event, (index) => {
            const msg = event.options[index]?.apply(this) ?? 'Nothing happened.';
            this.cb.log(msg, 'log-perk', event.emoji);
            this.storyBeats.push(`answered the call of "${event.title}"`);
            this.paused = false;
            this.cb.onAction();
          });
        } else {
          this.advanceTurn();
        }
        return;
      }
      if (npcTile.npcId === '__campfire__') {
        const healed = this.player.heal(this.player.maxHp);
        this.cb.onParticle(nx, ny, healed > 0 ? `+${healed} HP` : 'warm', '#ff8c32', 14, 'tile_brazier');
        this.cb.onParticleBurst?.(nx, ny, 8, '#ff8c32');
        this.cb.log('You rest by the hearth-fire of the mound. Warmth returns to your bones — fully healed.', 'log-success', 'tile_brazier');
        this.cb.onBeam?.(nx, '255,140,50');
        this.advanceTurn();
        return;
      }
      if (npcTile.npcId === '__peddler__') {
        this.cb.onBeam?.(nx, '198,58,50');
        this.openPeddler();
        return;
      }
      const isGhost = npcTile.npcId === '__ghost__';
      const isSmith = npcTile.npcId.startsWith('__smith_');
      const departOnClose = (): void => {
        this.cb.onBeam?.(nx, isGhost ? '176,196,222' : isSmith ? '184,115,51' : '89,159,124');
      };
      if (isGhost) {
        this.triggerGhostEncounter(departOnClose);
        return;
      }
      if (isSmith) {
        const smithId = npcTile.npcId.slice('__smith_'.length, -2);
        const smith = SMITHS.find(s => s.id === smithId);
        if (smith) this.triggerSmithEncounter(smith, departOnClose);
        else departOnClose();
        return;
      }
      const npc = NPCS.find(n => n.id === npcTile.npcId);
      if (npc) this.triggerNpcEncounter(npc, departOnClose);
      else departOnClose();
      return;
    }

    this.player.x = nx; this.player.y = ny;

    // Check hazard triggers on new tile
    HazardSystem.checkHazardTrigger(this.player, this, true);

    // Ice sliding — continue in same direction until hitting wall, monster, or non-ice
    while (this.isIceTile(this.player.x, this.player.y)) {
      const sx = this.player.x + dx, sy = this.player.y + dy;
      if (!this.isValidMove(sx, sy) || this.getMonsterAt(sx, sy) || this.isTattooTile(sx, sy)) break;
      this.player.x = sx; this.player.y = sy;
      HazardSystem.checkHazardTrigger(this.player, this, true);
      if (this.map[sx]?.[sy] === Tile.STAIRS) break;
    }

    // Bres sweeps every stairs tile away the instant he's summoned (see
    // summonGorgoth), so this can't fire mid-duel in practice — the extra
    // guard is defense-in-depth against a soft-lock (descending would wipe
    // his monster entry via resetDungeonState() while gorgothSummoned stayed
    // true, stopping tetrominoes forever with no boss left to fight).
    if (this.map[this.player.x]![this.player.y] === Tile.STAIRS && !this.gorgothSummoned) {
      // The mound's own exit stairs go straight down — you already rested.
      if (this.inWaystation) this.descendFloor();
      else this.openStairsChoice();
    } else {
      this.advanceTurn();
    }
  }

  /**
   * Every staircase offers the choice: delve straight on, or step aside into
   * the safe sídhe-mound waystation first (the mound sits *between* floors —
   * visiting it never consumes a floor number, so boss and smith floors can't
   * be dodged by resting). Falls back to a direct descent when no dialog
   * callback is wired (headless tests).
   */
  private openStairsChoice(): void {
    if (!this.cb.onFloorEvent) { this.descendFloor(); return; }
    // The rest option's pitch names whoever is actually waiting inside.
    const waiting: string[] = [];
    if (this.pactPending) waiting.push('an emissary of the gods');
    if (this.pendingFloorEvent) waiting.push('a sheltering stranger');
    const event: FloorEventDef = {
      id: '__stairs_choice__', emoji: 'tile_stairs', title: 'The Way Down',
      flavor: 'The stair falls away into the dark. Beside it, a low door of piled stones breathes warm air — a sídhe mound, where the deep cannot follow.',
      options: [
        {
          label: 'Delve deeper',
          desc: 'Take the stair down to the next floor.',
          apply: (): string => 'You take the stair down into the dark.',
        },
        {
          label: 'Rest in the mound',
          desc: `A hearth, a storyteller, and the Fear Dearg's stall${waiting.length > 0 ? ` — and ${waiting.join(', and ')}` : ''}. The stair waits inside.`,
          apply: (): string => 'You duck through the low door into the warmth of the mound.',
        },
      ],
    };
    this.paused = true;
    this.cb.onFloorEvent(event, (index) => {
      this.paused = false;
      if (index === 1) this.enterWaystation();
      else this.descendFloor();
      this.cb.onAction();
    });
  }

  /** The actual floor descent: advances the level, rebuilds the floor, and fires every floor-entry hook (omen, smith, pending-event roll). */
  private descendFloor(): void {
    this.inWaystation = false;
    this.dungeonLevel++;
    this.floorsDescended++;
    if (this.dungeonLevel % Balance.CONFIG.floors.bossFloorInterval === 0) this.announceBossFloor();
    this.cb.onAudio?.('descend');
    this.updateBiome();
    this.cb.log(`Stepped down to floor ${this.dungeonLevel}!`, 'log-success');
    this.resetDungeonState();
    // Between-floor choices are people now, not popups: on interval descents a
    // floor event is rolled and embodied as a stranger waiting in the sídhe
    // mound (held until met); the deity emissary and the Fear Dearg's stall
    // likewise live in the mound. Nothing modal fires on the descent itself.
    const isBossFloor = this.dungeonLevel % Balance.CONFIG.floors.bossFloorInterval === 0;
    if (!isBossFloor && this.floorsDescended % Balance.CONFIG.floors.floorEventInterval === 0 && !this.pendingFloorEvent) {
      this.pendingFloorEvent = FloorEvent.random();
      this.cb.log('Someone has taken shelter in the sídhe mounds nearby, waiting to be found...', 'log-perk', 'npc_stranger');
      this.cb.onToast?.('A stranger shelters in the sídhe mounds, waiting...', 'npc_stranger');
    }
    // A captive may ride down this floor under Fomorian guard — free them and
    // they join the mound as a resident (once per figure per run).
    const rescuePool = RESCUES.filter(r => !this.rescuedIds.has(r.id));
    if (!isBossFloor && rescuePool.length > 0 && Math.random() < Balance.CONFIG.rescues.rollChance) {
      this.pendingRescueId = rescuePool[Math.floor(Math.random() * rescuePool.length)]!.id;
      this.cb.log('Muffled cries carry up through the stone — someone is being dragged down in the rubble.', 'log-neutral', 'sprite_boss_wraith');
      this.cb.onToast?.('Cries for help echo in the falling stone...', 'fx_impact');
    }
    this.maybeRollOmen(isBossFloor);
    this.maybeAnnounceSmithFloor(isBossFloor);
  }

  /** Rests one turn: a small heal (more on sacred ground, less with a monster adjacent). */
  public handleHeroWait(): void {
    if (this.player.hp <= 0 || this.paused) return;
    const nearbyMonster = this.monsters.some(m => Math.abs(m.x - this.player.x) <= 1 && Math.abs(m.y - this.player.y) <= 1);
    const healAmt = nearbyMonster ? 1 : 4;
    const healed = this.player.heal(healAmt);
    if (healed > 0) {
      this.cb.onParticle(this.player.x, this.player.y, `+${healed} HP`, '#69f0ae');
      this.cb.log(`Rested. +${healed} HP.`, 'log-success');
    } else {
      this.cb.log('You wait.', 'log-neutral');
    }
    // Sacred ground bonus heal
    if (this.specialTiles.some(t => t.type === 'sacred' && t.x === this.player.x && t.y === this.player.y)) {
      const bonus = this.player.heal(2);
      if (bonus > 0) {
        this.cb.onParticle(this.player.x, this.player.y, `+${bonus}`, '#ffb74d', undefined, 'special_sacred');
        this.cb.onParticleBurst?.(this.player.x, this.player.y, 4, '#7fd488');
        this.cb.log('Sacred ground — blessed rest!', 'log-success');
      }
    }
    this.advanceTurn();
  }

  /** Reads a numeric tuning param off an ability, or `fallback` if absent/non-numeric. */
  private abilityNum(ability: import('./types').RangedAbility, key: string, fallback: number): number {
    const v = ability.params?.[key];
    return typeof v === 'number' ? v : fallback;
  }

  /** Reads a string tuning param off an ability, or `fallback` if absent/non-string. */
  private abilityStr(ability: import('./types').RangedAbility, key: string, fallback: string): string {
    const v = ability.params?.[key];
    return typeof v === 'string' ? v : fallback;
  }

  /** Casts the player's active ranged ability/spell, dispatched by `abilityType`. HP-pact spells pre-check a valid target before charging the cost. */
  public handleRangedAttack(): void {
    if (this.player.hp <= 0 || this.paused) return;
    const ability = this.player.rangedAbility;
    if (!ability) {
      this.cb.log('Your class has no ranged ability. (Q)', 'log-neutral');
      return;
    }
    if (this.player.isStunned) {
      this.cb.log('You are stunned!', 'log-damage');
      this.advanceTurn();
      return;
    }
    if (this.player.rangedCooldown > 0) {
      this.cb.log(`${ability.name} on cooldown (${this.player.rangedCooldown} turns).`, 'log-neutral', ability.emoji);
      return;
    }

    // HP-pact gate (An Draoi): spells are paid for in life, as a fraction of
    // Max HP. The cost bypasses damage reduction — a pact ignores armor — and
    // is deducted up front; the activation receives the amount paid so spell
    // power can scale off it (Max HP is both mana pool and spellpower).
    let hpPaid = 0;
    const hpCostPctRaw = ability.params?.['hpCostPct'];
    if (typeof hpCostPctRaw === 'number' && hpCostPctRaw > 0) {
      const cost = StatMath.pctOf(this.player.maxHp, hpCostPctRaw);
      if (this.player.hp <= cost) {
        this.cb.log(`The pact will not take your last breath. (${ability.name} costs ${cost} HP — you have ${Math.round(this.player.hp)})`, 'log-neutral', ability.emoji);
        return;
      }
      // Targeted spells need a target BEFORE the price is paid — a whiffed
      // cast shouldn't cost blood.
      if (ability.abilityType === 'drain' && !this.findRangedTarget(ability.range)) {
        this.cb.log(`No target in range (${ability.range} tiles).`, 'log-neutral', ability.emoji);
        return;
      }
      if (ability.abilityType === 'gravity_well') {
        const anyInRange = this.monsters.some(m =>
          Math.abs(m.x - this.player.x) + Math.abs(m.y - this.player.y) <= ability.range
          && (this.visibility[m.x]?.[m.y] ?? false));
        if (!anyInRange) {
          this.cb.log(`Nothing within reach of the tide (${ability.range} tiles).`, 'log-neutral', ability.emoji);
          return;
        }
      }
      this.player.hp -= cost;
      hpPaid = cost;
      this.damageTaken += cost;
      this.cb.onParticle(this.player.x, this.player.y, `-${cost}`, '#c1443c', 14);
      this.cb.onAudio?.('playerDamage');
    }

    switch (ability.abilityType) {
      case 'time_dilation': this.activateTimeDilation(ability); break;
      case 'gravity_well':  this.activateGravityWell(ability);  break;
      case 'consecrate':    this.activateConsecrate(ability);    break;
      case 'overload':      this.activateOverload(ability);      break;
      case 'shriek':        this.activateShriek(ability, hpPaid); break;
      case 'veil':          this.activateVeil(ability);           break;
      case 'drain':         this.activateDrain(ability, hpPaid);  break;
      case 'blight':        this.activateBlight(ability, hpPaid); break;
      case 'blink':         this.activateBlink(ability);          break;
      case 'spear_bolt':    this.activateSpearBolt(ability);      break;
      default:              this.activateBolt(ability);          break;
    }
  }

  // Badb's Shriek (the Morrígan): raining fire and mass terror — damage every
  // visible monster for a multiple of the HP paid; survivors may be stunned.
  private activateShriek(ability: import('./types').RangedAbility, hpPaid: number): void {
    const dmgMult = this.abilityNum(ability, 'dmgMult', 2);
    // dmgMult 0 = a pure-terror variant (Fog of Blood): stun-only, no damage
    const dmg = dmgMult > 0 ? Math.max(1, Math.round(hpPaid * dmgMult)) : 0;
    const stunChance = this.abilityNum(ability, 'stunChance', 0.35);
    const stunDuration = this.abilityNum(ability, 'stunDuration', 1);
    const targets = this.monsters.filter(m => this.visibility[m.x]?.[m.y]);
    for (const m of targets) {
      if (dmg > 0) {
        m.hp -= dmg;
        this.cb.onParticle(m.x, m.y, `-${dmg}`, '#c3272a', 16, 'fx_fire');
      }
      if (m.hp > 0 && !m.isStunned && Math.random() < stunChance) {
        m.statuses.push({ type: 'stun', duration: stunDuration, power: 0 });
        this.cb.onParticle(m.x, m.y, 'TERROR', '#b98fc4', 11);
      }
    }
    const killed = targets.filter(m => m.hp <= 0);
    this.monsters = this.monsters.filter(m => m.hp > 0);
    for (const m of killed) CombatSystem.killMonster(m, this);
    this.player.rangedCooldown = ability.cooldownMax;
    this.cb.log(
      dmg > 0
        ? `${ability.name.toUpperCase()}! ${targets.length} foe(s) seared for ${dmg} — the Morrígan takes her due.`
        : `${ability.name.toUpperCase()}! Terror grips ${targets.length} foe(s) — the Morrígan takes her due.`,
      'log-combo', ability.emoji,
    );
    this.cb.onRingPulse?.(this.player.x, this.player.y, '195,39,42');
    this.cb.onParticleBurst?.(this.player.x, this.player.y, 12, '#c3272a', 'fx_fire');
    this.cb.onAudio?.('bossWarn');
    this.advanceTurn();
  }

  // Blight of the Deep (Tethra): poison every visible monster; the venom's
  // power scales with the HP paid.
  private activateBlight(ability: import('./types').RangedAbility, hpPaid: number): void {
    const duration = this.abilityNum(ability, 'poisonDuration', 4);
    const power = Math.max(1, Math.round(hpPaid * this.abilityNum(ability, 'poisonPowerPct', 0.5)));
    const targets = this.monsters.filter(m => this.visibility[m.x]?.[m.y]);
    for (const m of targets) {
      m.statuses = m.statuses.filter(s => s.type !== 'poison');
      m.statuses.push({ type: 'poison', duration, power });
      this.cb.onParticle(m.x, m.y, 'BLIGHT', '#7cb342', 11, 'status_poison');
    }
    this.player.rangedCooldown = ability.cooldownMax;
    this.cb.log(`${ability.name}! ${targets.length} foe(s) wither — ${power} poison/turn for ${duration} turns.`, 'log-combo', ability.emoji);
    this.cb.onRingPulse?.(this.player.x, this.player.y, '124,179,66');
    this.cb.onAudio?.('poison');
    this.advanceTurn();
  }

  // Sea-Road (Manannán): step through the Otherworld to a random floor tile,
  // trailing a brief wisp of the Féth Fíada.
  private activateBlink(ability: import('./types').RangedAbility): void {
    const fromX = this.player.x, fromY = this.player.y;
    HazardSystem.teleportEntity(this.player, this);
    this.player.veiledTurns = Math.max(this.player.veiledTurns, this.abilityNum(ability, 'veilTurns', 2));
    this.player.rangedCooldown = ability.cooldownMax;
    this.cb.onParticle(fromX, fromY, '', '#9fe3c0', undefined, 'trap_smoke');
    this.cb.onParticle(this.player.x, this.player.y, '', '#9fe3c0', undefined, 'trap_teleport');
    this.cb.log(`${ability.name} — you step through the Otherworld and out again.`, 'log-perk', ability.emoji);
    this.cb.onAudio?.('teleport');
    this.updateVisibility();
    this.advanceTurn();
  }

  // Féth Fíada (Manannán mac Lir): the god-mist — monsters cannot see, chase,
  // or strike you while veiled. Bres alone sees through it.
  private activateVeil(ability: import('./types').RangedAbility): void {
    this.player.veiledTurns = this.abilityNum(ability, 'veilTurns', 6);
    this.player.rangedCooldown = ability.cooldownMax;
    this.cb.log(`The Féth Fíada rises — you fade from mortal sight for ${this.player.veiledTurns} turns.`, 'log-perk', ability.emoji);
    if (this.gorgothSummoned) this.cb.log('Bres laughs — a god-king sees through god-mist.', 'log-boss', 'sprite_boss_gorgoth');
    this.cb.onRingPulse?.(this.player.x, this.player.y, '63,158,147');
    this.cb.onParticleBurst?.(this.player.x, this.player.y, 8, '#9fe3c0', 'trap_smoke');
    this.cb.onAudio?.('teleport');
    this.advanceTurn();
  }

  // Tethra's Tithe: parasitic drain — a multiple of the HP paid as damage to
  // the nearest target, healing back a share; a kill refunds the entire cost.
  private activateDrain(ability: import('./types').RangedAbility, hpPaid: number): void {
    const target = this.findRangedTarget(ability.range);
    if (!target) {
      // Only reachable for a cost-free drain variant; paid casts pre-check the target.
      this.cb.log(`No target in range (${ability.range} tiles).`, 'log-neutral', ability.emoji);
      return;
    }
    let dmg = Math.max(1, Math.round(hpPaid * this.abilityNum(ability, 'dmgMult', 2)));
    const healPct = this.abilityNum(ability, 'healPct', 0);
    const refundOnKill = this.abilityNum(ability, 'refundOnKill', 0) > 0;
    // Tethra's Maw: a target already near death is devoured outright
    const executeBelowPct = this.abilityNum(ability, 'executeBelowPct', 0);
    const executed = executeBelowPct > 0 && target.hp <= target.maxHp * executeBelowPct;
    if (executed) dmg = target.hp;

    this.emitProjectileTrail(target.x, target.y, ability.emoji);
    target.hp -= dmg;
    this.cb.onParticle(target.x, target.y, executed ? 'DEVOURED' : `-${dmg}`, '#8d6fd4', 16, ability.emoji);
    this.cb.log(
      executed
        ? `${ability.name} DEVOURS ${target.name} whole!`
        : `${ability.name} rends ${target.name} for ${dmg}!`,
      'log-combo', ability.emoji,
    );

    if (healPct > 0) {
      const healed = this.player.heal(Math.round(dmg * healPct));
      if (healed > 0) this.cb.onParticle(this.player.x, this.player.y, `+${healed} HP`, '#69f0ae');
    }

    if (target.hp <= 0) {
      if (refundOnKill && hpPaid > 0) {
        const refunded = this.player.heal(hpPaid);
        if (refunded > 0) this.cb.log(`Tethra returns the tithe — +${refunded} HP.`, 'log-perk', ability.emoji);
      }
      const bx = target.x, by = target.y;
      CombatSystem.killMonster(target, this);
      if (target.isBoss && this.activeBossOnDeath) {
        this.activeBossOnDeath(this, bx, by);
        this.activeBossOnDeath = null;
      }
    }

    this.player.rangedCooldown = ability.cooldownMax;
    this.advanceTurn();
  }

  private activateBolt(ability: import('./types').RangedAbility): void {
    if (this.player.rangedAmmo === 0) {
      this.cb.log(`No ${ability.name}s left! (Replenish on next floor)`, 'log-neutral');
      return;
    }

    const target = this.findRangedTarget(ability.range);
    if (!target) {
      this.cb.log(`No target in range (${ability.range} tiles).`, 'log-neutral', ability.emoji);
      return;
    }

    this.emitProjectileTrail(target.x, target.y, ability.emoji);
    CombatSystem.playerAttackMonster(target, this, false, ability.damageMult);

    if (ability.statusEffect === 'stun' && target.hp > 0 && !target.isStunned) {
      target.statuses.push({ type: 'stun', duration: this.abilityNum(ability, 'stunDuration', 1), power: 0 });
      this.cb.log(`${target.name} is smited and stunned!`, 'log-success');
    }

    if (this.player.rangedAmmo > 0) this.player.rangedAmmo--;
    if (ability.cooldownMax > 0) this.player.rangedCooldown = ability.cooldownMax;

    if (target.hp <= 0) {
      const bx = target.x, by = target.y;
      CombatSystem.killMonster(target, this);
      if (target.isBoss && this.activeBossOnDeath) {
        this.activeBossOnDeath(this, bx, by);
        this.activeBossOnDeath = null;
      }
    }

    this.advanceTurn();
  }

  private activateTimeDilation(ability: import('./types').RangedAbility): void {
    const slowTurns = this.abilityNum(ability, 'slowTurns', 15);
    this.timeDilationTurns = slowTurns;
    this.timeDilationSlowPct = this.abilityNum(ability, 'slowPct', 100);
    this.player.rangedCooldown = ability.cooldownMax;
    this.cb.log(`Time Dilation! Gravity slowed for ${slowTurns} turns.`, 'log-perk', ability.emoji);
    this.cb.onParticle(this.player.x, this.player.y, 'SLOW!', '#b39ddb', 16, ability.emoji);
    this.cb.onRingPulse?.(this.player.x, this.player.y, '63,158,147');  // time ripples outward
    this.cb.onAction();  // immediately restart tick interval with new slow value
    this.advanceTurn();
  }

  private activateGravityWell(ability: import('./types').RangedAbility): void {
    const pullSteps = this.abilityNum(ability, 'pullSteps', 2);
    const stunDuration = this.abilityNum(ability, 'stunDuration', 1);
    const mdist = (m: Monster) => Math.abs(m.x - this.player.x) + Math.abs(m.y - this.player.y);
    const eligible = [...this.monsters]
      .filter(m => mdist(m) <= ability.range && (this.visibility[m.x]?.[m.y] ?? false))
      .sort((a, b) => mdist(a) - mdist(b));
    const moved = new Set<Monster>();
    for (let step = 0; step < pullSteps; step++) {
      for (const m of eligible) {
        const sx = Math.sign(this.player.x - m.x);
        const sy = Math.sign(this.player.y - m.y);
        for (const [dx, dy] of [[sx, 0], [0, sy]] as [number, number][]) {
          if (dx === 0 && dy === 0) continue;
          const nx = m.x + dx, ny = m.y + dy;
          if (this.map[nx]?.[ny] === Tile.FLOOR && !this.getMonsterAt(nx, ny)) {
            m.x = nx; m.y = ny; moved.add(m);
            this.cb.onParticle(nx, ny, '', '#7e57c2', undefined, 'trap_teleport');
            break;
          }
        }
      }
    }
    for (const m of moved) {
      if (!m.isStunned) m.statuses.push({ type: 'stun', duration: stunDuration, power: 0 });
    }
    this.player.rangedCooldown = ability.cooldownMax;
    this.cb.log(`Gravity Well! ${moved.size} monster(s) pulled & stunned.`, 'log-perk', 'trap_teleport');
    this.advanceTurn();
  }

  private activateConsecrate(ability: import('./types').RangedAbility): void {
    const radiusParam = ability.params?.['radius'];
    const r = typeof radiusParam === 'number' ? radiusParam : this.player.visionRadius;
    const tileType = this.abilityStr(ability, 'tileType', 'sacred') as SpecialTile['type'];
    let count = 0;
    for (let cx = 0; cx < GameConfig.COLS; cx++) {
      for (let cy = 0; cy < GameConfig.ROWS; cy++) {
        if (Math.hypot(cx - this.player.x, cy - this.player.y) > r) continue;
        if (this.map[cx]?.[cy] !== Tile.FLOOR) continue;
        if (this.specialTiles.some(t => t.x === cx && t.y === cy)) continue;
        this.specialTiles.push({ x: cx, y: cy, type: tileType });
        count++;
      }
    }
    this.player.rangedCooldown = ability.cooldownMax;
    this.cb.log(`Sacred Grounds! ${count} tiles consecrated.`, 'log-perk', 'special_sacred');
    this.cb.onParticle(this.player.x, this.player.y, 'HOLY', '#fff176', 18, 'special_sacred');
    this.cb.onRingPulse?.(this.player.x, this.player.y, '217,164,65');  // golden blessing wave
    this.cb.onParticleBurst?.(this.player.x, this.player.y, 10, '#ffd98a', 'special_sacred');
    this.advanceTurn();
  }

  private activateOverload(ability: import('./types').RangedAbility): void {
    const perKillDmg = this.abilityNum(ability, 'perKillDmg', 8);
    const perFloorMinDmg = this.abilityNum(ability, 'perFloorMinDmg', 5);
    const dmg = Math.max(this.dungeonLevel * perFloorMinDmg, perKillDmg * this.killsThisFloor);
    const targets = this.monsters.filter(m => this.visibility[m.x]?.[m.y]);
    for (const m of targets) {
      m.hp -= dmg;
      this.cb.onParticle(m.x, m.y, `-${dmg}`, '#ff6d00', 16, 'fx_impact');
    }
    const killed = targets.filter(m => m.hp <= 0);
    this.monsters = this.monsters.filter(m => m.hp > 0);
    for (const m of killed) CombatSystem.killMonster(m, this);
    this.cb.log(`Overload! ${targets.length} monsters hit for ${dmg} dmg (${this.killsThisFloor} kills × ${perKillDmg}, min floor×${perFloorMinDmg}).`, 'log-combo', 'fx_impact');
    this.cb.onParticle(this.player.x, this.player.y, 'BOOM!', '#ff6d00', 18, 'fx_impact');
    this.killsThisFloor = 0;
    this.player.rangedCooldown = ability.cooldownMax;
    this.advanceTurn();
  }

  // Spear of Lugh (Lugh's Spear questline, reforged by Goibniu): pierces
  // straight up the hero's own Tetris column, skewering every monster
  // standing on a built tile above them — a direct answer to a lane packed
  // with enemies, rather than another flat-damage nuke.
  private activateSpearBolt(ability: import('./types').RangedAbility): void {
    const dmg = Math.max(1, Math.round(this.player.atk * this.abilityNum(ability, 'dmgMult', 3)));
    const targets = this.monsters.filter(m => m.x === this.player.x && m.y < this.player.y);
    this.emitProjectileTrail(this.player.x, 0, ability.emoji);
    for (const m of targets) {
      m.hp -= dmg;
      this.cb.onParticle(m.x, m.y, `-${dmg}`, '#ffd54f', 16, 'fx_arcane');
    }
    const killed = targets.filter(m => m.hp <= 0);
    this.monsters = this.monsters.filter(m => m.hp > 0);
    for (const m of killed) CombatSystem.killMonster(m, this);
    this.cb.log(`${ability.name}! ${targets.length} foe(s) skewered for ${dmg} in the column above.`, 'log-combo', ability.emoji);
    this.cb.onParticleBurst?.(this.player.x, this.player.y, 10, '#ffd54f', 'fx_arcane');
    this.player.rangedCooldown = ability.cooldownMax;
    this.advanceTurn();
  }

  /** The nearest visible, line-of-sight monster within `range`, or `null`. */
  private findRangedTarget(range: number): import('./entities').Monster | null {
    const inRange = this.monsters.filter(m => {
      const dist = Math.abs(m.x - this.player.x) + Math.abs(m.y - this.player.y);
      return dist <= range
        && (this.visibility[m.x]?.[m.y] ?? false)
        && MonsterAiSystem.hasLineOfSight(this.player.x, this.player.y, m.x, m.y, this);
    });
    inRange.sort((a, b) => {
      const da = Math.abs(a.x - this.player.x) + Math.abs(a.y - this.player.y);
      const db = Math.abs(b.x - this.player.x) + Math.abs(b.y - this.player.y);
      return da - db;
    });
    return inRange[0] ?? null;
  }

  /** Emits a dotted particle trail from the player to `(tx, ty)`, for ranged-attack visual feedback. */
  private emitProjectileTrail(tx: number, ty: number, icon: string): void {
    // Bresenham path from player to target, emit a dot particle at each step
    let x = this.player.x, y = this.player.y;
    const dx = Math.abs(tx - x), dy = Math.abs(ty - y);
    const sx = x < tx ? 1 : -1, sy = y < ty ? 1 : -1;
    let err = dx - dy;
    while (!(x === tx && y === ty)) {
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x += sx; }
      if (e2 < dx)  { err += dx; y += sy; }
      if (x !== tx || y !== ty) this.cb.onParticle(x, y, '·', '#ffcc02');
    }
    this.cb.onParticle(tx, ty, '', '#ffcc02', undefined, icon);
  }

  /** Holds the current piece for later (swapping with any already-held piece), once per lock. */
  public handleBlockHold(): void {
    if (this.player.hp <= 0 || this.paused || this.tetrisSuspended) return;
    if (!this.canHold) {
      this.cb.log('Already held this piece — lock it first.', 'log-neutral');
      return;
    }
    if (this.heldType === null) {
      this.heldType = this.currentType;
      this.spawnBlock();
    } else {
      const swapType = this.heldType;
      this.heldType = this.currentType;
      this.setBlockType(swapType);
    }
    this.canHold = false;
    this.cb.onAudio?.('blockMove');
    this.pushUI();
    this.cb.onAction();
  }

  /** Force-swaps the falling piece to `type` (used by hold-swap). */
  private setBlockType(type: ShapeKey): void {
    this.currentType = type;
    const shape = SHAPES[type];
    this.blockColor = shape.color;
    const { cursed, blessed } = this.rollPieceCurseState(Math.random());
    this.currentCursed  = cursed;
    this.currentBlessed = blessed;
    this.blockMatrix = shape.matrix.map(row =>
      row.map((cell): CellValue => cell === 0 ? Cell.EMPTY : Cell.FLOOR)
    );
    this.blockX = Math.floor((GameConfig.COLS - this.blockMatrix[0]!.length) / 2);
    this.blockY = 0;
    if (this.checkBlockCollision(this.blockX, this.blockY, this.blockMatrix)) {
      this.summonGorgoth();
    }
  }

  // ── Endgame: Gorgoth the Returned ─────────────────────────────────────────

  /** Overflowing the stack summons the final boss into a cleared arena. */
  public summonGorgoth(): void {
    if (this.gorgothSummoned) return;
    this.gorgothSummoned = true;
    this.storyBeats.push('called Bres the Beautiful forth to battle');

    // The board the player built stays exactly as it is — no arena reset; only
    // the tetromino supply stops.
    this.blockMatrix = [];
    this.heldType = null;

    // The causeway is complete — there's no more "descend and try again
    // later." Every remaining stairs tile becomes plain floor, beaming away
    // like any other departing tile-feature (NPCs, altars, the tattoo artist).
    for (let x = 0; x < GameConfig.COLS; x++) {
      for (let y = 0; y < GameConfig.ROWS; y++) {
        if (this.map[x]![y] === Tile.STAIRS) {
          this.map[x]![y] = Tile.FLOOR;
          this.colors[x]![y] = this.blockColor;
          this.cb.onBeam?.(x, '109,63,122');
        }
      }
    }

    // Gorgoth looms in at the very top-centre and grinds his way down to the
    // hero — slow, unstoppable, phasing through the stack. Fixed, brutal stats
    // so descending floors only ever helps you.
    const gx = Math.floor(GameConfig.COLS / 2);
    const boss = new Monster(gx, 0, 'sprite_boss_gorgoth', 'Bres the Beautiful', Balance.CONFIG.gorgoth.maxHp, Balance.CONFIG.gorgoth.maxHp, Balance.CONFIG.gorgoth.atk, Balance.CONFIG.gorgoth.xpReward, true, 'gorgoth', 1, 1);
    boss.combatLevel = Balance.CONFIG.gorgoth.combatLevel;  // D20 — even a maxed hero misses ~half the time
    boss.isGorgoth = true;
    this.monsters.push(boss);

    // Fomorian escort — an invasion party at his side, scaled the same as any
    // other floor monster (not buffed to match Bres) so it reads as a raiding
    // party, not a second boss.
    let escorts = 0;
    for (const [dx, dy] of [[-2, 0], [-1, 0], [1, 0], [2, 0]] as Array<[number, number]>) {
      if (escorts >= 3) break;
      const ex = gx + dx, ey = 0 + dy;
      if (ex >= 0 && ex < GameConfig.COLS && ey >= 0 && ey < GameConfig.ROWS && this.isValidMove(ex, ey) && !this.getMonsterAt(ex, ey)) {
        this.spawnMonster(this.getRandomMonsterKey(), ex, ey);
        escorts++;
      }
    }
    if (escorts > 0) this.cb.log('Fomorian raiders pour across the finished causeway behind him!', 'log-boss', 'sprite_boss_gorgoth');

    // Half-HP: roar and raise two of the Returned beside him — but only the
    // first time he crosses the threshold this run (persists across summons).
    this.activeBossOnHalfHp = (g) => {
      g.gorgothHalfTriggered = true;
      g.cb.log('BRES ROARS — his Fomorian kin claw their way up!', 'log-boss', 'sprite_boss_gorgoth');
      for (const [dx, dy] of [[-1, 0], [1, 0]] as Array<[number, number]>) {
        const ax = boss.x + dx, ay = boss.y + dy;
        if (ax >= 0 && ax < GameConfig.COLS && ay >= 0 && ay < GameConfig.ROWS && g.isValidMove(ax, ay) && !g.getMonsterAt(ax, ay)) {
          g.spawnMonster(g.getRandomMonsterKey(), ax, ay);
        }
      }
    };
    this.activeBossOnDeath = null;  // victory is fired from killMonster (covers every death path)
    this.bossHalfHpTriggered = this.gorgothHalfTriggered;

    // Reveal the whole arena — no fog for the finale.
    for (let x = 0; x < GameConfig.COLS; x++) {
      for (let y = 0; y < GameConfig.ROWS; y++) {
        this.visibility[x]![y] = true;
        this.explored[x]![y] = true;
      }
    }

    this.cb.log('The causeway is complete! Bres the Beautiful now leads the charge to invade the Emerald Isle...', 'log-boss', 'ui_warning');
    this.cb.onParticle(gx, 0, 'BRES', '#ff1744', 18, 'sprite_boss_gorgoth');
    this.cb.onCodexDiscover?.('boss', 'gorgoth');

    this.paused = true;
    this.cb.onBossWarning?.(
      { char: 'sprite_boss_gorgoth', name: 'Bres the Beautiful', hpMult: 1, atkMult: 1, xpReward: Balance.CONFIG.gorgoth.xpReward, flavorText: 'The bridge home is finished — and he means to be first across it.' },
      () => { this.paused = false; },
    );
    this.pushUI();
  }

  /** Gorgoth defeated — the run is won. Idempotent. */
  public triggerVictory(): void {
    if (this.won) return;
    this.won = true;
    this.cb.log('BRES THE BEAUTIFUL FALLS — the bridge collapses, the rift is sealed. You win!', 'log-boss', 'item_trophy');
    this.cb.onParticle(this.player.x, this.player.y, 'VICTORY', '#ffd54f', 20, 'item_trophy');
    this.cb.onVictory?.(this.dungeonLevel, this.player.totalXpEarned, this.getRunStats(), this.buildRunStory('victory'));
  }

  /** Shifts the falling piece one column left, if unobstructed. */
  public handleBlockLeft(): void {
    if (this.player.hp <= 0 || this.paused || this.tetrisSuspended) return;
    if (!this.checkBlockCollision(this.blockX - 1, this.blockY, this.blockMatrix)) { this.blockX--; this.cb.onAudio?.('blockMove'); this.advanceTurn(); }
  }

  /** Shifts the falling piece one column right, if unobstructed. */
  public handleBlockRight(): void {
    if (this.player.hp <= 0 || this.paused || this.tetrisSuspended) return;
    if (!this.checkBlockCollision(this.blockX + 1, this.blockY, this.blockMatrix)) { this.blockX++; this.cb.onAudio?.('blockMove'); this.advanceTurn(); }
  }

  /** Rotates the falling piece 90°, if the rotated shape doesn't collide. */
  public handleBlockRotate(): void {
    if (this.player.hp <= 0 || this.paused || this.tetrisSuspended) return;
    const rotated = GameMath.rotateMatrix(this.blockMatrix);
    if (!this.checkBlockCollision(this.blockX, this.blockY, rotated)) { this.blockMatrix = rotated; this.cb.onAudio?.('blockRotate'); this.advanceTurn(); }
  }

  /** Drops the falling piece one row, locking it in place if it can't descend further. */
  public handleBlockSoftDrop(): void {
    if (this.player.hp <= 0 || this.paused || this.tetrisSuspended) return;
    if (!this.checkBlockCollision(this.blockX, this.blockY + 1, this.blockMatrix)) { this.blockY++; this.advanceTurn(); }
    else { this.lockBlock(); this.advanceTurn(); }
  }

  /** Instantly drops the falling piece to the floor and locks it, with an afterimage trail along its travel path. */
  public handleBlockDrop(): void {
    if (this.player.hp <= 0 || this.paused || this.tetrisSuspended) return;
    const startY = this.blockY;
    while (!this.checkBlockCollision(this.blockX, this.blockY + 1, this.blockMatrix)) this.blockY++;
    // Afterimage streaks along the travel path — one per occupied column,
    // from that column's topmost filled cell at launch to its final cell.
    if (this.blockY > startY && this.cb.onHardDrop) {
      const cols = new Map<number, { top: number; bottom: number }>();
      for (let r = 0; r < this.blockMatrix.length; r++) {
        for (let c = 0; c < this.blockMatrix[r]!.length; c++) {
          if (this.blockMatrix[r]![c] === Cell.EMPTY) continue;
          const e = cols.get(c);
          if (e) { e.top = Math.min(e.top, r); e.bottom = Math.max(e.bottom, r); }
          else cols.set(c, { top: r, bottom: r });
        }
      }
      const trails = Array.from(cols.entries()).map(([c, e]) => ({
        x: this.blockX + c,
        fromY: startY + e.top,
        toY: this.blockY + e.bottom,
      }));
      this.cb.onHardDrop(trails, this.blockColor);
    }
    this.lockBlock();
    this.advanceTurn();
  }

  // ── Lookups ──────────────────────────────────────────────────────────────

  /** The monster standing at `(x, y)`, if any. */
  public getMonsterAt(x: number, y: number): Monster | undefined {
    return this.monsters.find(m => m.x === x && m.y === y);
  }

  // ── Tap-to-inspect ───────────────────────────────────────────────────────

  /**
   * Builds the inspect-tooltip content for whatever occupies `(x, y)` —
   * the hero, a monster, a hazard, or a floor feature.
   * @throws {TypeError} If `x` or `y` is not a finite number.
   */
  public getInspectInfo(x: number, y: number): InspectInfo | null {
    if (typeof x !== 'number' || !Number.isFinite(x)) throw new TypeError('Game.getInspectInfo: "x" must be a finite number');
    if (typeof y !== 'number' || !Number.isFinite(y)) throw new TypeError('Game.getInspectInfo: "y" must be a finite number');
    if (x < 0 || x >= GameConfig.COLS || y < 0 || y >= GameConfig.ROWS) return null;

    if (this.player.x === x && this.player.y === y) {
      const lines = [
        `HP ${Math.round(this.player.hp)}/${Math.round(this.player.maxHp)}`,
        `ATK ${Math.round(this.player.totalAtk)}  DEF ${this.player.totalDef}`,
        `Lv.${this.player.playerLevel}`,
      ];
      if (this.player.boons.length > 0) lines.push(`Geasa: ${this.player.boons.map(b => `${SpriteService.iconHTML(b.def.char, 12)}×${b.stacks}`).join(' ')}`);
      return { icon: this.player.char, title: 'You', lines };
    }

    const monster = this.getMonsterAt(x, y);
    if (monster) {
      const hitPct = Math.round(CombatSystem.estimateHitChance(this.player.combatLevel, monster.combatLevel) * 100);
      const lines = [
        `HP ${Math.max(0, monster.hp)}/${monster.maxHp}`,
        `ATK ${monster.atk}`,
        `Your hit chance: ${hitPct}%`,
        `Type: ${monster.behaviorType}`,
      ];
      if (monster.statuses.length > 0) lines.push(`Status: ${monster.statuses.map(s => s.type).join(', ')}`);
      return { icon: monster.char, title: monster.name, lines };
    }

    const hazard = this.getHazardAt(x, y);
    if (hazard) {
      if (hazard.type === 'spike') {
        const line = hazard.warning ? `Firing in ${hazard.timer}!` : `Arms in ${hazard.timer} turns`;
        return { icon: 'trap_spike', title: 'Spike Trap', lines: [line] };
      }
      if (hazard.type === 'smoke') {
        return { icon: 'trap_smoke', title: 'Smoke Cloud', lines: ['Limits vision while standing inside'] };
      }
      if (hazard.type === 'teleport') {
        return { icon: 'trap_teleport', title: 'Teleport Rune', lines: ['Warps whoever steps on it to a random floor tile'] };
      }
    }

    if (this.map[x]![y] === Tile.STAIRS) {
      return { icon: 'tile_stairs', title: 'Stairs', lines: ['Descend to the next floor'] };
    }

    if (this.isTattooTile(x, y)) {
      return this.player.brandsCapped
        ? { icon: 'tile_merchant', title: 'Occult Tattoo Artist', lines: ['No room left — you already bear 5 Ogham Marks'] }
        : { icon: 'tile_merchant', title: 'Occult Tattoo Artist', lines: ['Receive a permanent Ogham Mark'] };
    }

    const altarInfo = this.altarTiles.find(a => a.x === x && a.y === y);
    if (altarInfo) {
      const tierName = altarInfo.tier === 3 ? 'Grand Altar (Tier III)' : altarInfo.tier === 2 ? 'Ruined Altar (Tier II)' : 'Minor Altar (Tier I)';
      return { icon: 'tile_altar', title: tierName, lines: ['Step on to choose a stackable geis'] };
    }

    const npcInfo = this.npcTiles.find(n => n.x === x && n.y === y);
    if (npcInfo) {
      return npcInfo.npcId === '__ghost__'
        ? { icon: 'sprite_boss_wraith', title: 'A Restless Ghost', lines: ['A fallen wanderer... something about them is familiar'] }
        : { icon: 'npc_sidhe', title: 'A Wandering Stranger', lines: ['Step closer to speak with them'] };
    }

    const special = this.specialTiles.find(t => t.x === x && t.y === y);
    if (special) {
      if (special.type === 'swamp')  return { icon: 'special_swamp',  title: 'Swamp',         lines: ['Deals 1 dmg/turn to monsters'] };
      if (special.type === 'sacred') return { icon: 'special_sacred', title: 'Sacred Ground', lines: ['Wait here for +2 bonus HP per rest'] };
      if (special.type === 'ice')    return { icon: 'special_ice',    title: 'Ice',           lines: ['Slide uncontrollably in direction of travel'] };
    }

    return null;
  }

  // ── Character sheet ─────────────────────────────────────────────────────
  // Aggregates every effective stat currently on the player — base numbers
  // plus whatever boons/brands/shop purchases have folded into them — into a
  // display-ready snapshot. Boons/brands/shop purchases all mutate the same
  // Player fields directly, so reading Player state IS reading the totals.

  /** Aggregates every effective player stat into a display-ready character-sheet snapshot. */
  private buildCharacterSheet(): CharacterSheetSection[] {
    const p = this.player;
    const pct = (frac: number): string => `${Math.round(frac * 100)}%`;
    return [
      {
        title: 'Offense', icon: 'sprite_equip_iron_sword',
        stats: [
          { label: 'Attack', value: String(Math.round(p.atk)) },
          { label: 'Combat Dice', value: `D${CombatSystem.dieSides(p.combatLevel)}` },
          { label: 'Line-Clear Damage', value: p.lineClearDamage > 0 ? `+${pct(p.lineClearDamage)} ATK` : '—' },
          { label: 'Line-Clear AoE', value: p.lineClearAoeDmgMult > 0 ? `${p.lineClearAoeDmgMult}× floor dmg, all enemies` : '—' },
          { label: 'Kill ATK Bonus', value: p.killAtkBonus > 0 ? `+${pct(p.killAtkBonus)} ATK/kill (this floor)` : '—' },
          { label: 'Thorn Reflect', value: p.thornDamage > 0 ? pct(p.thornDamage) : '—' },
          { label: 'Poison on Hit', value: p.poisonAttackChance > 0 ? pct(p.poisonAttackChance) : '—' },
          { label: 'Stun on Hit', value: p.stunAttackChance > 0 ? pct(p.stunAttackChance) : '—' },
          { label: 'Guaranteed Crit', value: p.critEvery > 0 ? `every ${p.critEvery}${p.critEvery === 1 ? 'st' : 'th'} hit` : '—' },
        ],
      },
      {
        title: 'Defense', icon: 'sprite_equip_buckler',
        stats: [
          { label: 'Max HP', value: String(Math.round(p.maxHp)) },
          { label: 'Damage Reduction', value: p.damageReduction > 0 ? `${pct(p.damageReduction)} (−${p.totalDef} dmg/hit)` : '—' },
          { label: 'Dodge Chance', value: p.dodgeChance > 0 ? pct(p.dodgeChance) : '—' },
          { label: 'Dodge Heal', value: p.dodgeHeal > 0 ? `${pct(p.dodgeHeal)} Max HP` : '—' },
          { label: 'Poison Immune', value: p.poisonImmune ? 'Yes' : '—' },
          { label: 'Deathward Charges', value: p.deathwardCharges > 0 ? String(p.deathwardCharges) : '—' },
          { label: 'Ghost Dodge Charges', value: p.ghostDodgeCharges > 0 ? String(p.ghostDodgeCharges) : '—' },
          { label: 'Life Brand Revive', value: p.lifeBrandRevive ? 'Armed' : '—' },
        ],
      },
      {
        title: 'Sustain', icon: 'item_droplet',
        stats: [
          { label: 'Regen / Tick', value: p.regenPerTick > 0 ? `${pct(p.regenPerTick)} Max HP` : '—' },
          { label: 'Heal on Kill', value: p.killHeal > 0 ? `${pct(p.killHeal)} Max HP` : '—' },
        ],
      },
      {
        title: 'Utility', icon: 'fx_arcane',
        stats: [
          { label: 'Vision Radius', value: String(p.visionRadius) },
          { label: 'Gravity Slow', value: p.tickSlowPercent !== 0 ? `${p.tickSlowPercent > 0 ? '+' : ''}${p.tickSlowPercent}%` : '—' },
          { label: 'Status Fades Faster', value: p.statusDurationBonus > 0 ? `−${p.statusDurationBonus} turn(s)` : '—' },
          { label: 'Aura Stun Radius', value: p.auraStunRadius > 0 ? `${p.auraStunRadius} tile(s)` : '—' },
          { label: 'Bonus Hero Moves', value: p.bonusHeroMoves > 0 ? `+${p.bonusHeroMoves}/turn` : '—' },
          { label: 'Line-Clear XP', value: p.lineClearXpMult !== 1 ? `×${p.lineClearXpMult}` : '—' },
          { label: 'Sworn Patron', value: PATRONS.find(pt => pt.id === this.activePatronId)?.deity ?? '—' },
          {
            label: 'Spells Known',
            value: p.spellbook.length > 0 ? p.spellbook.map(s => s.name).join(', ') : '—',
          },
          {
            label: 'Active Spell Cost',
            value: typeof p.rangedAbility?.params?.['hpCostPct'] === 'number'
              ? `${Math.round((p.rangedAbility.params['hpCostPct'] as number) * 100)}% Max HP (${StatMath.pctOf(p.maxHp, p.rangedAbility.params['hpCostPct'] as number)} HP)`
              : '—',
          },
        ],
      },
    ];
  }

  // ── UI push ──────────────────────────────────────────────────────────────

  /** Pushes a fresh {@link UIState} snapshot to the host UI via `cb.updateUI`. */
  private pushUI(): void {
    const activeMod = MODIFIERS.find(m => m.id === this.activeModifierId);
    const activeCls = CLASSES.find(c => c.id === this.activeClassId);
    const activePatron = PATRONS.find(p => p.id === this.activePatronId);
    const biome = Biome.forFloor(this.dungeonLevel);
    this.cb.updateUI({
      // atk/maxHp/hp can carry fractional precision internally (percentage
      // boons compound on them) — round only here, at the display boundary.
      hp: Math.round(this.player.hp),
      maxHp: Math.round(this.player.maxHp),
      floor: this.dungeonLevel,
      totalXpEarned: this.player.totalXpEarned,
      gold: this.gold,
      gravityRate: GameMath.tickMsForLevel(this.dungeonLevel, this.player.tickSlowPercent + this.biomeGravityPct + this.omenGravityPct),
      nextType: this.nextType,
      heldType: this.heldType,
      canHold: this.canHold,
      pieceState: this.currentCursed ? 'cursed' : this.currentBlessed ? 'blessed' : 'normal',
      xp: this.player.xp,
      xpToNext: this.player.xpToNext,
      playerLevel: this.player.playerLevel,
      boons: this.player.boons.map(b => ({ char: b.def.char, name: b.def.name, stacks: b.stacks, desc: b.def.desc })),
      brands: this.player.brands.map(b => {
        const count = this.player.brands.filter(x => x.brand.id === b.brand.id).length;
        return {
          slot: b.slot, char: b.brand.char, name: b.brand.name,
          setActive: count >= b.brand.setSize,
          desc: b.brand.desc, setDesc: b.brand.setDesc, setSize: b.brand.setSize,
        };
      }),
      brandsAcquiredTotal: this.player.brandsAcquiredTotal,
      brandsMaxLifetime: Balance.CONFIG.brands.maxLifetime,
      statuses: this.player.statuses,
      activeModifier: activeMod ? { emoji: activeMod.emoji, name: activeMod.name } : null,
      activeClass: activeCls
        ? {
            emoji: activePatron?.char ?? activeCls.emoji,
            name: activePatron ? `${activeCls.name} — ${activePatron.name}` : activeCls.name,
          }
        : null,
      biomeName: biome.name,
      activeOmen: this.activeOmen ? { icon: this.activeOmen.icon, name: this.activeOmen.name } : null,
      rangedAbility: this.player.rangedAbility
        ? {
            name:        this.player.rangedAbility.name,
            emoji:       this.player.rangedAbility.emoji,
            cooldown:    this.player.rangedCooldown,
            cooldownMax: this.player.rangedAbility.cooldownMax,
            ammo:        this.player.rangedAmmo >= 0 ? this.player.rangedAmmo : null,
            hpCostPct:   typeof this.player.rangedAbility.params?.['hpCostPct'] === 'number'
              ? this.player.rangedAbility.params['hpCostPct'] as number
              : null,
            spellIndex:  this.player.activeSpellIndex,
            spellCount:  this.player.spellbook.length,
          }
        : null,
      characterSheet: this.buildCharacterSheet(),
      floorProgress: {
        pieces: this.blocksSpawnedThisFloor,
        smithTarget: this.pendingSmithFloor ? Balance.CONFIG.smiths.pieceThreshold : null,
        fillPct: Math.round(this.filledFraction() * 100),
        bossFillTarget: this.pendingBossFloor ? Math.round(Game.BOSS_FILL_FRACTION * 100) : null,
        stairsPity: this.stairsOnBoard()
          ? null
          : { placed: this.blocksPlacedSinceStairs, target: Balance.CONFIG.spawnRates.stairsForcedAfterBlocks },
      },
    });
  }
}
