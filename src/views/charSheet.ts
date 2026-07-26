import { PATRONS } from '../content';
import { StatMath } from '../entities';
import { CombatSystem } from '../systems/combat';
import type { CharacterSheetSection } from '../types';
import type { Game } from '../game';

/**
 * Aggregates the player's effective stats into a display-ready character sheet.
 * Boons, brands, and shop purchases all fold into the same `Player` fields, so
 * reading `Player` state IS reading the totals. A read-only projection composed
 * onto {@link Game}.
 */
export class CharacterSheetView {
  constructor(private readonly game: Game) {}

  /** Every effective player stat, grouped into display sections. */
  build(): CharacterSheetSection[] {
    const p = this.game.player;
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
          { label: 'Sworn Patron', value: PATRONS.find(pt => pt.id === this.game.activePatronId)?.deity ?? '—' },
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
}
