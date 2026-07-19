import { BaseModal } from './base-modal';
import { SpriteService } from '../sprites';
import type { HeatTier } from '../balance';

/**
 * The New Game+ heat picker, shown at run start once a victory has unlocked
 * the ladder. The player chooses a heat level from 0 (a normal run) up to
 * the highest they've unlocked; each level stacks one more permanent geis
 * (handicap) in exchange for bonus XP. Higher heat = every geis at or below
 * that level.
 */
export class HeatModal extends BaseModal {
  protected template(): string {
    return `<div class="modal-card" style="max-width:360px;">
      <div class="modal-title" id="heat-title" style="color:#c1443c;font-size:20px;">GEASA OF THE VICTORIOUS</div>
      <p style="color:#666;margin:4px 0 12px 0;font-size:11px;">You have walked the causeway to its end. Take up the geasa of those who won before you — each is a burden, and a badge. More burden, more glory (and XP).</p>
      <div id="heat-choices" style="display:flex;flex-direction:column;gap:8px;"></div>
    </div>`;
  }

  /**
   * Shows the heat picker.
   * @param tiers - The full ladder from `balance.json` (only levels ≤ `maxHeat` are selectable).
   * @param maxHeat - The highest heat the player has unlocked.
   * @param xpBonusPerHeat - XP bonus per active geis, for the card copy.
   * @throws {TypeError} If `tiers` is null/undefined or `onSelect` is not a function.
   */
  public showHeatPick(tiers: HeatTier[], maxHeat: number, xpBonusPerHeat: number, onSelect: (level: number) => void): void {
    if (!tiers) throw new TypeError('HeatModal.showHeatPick: "tiers" must not be null/undefined');
    if (typeof onSelect !== 'function') throw new TypeError('HeatModal.showHeatPick: "onSelect" must be a function');
    const container = this.querySelector('#heat-choices')!;
    container.innerHTML = '';
    const cap = Math.min(maxHeat, tiers.length);

    // Heat 0 — a clean run, always offered.
    const zero = document.createElement('button');
    zero.className = 'modifier-btn';
    zero.innerHTML = `<span class="modifier-emoji">${SpriteService.iconHTML('sprite_player', 24)}</span><div class="modifier-info"><strong>No Geis — a clean descent</strong><span>The causeway as it was. No handicaps, no bonus.</span></div>`;
    zero.addEventListener('click', () => { this.hide(); onSelect(0); });
    container.appendChild(zero);

    // Heat 1..cap — each row stacks every geis up to its level.
    for (let level = 1; level <= cap; level++) {
      const tier = tiers.find(t => t.level === level);
      if (!tier) continue;
      const xpPct = Math.round(xpBonusPerHeat * level * 100);
      const btn = document.createElement('button');
      btn.className = 'modifier-btn';
      btn.innerHTML = `<span class="modifier-emoji">${SpriteService.iconHTML(tier.icon, 24)}</span><div class="modifier-info"><strong>Heat ${level}: ${tier.name} <span style="color:#8a7a4d;font-size:9px;">+${xpPct}% XP</span></strong><span>${tier.desc}${level > 1 ? ' <em style="color:#777;">(and every geis before it)</em>' : ''}</span></div>`;
      btn.addEventListener('click', () => { this.hide(); onSelect(level); });
      container.appendChild(btn);
    }
    this.show();
  }
}

customElements.define('heat-modal', HeatModal);
declare global {
  interface HTMLElementTagNameMap {
    'heat-modal': HeatModal;
  }
}
