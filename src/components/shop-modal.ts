import { BaseModal } from './base-modal';
import { SpriteService, HtmlUtils } from '../sprites';
import type { ShopItem } from '../types';

/** The wandering peddler's shop. */
export class ShopModal extends BaseModal {
  protected template(): string {
    return `<div class="modal-card" style="max-width:340px;">
      <div class="modal-title" id="shop-title" style="color:var(--accent-color);font-size:18px;">THE FEAR DEARG'S STALL</div>
      <p id="shop-subtitle" style="color:#666;margin:4px 0 4px 0;font-size:11px;">The red-capped peddler grins. "Gold for wonders, traveller. Fair trades, mostly."</p>
      <p style="color:var(--accent-color);font-size:12px;margin:0 0 10px 0;">Your gold: <span id="shop-gold">0</span></p>
      <div id="shop-items" style="display:flex;flex-direction:column;gap:8px;"></div>
      <button class="restart-btn" id="shop-close">Leave</button>
    </div>`;
  }

  /** Shows the shop modal for the given stock, with a live-updating gold balance as items are purchased. `titleOverride`/`subtitleOverride` let a one-off encounter (e.g. the Tetris-clear reward) replace the regular peddler's framing. */
  public showShop(
    stock: ShopItem[], gold: number, buy: (id: string) => { gold: number; ok: boolean }, onClose: () => void,
    titleOverride?: string, subtitleOverride?: string,
  ): void {
    if (!Array.isArray(stock)) throw new TypeError('ShopModal.showShop: "stock" must be an array');
    if (typeof gold !== 'number') throw new TypeError('ShopModal.showShop: "gold" must be a number');
    if (typeof buy !== 'function') throw new TypeError('ShopModal.showShop: "buy" must be a function');
    if (typeof onClose !== 'function') throw new TypeError('ShopModal.showShop: "onClose" must be a function');

    const titleEl = this.querySelector('#shop-title')!;
    titleEl.textContent = titleOverride ?? "THE FEAR DEARG'S STALL";
    const subtitleEl = this.querySelector('#shop-subtitle')!;
    subtitleEl.textContent = subtitleOverride ?? 'The red-capped peddler grins. "Gold for wonders, traveller. Fair trades, mostly."';
    const goldEl = this.querySelector('#shop-gold')!;
    const items  = this.querySelector('#shop-items')!;

    const render = (g: number): void => {
      goldEl.textContent = `${g.toLocaleString()}g`;
      items.innerHTML = '';
      for (const item of stock) {
        const btn = document.createElement('button');
        btn.className = 'shop-item-btn';
        btn.disabled = item.purchased || g < item.cost;
        btn.innerHTML =
          `<span style="display:flex;align-items:center;gap:8px;">${SpriteService.iconHTML(item.icon, 18)}` +
          `<span style="text-align:left;"><b>${HtmlUtils.escapeHtml(item.name)}</b><br>` +
          `<span style="color:#888;font-size:10px;">${HtmlUtils.escapeHtml(item.desc)}</span></span></span>` +
          `<span class="shop-cost">${item.purchased ? 'SOLD' : `${item.cost}g`}</span>`;
        btn.addEventListener('click', () => {
          const result = buy(item.id);
          if (result.ok) render(result.gold);
        });
        items.appendChild(btn);
      }
    };

    render(gold);
    (this.querySelector('#shop-close') as HTMLButtonElement).onclick = () => {
      this.hide();
      onClose();
    };
    this.show();
  }
}

customElements.define('shop-modal', ShopModal);
declare global { interface HTMLElementTagNameMap { 'shop-modal': ShopModal } }
