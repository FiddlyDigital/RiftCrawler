import { BaseModal } from './base-modal';
import { SpriteService } from '../sprites';
import type { DifficultyPreset } from '../balance';

/** The run-start difficulty picker — the first step of the launch flow. */
export class DifficultyModal extends BaseModal {
  protected template(): string {
    return `<div class="modal-card" style="max-width:340px;">
      <div class="modal-title" id="difficulty-title" style="color:#5b9a68;font-size:20px;">CHOOSE YOUR PATH</div>
      <p style="color:#666;margin:4px 0 12px 0;font-size:11px;">How hard a road down? Changes nothing but the challenge.</p>
      <div id="difficulty-choices" style="display:flex;flex-direction:column;gap:8px;"></div>
    </div>`;
  }

  /**
   * Shows the run-start difficulty picker.
   * @param lastChosenId - The preset picked last run, marked on its card.
   * @throws {TypeError} If `presets` is null/undefined or `onSelect` is not a function.
   */
  public showDifficultyPick(presets: DifficultyPreset[], lastChosenId: string | null, onSelect: (id: string) => void): void {
    if (!presets) throw new TypeError('DifficultyModal.showDifficultyPick: "presets" must not be null/undefined');
    if (typeof onSelect !== 'function') throw new TypeError('DifficultyModal.showDifficultyPick: "onSelect" must be a function');
    const container = this.querySelector('#difficulty-choices')!;
    container.innerHTML = '';
    for (const preset of presets) {
      const btn = document.createElement('button');
      btn.className = 'modifier-btn';
      const last = preset.id === lastChosenId ? ' <span style="color:#8a7a4d;font-size:9px;">· your last road</span>' : '';
      btn.innerHTML = `<span class="modifier-emoji">${SpriteService.iconHTML(preset.icon, 24)}</span><div class="modifier-info"><strong>${preset.name}${last}</strong><span>${preset.desc}</span></div>`;
      btn.addEventListener('click', () => {
        this.hide();
        onSelect(preset.id);
      });
      container.appendChild(btn);
    }
    this.show();
  }
}

customElements.define('difficulty-modal', DifficultyModal);
declare global {
  interface HTMLElementTagNameMap {
    'difficulty-modal': DifficultyModal;
  }
}
