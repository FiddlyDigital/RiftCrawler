import { BaseModal } from './base-modal';
import { SpriteService, HtmlUtils } from '../sprites';
import type { RunStats, RunRecord, LogClass } from '../types';

/** The death/victory screen: final stats, share/copy/download, run log, and run history. */
export class GameOverModal extends BaseModal {
  protected template(): string {
    return `<div class="modal-card">
      <div class="modal-title" id="death-title">DUNGEON COLLAPSE</div>
      <p style="color:#888;margin:5px 0 10px 0;" id="death-reason">Dungeon ceiling collapsed.</p>
      <p id="run-story" style="display:none;color:#9d8f6f;font-style:italic;font-size:11px;margin:0 0 10px 0;line-height:1.5;"></p>
      <div style="text-align:left;padding:10px;background-color:#0c0c12;border-radius:4px;font-size:12px;">
        <p style="margin:3px 0;"><span class="spr" data-sprite="tile_stairs_up" data-size="14"></span> Floor: <b id="final-floor" style="color:var(--accent-color);">1</b></p>
        <p style="margin:3px 0;"><span class="spr" data-sprite="fx_arcane"></span> XP Earned: <b id="final-score" style="color:var(--accent-color);">0</b></p>
        <p style="margin:3px 0;"><span class="spr" data-sprite="item_trophy"></span> Best:  <b id="high-score"  style="color:var(--accent-color);">0</b></p>
      </div>
      <!-- Run stats grid -->
      <div id="run-stats-grid"></div>
      <!-- Share string -->
      <div id="share-container" style="display:none;margin-top:6px;">
        <textarea id="share-text" readonly rows="2"></textarea>
        <button id="copy-share-btn" class="share-btn">📋 Copy Summary</button>
      </div>
      <!-- Full run log -->
      <div style="margin-top:10px;">
        <div style="font-size:9px;text-transform:uppercase;letter-spacing:.5px;color:#555;margin-bottom:4px;">Run Log</div>
        <div id="run-log-full" class="run-log-full"></div>
        <div class="log-actions">
          <button id="copy-log-btn" class="share-btn">📋 Copy Log</button>
          <button id="download-log-btn" class="share-btn">⬇ Download Log</button>
        </div>
      </div>
      <!-- Run history -->
      <div style="margin-top:10px;">
        <div style="font-size:9px;text-transform:uppercase;letter-spacing:.5px;color:#555;margin-bottom:4px;">Past Runs</div>
        <div id="run-history"></div>
      </div>
      <button class="restart-btn" id="restart-btn">Try Again</button>
    </div>`;
  }

  /** Shows the death screen with the run's final stats and history. */
  public showDeath(
    title: string, reason: string, floor: number, totalXpEarned: number, highXp: number,
    history: RunRecord[], fullLog: { text: string; cls: LogClass; icon?: string }[],
    onRestart: () => void, stats?: RunStats, story?: string,
  ): void {
    this.querySelector('#death-title')!.textContent = title;
    this.querySelector('#death-reason')!.textContent = reason;
    this.querySelector('.modal-card')?.classList.remove('victory');
    this.populateEndModal(floor, totalXpEarned, highXp, history, fullLog, onRestart, stats, story);
  }

  /** Shows the victory screen (Bres defeated) with the run's final stats and history. */
  public showVictory(
    floor: number, totalXpEarned: number, highXp: number,
    history: RunRecord[], fullLog: { text: string; cls: LogClass; icon?: string }[],
    onRestart: () => void, stats?: RunStats, story?: string,
  ): void {
    this.querySelector('#death-title')!.innerHTML = `${SpriteService.iconHTML('item_trophy', 16)}BRES VANQUISHED`;
    this.querySelector('#death-reason')!.textContent = 'You felled Bres the Beautiful and shattered his bridge — the run is won.';
    this.querySelector('.modal-card')?.classList.add('victory');
    this.populateEndModal(floor, totalXpEarned, highXp, history, fullLog, onRestart, stats, story);
  }

  /** Shared body for {@link showDeath}/{@link showVictory}: fills in the stats grid, share text, run log, and history table. */
  private populateEndModal(
    floor: number, totalXpEarned: number, highXp: number, history: RunRecord[],
    fullLog: { text: string; cls: LogClass; icon?: string }[], onRestart: () => void,
    stats?: RunStats, story?: string,
  ): void {
    this.querySelector('#final-floor')!.textContent = String(floor);
    this.querySelector('#final-score')!.textContent = String(totalXpEarned);
    this.querySelector('#high-score')!.textContent  = String(highXp);

    // Short narrative recap of the run's notable moments
    const storyEl = this.querySelector<HTMLElement>('#run-story');
    if (storyEl) {
      storyEl.textContent = story ?? '';
      storyEl.style.display = story ? '' : 'none';
    }

    const runStatsGrid = this.querySelector<HTMLElement>('#run-stats-grid')!;
    const shareContainer = this.querySelector<HTMLElement>('#share-container')!;
    const shareText = this.querySelector<HTMLTextAreaElement>('#share-text')!;

    // Run stats grid
    if (stats) {
      runStatsGrid.innerHTML = `
        <div class="run-stats-grid">
          <div class="stat-cell">${SpriteService.iconHTML('status_poison', 14)}<b>${stats.monstersKilled}</b><br><span>Monsters</span></div>
          <div class="stat-cell">${SpriteService.iconHTML('sprite_boss_boneking', 14)}<b>${stats.bossesKilled}</b><br><span>Bosses</span></div>
          <div class="stat-cell"><span class="brick-icon"></span><b>${stats.linesCleared}</b><br><span>Lines</span></div>
          <div class="stat-cell">${SpriteService.iconHTML('fx_impact', 14)}<b>${stats.biggestCombo > 0 ? `×${stats.biggestCombo + 1}` : '—'}</b><br><span>Best Combo</span></div>
          <div class="stat-cell">${SpriteService.iconHTML('item_heart', 14)}<b>${stats.damageTaken}</b><br><span>Dmg Taken</span></div>
        </div>`;
      const shareStr = `Fl.${floor} · ${stats.monstersKilled} kills · ${stats.linesCleared} lines · Best combo ×${stats.biggestCombo + 1} · ${totalXpEarned.toLocaleString()} XP`;
      shareText.value = shareStr;
      shareContainer.style.display = '';
      const copyBtn = this.querySelector<HTMLButtonElement>('#copy-share-btn');
      if (copyBtn) {
        copyBtn.onclick = () => {
          navigator.clipboard?.writeText(shareStr).catch(() => {
            shareText.select();
            document.execCommand('copy');
          });
          copyBtn.textContent = 'Copied!';
          setTimeout(() => { copyBtn.textContent = 'Copy Summary'; }, 1800);
        };
      }
    } else {
      runStatsGrid.innerHTML = '';
      shareContainer.style.display = 'none';
    }

    // Full run log — scrolling box + copy/download
    this.querySelector('#run-log-full')!.innerHTML = fullLog.map(e =>
      `<div class="log-entry ${e.cls}">${e.icon ? `${SpriteService.iconHTML(e.icon, 13, 'sprite-icon log-icon')}${HtmlUtils.escapeHtml(e.text)}` : HtmlUtils.escapeHtml(e.text)}</div>`
    ).join('') || '<div style="color:#555;font-size:9px">No events recorded.</div>';
    const logText = fullLog.map(e => e.text).join('\n');
    const copyLogBtn = this.querySelector<HTMLButtonElement>('#copy-log-btn');
    if (copyLogBtn) {
      copyLogBtn.onclick = () => {
        navigator.clipboard?.writeText(logText).catch(() => {
          const ta = document.createElement('textarea');
          ta.value = logText;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          ta.remove();
        });
        copyLogBtn.textContent = 'Copied!';
        setTimeout(() => { copyLogBtn.textContent = '📋 Copy Log'; }, 1800);
      };
    }
    const downloadLogBtn = this.querySelector<HTMLButtonElement>('#download-log-btn');
    if (downloadLogBtn) {
      downloadLogBtn.onclick = () => {
        const blob = new Blob([logText], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `causeway-to-eriu-run-log-fl${floor}.txt`;
        a.click();
        URL.revokeObjectURL(url);
      };
    }

    // Run history table
    const lines = history.map((r, i) =>
      `<div class="history-row${i === 0 ? ' history-latest' : ''}">
        <span>${r.date}</span><span>Fl.${r.floor}</span>
        <span>${r.totalXpEarned.toLocaleString()}</span><span>Lv.${r.playerLevel}</span>
        <span>${r.cause?.split(' ').slice(0, 2).join(' ') ?? ''}</span>
       </div>`
    ).join('');
    this.querySelector('#run-history')!.innerHTML = lines || '<div style="color:#555;font-size:9px">No runs yet.</div>';

    (this.querySelector('#restart-btn') as HTMLButtonElement).onclick = () => { this.hide(); onRestart(); };
    this.show();
  }
}

customElements.define('game-over-modal', GameOverModal);
declare global { interface HTMLElementTagNameMap { 'game-over-modal': GameOverModal } }
