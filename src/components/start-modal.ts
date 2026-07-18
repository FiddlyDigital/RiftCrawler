import { BaseModal } from './base-modal';

/** The start screen: how-to-play, controls reference, and the run-launch button. */
export class StartModal extends BaseModal {
  protected template(): string {
    return `<div class="modal-card" style="max-width:340px;">
      <div class="modal-title" id="start-title" style="color:var(--accent-color);font-size:26px;letter-spacing:3px;">CAUSEWAY TO ÉRIU</div>
      <p style="color:#666;font-size:10px;letter-spacing:1px;margin:2px 0 14px 0;">TETRIS MEETS DUNGEON — BUILD THE FLOOR, SURVIVE IT</p>

      <!-- How to play -->
      <div style="text-align:left;background:#0c0c12;border-radius:4px;padding:10px 12px;margin-bottom:10px;font-size:11px;line-height:1.8;">
        <div style="color:#555;font-size:8px;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;">How to Play</div>
        <div>🧱 <span style="color:#ccc;">Steer falling blocks</span> <span style="color:#666;">to build dungeon tiles beneath your hero.</span></div>
        <div>🧙 <span style="color:#ccc;">Move & fight</span> <span style="color:#666;">across those tiles — loot items, slay monsters, reach the stairs.</span></div>
        <div>✨ <span style="color:#ccc;">Clear full rows</span> <span style="color:#666;">to heal. Every block action advances the monster turns.</span></div>
        <div>🗿 <span style="color:#ccc;">To win:</span> <span style="color:#666;">grow strong, then let the stack reach the top to summon <b style="color:#e08a72;">Bres the Beautiful</b> — defeat him before he completes his bridge to Ériu.</span></div>
      </div>

      <!-- Controls reference — touch version (mobile) -->
      <div class="touch-only" style="background:#0c0c12;border-radius:4px;padding:10px 12px;margin-bottom:14px;">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:10px;">
          <div>
            <div style="color:var(--block-accent);font-size:8px;text-transform:uppercase;letter-spacing:.5px;margin-bottom:5px;">Block (Tetris)</div>
            <div style="color:#aaa;line-height:2;">
              <span style="color:#555;">Swipe ◀▶</span> Move<br>
              <span style="color:#555;">Swipe ▲</span> Rotate<br>
              <span style="color:#555;">Flick ▼</span> Hard Drop
            </div>
          </div>
          <div>
            <div style="color:var(--hero-accent);font-size:8px;text-transform:uppercase;letter-spacing:.5px;margin-bottom:5px;">Hero (Rogue)</div>
            <div style="color:#aaa;line-height:2;">
              <span style="color:#555;">Right pad</span> Move<br>
              <span style="color:#555;">Hold</span> to repeat<br>
              <span style="color:#555;">Tap a tile</span> Inspect
            </div>
          </div>
        </div>
      </div>

      <!-- Controls reference — keyboard version (desktop) -->
      <div class="kbd-only" style="background:#0c0c12;border-radius:4px;padding:10px 12px;margin-bottom:14px;">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:10px;">
          <div>
            <div style="color:var(--block-accent);font-size:8px;text-transform:uppercase;letter-spacing:.5px;margin-bottom:5px;">Block (Tetris)</div>
            <div style="color:#aaa;line-height:2;">
              <span style="color:#555;">I</span> Rotate &nbsp;
              <span style="color:#555;">J / L</span> Move<br>
              <span style="color:#555;">K</span> Hard Drop &nbsp;
              <span style="color:#555;">X</span> Soft Drop
            </div>
          </div>
          <div>
            <div style="color:var(--hero-accent);font-size:8px;text-transform:uppercase;letter-spacing:.5px;margin-bottom:5px;">Hero (Rogue)</div>
            <div style="color:#aaa;line-height:2;">
              <span style="color:#555;">WASD</span> / Arrows Move<br>
              <span style="color:#555;">Space</span> Wait &amp; Heal
            </div>
          </div>
        </div>
      </div>

      <div id="start-best" style="color:#555;font-size:9px;margin-bottom:10px;min-height:14px;"></div>
      <button class="restart-btn" id="start-btn" style="font-size:15px;letter-spacing:2px;">▶ BEGIN DESCENT</button>
      <button id="start-tutorial-btn" style="background:none;border:none;color:#8a7a4d;font-size:11px;margin-top:8px;cursor:pointer;text-decoration:underline;text-underline-offset:3px;">❓ New here? Play the guided tutorial</button>
      <p class="kbd-only" style="color:#333;font-size:8px;margin-top:8px;">Press <b style="color:#444;">M</b> during play to toggle sound</p>
      <p style="color:#333;font-size:8px;margin-top:4px;">Art: <span style="color:#444;">32rogues</span> tileset by Seth Boyles</p>
    </div>`;
  }

  /**
   * Shows the start screen with the given high score and begin-run handler.
   * @param onBeginTutorial - Optional: starts the run with the guided tutorial forced on.
   */
  public showStart(highScore: number, onBegin: () => void, onBeginTutorial?: () => void): void {
    if (typeof highScore !== 'number') throw new TypeError('StartModal.showStart: "highScore" must be a number');
    if (typeof onBegin !== 'function') throw new TypeError('StartModal.showStart: "onBegin" must be a function');

    const el = this.querySelector('#start-best');
    if (el) el.textContent = highScore > 0 ? `Best run: ${highScore.toLocaleString()} XP` : '';
    (this.querySelector('#start-btn') as HTMLButtonElement).onclick = () => { this.hide(); onBegin(); };
    const tutBtn = this.querySelector<HTMLButtonElement>('#start-tutorial-btn');
    if (tutBtn) {
      tutBtn.style.display = onBeginTutorial ? '' : 'none';
      tutBtn.onclick = () => { this.hide(); onBeginTutorial?.(); };
    }
    this.show();
  }
}

customElements.define('start-modal', StartModal);
declare global { interface HTMLElementTagNameMap { 'start-modal': StartModal } }
