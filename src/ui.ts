import { NEXT_PREVIEWS } from './config';
import type { LogClass, UIState } from './types';
import type { PerkDef, MerchantItem } from './content';
import type { RunRecord } from './types';

export class UIManager {
  private readonly logPanel: HTMLElement;
  private readonly modal: HTMLElement;
  private readonly perkModal: HTMLElement;
  private readonly shopModal: HTMLElement;
  private readonly els: Record<string, HTMLElement>;

  constructor() {
    this.logPanel   = document.getElementById('log-panel')!;
    this.modal      = document.getElementById('game-over-modal')!;
    this.perkModal  = document.getElementById('perk-modal')!;
    this.shopModal  = document.getElementById('shop-modal')!;
    this.els = {
      floor:       document.getElementById('stat-floor')!,
      score:       document.getElementById('stat-score')!,
      hp:          document.getElementById('stat-hp')!,
      rate:        document.getElementById('stat-rate')!,
      hpBar:       document.getElementById('hp-bar')!,
      nextPreview: document.getElementById('next-preview-box')!,
      deathTitle:  document.getElementById('death-title')!,
      deathReason: document.getElementById('death-reason')!,
      finalFloor:  document.getElementById('final-floor')!,
      finalScore:  document.getElementById('final-score')!,
      highScore:   document.getElementById('high-score')!,
      bestScore:   document.getElementById('best-score')!,
      xpBar:       document.getElementById('xp-bar')!,
      xpLabel:     document.getElementById('xp-label')!,
      playerLevel: document.getElementById('player-level')!,
      weaponSlot:  document.getElementById('weapon-slot')!,
      armorSlot:   document.getElementById('armor-slot')!,
      statusRow:   document.getElementById('status-row')!,
      runHistory:  document.getElementById('run-history')!,
    };
  }

  log(text: string, cls: LogClass = 'log-neutral'): void {
    const div = document.createElement('div');
    div.className = `log-entry ${cls}`;
    div.innerText = text;
    this.logPanel.appendChild(div);
    this.logPanel.scrollTop = this.logPanel.scrollHeight;
  }

  updateStats(state: UIState): void {
    this.els['floor']!.textContent       = String(state.floor);
    this.els['score']!.textContent       = String(state.score);
    this.els['hp']!.textContent          = `${state.hp}/${state.maxHp}`;
    this.els['rate']!.textContent        = `${state.gravityRate}ms`;
    this.els['hpBar']!.style.width       = `${Math.max(0, (state.hp / state.maxHp) * 100)}%`;
    this.els['nextPreview']!.innerHTML   = NEXT_PREVIEWS[state.nextType] ?? '';
    this.els['playerLevel']!.textContent = `Lv.${state.playerLevel}`;
    this.els['xpBar']!.style.width       = `${Math.min(100, (state.xp / state.xpToNext) * 100)}%`;
    this.els['xpLabel']!.textContent     = `${state.xp}/${state.xpToNext} XP`;
    this.els['weaponSlot']!.textContent  = state.weaponName ? `⚔️ ${state.weaponName}` : '⚔️ —';
    this.els['armorSlot']!.textContent   = state.armorName  ? `🛡️ ${state.armorName}`  : '🛡️ —';

    // Status effect tags
    this.els['statusRow']!.innerHTML = state.statuses
      .map(s => `<span class="status-tag status-${s.type}">${s.type === 'poison' ? '☠️' : '💫'} ${s.type} ${s.duration}</span>`)
      .join('');
  }

  showDeath(title: string, reason: string, floor: number, score: number, highScore: number, history: RunRecord[]): void {
    this.els['deathTitle']!.textContent  = title;
    this.els['deathReason']!.textContent = reason;
    this.els['finalFloor']!.textContent  = String(floor);
    this.els['finalScore']!.textContent  = String(score);
    this.els['highScore']!.textContent   = String(highScore);

    // Run history table
    const lines = history.map((r, i) =>
      `<div class="history-row${i === 0 ? ' history-latest' : ''}">
        <span>${r.date}</span><span>Fl.${r.floor}</span>
        <span>${r.score.toLocaleString()}</span><span>Lv.${r.playerLevel}</span>
       </div>`
    ).join('');
    this.els['runHistory']!.innerHTML = lines || '<div style="color:#555;font-size:9px">No runs yet.</div>';

    this.modal.style.display = 'flex';
  }

  hideDeath(): void { this.modal.style.display = 'none'; }

  showPerkSelection(perks: PerkDef[], onSelect: (id: string) => void): void {
    const container = document.getElementById('perk-choices')!;
    container.innerHTML = '';
    for (const perk of perks) {
      const btn = document.createElement('button');
      btn.className = 'perk-btn';
      btn.innerHTML = `<strong>${perk.name}</strong><br><span>${perk.desc}</span>`;
      btn.addEventListener('click', () => {
        this.perkModal.style.display = 'none';
        onSelect(perk.id);
      });
      container.appendChild(btn);
    }
    this.perkModal.style.display = 'flex';
  }

  showShop(gold: number, stock: MerchantItem[], onBuy: (i: number) => void, onClose: () => void): void {
    const container = document.getElementById('shop-items')!;
    document.getElementById('shop-gold')!.textContent = String(gold);
    container.innerHTML = '';
    for (let i = 0; i < stock.length; i++) {
      const item = stock[i]!;
      const btn = document.createElement('button');
      btn.className = 'shop-item-btn';
      btn.innerHTML = `<span>${item.char} ${item.name}</span><span class="shop-cost">${item.cost} pts</span>`;
      btn.addEventListener('click', () => {
        document.getElementById('shop-gold')!.textContent = String(gold - item.cost);
        onBuy(i);
      });
      container.appendChild(btn);
    }
    document.getElementById('shop-close')!.onclick = () => {
      this.shopModal.style.display = 'none';
      onClose();
    };
    this.shopModal.style.display = 'flex';
  }

  updateBestScore(score: number): void {
    this.els['bestScore']!.textContent = String(score);
  }

  showError(message: string): void {
    console.error('[RiftCrawler]', message);
    this.log(`⚠️ ${message}`, 'log-damage');
  }

  clearLog(): void { this.logPanel.innerHTML = ''; }
}
