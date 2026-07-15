import { BaseModal } from './base-modal';
import { SpriteService, HtmlUtils } from '../sprites';
import type { ClassDef } from '../types';

/** The run-start class picker. */
export class ClassModal extends BaseModal {
  protected template(): string {
    return `<div class="modal-card" style="max-width:340px;">
      <div class="modal-title" id="class-title" style="color:#8d6fd4;font-size:20px;">CHOOSE YOUR CLASS</div>
      <p style="color:#666;margin:4px 0 12px 0;font-size:11px;">Your class shapes the entire run. There is no going back.</p>
      <div id="class-choices" style="display:flex;flex-direction:column;gap:8px;"></div>
    </div>`;
  }

  /**
   * Shows the run-start class picker.
   * @throws {TypeError} If `classes` is null/undefined or `onSelect` is not a function.
   */
  public showClassSelection(classes: ClassDef[], onSelect: (id: string) => void): void {
    if (!classes) throw new TypeError('ClassModal.showClassSelection: "classes" must not be null/undefined');
    if (typeof onSelect !== 'function') throw new TypeError('ClassModal.showClassSelection: "onSelect" must be a function');
    const container = this.querySelector('#class-choices')!;
    container.innerHTML = '';
    for (const cls of classes) {
      const btn = document.createElement('button');
      btn.className = 'modifier-btn';
      const chips = cls.statChips.map(c => `<span class="class-chip">${HtmlUtils.escapeHtml(c)}</span>`).join('');
      btn.innerHTML = `<span class="modifier-emoji">${SpriteService.iconHTML(cls.emoji, 24)}</span><div class="modifier-info"><strong>${cls.name}</strong><span>${cls.tagline}</span><span class="class-chip-row">${chips}</span></div>`;
      btn.addEventListener('click', () => {
        this.hide();
        onSelect(cls.id);
      });
      container.appendChild(btn);
    }
    this.show();
  }
}

customElements.define('class-modal', ClassModal);
declare global {
  interface HTMLElementTagNameMap {
    'class-modal': ClassModal;
  }
}
