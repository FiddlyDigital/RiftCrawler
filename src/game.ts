import { GameConfig, SHAPES, type ShapeKey } from './config';
import { Tile, Cell, type TileValue, type CellValue, type GameCallbacks, type HazardTile, type SpecialTile, type RunStats, type ModifierDef, type InspectInfo, type AltarTile, type NpcTile, type FloorEventDef, type BossDef, type GhostRecord, type SavedRun, type UIState } from './types';
import { Player, Monster, StatMath } from './entities';
import { MONSTERS, BOSSES, Boon, CLASSES, Biome, FloorEvent, Npc, NPCS, Smith, SMITHS, RESCUES, Omen, type ClassDef } from './content';
import { Fidchell } from './fidchell';
import { GameMath } from './gameMath';
import { AbilitySystem } from './systems/abilities';
import { InspectView } from './views/inspect';
import { CharacterSheetView } from './views/charSheet';
import { UiStateBuilder } from './views/uiState';
import { PactCeremony } from './pact';
import { NpcEncounters } from './npcEncounters';
import { SmithQuest } from './smithQuest';
import { Spawner } from './spawning';
import { RunSetup } from './runSetup';
import { SaveGame } from './saveGame';
import { VendorOffers } from './vendorOffers';
import { BossEncounters } from './bossEncounters';
import { CausewayDuel } from './causewayDuel';
import { Waystation } from './waystation';
import { StatusEffectSystem } from './systems/statusEffects';
import { HazardSystem } from './systems/hazards';
import { CombatSystem } from './systems/combat';
import { MonsterAiSystem } from './systems/monsterAI';
import { Balance, type DifficultyPreset } from './balance';
import { Colors } from './colors';
import { StorageService } from './storage';

const TRAP_CELL: Record<'spike' | 'smoke' | 'teleport', CellValue> = {
  spike: Cell.TRAP_SPIKE, smoke: Cell.TRAP_SMOKE, teleport: Cell.TRAP_TELEPORT,
};


// ── Pure helpers ────────────────────────────────────────────────────────────

// GameMath moved to ./gameMath (so feature modules like the Causeway Duel can
// use it without a circular import); re-exported here for existing importers.
export { GameMath } from './gameMath';

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

  // Difficulty state (chosen at run start, active for the whole run)
  public activeDifficultyId = 'standard';

  /** New Game+ heat: how many victory-unlocked geasa (cumulative handicaps) this run carries. 0 = a normal run. */
  public heatLevel = 0;

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

  /** The mound chamber layout (owned by {@link Waystation}); aliased here so tests target positions by name. */
  public static readonly MOUND = Waystation.MOUND;
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
  public rescueGuards: Monster[] = [];  // public: read/written by SaveGame
  /** ATK granted by Bricriu's Champion's Portion, reverted on the next descent. */
  public portionAtkBonus = 0;  // public: read/written by VendorOffers (Bricriu) and descent revert

  /** While the first-run tutorial is teaching, natural enemy spawns are suppressed — the tutorial introduces its own single practice foe (see spawnTutorialFoe). */
  public tutorialSafety = false;

  /** The floor Abcán's sleep-strain was played for — every monster spawning on that floor arrives stunned for 2 turns. */
  public harperLullFloor = 0;

  /** Whether An Draoi's deity pact is still unsworn — the emissary waits in the mound until it is. */
  public get pactPending(): boolean {
    return this.activeClassId === 'draoi' && this.activePatronId === null && this.dungeonLevel >= 2;
  }

  /** Whether the BlockBuilding layer is currently frozen (the Gorgoth duel, a waystation rest floor, or a Causeway Duel — which runs its own placement layer). */
  public get blockBuildingSuspended(): boolean { return this.gorgothSummoned || this.inWaystation || this.inCausewayDuel || this.inFidchell; }

  // ── Causeway Duel (boss-floor play state) ────────────────────────────────
  // A no-gravity, turn-based duel on the shared grid: the player grows a
  // causeway up from the home row while the boss grows one down; climb yours
  // to kill the boss (the duel then ends), or lose if the boss's causeway
  // reaches your home row. Self-contained in its own module (see
  // src/causewayDuel.ts); Game holds the instance and delegates.
  /** Whether a Causeway Duel is currently in progress (proxies the duel module's `active`). */
  public get inCausewayDuel(): boolean { return this.causewayDuel.active; }
  public set inCausewayDuel(v: boolean) { this.causewayDuel.active = v; }

  // ── Fidchell ("the wooden wisdom") — a brandub/tafl board challenge ────────
  // Every 7th floor a Fomorian gambler bars the crossing and sets the board.
  // Self-contained in its own module (see src/fidchell.ts); Game just holds the
  // instance and delegates entry, input, the HUD payload, and save/resume.
  public readonly fidchell: Fidchell = new Fidchell(this);
  public readonly causewayDuel: CausewayDuel = new CausewayDuel(this);
  private readonly waystation: Waystation = new Waystation(this);
  private readonly inspectView: InspectView = new InspectView(this);
  public readonly characterSheetView: CharacterSheetView = new CharacterSheetView(this);
  private readonly uiStateBuilder: UiStateBuilder = new UiStateBuilder(this);
  public readonly pact: PactCeremony = new PactCeremony(this);
  public readonly npcEncounters: NpcEncounters = new NpcEncounters(this);
  public readonly smithQuest: SmithQuest = new SmithQuest(this);
  private readonly spawner: Spawner = new Spawner(this);
  private readonly runSetup: RunSetup = new RunSetup(this);
  private readonly saveGame: SaveGame = new SaveGame(this);
  public readonly vendorOffers: VendorOffers = new VendorOffers(this);
  private readonly bossEncounters: BossEncounters = new BossEncounters(this);
  /** Whether a Fidchell match is currently in progress. */
  public get inFidchell(): boolean { return this.fidchell.active; }
  /** Read-only board views for the renderer. */
  public get fidchellBoard(): ReadonlyArray<ReadonlyArray<number>> { return this.fidchell.board; }
  public get fidchellOrigin(): { x: number; y: number } { return this.fidchell.origin; }
  public get fidchellSelected(): { x: number; y: number } | null { return this.fidchell.selected; }
  public get fidchellLegal(): ReadonlyArray<{ x: number; y: number }> { return this.fidchell.legal; }
  public get fidchellPlayerSide(): 'king' | 'raider' { return this.fidchell.playerSide; }
  /** Starts a Fidchell match (delegates to the module). */
  public startFidchell(): void { this.fidchell.start(); }
  /** Routes a board tap to the match (delegates to the module). */
  public handleFidchellTap(gx: number, gy: number): void { this.fidchell.handleTap(gx, gy); }

  // Bealtaine Fires ritual state (the 'bealtaine' special omen)
  /** Braziers standing on the floor this level — walk into an unlit one to light it. */
  public brazierTiles: { x: number; y: number; lit: boolean }[] = [];
  /** Need-fires lit this floor — banked progress, kept even if a lit brazier's row later clears. */
  public brazierLitCount = 0;
  /** Set once the ritual reward has been granted, stopping further brazier riders. */
  public ritualComplete = false;  // public: reset by Waystation.enter

  // Run stats
  public monstersKilled = 0;
  public bossesKilled = 0;
  public linesCleared = 0;
  public biggestCombo = 0;
  public damageTaken = 0;

  // Internal counters
  private floorsDescended = 0;
  private blocksPlacedSinceStairs = 0;
  public pendingBossFloor = false;  // public: set by BossEncounters.announceFloor
  /** Whole-board fill fraction a pending boss waits for before riding in (see spawnBlock); also drives the HUD dial's boss marker. */
  private static readonly BOSS_FILL_FRACTION = 0.5;
  /** Set on a smith-eligible floor entry; the smith rider doesn't inject until {@link blocksSpawnedThisFloor} passes the configured threshold. */
  public pendingSmithFloor = false;
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
  /** Set by the run's first real 4-line clear: An Dagda takes notice and waits in the mound with a gift. */
  public dagdaGiftEarned = false;
  /** Set once his tier-3 Geis has been accepted — he departs for the rest of the run. */
  public dagdaGiftClaimed = false;
  public comboCount = 0;
  public lastLineClearMs = 0;  // public: reset by SaveGame on restore
  public tattooTiles: Array<{ x: number; y: number }> = [];
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
  public activeGhost: GhostRecord | null = null;
  private ghostPlaced = false;

  /** Notable moments this run — feeds the death/victory screen's short "tale of the run" recap. */
  public storyBeats: string[] = [];
  /** Flavor-kind NPC ids already met this run, so a repeat encounter shows its return line instead of a fresh random line. */
  public metFlavorNpcIds = new Set<string>();
  /** Whether the run's first elite kill has already pushed a story beat (elites can be felled many times a run — only the first is notable). */
  public firstEliteFelled = false;
  /** Whether the run's first sub-15%-HP survival has already pushed a "close call" story beat. */
  private hadCloseCall = false;

  // Active boss mechanics (set at spawn, cleared on floor reset).
  // Public: reattached by SaveGame around the restored boss instance.
  public activeBossOnHalfHp: ((game: Game) => void) | null = null;
  public activeBossOnDeath:   ((game: Game, x: number, y: number) => void) | null = null;
  public bossHalfHpTriggered = false;

  /**
   * Endgame: overflowing the stack summons Gorgoth the Returned. While
   * summoned, no tetrominoes fall — the run becomes a boss duel. Killing
   * him wins.
   */
  public gorgothSummoned = false;
  public won = false;
  /** One-time nudge toward the win condition. Public: owned by BossEncounters. */
  public gorgothHintShown = false;
  public gorgothHalfTriggered = false;

  public readonly cb: GameCallbacks;

  /**
   * Starts a fresh run: builds an empty floor, places the hero on the
   * starting platform, and spawns the first falling piece.
   *
   * With `opts.forRestore`, stops after allocating the grids/entities —
   * no starting platform, first piece, log lines, or stash inheritance —
   * leaving a blank shell for {@link applySave} to fill in.
   * @throws {TypeError} If `callbacks` is null/undefined.
   */
  constructor(callbacks: GameCallbacks, opts?: { forRestore?: boolean }) {
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
    if (opts?.forRestore) return;
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
    this.cb.log(`${startBiome.name} — ${startBiome.desc}`, 'log-blockbuilding', startIcon);
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
  public emptyMap(): TileValue[][] {
    return Array.from({ length: GameConfig.COLS }, () => Array<TileValue>(GameConfig.ROWS).fill(Tile.VOID));
  }

  /** A fresh all-null tile-color grid. */
  public emptyColors(): (string | null)[][] {
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
  /** Weighted spawn table for the falling pieces, straight from shapes.json — classics dominate; custom shapes (Q, H) are rare visitors. */
  private static readonly SHAPE_WEIGHTS: Record<ShapeKey, number> =
    Object.fromEntries((Object.keys(SHAPES) as ShapeKey[]).map(k => [k, SHAPES[k].weight])) as Record<ShapeKey, number>;
  private static readonly SHAPE_WEIGHT_TOTAL: number =
    Object.values(Game.SHAPE_WEIGHTS).reduce((a, b) => a + b, 0);

  public randomShapeKey(): ShapeKey {
    return Balance.weightedPick(Game.SHAPE_WEIGHTS, Math.random() * Game.SHAPE_WEIGHT_TOTAL) ?? 'I';
  }

  // ── Fog of war ───────────────────────────────────────────────────────────

  /** Recomputes visibility/explored state around the player (or reveals the whole arena during the Gorgoth duel). */
  public updateVisibility(): void {
    // During the Gorgoth duel (and inside a waystation) the whole arena stays
    // lit — revealed on entry, so don't re-fog to the vision radius.
    if (this.blockBuildingSuspended) return;
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
        const monsterChance = this.tutorialSafety ? 0 : hauntedChance * (this.activeOmen?.num('monsterChanceMult', 1) ?? 1) * this.heatMult('monsterChanceMult');
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
    // Cursed piece: carries a monster that crawls out where it lands
    // (held back, like all natural spawns, while the tutorial teaches).
    if (this.currentCursed && !this.tutorialSafety) {
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
    // In a duel the hero can't walk the sealed wall, but switch- and boon-islands
    // are walked *onto* to activate them (build your causeway up, then step on).
    if (this.inCausewayDuel && this.causewayDuel.owner[x]?.[y] === CausewayDuel.WALL) return false;
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

  public getHazardAt(x: number, y: number): HazardTile | undefined {
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
          const rescue = RESCUES.find(res => res.id === this.pendingRescueId);
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
          this.cb.log('A cold need-fire settles into the stone. Walk to it to light it.', 'log-blockbuilding', 'tile_brazier');
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
        this.cb.log(msgs[tileType], 'log-blockbuilding', icons[tileType]);
      } else if (this.currentType === 'Z') {
        for (const fc of lockedFloorCells) {
          if (!this.hazards.some(h => h.x === fc.x && h.y === fc.y) &&
              !this.tattooTiles.some(t => t.x === fc.x && t.y === fc.y)) {
            this.hazards.push({ x: fc.x, y: fc.y, type: 'spike', timer: Balance.HAZARD.spike.fieldFixedTimer, warning: false });
          }
        }
        this.cb.log('Spike Field — fires every 5 ticks!', 'log-blockbuilding', 'trap_spike');
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
    this.spawnBlock();
  }

  /** Row index of the highest built floor tile across every column (`GameConfig.ROWS` if the field is empty — row 0 is the field's top). */
  public stackTopRow(): number {
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

  /** Near-ceiling "top out to win" nudge. Delegates to {@link BossEncounters}. */
  private maybeHintGorgoth(): void {
    this.bossEncounters.maybeHintGorgoth();
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

  /**
   * Scales a `MonsterTemplate` by dungeon level/biome/elite-roll and places the
   * resulting `Monster` at `(tx, ty)`. Thin delegate onto {@link Spawner}.
   * `elite`: true forces an elite, false forbids one, undefined rolls the normal chance.
   */
  public spawnMonster(key: string, tx: number, ty: number, elite?: boolean, nameOverride?: string): void {
    this.spawner.monster(key, tx, ty, elite, nameOverride);
  }

  /** A monster key, weighted toward tougher species as the dungeon deepens. Delegates to {@link Spawner}. */
  public getRandomMonsterKey(): string {
    return this.spawner.randomMonsterKey();
  }

  /** Spawns up to two Crystal Shard adds beside a fallen Cailleach's Stoneward. Called by that boss's `onDeath` hook. Delegates to {@link BossEncounters}. */
  public spawnCrystalShards(bx: number, by: number): void {
    this.bossEncounters.spawnCrystalShards(bx, by);
  }

  /** Yanks the falling piece 5 rows down. Called by Balor's Herald's `onHalfHp` hook. Delegates to {@link BossEncounters}. */
  public triggerGravityBurst(): void {
    this.bossEncounters.triggerGravityBurst();
  }

  // ── Dungeon rooms ────────────────────────────────────────────────────────

  /** Rolls the per-floor chance to carve a lateral vault/den room. Delegates to {@link Spawner}. */
  private maybeSpawnDungeonRoom(): void {
    this.spawner.maybeSpawnRoom();
  }

  // Boss selection is deterministic per floor (cycles through the pool in a
  // fixed order, biome permitting), and biome is itself purely a function of
  // floor number — so this can truthfully preview a boss on a floor the
  // player hasn't reached yet (used by the vengeance-bounty NPC).
  public previewBossForFloor(floor: number): BossDef {
    const biome = Biome.forFloor(floor);
    const biomeBosses   = BOSSES.filter(b => b.biomeId === biome.id);
    const genericBosses = BOSSES.filter(b => !b.biomeId);
    const bossPool = biomeBosses.length > 0 ? biomeBosses : genericBosses;
    return bossPool[(Math.floor(floor / Balance.CONFIG.floors.bossFloorInterval) - 1) % bossPool.length]!;
  }

  // ── Lugh's Spear questline ───────────────────────────────────────────────
  // Every few floors (skipping boss floors), one of the three legendary
  // smiths waits somewhere on that floor — embedded as a guaranteed rider
  // once the player has built enough of the floor (see spawnBlock). This
  // just announces the floor; the actual encounter is triggered on bump,
  // in triggerSmithEncounter below.

  /** Steps aside into the safe sídhe-mound rest stop. Delegates to {@link Waystation}. */
  private enterWaystation(): void { this.waystation.enter(); }

  /** Rolls this floor's omen (per-floor modifier) on entry — boss floors and floor 1 stay omen-free, and most floors still roll nothing. */
  private maybeRollOmen(isBossFloor: boolean): void {
    if (isBossFloor || this.dungeonLevel <= 1) return;
    if (Math.random() >= Balance.CONFIG.omens.rollChance) return;
    const omen = Omen.random();
    this.activeOmen = omen;
    this.omenGravityPct = omen.num('gravityPct', 0);
    // Samhain: the veil is thin — a ghost of a past run WILL find you, if any
    // is close enough to your level (the normal roll already happened in
    // resetDungeonState; this overrides a miss).
    if (omen.num('forceHaunt', 0) > 0 && !this.activeGhost) {
      const eligible = this.availableGhosts.filter(
        g => Math.abs(g.playerLevel - this.player.playerLevel) <= Balance.CONFIG.ghosts.levelTolerance,
      );
      if (eligible.length > 0) this.activeGhost = eligible[Math.floor(Math.random() * eligible.length)]!;
    }
    this.cb.log(omen.logText, 'log-blockbuilding', omen.icon);
    this.cb.onToast?.(omen.toastText, omen.icon);
    // Gravity-affecting omens need the host's tick timer re-armed right away.
    if (this.omenGravityPct !== 0) this.cb.onAction();
  }

  /** Ambient heads-up on a smith-eligible floor entry (delegates to {@link SmithQuest}). */
  private maybeAnnounceSmithFloor(isBossFloor: boolean): void { this.smithQuest.announceFloor(isBossFloor); }

  /** The next smith due to appear this run, or null once all three are met (delegates to {@link SmithQuest}). */
  private nextSmith(): Smith | null { return this.smithQuest.next(); }

  /**
   * The tutorial's single practice foe: one ordinary rat on a floor tile
   * within a few steps of the hero, spawned when the Fight step begins so
   * the lesson has a target while natural spawns stay suppressed. No-op if
   * no suitable tile exists (the step's landing-count fallback covers it).
   */
  public spawnTutorialFoe(): void {
    let best: { x: number; y: number; d: number } | null = null;
    for (let x = 0; x < GameConfig.COLS; x++) {
      for (let y = 0; y < GameConfig.ROWS; y++) {
        if (this.map[x]![y] !== Tile.FLOOR) continue;
        if (this.getMonsterAt(x, y) || (x === this.player.x && y === this.player.y)) continue;
        if (this.npcTiles.some(n => n.x === x && n.y === y) || this.isTattooTile(x, y)) continue;
        const d = Math.abs(x - this.player.x) + Math.abs(y - this.player.y);
        if (d >= 2 && d <= 7 && (best === null || d < best.d)) best = { x, y, d };
      }
    }
    if (best) this.spawnMonster('rat', best.x, best.y, false);  // a practice target, never an elite
  }

  /** The captors' monster archetype for a rescue piece — nastier stock the deeper you are. */
  private rollGuardKey(): string {
    const pool = this.dungeonLevel >= 6 ? ['berserker_orc', 'skeleton'] : ['skeleton', 'goblin_archer'];
    return pool[Math.floor(Math.random() * pool.length)]!;
  }


  /** Swears An Draoi's pact with the named deity (delegates to {@link PactCeremony}). */
  public applyPatron(id: string): void { this.pact.apply(id); }

  /** Adds any patron spells the player has now reached the level for (delegates to {@link PactCeremony}); called from the level-up choke point. */
  private syncSpellUnlocks(): void { this.pact.syncUnlocks(); }

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
      const diff = this.difficultyTuning();
      const baseHp = Balance.CONFIG.boss.baseHpFloor1 + (this.dungeonLevel - 1) * Balance.CONFIG.boss.baseHpPerDungeonLevel;
      const baseAtk = Balance.CONFIG.boss.baseAtkFloor1 + (this.dungeonLevel - 1) * Balance.CONFIG.boss.baseAtkPerDungeonLevel;
      const hp = Math.floor(baseHp * bossDef.hpMult * diff.monsterHpMult);
      const atk = Math.floor(baseAtk * bossDef.atkMult * diff.monsterAtkMult * this.heatMult('monsterAtkMult'));
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

      let goldAdded = Math.floor(GameMath.scoreForLines(rowsCleared, this.dungeonLevel) * (this.activeOmen?.num('goldMult', 1) ?? 1) * this.difficultyTuning().goldMult * this.heatMult('goldMult'));
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
      const omenXpMult = this.activeOmen?.num('xpMult', 1) ?? 1;
      const levelled = this.player.gainXP(Math.floor(xpGain * this.xpMultiplier * omenXpMult));
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
          if (this.comboCount === 0) this.cb.log(`Row cleared! +${lineHeal} HP.`, 'log-blockbuilding');
        } else if (this.comboCount === 0) {
          this.cb.log(`Dungeon Row Cleared! +${goldAdded} Gold.`, 'log-blockbuilding');
        }
      } else if (this.comboCount === 0) {
        this.cb.log(`Dungeon Row Cleared! +${goldAdded} Gold. (Cursed — no heal)`, 'log-blockbuilding');
      }

      // A real 4-line clear is rare enough to be noticed by
      // the Good God himself — once per run, An Dagda takes a seat in the
      // sídhe mound with a tier-3 Geis from his cauldron. No modal here; the
      // gift is claimed in person at the next mound visit.
      if (rowsCleared === 4 && !this.dagdaGiftEarned) {
        this.dagdaGiftEarned = true;
        this.cb.log('A PERFECT CLEAR! A great slow laugh rolls up through the stone — An Dagda has taken notice. He waits in the sídhe mounds with a gift.', 'log-combo', 'fx_arcane');
        this.cb.onToast?.('An Dagda has seen your perfect clear — a gift waits in the mounds.', 'fx_arcane');
        this.storyBeats.push('cleared four lines as one and drew the Good God\'s eye');
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

  /** Ambient heads-up on entering a boss-eligible floor. Delegates to {@link BossEncounters}. */
  private announceBossFloor(): void {
    this.bossEncounters.announceFloor();
  }

  /** Advances the dungeon level counter and rebuilds the floor (used when the stack's top row itself scrolls off the bottom). */
  private transitionToNextFloor(): void {
    this.dungeonLevel++;
    this.floorsDescended++;
    const isBossFloor = this.dungeonLevel % Balance.CONFIG.floors.bossFloorInterval === 0;
    this.updateBiome();
    this.cb.log(`Collapsed down to depth floor ${this.dungeonLevel}!`, 'log-blockbuilding');
    this.resetDungeonState();
    this.inWaystation = false;  // defense-in-depth: a collapse can't start inside the mound, but never carry the suspension out
    // A boss floor reached by a stack collapse also opens as a Causeway Duel.
    if (isBossFloor && this.duelBossFloorsEnabled()) { this.startCausewayDuel(); return; }
    if (this.fidchellFloor(this.dungeonLevel, isBossFloor)) { this.startFidchell(); return; }
    if (isBossFloor) this.announceBossFloor();
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
      this.cb.log(`${biome.name} — ${biome.desc}`, 'log-blockbuilding', icon);
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
    // Abcán's suantraí fades once its floor is behind you.
    if (this.harperLullFloor !== 0 && this.dungeonLevel > this.harperLullFloor) this.harperLullFloor = 0;
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
    this.settleDuel();  // end a won duel / open its descent choice the moment the boss is gone
    this.fidchell.maybeShowRules();  // open the fidchell rules modal on the first safe tick of a match
    StatusEffectSystem.applyStatusEffects(this);
    StatusEffectSystem.applyRegen(this);
    StatusEffectSystem.applyAuraStun(this);
    HazardSystem.processHazards(this);
    this.processSpecialTiles();
    if (!this.blockBuildingSuspended) this.moveGravity();  // no falling blocks during the Gorgoth duel or a waystation
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
  public advanceTurn(): void {
    if (this.player.hp <= 0) return;
    this.settleDuel();  // end a won duel / open its descent choice the moment the boss is gone
    StatusEffectSystem.applyStatusEffects(this);
    StatusEffectSystem.applyRegen(this);
    StatusEffectSystem.applyAuraStun(this);
    HazardSystem.processHazards(this);
    this.processSpecialTiles();
    if (!this.blockBuildingSuspended) this.moveGravity();  // no falling stone in the Gorgoth duel, a waystation, or a Causeway Duel
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
      // If this level-up was the boss-kill that won a duel, the delve-or-rest
      // choice has been waiting on this modal — open it now, without a tick's delay.
      this.tryFinishDuelDescent();
    });
  }

  // ── Class selection ──────────────────────────────────────────────────────

  /** The classes offered on the start-screen picker. Delegates to {@link RunSetup}. */
  public getRandomClasses(count = 2): ClassDef[] {
    return this.runSetup.getRandomClasses(count);
  }

  /** Applies the chosen starting class's stat effects/ability. Delegates to {@link RunSetup}. */
  public applyClass(id: string): void {
    this.runSetup.applyClass(id);
  }

  // ── Difficulty selection ─────────────────────────────────────────────────

  /** Identity tuning used when the active difficulty id is unknown (content changed under a save). */
  private static readonly DIFFICULTY_FALLBACK: DifficultyPreset = {
    id: 'standard', icon: '', name: '', desc: '',
    gravityPct: 0, playerHpMult: 1, monsterAtkMult: 1, monsterHpMult: 1, goldMult: 1, xpMult: 1,
  };

  /** The active difficulty preset's tuning. */
  public difficultyTuning(): DifficultyPreset {
    return Balance.CONFIG.difficulty.presets.find(p => p.id === this.activeDifficultyId)
      ?? Game.DIFFICULTY_FALLBACK;
  }

  /** Percent gravity adjustment from the active difficulty (positive = slower), summed with the biome/omen adjustments at both tick-rate call sites. */
  public get difficultyGravityPct(): number {
    return this.difficultyTuning().gravityPct;
  }

  /** Applies the chosen run difficulty at run start. Delegates to {@link RunSetup}. */
  public applyDifficulty(id: string): void {
    this.runSetup.applyDifficulty(id);
  }

  // ── New Game+ heat ───────────────────────────────────────────────────────
  // Winning unlocks the heat ladder: each heat level stacks one more
  // permanent geis (handicap) from balance.json's ngplus.tiers onto the
  // whole run, in exchange for bonus XP. Heat N applies every tier ≤ N.

  /** Cumulative multiplicative heat param for `key` across the active tiers (identity 1). */
  public heatMult(key: string): number {
    let v = 1;
    for (const t of Balance.CONFIG.ngplus.tiers) {
      const p = t.params[key];
      if (t.level <= this.heatLevel && typeof p === 'number') v *= p;
    }
    return v;
  }

  /** Cumulative additive heat param for `key` across the active tiers (identity 0). */
  public heatAdd(key: string): number {
    let v = 0;
    for (const t of Balance.CONFIG.ngplus.tiers) {
      const p = t.params[key];
      if (t.level <= this.heatLevel && typeof p === 'number') v += p;
    }
    return v;
  }

  /** Percent gravity adjustment from the active heat geasa (negative = faster), summed with biome/omen/difficulty at both tick-rate call sites. */
  public get heatGravityPct(): number {
    return this.heatAdd('gravityPct');
  }

  /** Applies the chosen New Game+ heat at run start. Delegates to {@link RunSetup}. */
  public applyHeat(level: number): void {
    this.runSetup.applyHeat(level);
  }

  // ── Modifier selection ───────────────────────────────────────────────────

  /** A random selection of run modifiers (Rift Curses) for the start-screen picker. Delegates to {@link RunSetup}. */
  public getRandomModifiers(count = 3): ModifierDef[] {
    return this.runSetup.getRandomModifiers(count);
  }

  /** Applies the chosen run modifier's effect for the whole run. Delegates to {@link RunSetup}. */
  public applyModifier(id: string): void {
    this.runSetup.applyModifier(id);
  }

  // ── Tattoo Artist ─────────────────────────────────────────────────────────

  /** Opens the tattoo-artist brand-choice modal (reachable via a tattoo-artist tile). `onClosed` fires once a mark is chosen. */
  /** Opens the tattoo-artist brand-choice modal. Delegates to {@link VendorOffers}. */
  private openTattooArtist(onClosed?: () => void): void {
    this.vendorOffers.tattooArtist(onClosed);
  }

  /** The Fear Dearg's stall — the gold sink. Delegates to {@link VendorOffers}. */
  public openPeddler(): void {
    this.vendorOffers.peddler();
  }

  /** Opens the altar boon-choice modal for the given reward tier. Delegates to {@link VendorOffers}. */
  private openAltar(tier: 1 | 2 | 3, onClosed?: () => void): void {
    this.vendorOffers.altar(tier, onClosed);
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
    if (this.inFidchell) return;  // during fidchell you command the board by tapping, not by moving a hero
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
        const wasDuelBoss = this.inCausewayDuel && monster === this.causewayDuel.boss;
        CombatSystem.killMonster(monster, this);
        if (monster.isBoss && this.activeBossOnDeath) {
          this.activeBossOnDeath(this, bx, by);
          this.activeBossOnDeath = null;
        }
        if (wasDuelBoss) { this.causewayDuel.win(); return; }
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

    // Causeway-Duel islands — walk onto one to activate it.
    if (this.inCausewayDuel) {
      const sw = this.causewayDuel.switches.find(s => s.x === nx && s.y === ny && !s.lit);
      if (sw) {
        this.player.x = nx; this.player.y = ny;
        this.causewayDuel.lightSwitch(sw);
        this.advanceTurn();
        return;
      }
      const boon = this.causewayDuel.boons.find(b => b.x === nx && b.y === ny && !b.taken);
      if (boon) {
        this.player.x = nx; this.player.y = ny;
        this.causewayDuel.takeBoon(boon);
        this.advanceTurn();
        return;
      }
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

    // Wandering NPC / ghost / mound resident — bump to run its verb (see Waystation).
    const npcTile = this.npcTiles.find(n => n.x === nx && n.y === ny);
    if (npcTile) { this.waystation.interact(npcTile); return; }

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
      // A won duel's stairs end the duel and open the usual delve-or-rest choice.
      if (this.inCausewayDuel) { this.inCausewayDuel = false; this.openStairsChoice(); }
      // The mound's own exit stairs go straight down — you already rested.
      else if (this.inWaystation) this.descendFloor();
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
  public openStairsChoice(): void {
    if (!this.cb.onFloorEvent) { this.descendFloor(); return; }
    // The rest option's pitch names whoever is actually waiting inside.
    const waiting: string[] = [];
    if (this.dagdaGiftEarned && !this.dagdaGiftClaimed) waiting.push('the Good God, bearing a gift');
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

  /**
   * Whether boss floors run as a Causeway Duel (this branch: always). Kept as
   * a single toggle point so it's easy to gate behind a setting later.
   */
  private duelBossFloorsEnabled(): boolean {
    return true;
  }

  /** Whether entering `floor` opens a Fidchell challenge: every 7th non-boss floor (boss floors keep their Causeway Duel). */
  private fidchellFloor(floor: number, isBossFloor: boolean): boolean {
    return !isBossFloor && floor > 0 && floor % 7 === 0;
  }

  /** The actual floor descent: advances the level, rebuilds the floor, and fires every floor-entry hook (omen, smith, pending-event roll). */
  public descendFloor(): void {
    this.inWaystation = false;
    this.dungeonLevel++;
    this.floorsDescended++;
    const bossFloor = this.dungeonLevel % Balance.CONFIG.floors.bossFloorInterval === 0;
    this.cb.onAudio?.('descend');
    this.updateBiome();
    // Spike opt-in: a boss floor becomes a Causeway Duel.
    if (bossFloor && this.duelBossFloorsEnabled()) {
      this.cb.log(`Stepped down to floor ${this.dungeonLevel}!`, 'log-success');
      this.resetDungeonState();
      this.startCausewayDuel();
      return;
    }
    // Every 7th (non-boss) floor a Fomorian gambler bars the crossing with fidchell.
    if (this.fidchellFloor(this.dungeonLevel, bossFloor)) {
      this.cb.log(`Stepped down to floor ${this.dungeonLevel}!`, 'log-success');
      this.resetDungeonState();
      this.startFidchell();
      return;
    }
    if (bossFloor) this.announceBossFloor();
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
    if (!isBossFloor && !this.tutorialSafety && rescuePool.length > 0 && Math.random() < Balance.CONFIG.rescues.rollChance) {
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
    const healAmt = (nearbyMonster ? 1 : 4) * (this.activeOmen?.num('waitHealMult', 1) ?? 1);
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

  /** Casts the player's active ranged ability/spell (delegates to {@link AbilitySystem}). */
  public handleRangedAttack(): void { AbilitySystem.cast(this); }

  /** Holds the current piece for later (swapping with any already-held piece), once per lock. */
  public handleBlockHold(): void {
    if (this.player.hp <= 0 || this.paused || this.blockBuildingSuspended) return;
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

  /** Overflowing the stack summons the final boss into a cleared arena. Delegates to {@link BossEncounters}. */
  public summonGorgoth(): void {
    this.bossEncounters.summonGorgoth();
  }

  /** Bres's half-HP mechanic factory (roar + two Fomorian adds). Delegates to {@link BossEncounters}. */
  public makeGorgothOnHalfHp(boss: Monster): (game: Game) => void {
    return this.bossEncounters.makeGorgothOnHalfHp(boss);
  }

  /** Gorgoth defeated — the run is won. Idempotent. Delegates to {@link BossEncounters}. */
  public triggerVictory(): void {
    this.bossEncounters.triggerVictory();
  }

  /** Shifts the falling piece one column left, if unobstructed. */
  public handleBlockLeft(): void {
    if (this.player.hp <= 0 || this.paused) return;
    if (this.inCausewayDuel) { this.causewayDuel.steerPiece(-1); return; }
    if (this.blockBuildingSuspended) return;
    if (!this.checkBlockCollision(this.blockX - 1, this.blockY, this.blockMatrix)) { this.blockX--; this.cb.onAudio?.('blockMove'); this.advanceTurn(); }
  }

  /** Shifts the falling piece one column right, if unobstructed. */
  public handleBlockRight(): void {
    if (this.player.hp <= 0 || this.paused) return;
    if (this.inCausewayDuel) { this.causewayDuel.steerPiece(1); return; }
    if (this.blockBuildingSuspended) return;
    if (!this.checkBlockCollision(this.blockX + 1, this.blockY, this.blockMatrix)) { this.blockX++; this.cb.onAudio?.('blockMove'); this.advanceTurn(); }
  }

  /**
   * Rotates the falling piece 90°, if the rotated shape doesn't collide.
   * Rotation is a FREE action — no turn passes, monsters don't move. It
   * cycles in place through four orientations without advancing the piece,
   * so there's nothing to farm; charging a turn for it just got players
   * bitten while lining up a drop.
   */
  public handleBlockRotate(): void {
    if (this.player.hp <= 0 || this.paused) return;
    if (this.inCausewayDuel) { this.causewayDuel.rotatePiece(); return; }
    if (this.blockBuildingSuspended) return;
    const rotated = GameMath.rotateMatrix(this.blockMatrix);
    if (!this.checkBlockCollision(this.blockX, this.blockY, rotated)) { this.blockMatrix = rotated; this.cb.onAudio?.('blockRotate'); }
  }

  /** Drops the falling piece one row, locking it in place if it can't descend further. */
  public handleBlockSoftDrop(): void {
    if (this.player.hp <= 0 || this.paused) return;
    if (this.inCausewayDuel) { this.causewayDuel.placePiece(); return; }  // soft-drop doubles as "place" in a duel
    if (this.blockBuildingSuspended) return;
    if (!this.checkBlockCollision(this.blockX, this.blockY + 1, this.blockMatrix)) { this.blockY++; this.advanceTurn(); }
    else { this.lockBlock(); this.advanceTurn(); }
  }

  /** Instantly drops the falling piece to the floor and locks it, with an afterimage trail along its travel path. */
  public handleBlockDrop(): void {
    if (this.player.hp <= 0 || this.paused) return;
    if (this.inCausewayDuel) { this.causewayDuel.placePiece(); return; }
    if (this.blockBuildingSuspended) return;
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

  // ── Causeway Duel — thin delegators onto the CausewayDuel module ──────────

  /** Starts a Causeway Duel on a boss floor. Delegates to {@link CausewayDuel}. */
  public startCausewayDuel(): void { this.causewayDuel.start(); }

  /** Wall tiles still sealed (for the renderer). */
  public get duelWallTiles(): ReadonlyArray<{ x: number; y: number }> { return this.causewayDuel.wall; }
  /** Switch-islands (for the renderer). */
  public get duelSwitchTiles(): ReadonlyArray<{ x: number; y: number; lit: boolean }> { return this.causewayDuel.switches; }
  /** Unclaimed boon-islands (for the renderer). */
  public get duelBoonTiles(): ReadonlyArray<{ x: number; y: number; kind: string; taken: boolean }> { return this.causewayDuel.boons; }

  /**
   * Called from {@link CombatSystem.killMonster} for every monster death so the
   * duel ends the instant its boss falls, by any death path. Delegates to {@link CausewayDuel}.
   */
  public notifyMonsterKilled(m: Monster): void { this.causewayDuel.notifyMonsterKilled(m); }

  /** Opens the delve-or-rest choice for a won duel once nothing else is modal. Delegates to {@link CausewayDuel}. */
  private tryFinishDuelDescent(): void { this.causewayDuel.tryFinishDescent(); }

  /** Per-tick safety net: ends a won duel and opens its descent choice. Delegates to {@link CausewayDuel}. */
  private settleDuel(): void { this.causewayDuel.settle(); }


  // ── Lookups ──────────────────────────────────────────────────────────────

  /** The monster standing at `(x, y)`, if any. */
  public getMonsterAt(x: number, y: number): Monster | undefined {
    return this.monsters.find(m => m.x === x && m.y === y);
  }

  // ── Tap-to-inspect ───────────────────────────────────────────────────────

  /** Builds the inspect-tooltip content for whatever occupies `(x, y)` (delegates to {@link InspectView}). */
  public getInspectInfo(x: number, y: number): InspectInfo | null { return this.inspectView.build(x, y); }

  // ── Mid-run save/resume ──────────────────────────────────────────────────

  /** Snapshots the complete run state for the mid-run save. Delegates to {@link SaveGame}. */
  public serialize(): SavedRun {
    return this.saveGame.serialize();
  }

  /**
   * Restores a {@link serialize} snapshot onto a shell built with
   * `new Game(cb, { forRestore: true })`. Delegates to {@link SaveGame}.
   * @throws {Error} If the save's version doesn't match, or its piece shapes no longer exist.
   */
  public applySave(save: SavedRun): void {
    this.saveGame.restore(save);
  }

  // ── UI push ──────────────────────────────────────────────────────────────

  /** Pushes a fresh {@link UIState} snapshot to the host UI via `cb.updateUI` (assembled by {@link UiStateBuilder}). */
  public pushUI(): void { this.cb.updateUI(this.uiStateBuilder.build()); }

  /** The floor-progress dial payload (smith/boss/stairs thresholds). Encapsulates the private per-floor counters for {@link UiStateBuilder}. */
  public floorProgressState(): UIState['floorProgress'] {
    return {
      pieces: this.blocksSpawnedThisFloor,
      smithTarget: this.pendingSmithFloor ? Balance.CONFIG.smiths.pieceThreshold : null,
      fillPct: Math.round(this.filledFraction() * 100),
      bossFillTarget: this.pendingBossFloor ? Math.round(Game.BOSS_FILL_FRACTION * 100) : null,
      stairsPity: this.stairsOnBoard()
        ? null
        : { placed: this.blocksPlacedSinceStairs, target: Balance.CONFIG.spawnRates.stairsForcedAfterBlocks },
    };
  }
}
