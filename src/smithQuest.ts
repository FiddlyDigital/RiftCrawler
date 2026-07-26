import { Balance } from './balance';
import { SMITHS, type Smith } from './content';
import type { FloorEventDef } from './types';
import type { Game } from './game';

/**
 * Lugh's Spear questline: the three legendary smiths (Luchta → Credne →
 * Goibniu) who appear on smith-eligible floors, each gifting one part of the
 * Spear; the third meeting reforges it whole and swaps it in as the ranged
 * ability. Composed onto {@link Game}; the run state (pendingSmithFloor,
 * smithsMetCount, spearPartsHeld, spearForged) lives on Game and is saved.
 */
export class SmithQuest {
  constructor(private readonly game: Game) {}

  /** Sets pendingSmithFloor and gives an ambient heads-up on a smith-eligible floor entry. */
  announceFloor(isBossFloor: boolean): void {
    const g = this.game;
    if (isBossFloor || g.pendingSmithFloor || g.smithsMetCount >= SMITHS.length) return;
    if (g.dungeonLevel % Balance.CONFIG.smiths.floorInterval !== 0) return;
    g.pendingSmithFloor = true;
    g.cb.log('You hear the clang of an anvil in the distance...', 'log-perk', 'fx_impact');
    g.cb.onToast?.('You hear the clang of an anvil in the distance...', 'fx_impact');
    g.cb.onParticleBurst?.(g.player.x, g.player.y, 6, '#d9a441');
  }

  /** The next smith due this run (Luchta → Credne → Goibniu), or null once all three are met. */
  next(): Smith | null {
    return (SMITHS as Smith[])[this.game.smithsMetCount] ?? null;
  }

  /** Grants the smith's part, and — on the third meeting (Goibniu) — reforges the complete Spear of Lugh. */
  triggerEncounter(smith: Smith, onClosed?: () => void): void {
    const g = this.game;
    const isReforge = smith.partKey === 'head' && g.spearPartsHeld.has('shaft') && g.spearPartsHeld.has('bolts');
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
    g.presentChoice(event, smith.char, onClosed);
  }
}
