import { MODIFIERS, CLASSES, PATRONS, Biome } from '../content';
import { Balance } from '../balance';
import { GameMath } from '../gameMath';
import type { UIState } from '../types';
import type { Game } from '../game';

/**
 * Builds the {@link UIState} HUD snapshot from the current {@link Game} state.
 * A read-only projection composed onto Game — it assembles public game state
 * plus a few cohesive query methods the game exposes for the private-heavy bits
 * (the duel card, the floor-progress dial). Pushed to the host via `cb.updateUI`.
 */
export class UiStateBuilder {
  constructor(private readonly game: Game) {}

  build(): UIState {
    const g = this.game;
    const activeMod = MODIFIERS.find(m => m.id === g.activeModifierId);
    const activeCls = CLASSES.find(c => c.id === g.activeClassId);
    const activePatron = PATRONS.find(p => p.id === g.activePatronId);
    const biome = Biome.forFloor(g.dungeonLevel);
    return {
      // atk/maxHp/hp can carry fractional precision internally (percentage
      // boons compound on them) — round only here, at the display boundary.
      hp: Math.round(g.player.hp),
      maxHp: Math.round(g.player.maxHp),
      floor: g.dungeonLevel,
      totalXpEarned: g.player.totalXpEarned,
      gold: g.gold,
      gravityRate: GameMath.tickMsForLevel(g.dungeonLevel, g.player.tickSlowPercent + g.biomeGravityPct + g.omenGravityPct + g.difficultyGravityPct + g.heatGravityPct),
      nextType: g.nextType,
      heldType: g.heldType,
      canHold: g.canHold,
      pieceState: g.currentCursed ? 'cursed' : g.currentBlessed ? 'blessed' : 'normal',
      xp: g.player.xp,
      xpToNext: g.player.xpToNext,
      playerLevel: g.player.playerLevel,
      boons: g.player.boons.map(b => ({ char: b.def.char, name: b.def.name, stacks: b.stacks, desc: b.def.desc })),
      brands: g.player.brands.map(b => {
        const count = g.player.brands.filter(x => x.brand.id === b.brand.id).length;
        return {
          slot: b.slot, char: b.brand.char, name: b.brand.name,
          setActive: count >= b.brand.setSize,
          desc: b.brand.desc, setDesc: b.brand.setDesc, setSize: b.brand.setSize,
        };
      }),
      brandsAcquiredTotal: g.player.brandsAcquiredTotal,
      brandsMaxLifetime: Balance.CONFIG.brands.maxLifetime,
      statuses: g.player.statuses,
      activeModifier: activeMod ? { emoji: activeMod.emoji, name: activeMod.name } : null,
      activeClass: activeCls
        ? {
            emoji: activePatron?.char ?? activeCls.emoji,
            name: activePatron ? `${activeCls.name} — ${activePatron.name}` : activeCls.name,
          }
        : null,
      // During a duel the boss's own causeway is the focus — the duel card names
      // the boss, so the generic biome badge ("Bres's Causeway") is suppressed.
      biomeName: g.inCausewayDuel ? '' : biome.name,
      activeOmen: g.activeOmen ? { icon: g.activeOmen.icon, name: g.activeOmen.name } : null,
      activeDifficulty: g.activeDifficultyId !== 'standard' && g.difficultyTuning().name !== ''
        ? { icon: g.difficultyTuning().icon, name: g.difficultyTuning().name.split(' — ')[0]! }
        : null,
      heatLevel: g.heatLevel > 0 ? g.heatLevel : null,
      duel: g.causewayDuel.uiState(),
      fidchell: g.fidchell.uiState(),
      rangedAbility: g.player.rangedAbility
        ? {
            name:        g.player.rangedAbility.name,
            emoji:       g.player.rangedAbility.emoji,
            cooldown:    g.player.rangedCooldown,
            cooldownMax: g.player.rangedAbility.cooldownMax,
            ammo:        g.player.rangedAmmo >= 0 ? g.player.rangedAmmo : null,
            hpCostPct:   typeof g.player.rangedAbility.params?.['hpCostPct'] === 'number'
              ? g.player.rangedAbility.params['hpCostPct'] as number
              : null,
            spellIndex:  g.player.activeSpellIndex,
            spellCount:  g.player.spellbook.length,
          }
        : null,
      characterSheet: g.characterSheetView.build(),
      floorProgress: g.floorProgressState(),
    };
  }
}
