import { BaseModal } from './base-modal';
import { SpriteService, HtmlUtils } from '../sprites';
import type { BoonDef, BrandDef, BodyPart, RerollCfg } from '../types';

/** Shared altar (Geis) / Tattoo Artist (Ogham Mark) 3-choice picker, with an optional gold reroll. */
export class OfferModal extends BaseModal {
  protected template(): string {
    return `<div class="modal-card">
      <div class="modal-title" id="altar-title" style="font-size:18px;color:#b98fc4;">⛩️ Minor Altar — Choose a Geis</div>
      <p id="altar-subtitle" style="color:#888;margin:4px 0 12px 0;font-size:12px;">Geasa are unlimited — stack freely, and pick the same one again to amplify its effect.</p>
      <div id="altar-owned-summary" style="display:none;text-align:left;margin-bottom:10px;padding:8px 10px;background:#0c0c12;border-radius:4px;">
        <div style="font-size:8px;color:#555;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;">You already have</div>
        <div id="altar-owned-chips" class="boon-grid"></div>
      </div>
      <div id="altar-choices" style="display:flex;flex-direction:column;gap:8px;"></div>
    </div>`;
  }

  // Owned-summary chips shown above the choices so a player picking a new
  // Geis/Ogham Mark can see what they already have before committing.
  private buildOwnedBoonsHTML(boons: Array<{ id: string; stacks: number; def: BoonDef }>): string {
    if (boons.length === 0) return '';
    return boons.map(b =>
      `<span class="boon-chip" title="${HtmlUtils.escapeHtml(b.def.desc)}">${SpriteService.iconHTML(b.def.char, 14)}${HtmlUtils.escapeHtml(b.def.name)} ×${b.stacks}</span>`,
    ).join('');
  }

  private buildOwnedBrandsHTML(brands: Array<{ slot: BodyPart; brand: BrandDef }>): string {
    if (brands.length === 0) return '';
    const grouped = new Map<string, { char: string; name: string; count: number; setSize: number }>();
    for (const b of brands) {
      const existing = grouped.get(b.brand.id);
      if (existing) existing.count++;
      else grouped.set(b.brand.id, { char: b.brand.char, name: b.brand.name, count: 1, setSize: b.brand.setSize });
    }
    return Array.from(grouped.values()).map(g => {
      const setActive = g.count >= g.setSize;
      return `<span class="brand-chip${setActive ? ' brand-set-active' : ''}" title="${HtmlUtils.escapeHtml(g.name)}${setActive ? ' — set active' : ''}">${SpriteService.iconHTML(g.char, 14)}${HtmlUtils.escapeHtml(g.name)} ×${g.count}</span>`;
    }).join('');
  }

  private renderOffer<T extends { char: string; name: string }>(opts: {
    title: string;
    titleIcon?: string;
    subtitle: string;
    choices: T[];
    buttonInner: (c: T) => string;
    onChoice: (index: number) => void;
    reroll?: RerollCfg<T>;
    ownedHTML?: string;
  }): void {
    const titleEl = this.querySelector('#altar-title')!;
    titleEl.innerHTML = opts.titleIcon ? `${SpriteService.iconHTML(opts.titleIcon, 16)}${HtmlUtils.escapeHtml(opts.title)}` : HtmlUtils.escapeHtml(opts.title);
    const subEl = this.querySelector('#altar-subtitle');
    if (subEl) subEl.textContent = opts.subtitle;
    const ownedWrap = this.querySelector<HTMLElement>('#altar-owned-summary');
    const ownedChips = this.querySelector('#altar-owned-chips');
    if (ownedWrap && ownedChips) {
      if (opts.ownedHTML) { ownedChips.innerHTML = opts.ownedHTML; ownedWrap.style.display = ''; }
      else { ownedChips.innerHTML = ''; ownedWrap.style.display = 'none'; }
    }
    const container = this.querySelector('#altar-choices')!;

    const render = (choices: T[], gold: number, cost: number): void => {
      container.innerHTML = '';
      choices.forEach((c, i) => {
        const btn = document.createElement('button');
        btn.className = 'modifier-btn';
        btn.innerHTML = opts.buttonInner(c);
        btn.addEventListener('click', () => {
          this.hide();
          opts.onChoice(i);
        });
        container.appendChild(btn);
      });
      if (opts.reroll) {
        const rb = document.createElement('button');
        rb.className = 'reroll-btn';
        rb.disabled = gold < cost;
        rb.innerHTML = gold >= cost
          ? `${SpriteService.iconHTML('item_dice', 14)}Reroll — ${cost}g (you have ${gold}g)`
          : `${SpriteService.iconHTML('item_dice', 14)}Reroll — need ${cost - gold} more gold`;
        rb.addEventListener('click', () => {
          const next = opts.reroll!.run();
          if (next) render(next.choices, next.gold, next.cost);
        });
        container.appendChild(rb);
      }
    };

    render(opts.choices, opts.reroll?.gold ?? 0, opts.reroll?.cost ?? 0);
    this.show();
  }

  /** Shows the tattoo-artist brand-choice modal, with an optional gold reroll. */
  public showTattooModal(
    choices: BrandDef[],
    ownedBrands: Array<{ slot: BodyPart; brand: BrandDef }>,
    onChoice: (index: number) => void,
    reroll?: RerollCfg<BrandDef>,
  ): void {
    this.renderOffer({
      title: 'Occult Tattoo Artist — Choose an Ogham Mark',
      titleIcon: 'tile_altar',
      subtitle: 'Ogham marks are permanent — you may only ever bear 5 in this life. Choose your identity.',
      choices, onChoice, reroll,
      ownedHTML: this.buildOwnedBrandsHTML(ownedBrands),
      buttonInner: (b) => `<span class="modifier-emoji">${SpriteService.iconHTML(b.char, 24)}</span><div class="modifier-info"><strong>${b.name}</strong><span>${b.desc}</span><span style="font-size:9px;color:#a78bfa;">${b.setDesc} (need ${b.setSize})</span></div>`,
    });
  }

  /** Shows the altar boon-choice modal for the given reward tier, with an optional gold reroll. */
  public showAltarModal(
    tier: 1 | 2 | 3,
    choices: BoonDef[],
    ownedBoons: Array<{ id: string; stacks: number; def: BoonDef }>,
    onChoice: (index: number) => void,
    titleOverride?: string,
    reroll?: RerollCfg<BoonDef>,
  ): void {
    const tierNames: Record<1 | 2 | 3, string> = { 1: 'Minor Altar', 2: 'Ruined Altar', 3: 'Grand Altar' };
    this.renderOffer({
      title: titleOverride ?? `${tierNames[tier]} — Choose a Geis`,
      titleIcon: 'tile_altar',
      subtitle: 'Geasa are unlimited — stack freely, and pick the same one again to amplify its effect.',
      choices, onChoice, reroll,
      ownedHTML: this.buildOwnedBoonsHTML(ownedBoons),
      buttonInner: (b) => `<span class="modifier-emoji">${SpriteService.iconHTML(b.char, 24)}</span><div class="modifier-info"><strong>${b.name}</strong><span>${b.desc}</span></div>`,
    });
  }
}

customElements.define('offer-modal', OfferModal);
declare global { interface HTMLElementTagNameMap { 'offer-modal': OfferModal } }
