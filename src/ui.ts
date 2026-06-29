import { NEXT_PREVIEWS } from './config';
import type { LogClass, UIState } from './types';

export class UIManager {
  private readonly logPanel: HTMLElement;
  private readonly modal: HTMLElement;
  private readonly els: Record<string, HTMLElement>;

  constructor() {
    this.logPanel = document.getElementById('log-panel')!;
    this.modal = document.getElementById('game-over-modal')!;
    this.els = {
      floor: document.getElementById('stat-floor')!,
      score: document.getElementById('stat-score')!,
      hp: document.getElementById('stat-hp')!,
      rate: document.getElementById('stat-rate')!,
      hpBar: document.getElementById('hp-bar')!,
      nextPreview: document.getElementById('next-preview-box')!,
      deathTitle: document.getElementById('death-title')!,
      deathReason: document.getElementById('death-reason')!,
      finalFloor: document.getElementById('final-floor')!,
      finalScore: document.getElementById('final-score')!,
      highScore: document.getElementById('high-score')!,
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
    this.els['floor']!.textContent = String(state.floor);
    this.els['score']!.textContent = String(state.score);
    this.els['hp']!.textContent = `${state.hp}/${state.maxHp}`;
    this.els['rate']!.textContent = String(state.gravityRate);
    this.els['hpBar']!.style.width = `${Math.max(0, (state.hp / state.maxHp) * 100)}%`;
    this.els['nextPreview']!.innerHTML = NEXT_PREVIEWS[state.nextType] ?? '';
  }

  showDeath(title: string, reason: string, floor: number, score: number, highScore: number): void {
    this.els['deathTitle']!.textContent = title;
    this.els['deathReason']!.textContent = reason;
    this.els['finalFloor']!.textContent = String(floor);
    this.els['finalScore']!.textContent = String(score);
    this.els['highScore']!.textContent = String(highScore);
    this.modal.style.display = 'flex';
  }

  hideDeath(): void {
    this.modal.style.display = 'none';
  }

  showError(message: string): void {
    console.error('[RiftCrawler]', message);
    this.log(`⚠️ ${message}`, 'log-damage');
  }

  clearLog(): void {
    this.logPanel.innerHTML = '';
  }
}
