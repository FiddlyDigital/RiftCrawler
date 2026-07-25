import { SHAPES } from './config';
import { SAVE_VERSION, type SavedRun } from './types';
import { Monster } from './entities';
import { Boon, Brand, BOSSES, FloorEvent, Omen } from './content';
import type { Game } from './game';

/**
 * Mid-run persistence for {@link Game}: the matched {@link serialize} /
 * {@link restore} pair. Serialization is a generic scalar sweep of Game's own
 * plain fields (everything not in {@link SaveGame.SAVE_SKIP}) plus explicit,
 * re-resolvable projections of the live references (entities → their own
 * serializers, content instances → ids, Sets → arrays, function-valued boss
 * hooks reattached by id/name on restore). Composed onto Game; holds no state
 * of its own — it reads and writes Game's run state directly.
 */
export class SaveGame {
  constructor(private readonly game: Game) {}

  /**
   * Fields excluded from the generic scalar sweep in {@link serialize}:
   * the host callbacks, live entity/content-instance references (serialized
   * in re-resolvable forms instead), function-valued boss hooks (reattached
   * by id/name on restore), Sets (stored as arrays), session-relative
   * timestamps, tutorial state (owned by the live TutorialController — a save
   * is never taken mid-tutorial), and the composed subsystems (each a back-ref
   * to Game; any that has state serializes it explicitly). Everything else —
   * grids, counters, tile lists, flags — round-trips verbatim, so newly added
   * plain fields are persisted without touching the save code.
   */
  private static readonly SAVE_SKIP = new Set([
    'cb', 'player', 'monsters', 'rescueGuards',
    'activeOmen', 'pendingFloorEvent',
    'activeBossOnHalfHp', 'activeBossOnDeath',
    'rescuedIds', 'spearPartsHeld', 'metFlavorNpcIds',
    'activeGhost', 'availableGhosts',
    'lastLineClearMs', 'tutorialSafety',
    'duelBoss',  // a live Monster ref — re-linked to the restored boss in restore()
    // Composed subsystems that hold a back-ref to Game — never part of the data
    // snapshot (each serializes its own state explicitly if it has any).
    'fidchell', 'inspectView', 'characterSheetView', 'uiStateBuilder', 'pact',
    'npcEncounters', 'smithQuest', 'spawner', 'runSetup', 'saveGame',
  ]);

  /** Snapshots the complete run state for the mid-run save (see {@link restore}). */
  serialize(): SavedRun {
    const g = this.game;
    const scalars: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(g)) {
      if (!SaveGame.SAVE_SKIP.has(k)) scalars[k] = v;
    }
    return {
      version: SAVE_VERSION,
      savedAt: Date.now(),
      scalars,
      player: g.player.serialize(),
      monsters: g.monsters.map(m => m.serialize()),
      rescueGuardIdx: g.rescueGuards.map(guard => g.monsters.indexOf(guard)).filter(i => i >= 0),
      omenId: g.activeOmen?.id ?? null,
      pendingFloorEventId: g.pendingFloorEvent?.id ?? null,
      rescuedIds: [...g.rescuedIds],
      spearPartsHeld: [...g.spearPartsHeld],
      metFlavorNpcIds: [...g.metFlavorNpcIds],
      activeGhost: g.activeGhost,
      fidchell: g.fidchell.serialize(),
    };
  }

  /**
   * Restores a {@link serialize} snapshot onto a shell built with
   * `new Game(cb, { forRestore: true })`. Content references (omen, pending
   * floor event, boons/brands, boss mechanics) are re-resolved against the
   * currently loaded data; a reference whose id no longer exists degrades to
   * "absent" rather than crashing — except the falling piece's shape, without
   * which the run can't continue.
   * @throws {Error} If the save's version doesn't match, or its piece shapes no longer exist.
   */
  restore(save: SavedRun): void {
    const g = this.game;
    if (save.version !== SAVE_VERSION) {
      throw new Error(`SaveGame.restore: save version ${save.version} is not ${SAVE_VERSION}`);
    }
    Object.assign(g, save.scalars);
    g.fidchell.restore(save.fidchell);
    if (!SHAPES[g.currentType] || !SHAPES[g.nextType] || (g.heldType !== null && !SHAPES[g.heldType])) {
      throw new Error('SaveGame.restore: a saved piece shape no longer exists in shapes.json');
    }
    g.player.applySave(save.player, {
      boon:  id => Boon.ALL.find(b => b.id === id),
      brand: id => Brand.ALL.find(b => b.id === id),
    });
    g.monsters = save.monsters.map(m => Monster.fromSave(m));
    g.rescueGuards = save.rescueGuardIdx
      .map(i => g.monsters[i])
      .filter((m): m is Monster => m !== undefined);
    g.activeOmen = save.omenId === null ? null : Omen.ALL.find(o => o.id === save.omenId) ?? null;
    g.pendingFloorEvent = save.pendingFloorEventId === null
      ? null
      : FloorEvent.ALL.find(f => f.id === save.pendingFloorEventId) ?? null;
    g.rescuedIds = new Set(save.rescuedIds);
    g.spearPartsHeld = new Set(save.spearPartsHeld as Array<'shaft' | 'bolts' | 'head'>);
    g.metFlavorNpcIds = new Set(save.metFlavorNpcIds);
    g.activeGhost = save.activeGhost;
    // Boss mechanics are functions — reattach them from the live content
    // definitions around the restored boss instance.
    const boss = g.monsters.find(m => m.isBoss);
    if (g.inCausewayDuel) {
      // The duel owns its boss outright (no biome hooks) — just re-link the
      // reference to the restored boss instance so the win path still fires.
      g.duelBoss = boss ?? null;
      g.activeBossOnHalfHp = null;
      g.activeBossOnDeath = null;
      g.bossHalfHpTriggered = true;
    } else if (boss?.isGorgoth) {
      g.activeBossOnHalfHp = g.makeGorgothOnHalfHp(boss);
      g.activeBossOnDeath = null;
    } else if (boss) {
      const def = BOSSES.find(b => b.name === boss.name);
      g.activeBossOnHalfHp = def?.onHalfHp ?? null;
      g.activeBossOnDeath  = def?.onDeath  ?? null;
    }
    // Session-relative state restarts clean: the combo window is long gone,
    // and a snapshot is only ever taken of a live, unblocked, post-tutorial game.
    g.lastLineClearMs = 0;
    g.comboCount = 0;
    g.active = true;
    g.paused = false;
    g.tutorialSafety = false;
    g.pushUI();
  }
}
