import { BaseModal } from './base-modal';
import { SpriteService } from '../sprites';
import type { FloorEventDef } from '../types';

/** A narrative floor-event modal (shrine, spring, NPC encounter, pact ceremony, etc.). */
export class FloorEventModal extends BaseModal {
  protected template(): string {
    return `<div class="modal-card" style="max-width:340px;">
      <div id="floor-event-emoji" style="font-size:36px;margin-bottom:6px;line-height:1;"></div>
      <div class="modal-title" id="floor-event-title" style="color:#d99a3d;font-size:18px;"></div>
      <p id="floor-event-flavor" style="color:#666;margin:6px 0 14px 0;font-size:11px;font-style:italic;"></p>
      <div id="floor-event-choices" style="display:flex;flex-direction:column;gap:8px;"></div>
    </div>`;
  }

  /**
   * Shows a narrative floor-event modal (shrine, spring, NPC encounter, pact ceremony, etc.).
   * @throws {TypeError} If `event` is null/undefined or `onChoice` is not a function.
   */
  public showFloorEvent(event: FloorEventDef, onChoice: (index: number) => void): void {
    if (!event) throw new TypeError('FloorEventModal.showFloorEvent: "event" must not be null/undefined');
    if (typeof onChoice !== 'function') throw new TypeError('FloorEventModal.showFloorEvent: "onChoice" must be a function');
    (this.querySelector('#floor-event-emoji') as HTMLElement).innerHTML = SpriteService.iconHTML(event.emoji, 28);
    (this.querySelector('#floor-event-title') as HTMLElement).textContent = event.title;
    (this.querySelector('#floor-event-flavor') as HTMLElement).textContent = event.flavor;
    const container = this.querySelector('#floor-event-choices')!;
    container.innerHTML = '';
    event.options.forEach((opt, i) => {
      const btn = document.createElement('button');
      btn.className = 'modifier-btn';
      btn.innerHTML = `<div class="modifier-info"><strong>${opt.label}</strong><span>${opt.desc}</span></div>`;
      btn.addEventListener('click', () => {
        this.hide();
        onChoice(i);
      });
      container.appendChild(btn);
    });
    this.show();
  }
}

customElements.define('floor-event-modal', FloorEventModal);
declare global {
  interface HTMLElementTagNameMap {
    'floor-event-modal': FloorEventModal;
  }
}
