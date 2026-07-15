import { BaseModal } from './base-modal';
import { SpriteService, HtmlUtils } from '../sprites';
import type { CharacterSheetSection } from '../types';

/** The full character-sheet modal: every effective stat currently on the hero. */
export class CharSheetModal extends BaseModal {
  protected template(): string {
    return `<div class="modal-card char-sheet-card">
      <div class="modal-title" id="char-sheet-title" style="color:var(--accent-color);font-size:18px;">📜 CHARACTER SHEET</div>
      <p style="color:#666;margin:4px 0 12px 0;font-size:11px;">Every effective stat currently on your hero — base, Geasa, Ogham Marks, and stall purchases combined.</p>
      <div id="char-sheet-body" class="char-sheet-body"></div>
      <button class="restart-btn" id="char-sheet-close">Close</button>
    </div>`;
  }

  /** Shows the character sheet for the given sections (the most recent `updateStats` snapshot). */
  public showCharacterSheet(sections: CharacterSheetSection[], onClose: () => void): void {
    if (!Array.isArray(sections)) throw new TypeError('CharSheetModal.showCharacterSheet: "sections" must be an array');
    if (typeof onClose !== 'function') throw new TypeError('CharSheetModal.showCharacterSheet: "onClose" must be a function');

    this.querySelector('#char-sheet-body')!.innerHTML = sections.map(section => `
      <div class="char-sheet-section">
        <div class="char-sheet-section-title">${SpriteService.iconHTML(section.icon, 13)}${HtmlUtils.escapeHtml(section.title)}</div>
        <div class="char-sheet-rows">
          ${section.stats.map(s => `<div class="char-sheet-row"><span>${HtmlUtils.escapeHtml(s.label)}</span><span>${HtmlUtils.escapeHtml(s.value)}</span></div>`).join('')}
        </div>
      </div>`).join('');
    (this.querySelector('#char-sheet-close') as HTMLButtonElement).onclick = () => { this.hide(); onClose(); };
    this.show();
  }
}

customElements.define('char-sheet-modal', CharSheetModal);
declare global { interface HTMLElementTagNameMap { 'char-sheet-modal': CharSheetModal } }
