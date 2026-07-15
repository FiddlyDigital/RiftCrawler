import { BaseModal } from './base-modal';
import { SpriteService } from '../sprites';
import type { BossDef } from '../types';

/** The boss-encounter cinematic banner, shown for ~1.8s before combat begins. */
export class BossWarningModal extends BaseModal {
  protected template(): string {
    return `<div id="boss-warning-card">
      <div id="boss-warning-emoji" style="font-size:52px;line-height:1;margin-bottom:8px;"></div>
      <div id="boss-warning-name" class="modal-title" style="color:#c3272a;font-size:22px;"></div>
      <div id="boss-warning-flavor" style="color:#888;font-size:11px;margin-top:8px;font-style:italic;max-width:280px;line-height:1.4;"></div>
      <div id="boss-countdown-track" style="width:80%;margin:16px auto 0;background:#1a0000;height:3px;border-radius:2px;">
        <div id="boss-countdown-bar" style="height:100%;background:#c3272a;width:100%;"></div>
      </div>
    </div>`;
  }

  /**
   * Shows the boss-warning cinematic banner for ~1.8s, then calls `onDone`.
   * @throws {TypeError} If `boss` is null/undefined or `onDone` is not a function.
   */
  public showBossWarning(boss: BossDef, onDone: () => void): void {
    if (!boss) throw new TypeError('BossWarningModal.showBossWarning: "boss" must not be null/undefined');
    if (typeof onDone !== 'function') throw new TypeError('BossWarningModal.showBossWarning: "onDone" must be a function');
    (this.querySelector('#boss-warning-emoji') as HTMLElement).innerHTML = SpriteService.iconHTML(boss.char, 32);
    (this.querySelector('#boss-warning-name') as HTMLElement).textContent = boss.name.toUpperCase();
    (this.querySelector('#boss-warning-flavor') as HTMLElement).textContent = boss.flavorText;
    this.show();
    const bar = this.querySelector('#boss-countdown-bar') as HTMLElement | null;
    if (bar) {
      bar.style.transition = 'none';
      bar.style.width = '100%';
      void bar.offsetWidth;
      bar.style.transition = 'width 1700ms linear';
      bar.style.width = '0%';
    }
    setTimeout(() => {
      this.hide();
      onDone();
    }, 1800);
  }
}

customElements.define('boss-warning-modal', BossWarningModal);
declare global {
  interface HTMLElementTagNameMap {
    'boss-warning-modal': BossWarningModal;
  }
}
