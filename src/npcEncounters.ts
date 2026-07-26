import { Balance } from './balance';
import { Boon, CLASSES, NPCS } from './content';
import type { FloorEventDef, NpcDef } from './types';
import type { Game } from './game';

/**
 * Wandering-NPC and ghost encounters. Each is just a {@link FloorEventDef} built
 * at runtime and pushed through the existing floor-event modal — bounties,
 * boon-trades, flavor talkers, the mound seanchaí, and a ghost of a past run.
 * Composed onto {@link Game}; holds no state of its own.
 */
export class NpcEncounters {
  constructor(private readonly game: Game) {}

  /** Opens a wandering-NPC dialog (bounty / trade / flavor), calling `onClosed` when it dismisses. */
  triggerEncounter(npc: NpcDef, onClosed?: () => void): void {
    const g = this.game;
    g.cb.onCodexDiscover?.('npc', npc.id);
    let event: FloorEventDef;

    if (npc.kind === 'bounty') {
      const targetFloor = (Math.floor(g.dungeonLevel / Balance.CONFIG.floors.bossFloorInterval) + 1) * Balance.CONFIG.floors.bossFloorInterval;
      const targetBoss = g.previewBossForFloor(targetFloor);
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
    } else if (npc.kind === 'trade' && g.player.boons.length === 0) {
      // Still a real encounter (dialog + departure beam), just with nothing
      // to trade yet — not a silent log line while the NPC vanishes.
      event = {
        id: npc.id, emoji: npc.char, title: npc.name,
        flavor: `${npc.introLine} ...but you carry nothing worth trading. Come back once you've gathered some Geasa.`,
        options: [{ label: 'Nothing to offer', desc: '', apply: (): string => `${npc.name} shrugs and fades back into the dark.` }],
      };
    } else if (npc.kind === 'trade') {
      const boonOptions = g.player.boons.map(b => ({
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
      const metBefore = g.metFlavorNpcIds.has(npc.id);
      const lines = npc.lines!;
      const flavor = metBefore && npc.returnLine ? npc.returnLine : lines[Math.floor(Math.random() * lines.length)]!;
      g.metFlavorNpcIds.add(npc.id);
      event = {
        id: npc.id, emoji: npc.char, title: npc.name, flavor,
        options: [{ label: 'Farewell', desc: '', apply: (): string => 'You part ways.' }],
      };
    }

    g.storyBeats.push(`crossed paths with ${npc.name}`);
    g.cb.onAudio?.('npcEncounter');
    g.presentChoice(event, npc.char, onClosed);
  }

  /** Your run's story so far, in the seanchaí's voice — built from the game's story beats. */
  private buildOwnTale(): string {
    const g = this.game;
    const cls = CLASSES.find(c => c.id === g.activeClassId)?.name ?? 'a wanderer';
    const beats = g.storyBeats.slice(0, 5);
    const joined = beats.length === 0
      ? 'you have only begun'
      : beats.length === 1
      ? `already you ${beats[0]!}`
      : `already you ${beats.slice(0, -1).join(', ')}, and ${beats[beats.length - 1]!}`;
    const more = g.storyBeats.length > 5 ? ' …and more besides — the verse grows long.' : '';
    return `He closes his eyes and speaks it like an old poem: "${cls}, ${g.dungeonLevel} floor${g.dungeonLevel === 1 ? '' : 's'} into the dark — ${joined}.${more}" He opens one eye. "The ending, now. That part is still yours."`;
  }

  /**
   * The seanchaí of the mound: mound-lore flavor plus "ask for your own tale" —
   * which opens a SECOND dialog whose body IS the tale, so it's read on screen
   * instead of scrolling past in the log. He never departs.
   */
  triggerSeanchai(): void {
    const g = this.game;
    const npc = NPCS.find(n => n.id === 'seanchai');
    if (!npc || !g.cb.onFloorEvent) { g.advanceTurn(); return; }
    g.cb.onCodexDiscover?.('npc', npc.id);
    const metBefore = g.metFlavorNpcIds.has(npc.id);
    const lines = npc.lines ?? [];
    const flavor = (metBefore && npc.returnLine) || lines[Math.floor(Math.random() * Math.max(1, lines.length))] || npc.name;
    g.metFlavorNpcIds.add(npc.id);
    const event: FloorEventDef = {
      id: npc.id, emoji: npc.char, title: npc.name, flavor,
      options: [
        { label: 'Ask for your own tale', desc: 'Hear the seanchaí recount your descent so far.', apply: (): string => '' },
        { label: 'Farewell', desc: '', apply: (): string => 'The seanchaí nods and returns to watching the fire.' },
      ],
    };
    g.cb.onAudio?.('npcEncounter');
    g.paused = true;
    g.cb.onFloorEvent(event, (index) => {
      if (index === 0) {
        // Chain straight into the tale dialog — the game stays paused between the two.
        const tale = this.buildOwnTale();
        g.cb.log(tale, 'log-perk', npc.char);
        g.storyBeats.push('heard your own tale by the mound-fire');
        const taleEvent: FloorEventDef = {
          id: '__seanchai_tale__', emoji: npc.char, title: 'Your Tale, So Far', flavor: tale,
          options: [{ label: 'Farewell', desc: '', apply: (): string => 'The seanchaí nods and returns to watching the fire.' }],
        };
        g.cb.onFloorEvent?.(taleEvent, () => {
          g.paused = false;
          g.cb.onAction();
        });
        return;
      }
      g.cb.log('The seanchaí nods and returns to watching the fire.', 'log-perk', npc.char);
      g.paused = false;
      g.cb.onAction();
    });
  }

  /**
   * A fallen character from a previous run, met again. Laying them to rest
   * grants a fragment of their old power and removes them from the ghost file;
   * turning away leaves them haunting future runs.
   */
  triggerGhost(onClosed?: () => void): void {
    const g = this.game;
    const ghost = g.activeGhost;
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
            game.availableGhosts = game.availableGhosts.filter(gh => gh.id !== ghost.id);
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
    g.activeGhost = null;
    g.cb.onAudio?.('ghostEncounter');
    g.presentChoice(event, 'sprite_boss_wraith', onClosed);
  }
}
