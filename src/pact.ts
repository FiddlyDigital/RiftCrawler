import { PATRONS, EffectResolver, type PatronDef } from './content';
import type { EffectSpec, FloorEventDef } from './types';
import type { Game } from './game';

/** Human-readable one-line summary of a patron's signature spell (for the pact modal). */
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

const TOLL_LABELS: Record<string, string> = { atk: 'ATK', maxHp: 'Max HP', tickSlowPercent: 'gravity speed' };

/** Human-readable summary of a spell's one-time toll, applied the moment the patron grants it. */
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

/**
 * An Draoi's pact ceremony: the class whose power is a bargain with a deity.
 * Bumping the waystation's emissary calls two of the three patrons; swearing to
 * one applies its passive and its level-gated spellbook (each paid for in a
 * one-time toll). Composed onto {@link Game}; holds no state of its own (the
 * chosen patron lives on Game as `activePatronId`, part of the save).
 */
export class PactCeremony {
  constructor(private readonly game: Game) {}

  /**
   * Offers the pact modal (two random patrons) when the draoi hasn't sworn one
   * yet. The pact IS the class, so there's no decline. Returns true if opened.
   */
  offer(): boolean {
    const g = this.game;
    if (g.activeClassId !== 'draoi' || g.activePatronId !== null) return false;
    if (g.dungeonLevel < 2 || !g.cb.onFloorEvent) return false;

    // Only 2 of the 3 deities call on any given run — which two is the rift's whim.
    const offered = [...PATRONS].sort(() => this.game.rng() - 0.5).slice(0, 2);
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

    g.presentChoice(event, 'fx_arcane');
    return true;
  }

  /**
   * Swears the pact with the named deity: applies the passive, grants the
   * level-appropriate spells (paying each toll), and swaps in the signature
   * spell as the active ranged ability.
   * @throws {TypeError} If `id` is not a non-empty string.
   */
  apply(id: string): void {
    if (typeof id !== 'string' || id.length === 0) throw new TypeError('PactCeremony.apply: "id" must be a non-empty string');
    const g = this.game;
    const patron = PATRONS.find(p => p.id === id);
    if (!patron) return;
    g.activePatronId = id;
    EffectResolver.applyToPlayer(g.player, patron.effects);
    g.player.spellbook = patron.spells
      .filter(s => (s.unlockLevel ?? 1) <= g.player.playerLevel)
      .map(s => ({ ...s }));
    for (const spell of g.player.spellbook) EffectResolver.applyToPlayer(g.player, spell.toll);
    g.player.hp = Math.min(g.player.hp, g.player.maxHp);
    g.player.activeSpellIndex = 0;
    g.player.rangedAbility = g.player.spellbook[0] ?? null;
    g.player.rangedCooldown = 0;
    g.storyBeats.push(`swore a pact with ${patron.deity}`);
    g.cb.onCodexDiscover?.('patron', id);
    g.cb.log(`${patron.name} — ${patron.spells[0]!.name} replaces Wild Surge. (Q)`, 'log-perk', patron.char);
    g.cb.log(patron.tollDesc, 'log-neutral', patron.char);
    g.cb.onParticleBurst?.(g.player.x, g.player.y, 12, '#8d6fd4', patron.char);
    g.cb.onRingPulse?.(g.player.x, g.player.y, '141,111,212');
    g.cb.onAudio?.('pactSworn');
    g.pushUI();
  }

  /**
   * Adds any patron spells whose unlockLevel the player has now reached. Called
   * from the level-up choke point so every XP source unlocks on time.
   */
  syncUnlocks(): void {
    const g = this.game;
    const patron = PATRONS.find(p => p.id === g.activePatronId);
    if (!patron) return;
    for (const spell of patron.spells) {
      if ((spell.unlockLevel ?? 1) > g.player.playerLevel) continue;
      if (g.player.spellbook.some(s => s.name === spell.name)) continue;
      g.player.spellbook.push({ ...spell });
      EffectResolver.applyToPlayer(g.player, spell.toll);
      g.player.hp = Math.min(g.player.hp, g.player.maxHp);
      const toll = describeToll(spell.toll);
      g.cb.log(`${patron.deity} grants a new spell: ${spell.name}! (${toll} — E cycles spells)`, 'log-perk', spell.emoji);
      g.cb.onParticleBurst?.(g.player.x, g.player.y, 8, '#8d6fd4', spell.emoji);
    }
  }
}
