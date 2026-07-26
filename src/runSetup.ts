import { CLASSES, MODIFIERS, type ClassDef } from './content';
import { Balance } from './balance';
import type { ModifierDef } from './types';
import type { Game } from './game';

/**
 * Run-configuration pickers: the start-screen and New Game+ choices that shape
 * a run before (and just as) it begins — starting class, difficulty preset,
 * heat level, and Rift Curse modifier. Each `getRandom*` supplies the offered
 * options and each `apply*` commits the choice to the live {@link Game}. The
 * chosen ids live on Game (activeClassId/activeDifficultyId/activeModifierId/
 * heatLevel), so this class holds no state of its own.
 */
export class RunSetup {
  constructor(private readonly game: Game) {}

  // ── Class selection ────────────────────────────────────────────────────────

  /**
   * The classes offered on the start-screen picker.
   * @throws {TypeError} If `count` is not a positive finite number.
   */
  getRandomClasses(count = 2): ClassDef[] {
    if (typeof count !== 'number' || !Number.isFinite(count) || count <= 0) {
      throw new TypeError('RunSetup.getRandomClasses: "count" must be a positive finite number');
    }
    return CLASSES.slice(0, count);
  }

  /**
   * Applies the chosen starting class's stat effects/ability and sets the
   * hero's board sprite to match.
   * @throws {TypeError} If `id` is not a non-empty string.
   */
  applyClass(id: string): void {
    if (typeof id !== 'string' || id.length === 0) throw new TypeError('RunSetup.applyClass: "id" must be a non-empty string');
    const g = this.game;
    const cls = CLASSES.find(c => c.id === id);
    if (!cls) return;
    cls.apply(g.player);
    g.player.char = cls.emoji;  // the hero looks like the card you picked
    g.activeClassId = id;
    g.cb.log(`Playing as ${cls.name}: ${cls.tagline}`, 'log-perk', cls.emoji);
    g.pushUI();
  }

  // ── Difficulty selection ─────────────────────────────────────────────────

  /**
   * Applies the chosen run difficulty. Called once at run start, after the
   * class is applied so the Max-HP multiplier covers class bonuses too; the
   * monster/gold/gravity multipliers are read live from the preset at their
   * respective choke points for the rest of the run.
   * @throws {TypeError} If `id` is not a non-empty string.
   */
  applyDifficulty(id: string): void {
    if (typeof id !== 'string' || id.length === 0) throw new TypeError('RunSetup.applyDifficulty: "id" must be a non-empty string');
    const g = this.game;
    const preset = Balance.CONFIG.difficulty.presets.find(p => p.id === id);
    if (!preset) return;
    g.activeDifficultyId = id;
    if (preset.playerHpMult !== 1) {
      g.player.maxHp = Math.round(g.player.maxHp * preset.playerHpMult);
      g.player.hp = Math.min(Math.round(g.player.hp * preset.playerHpMult), g.player.maxHp);
    }
    g.xpMultiplier *= preset.xpMult;
    if (id !== 'standard') {
      g.storyBeats.push(`chose ${preset.name.split(' — ')[0]!}`);
      g.cb.log(`${preset.name}. ${preset.desc}`, 'log-perk', preset.icon);
    }
    g.pushUI();
  }

  // ── New Game+ heat ───────────────────────────────────────────────────────

  /**
   * Applies the chosen New Game+ heat. Called once at run start (only offered
   * after a victory has unlocked the ladder); each active geis pays
   * +`ngplus.xpBonusPerHeat` XP.
   * @throws {TypeError} If `level` is not a finite number.
   */
  applyHeat(level: number): void {
    if (typeof level !== 'number' || !Number.isFinite(level)) throw new TypeError('RunSetup.applyHeat: "level" must be a finite number');
    const g = this.game;
    const tiers = Balance.CONFIG.ngplus.tiers;
    g.heatLevel = Math.max(0, Math.min(Math.floor(level), tiers.length));
    if (g.heatLevel === 0) return;
    g.xpMultiplier *= 1 + Balance.CONFIG.ngplus.xpBonusPerHeat * g.heatLevel;
    for (const t of tiers) {
      if (t.level <= g.heatLevel) g.cb.log(`${t.name} — ${t.desc}`, 'log-boss', t.icon);
    }
    g.cb.log(`Heat ${g.heatLevel}: +${Math.round(Balance.CONFIG.ngplus.xpBonusPerHeat * g.heatLevel * 100)}% XP for the burden.`, 'log-perk', 'special_sacred');
    g.storyBeats.push(`took up ${g.heatLevel} ${g.heatLevel === 1 ? 'geis' : 'geasa'} of the victorious`);
    g.pushUI();
  }

  // ── Modifier selection ───────────────────────────────────────────────────

  /**
   * A random selection of run modifiers (Rift Curses) for the start-screen picker.
   * @throws {TypeError} If `count` is not a positive finite number.
   */
  getRandomModifiers(count = 3): ModifierDef[] {
    if (typeof count !== 'number' || !Number.isFinite(count) || count <= 0) {
      throw new TypeError('RunSetup.getRandomModifiers: "count" must be a positive finite number');
    }
    const shuffled = [...MODIFIERS].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, count);
  }

  /**
   * Applies the chosen run modifier's effect for the whole run.
   * @throws {TypeError} If `id` is not a non-empty string.
   */
  applyModifier(id: string): void {
    if (typeof id !== 'string' || id.length === 0) throw new TypeError('RunSetup.applyModifier: "id" must be a non-empty string');
    const g = this.game;
    const mod = MODIFIERS.find(m => m.id === id);
    if (!mod) return;
    mod.apply(g);
    g.activeModifierId = id;
    g.cb.log(`Rift Curse active: ${mod.name} — ${mod.desc}`, 'log-perk', mod.emoji);
    g.pushUI();
  }
}
