import { Tile, type FloorEventDef, type NpcTile } from './types';
import { Boon, RESCUES, NPCS, SMITHS } from './content';
import { Balance } from './balance';
import type { Game } from './game';

/**
 * The sídhe-mound waystation: the safe rest floor reached from any staircase,
 * and every bump-interaction with a mound/floor NPC tile. Owns the mound's
 * layout and its {@link enter} setup, plus the {@link interact} dispatch for
 * every `npcTile` verb — An Dagda's gift, An Draoi's pact emissary, nexus
 * rescues, the ogham stone (codex), the Sídhe coffer (cross-run stash), the
 * Well of Segais, a held floor event, the hearth-fire, the Fear Dearg's stall,
 * the seanchaí, a ghost of a past self, the smiths, and wandering NPCs.
 * Composed onto {@link Game}; holds no state of its own — the run flags it
 * reads/writes all live on Game — and it collaborates with the sibling
 * subsystems (npcEncounters, pact, smithQuest, vendorOffers) directly.
 */
export class Waystation {
  /**
   * The mound chamber layout: an 8×8 square hall centered on the canvas
   * (inclusive bounds), the hearth at its heart with the seanchaí beside it,
   * the emissary aloof in a corner, the stall along a wall, and the exit
   * stairs in the far corner. Public so tests target positions by name
   * (aliased as {@link Game.MOUND}).
   */
  static readonly MOUND = {
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

  /**
   * Where the i-th freed captive stands. They line the north wall first, then
   * wrap along the south wall — the mound is 8 tiles wide, so a single row
   * would push the 8th resident out through the chamber wall. The south wall's
   * far corner is left clear for the exit stairs.
   */
  static rescueSeat(index: number): { x: number; y: number } {
    const M = Waystation.MOUND;
    const north = Array.from({ length: M.x1 - 2 + 1 }, (_, i) => ({ x: 2 + i, y: M.y0 }));
    // The south wall stops one short of x1 — that corner is the exit stairs.
    const south = Array.from({ length: M.x1 - 1 - 2 + 1 }, (_, i) => ({ x: 2 + i, y: M.y1 }));
    const seats = [...north, ...south];
    return seats[Math.min(Math.max(0, index), seats.length - 1)]!;
  }

  constructor(private readonly game: Game) {}

  /**
   * Steps aside into the waystation: a safe sídhe-mound rest stop offered at
   * every staircase (see {@link Game.openStairsChoice}). The mound sits *between*
   * floors — the level counter doesn't advance until its exit stairs are taken.
   * The Blockbuilding layer is suspended (see {@link Game.blockBuildingSuspended})
   * and the mound offers a seanchaí (lore), a hearth-fire (full heal), the Fear
   * Dearg's stall (shop), and the stairs on.
   */
  enter(): void {
    const g = this.game;
    this.build(true);
    g.cb.onAudio?.('waystationEnter');
    g.cb.log('You surface into a sídhe mound — a hush, a hearth, and friendly faces. The stairs will keep.', 'log-success', 'special_sacred');
    g.cb.onToast?.('You surface into a sídhe mound — rest; the dark will keep.', 'special_sacred');
    g.storyBeats.push('rested in a sídhe mound');
    g.pushUI();
  }

  /**
   * Rebuilds the mound around the hero after something took the chamber over
   * mid-visit (Midir's fidchell wager clears the board to lay out its own).
   * Same layout, no arrival fanfare — you never left, so there is no second
   * "you surface into a mound" beat, and the tattooist's visit is not re-rolled.
   */
  reenter(): void {
    this.build(false);
    this.game.pushUI();
  }

  /** Lays out the chamber, its fixtures and its residents. Shared by {@link enter} and {@link reenter}. */
  private build(rollTattooist: boolean): void {
    const g = this.game;
    g.inWaystation = true;
    g.blockMatrix = [];  // no falling stone inside the mound
    // Entered mid-floor, so the interrupted floor's whole state — stack,
    // monsters, hazards, tiles, ghost, omen, ritual — is swept away; the
    // mound is home ground, rebuilt from bare rock.
    g.clearBoardEntities();
    g.activeGhost = null;
    g.activeOmen = null;
    g.omenGravityPct = 0;
    g.brazierTiles = [];
    g.brazierLitCount = 0;
    g.ritualComplete = false;
    // The mound chamber: a broad square hall centered on the canvas.
    const M = Waystation.MOUND;
    for (let x = M.x0; x <= M.x1; x++) {
      for (let y = M.y0; y <= M.y1; y++) {
        g.map[x]![y] = Tile.FLOOR;
        g.colors[x]![y] = '#2c2a40';
      }
    }
    g.player.x = M.hero.x; g.player.y = M.hero.y;
    g.npcTiles.push({ x: M.seanchai.x, y: M.seanchai.y, npcId: 'seanchai' });
    g.npcTiles.push({ x: M.campfire.x, y: M.campfire.y, npcId: '__campfire__' });
    g.npcTiles.push({ x: M.peddler.x, y: M.peddler.y, npcId: '__peddler__' });
    // Between-floor choices stand here in person: An Draoi's unsworn pact as
    // a deity emissary, and any pending floor event as a waiting stranger.
    if (g.pactPending) g.npcTiles.push({ x: M.emissary.x, y: M.emissary.y, npcId: '__pact__' });
    if (g.pendingFloorEvent) g.npcTiles.push({ x: M.stranger.x, y: M.stranger.y, npcId: '__event__' });
    // Fixtures of the hall: the ogham stone (lore codex), the Well of
    // Segais (gold for wisdom), and the Sídhe coffer (cross-run gold stash);
    // Aoife takes a seat only while she has a vengeance contract to offer,
    // and the Ogham-mark tattooist drifts through on some visits (never once
    // the hero's five marks are spent).
    g.npcTiles.push({ x: M.oghamStone.x, y: M.oghamStone.y, npcId: '__ogham_stone__' });
    g.npcTiles.push({ x: M.well.x, y: M.well.y, npcId: '__well__' });
    g.npcTiles.push({ x: M.stash.x, y: M.stash.y, npcId: '__stash__' });
    if (!g.activeBountyQuest) g.npcTiles.push({ x: M.aoife.x, y: M.aoife.y, npcId: 'aoife' });
    if (rollTattooist) g.moundTattooist = this.game.rng() < Balance.CONFIG.waystation.tattooistChance;
    if (g.moundTattooist && !g.player.brandsCapped) {
      g.tattooTiles.push({ x: M.tattooist.x, y: M.tattooist.y });
    }
    // An Dagda takes the north-west corner while his gift goes unclaimed.
    if (g.dagdaGiftEarned && !g.dagdaGiftClaimed) {
      g.npcTiles.push({ x: M.x0, y: M.y0, npcId: '__dagda__' });
    }
    // Everyone freed from Fomorian captivity settles along the north wall.
    RESCUES.filter(r => g.rescuedIds.has(r.id)).forEach((r, i) => {
      const seat = Waystation.rescueSeat(i);
      g.npcTiles.push({ x: seat.x, y: seat.y, npcId: `__rescue_${r.id}__` });
    });
    g.map[M.stairs.x]![M.stairs.y] = Tile.STAIRS;
    g.colors[M.stairs.x]![M.stairs.y] = '#6d3f7a';
    // The mound is home ground — no fog here (updateVisibility early-returns
    // while the Blockbuilding layer is suspended, so set the full reveal directly).
    g.revealAll();
  }

  /**
   * Bump-dispatch for stepping onto an `npcTile`: moves the hero on, consumes
   * the tile, and runs the matching verb. Every branch is terminal (it either
   * advances the turn or opens a dialog whose callback does). Fixtures
   * (ogham stone, well, coffer, seanchaí) re-push themselves so they persist.
   */
  interact(npcTile: NpcTile): void {
    const g = this.game;
    const nx = npcTile.x, ny = npcTile.y;
    g.player.x = nx; g.player.y = ny;
    g.npcTiles = g.npcTiles.filter(n => n !== npcTile);
    // Waystation residents: the deity emissary swears An Draoi's pact, the
    // waiting stranger delivers the held floor event, the hearth-fire heals
    // in full once, and the Fear Dearg's stall opens the regular peddler shop.
    // An Dagda: the once-per-run gift for a perfect (4-line) clear.
    if (npcTile.npcId === '__dagda__') {
      const pool = Boon.BY_TIER[3];
      const gift = pool[Math.floor(this.game.rng() * pool.length)]!;
      const grant = (): void => {
        g.player.addBoon(gift);
        g.dagdaGiftClaimed = true;
        g.storyBeats.push("took a gift from An Dagda's cauldron");
        g.cb.onBeam?.(nx, '217,164,65');
        g.cb.onParticleBurst?.(nx, ny, 12, '#d9a441', 'fx_arcane');
        g.pushUI();
      };
      if (!g.cb.onFloorEvent) { grant(); g.advanceTurn(); return; }
      const event: FloorEventDef = {
        id: '__dagda__', emoji: 'npc_dagda', title: 'An Dagda',
        flavor: 'A vast old man fills the corner of the mound, a club that could level a house resting easy across his knees and a cauldron steaming beside him. "A fourfold clearing," he rumbles, approving. "Few enough manage that above ground, let alone under it. Come — no one leaves my cauldron unsatisfied."',
        options: [{
          label: 'Accept the gift',
          desc: `${gift.name} — ${gift.desc}`,
          apply: (): string => `He ladles something bright out of the cauldron and presses it into your hands. You gain ${gift.name}!`,
        }],
      };
      g.paused = true;
      g.cb.onFloorEvent(event, (index) => {
        const msg = event.options[index]?.apply(g) ?? 'Nothing happened.';
        grant();
        g.cb.log(msg, 'log-perk', 'npc_dagda');
        g.paused = false;
        g.cb.onAction();
      });
      return;
    }
    if (npcTile.npcId === '__pact__') {
      g.cb.onBeam?.(nx, '141,111,212');
      if (!g.pact.offer()) g.advanceTurn();
      return;
    }
    // A rescuable captive (on the floor) or rescued resident (in the mound).
    if (npcTile.npcId.startsWith('__rescue_')) {
      const rescueId = npcTile.npcId.slice('__rescue_'.length, -2);
      const rescue = RESCUES.find(r => r.id === rescueId);
      if (!rescue) { g.advanceTurn(); return; }
      if (g.inWaystation) {
        g.npcTiles.push(npcTile);  // residents stay
        g.vendorOffers.rescueService(rescue);
        return;
      }
      // Still guarded: no rescue until every captor is dead.
      if (g.rescueGuards.some(guard => guard.hp > 0 && g.monsters.includes(guard))) {
        g.npcTiles.push(npcTile);
        g.cb.log(rescue.captiveLine, 'log-neutral', rescue.char);
        g.advanceTurn();
        return;
      }
      // Freed — thanks, then away to the mounds.
      const free = (): void => {
        g.rescuedIds.add(rescue.id);
        g.storyBeats.push(`freed ${rescue.name} from Fomorian captors`);
        g.cb.onBeam?.(nx, '230,180,90');
        g.cb.onAudio?.('bountyFulfilled');
      };
      if (!g.cb.onFloorEvent) { free(); g.advanceTurn(); return; }
      const event: FloorEventDef = {
        id: npcTile.npcId, emoji: rescue.char, title: rescue.name,
        flavor: rescue.thanksLine,
        options: [{
          label: 'See them off', desc: 'They will wait for you in the sídhe mounds.',
          apply: (): string => `${rescue.name} steps into a pillar of light and is gone — away to the mounds, where the deep cannot follow.`,
        }],
      };
      g.paused = true;
      g.cb.onFloorEvent(event, (index) => {
        const msg = event.options[index]?.apply(g) ?? 'Nothing happened.';
        free();
        g.cb.log(msg, 'log-perk', rescue.char);
        g.paused = false;
        g.cb.onAction();
      });
      return;
    }
    // The ogham stone is a fixture — reading it never consumes it.
    if (npcTile.npcId === '__ogham_stone__') {
      g.npcTiles.push(npcTile);
      g.cb.log('You trace the ogham strokes. Old names surface: everything the deep has shown you.', 'log-perk', 'tile_ogham_stone');
      g.cb.onOpenCodex?.();
      return;
    }
    if (npcTile.npcId === '__stash__') {
      const stashed = g.stash.load();
      const pct = Math.round(Balance.CONFIG.waystation.stashRecoveryPct * 100);
      const stashEvent: FloorEventDef = {
        id: '__stash__', emoji: 'item_gold_pouch', title: 'The Sídhe Coffer',
        flavor: `A stone coffer, older than the mound around it. ${stashed > 0 ? `Inside, ${stashed} gold glints — left by those who came before.` : 'It sits empty, waiting for an offering.'} What is left with the Sídhe passes on when you fall — less their tithe.`,
        options: [
          {
            label: g.gold > 0 ? `Leave your gold (${g.gold})` : 'Leave your gold',
            desc: `Your next self inherits ${pct}% of everything in the coffer.`,
            apply: (game: Game): string => {
              if (game.gold <= 0) return 'Your purse is empty. The coffer keeps its silence.';
              const left = game.gold;
              const total = g.stash.add(left);
              game.gold = 0;
              game.storyBeats.push('left gold in the keeping of the Sídhe');
              return `You pour ${left} gold into the coffer — ${total} now waits in the Sídhe's keeping.`;
            },
          },
          { label: 'Keep your purse', desc: '', apply: (): string => 'Gold spends better in living hands. You leave the coffer be.' },
        ],
      };
      g.cb.onBeam?.(nx, '217,164,65');
      if (!g.cb.onFloorEvent) { g.npcTiles.push(npcTile); g.advanceTurn(); return; }
      g.paused = true;
      g.cb.onFloorEvent(stashEvent, (index) => {
        const msg = stashEvent.options[index]?.apply(g) ?? 'Nothing happened.';
        g.cb.log(msg, 'log-perk', 'item_gold_pouch');
        // The coffer is a fixture — it stays whether you gave or not.
        g.npcTiles.push(npcTile);
        g.paused = false;
        g.pushUI();
        g.cb.onAction();
      });
      return;
    }
    if (npcTile.npcId === '__well__') {
      const cost = Balance.CONFIG.well.baseCost + g.dungeonLevel * Balance.CONFIG.well.costPerFloor;
      const xpGain = Balance.CONFIG.well.baseXp + g.dungeonLevel * Balance.CONFIG.well.xpPerFloor;
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
      if (!g.cb.onFloorEvent) { g.npcTiles.push(npcTile); g.advanceTurn(); return; }
      g.paused = true;
      g.cb.onFloorEvent(wellEvent, (index) => {
        const msg = wellEvent.options[index]?.apply(g) ?? 'Nothing happened.';
        g.cb.log(msg, 'log-perk', 'tile_well');
        // The well is a fixture — it stays whether you drink or not.
        g.npcTiles.push(npcTile);
        g.paused = false;
        g.cb.onAction();
      });
      return;
    }
    if (npcTile.npcId === '__event__') {
      const event = g.pendingFloorEvent;
      g.pendingFloorEvent = null;
      g.cb.onBeam?.(nx, '89,159,124');
      if (event && g.cb.onFloorEvent) {
        g.paused = true;
        g.cb.onFloorEvent(event, (index) => {
          const msg = event.options[index]?.apply(g) ?? 'Nothing happened.';
          g.cb.log(msg, 'log-perk', event.emoji);
          g.storyBeats.push(`answered the call of "${event.title}"`);
          g.paused = false;
          g.cb.onAction();
        });
      } else {
        g.advanceTurn();
      }
      return;
    }
    if (npcTile.npcId === '__campfire__') {
      const healed = g.player.heal(g.player.maxHp);
      g.cb.onParticle(nx, ny, healed > 0 ? `+${healed} HP` : 'warm', '#ff8c32', 14, 'tile_brazier');
      g.cb.onParticleBurst?.(nx, ny, 8, '#ff8c32');
      g.cb.log('You rest by the hearth-fire of the mound. Warmth returns to your bones — fully healed.', 'log-success', 'tile_brazier');
      g.cb.onBeam?.(nx, '255,140,50');
      g.advanceTurn();
      return;
    }
    if (npcTile.npcId === '__peddler__') {
      g.cb.onBeam?.(nx, '198,58,50');
      g.openPeddler();
      return;
    }
    const isGhost = npcTile.npcId === '__ghost__';
    const isSmith = npcTile.npcId.startsWith('__smith_');
    const departOnClose = (): void => {
      g.cb.onBeam?.(nx, isGhost ? '176,196,222' : isSmith ? '184,115,51' : '89,159,124');
    };
    // The seanchaí is a permanent mound resident — he stays by his fire
    // (no beam-away), and his tale gets a proper dialog of its own.
    if (npcTile.npcId === 'seanchai') {
      g.npcTiles.push(npcTile);
      g.npcEncounters.triggerSeanchai();
      return;
    }
    if (isGhost) {
      g.npcEncounters.triggerGhost(departOnClose);
      return;
    }
    if (isSmith) {
      const smithId = npcTile.npcId.slice('__smith_'.length, -2);
      const smith = SMITHS.find(s => s.id === smithId);
      if (smith) g.smithQuest.triggerEncounter(smith, departOnClose);
      else departOnClose();
      return;
    }
    const npc = NPCS.find(n => n.id === npcTile.npcId);
    if (npc) g.npcEncounters.triggerEncounter(npc, departOnClose);
    else departOnClose();
  }
}
