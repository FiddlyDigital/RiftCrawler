import { BaseModal } from './base-modal';
import { SpriteService, HtmlUtils } from '../sprites';
import { Boss, Npc, Biome, Patron } from '../content';
import { StorageService } from '../storage';

/** The lore codex: every boss/NPC/biome/patron discovered across all past runs, persisted across sessions. */
export class CodexModal extends BaseModal {
  // Fallback icon per biome id — BiomeDef carries no icon field of its own.
  private static readonly BIOME_ICON: Record<string, string> = {
    stone: 'tile_stone_a', cavern: 'sprite_crystal', rift: 'fx_arcane',
  };

  protected template(): string {
    return `<div class="modal-card char-sheet-card">
      <div class="modal-title" id="codex-title" style="color:var(--accent-color);font-size:18px;">📖 CODEX</div>
      <p style="color:#666;margin:4px 0 12px 0;font-size:11px;">What you've discovered across every run. Undiscovered entries show as "???" until you meet them.</p>
      <div id="codex-body" class="char-sheet-body"></div>
      <button class="restart-btn" id="codex-close">Close</button>
    </div>`;
  }

  /** One codex row: the real entry if discovered, a "???" placeholder otherwise. */
  private row(icon: string, name: string, text: string, discovered: boolean): string {
    if (!discovered) {
      return `<div class="char-sheet-row codex-row codex-undiscovered"><span class="codex-icon">?</span><div><strong>???</strong></div></div>`;
    }
    return `<div class="char-sheet-row codex-row"><span class="codex-icon">${SpriteService.iconHTML(icon, 16)}</span><div><strong>${HtmlUtils.escapeHtml(name)}</strong><span>${HtmlUtils.escapeHtml(text)}</span></div></div>`;
  }

  /** Shows the lore codex, reading the persisted discovery record from `StorageService`. */
  public showCodex(onClose: () => void): void {
    if (typeof onClose !== 'function') throw new TypeError('CodexModal.showCodex: "onClose" must be a function');

    const codex = StorageService.loadCodex();

    const bossRows = [
      ...Boss.ALL.map(b => this.row(b.char, b.name, `${b.flavorText}${b.deathLine ? ` ${b.deathLine}` : ''}`, codex.bosses.includes(b.name))),
      this.row('sprite_boss_gorgoth', 'Bres the Beautiful',
        'The bridge home is finished — and he means to be first across it.',
        codex.bosses.includes('gorgoth')),
    ].join('');

    const npcRows = Npc.ALL.map(n => {
      const text = n.kind === 'flavor' ? (n.lines ?? []).join(' ') : (n.introLine ?? '');
      return this.row(n.char, n.name, text, codex.npcs.includes(n.id));
    }).join('');

    const biomeRows = Biome.ALL.map(b =>
      this.row(CodexModal.BIOME_ICON[b.id] ?? 'tile_stone_a', b.name, b.desc, codex.biomes.includes(b.id)),
    ).join('');

    const patronRows = Patron.ALL.map(p =>
      this.row(p.char, p.name, `${p.tagline} ${p.tollDesc}`, codex.patrons.includes(p.id)),
    ).join('');

    const section = (title: string, icon: string, rows: string): string => `
      <div class="char-sheet-section">
        <div class="char-sheet-section-title">${SpriteService.iconHTML(icon, 13)}${HtmlUtils.escapeHtml(title)}</div>
        <div class="char-sheet-rows">${rows}</div>
      </div>`;

    this.querySelector('#codex-body')!.innerHTML = [
      section('Bosses', 'sprite_boss_dragon', bossRows),
      section('Wanderers', 'npc_fili', npcRows),
      section('Biomes', 'special_sacred', biomeRows),
      section('Patrons', 'fx_arcane', patronRows),
    ].join('');
    (this.querySelector('#codex-close') as HTMLButtonElement).onclick = () => { this.hide(); onClose(); };
    this.show();
  }
}

customElements.define('codex-modal', CodexModal);
declare global { interface HTMLElementTagNameMap { 'codex-modal': CodexModal } }
