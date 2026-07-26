import type { ShapeKey } from './config';
import { BODY_PARTS, type FloorEventDef, type ShopItem } from './types';
import { Boon, Brand, SMITHS, type RescueDef } from './content';
import { Balance } from './balance';
import type { Game } from './game';

/**
 * The run's in-world vendors and reward stalls: the altar (boon pick), the
 * tattoo artist (Ogham brands), the Fear Dearg's shop (gold sink), and the
 * rescued-NPC services (the Gobán Saor's shaped stone, Fedelm's boss omen,
 * Airmed's herbs, Abcán's lullaby, Bricriu's Champion's Portion). Each builds a
 * modal payload and hands it to the host via `cb`. Composed onto {@link Game};
 * holds no state of its own — gold, boons, brands and the run flags it touches
 * all live on Game.
 */
export class VendorOffers {
  constructor(private readonly game: Game) {}

  /** Opens the altar boon-choice modal for the given reward tier (reached by stepping on an altar tile). `onClosed` fires once a boon is chosen. */
  altar(tier: 1 | 2 | 3, onClosed?: () => void): void {
    const g = this.game;
    g.paused = true;
    const pool = Boon.BY_TIER[tier];
    const ownedIds = (): string[] => g.player.boons.map(b => b.id);
    let cost = Balance.CONFIG.economy.geasaRerollBaseCost;
    let choices = Boon.pickThree(pool, ownedIds());
    const commit = (index: number): void => {
      g.player.addBoon(choices[index]!);
      g.cb.onParticleBurst?.(g.player.x, g.player.y, 6, '#b98fc4');
      g.paused = false;
      g.pushUI();
      g.cb.onAction?.();
      onClosed?.();
    };
    g.cb.onOpenAltar?.(tier, choices, commit, {
      gold: g.gold,
      cost,
      run: () => {
        if (g.gold < cost) return null;
        g.gold -= cost;
        cost = Math.floor(cost * Balance.CONFIG.economy.geasaRerollCostGrowth);
        choices = Boon.pickThree(pool, ownedIds());
        g.pushUI();
        return { choices, gold: g.gold, cost };
      },
    });
  }

  /** Opens the tattoo-artist brand-choice modal (reachable via a tattoo-artist tile). `onClosed` fires once a mark is chosen. */
  tattooArtist(onClosed?: () => void): void {
    const g = this.game;
    g.paused = true;
    const ownedIds = (): string[] => g.player.brands.map(b => b.brand.id);
    let cost = Balance.CONFIG.economy.ogmRerollBaseCost;
    let choices = Brand.pickThree(ownedIds());
    const commit = (index: number): void => {
      const slot = BODY_PARTS[g.player.brands.length % BODY_PARTS.length]!;
      const chosen = choices[index]!;
      g.player.addBrand(slot, chosen);
      const setCompleted = g.player.brands.filter(b => b.brand.id === chosen.id).length % chosen.setSize === 0;
      g.cb.onParticleBurst?.(g.player.x, g.player.y, setCompleted ? 14 : 6, setCompleted ? '#d9a441' : '#9d7bc7');
      g.cb.log(`${choices[index]!.name} Ogham mark tattooed on ${slot.replace('_', ' ')}!`, 'log-perk', 'tile_altar');
      g.paused = false;
      g.pushUI();
      g.cb.onAction?.();
      onClosed?.();
    };
    g.cb.onOpenTattooArtist?.(choices, commit, {
      gold: g.gold,
      cost,
      run: () => {
        if (g.gold < cost) return null;
        g.gold -= cost;
        cost = Math.floor(cost * Balance.CONFIG.economy.ogmRerollCostGrowth);
        choices = Brand.pickThree(ownedIds());
        g.pushUI();
        return { choices, gold: g.gold, cost };
      },
    });
  }

  /**
   * The Fear Dearg's stall — the gold sink. Prices scale with depth; each
   * item can be bought once per visit.
   */
  peddler(): void {
    const g = this.game;
    if (!g.cb.onOpenShop) return;
    g.paused = true;
    const prices = Balance.CONFIG.economy.shop.prices;
    const cost = (p: { base: number; perFloor: number }): number => p.base + p.perFloor * g.dungeonLevel;
    const stock: ShopItem[] = [
      { id: 'heal',  icon: 'sprite_potion',           name: 'Hearth Broth',       desc: 'Restore to full HP',                     cost: cost(prices.heal),  purchased: false },
      { id: 'maxhp', icon: 'item_heart',              name: 'Bogwood Charm',      desc: '+10% Max HP',                            cost: cost(prices.maxhp), purchased: false },
      { id: 'atk',   icon: 'sprite_equip_iron_sword', name: 'Ogham-Etched Edge',  desc: '+10% ATK',                               cost: cost(prices.atk),   purchased: false },
      { id: 'ward',  icon: 'status_poison',           name: 'Deathward Sigil',    desc: 'Survive one killing blow (this floor)',  cost: cost(prices.ward),  purchased: false },
    ];
    const buy = (id: string): { gold: number; ok: boolean } => {
      const item = stock.find(s => s.id === id);
      if (!item || item.purchased || g.gold < item.cost) return { gold: g.gold, ok: false };
      g.gold -= item.cost;
      item.purchased = true;
      switch (id) {
        case 'heal':  g.player.heal(g.player.maxHp); break;
        case 'maxhp': g.player.maxHp *= 1.10; g.player.hp = Math.min(g.player.hp * 1.10, g.player.maxHp); break;
        case 'atk':   g.player.atk *= 1.10; break;
        case 'ward':  g.player.deathwardCharges += 1; break;
      }
      g.cb.log(`Bought ${item.name} for ${item.cost}g.`, 'log-perk', item.icon);
      g.pushUI();
      return { gold: g.gold, ok: true };
    };
    g.cb.log('A red-capped peddler unfolds his stall...', 'log-perk', 'tile_merchant');
    g.cb.onOpenShop(stock, g.gold, buy, () => { g.paused = false; g.pushUI(); });
  }

  /** The service a freed nexus-rescue NPC offers, built as a floor-event dialog keyed on the rescue's `service` kind. */
  rescueService(rescue: RescueDef): void {
    const g = this.game;
    if (!g.cb.onFloorEvent) { g.advanceTurn(); return; }
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
      const nextBossFloor = (Math.floor(g.dungeonLevel / interval) + 1) * interval;
      const boss = g.previewBossForFloor(nextBossFloor);
      const smithsLeft = g.smithsMetCount < SMITHS.length && !g.spearForged;
      const smithLine = smithsLeft
        ? ` The anvils still ring below — ${SMITHS.length - g.smithsMetCount} smith${SMITHS.length - g.smithsMetCount === 1 ? '' : 's'} yet to find.`
        : '';
      event = {
        id: `__service_${rescue.id}__`, emoji: rescue.char, title: rescue.name,
        flavor: `${rescue.serviceFlavor} "I see crimson at floor ${nextBossFloor} — ${boss.name} waits there, and knows you are coming.${smithLine}"`,
        options: [{ label: 'Thank her', desc: '', apply: (): string => 'The flame gutters out. Fedelm is already looking at something else — something further down.' }],
      };
    } else if (rescue.service === 'healer') {
      const cost = Balance.CONFIG.rescues.healerBaseCost + g.dungeonLevel * Balance.CONFIG.rescues.healerCostPerFloor;
      const hpGain = Balance.CONFIG.rescues.healerHpGain;
      event = {
        id: `__service_${rescue.id}__`, emoji: rescue.char, title: rescue.name,
        flavor: rescue.serviceFlavor,
        options: [
          {
            label: `Buy her herbs (${cost} gold)`,
            desc: `+${hpGain} Max HP, permanently.`,
            apply: (game: Game): string => {
              if (game.gold < cost) return 'Airmed folds the herbs away. "Healing is costly. Dying is costlier — come back with gold."';
              game.gold -= cost;
              game.player.maxHp += hpGain;
              game.player.hp += hpGain;
              game.storyBeats.push("ate of the herbs of Miach's grave");
              game.pushUI();
              return `The herbs are bitter as grief and warm as a hearth. +${hpGain} Max HP, forever.`;
            },
          },
          { label: 'Not today', desc: '', apply: (): string => '"Then don\'t come crying to me with your ribs showing," she says, not unkindly.' },
        ],
      };
    } else if (rescue.service === 'harper') {
      const played = g.harperLullFloor === g.dungeonLevel + 1;
      event = {
        id: `__service_${rescue.id}__`, emoji: rescue.char, title: rescue.name,
        flavor: played
          ? 'Abcán is still playing, eyes closed. The suantraí already drifts down the stair ahead of you — one floor of it is all one harp can hold.'
          : rescue.serviceFlavor,
        options: played
          ? [{ label: 'Leave him to it', desc: '', apply: (): string => 'You leave the harper to his slow, heavy tune.' }]
          : [
              {
                label: 'Ask for the suantraí',
                desc: 'Every monster on the NEXT floor arrives drowsy (stunned 2 turns).',
                apply: (game: Game): string => {
                  game.harperLullFloor = game.dungeonLevel + 1;
                  game.storyBeats.push("descended under Abcán's sleep-strain");
                  return 'Abcán bends to the strings, and the stairwell fills with a tune like falling snow. Whatever waits below will wake slowly.';
                },
              },
              { label: 'Not now', desc: '', apply: (): string => '"Suit yourself," he says. "The deep is louder without me."' },
            ],
      };
    } else {
      const fed = g.portionAtkBonus > 0;
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
    g.presentChoice(event, rescue.char);
  }
}
