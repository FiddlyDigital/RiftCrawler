import { BaseModal } from './base-modal';
import { SpriteService } from '../sprites';
import type { ModifierDef } from '../types';

/** The run-start modifier (Rift Curse) picker. */
export class ModifierModal extends BaseModal {
  protected template(): string {
    return `<div class="modal-card" style="max-width:340px;">
      <div class="modal-title" id="modifier-title" style="color:#b9672a;font-size:20px;">CHOOSE YOUR CURSE</div>
      <p style="color:#666;margin:4px 0 12px 0;font-size:11px;">One modifier shapes the entire run. Choose wisely.</p>
      <div id="modifier-choices" style="display:flex;flex-direction:column;gap:8px;"></div>
    </div>`;
  }

  /**
   * Shows the run-start modifier (Rift Curse) picker.
   * @throws {TypeError} If `mods` is null/undefined or `onSelect` is not a function.
   */
  public showModifierPick(mods: ModifierDef[], onSelect: (id: string) => void): void {
    if (!mods) throw new TypeError('ModifierModal.showModifierPick: "mods" must not be null/undefined');
    if (typeof onSelect !== 'function') throw new TypeError('ModifierModal.showModifierPick: "onSelect" must be a function');
    const container = this.querySelector('#modifier-choices')!;
    container.innerHTML = '';
    for (const mod of mods) {
      const btn = document.createElement('button');
      btn.className = 'modifier-btn';
      btn.innerHTML = `<span class="modifier-emoji">${SpriteService.iconHTML(mod.emoji, 24)}</span><div class="modifier-info"><strong>${mod.name}</strong><span>${mod.desc}</span></div>`;
      btn.addEventListener('click', () => {
        this.hide();
        onSelect(mod.id);
      });
      container.appendChild(btn);
    }
    this.show();
  }
}

customElements.define('modifier-modal', ModifierModal);
declare global {
  interface HTMLElementTagNameMap {
    'modifier-modal': ModifierModal;
  }
}
