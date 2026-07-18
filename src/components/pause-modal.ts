import { BaseModal } from './base-modal';

/** Settings/handlers passed fresh each time the pause menu is (re)shown. */
export interface PauseMenuState {
  soundOn: boolean;
  reducedMotion: boolean;
  volumePct: number;
}

export interface PauseMenuHandlers {
  onResume: () => void;
  onToggleMute: () => void;
  onToggleMotion: () => void;
  onCycleVolume: () => void;
  onRestart: () => void;
  /** Nukes the service worker + caches and reloads — the "the PWA is stuck on an old version" escape hatch. */
  onForceRefresh: () => void;
}

/** The in-run pause/settings menu. */
export class PauseModal extends BaseModal {
  protected template(): string {
    return `<div class="modal-card" style="max-width:300px;">
      <div class="modal-title" id="pause-title" style="color:var(--accent-color);">⏸ PAUSED</div>
      <div style="display:flex;flex-direction:column;gap:8px;margin-top:14px;">
        <button class="restart-btn" id="pause-resume" style="font-size:15px;letter-spacing:1px;">▶ Resume</button>
        <button class="settings-row" id="pause-mute"><span>🔊 Sound</span><span id="pause-mute-state" class="settings-val">On</span></button>
        <button class="settings-row" id="pause-volume"><span>🔉 Volume</span><span id="pause-volume-state" class="settings-val">100%</span></button>
        <button class="settings-row" id="pause-motion"><span>🎬 Reduced Motion</span><span id="pause-motion-state" class="settings-val">Off</span></button>
        <button class="restart-btn" id="pause-restart" style="background-color:#3a1414;color:#ffab91;margin-top:4px;">↻ New Run</button>
        <button class="settings-row" id="pause-refresh"><span>⟳ Update App</span><span class="settings-val">Reload</span></button>
      </div>
      <p class="kbd-only" style="color:#444;font-size:8px;margin-top:10px;">Esc or P to resume · M mutes</p>
    </div>`;
  }

  private bind(id: string, fn: () => void): void {
    const el = this.querySelector<HTMLElement>(`#${id}`);
    if (el) el.onclick = fn;
  }

  /**
   * Shows the pause menu with the current sound/motion/volume state and button handlers.
   * @throws {TypeError} If `state` or `handlers` is null/undefined.
   */
  public showPauseMenu(state: PauseMenuState, handlers: PauseMenuHandlers): void {
    if (!state) throw new TypeError('PauseModal.showPauseMenu: "state" must not be null/undefined');
    if (!handlers) throw new TypeError('PauseModal.showPauseMenu: "handlers" must not be null/undefined');
    const muteState = this.querySelector('#pause-mute-state');
    const motionState = this.querySelector('#pause-motion-state');
    const volumeState = this.querySelector('#pause-volume-state');
    if (muteState) muteState.textContent = state.soundOn ? 'On' : 'Off';
    if (motionState) motionState.textContent = state.reducedMotion ? 'On' : 'Off';
    if (volumeState) volumeState.textContent = `${state.volumePct}%`;
    this.bind('pause-resume', handlers.onResume);
    this.bind('pause-mute', handlers.onToggleMute);
    this.bind('pause-motion', handlers.onToggleMotion);
    this.bind('pause-volume', handlers.onCycleVolume);
    this.bind('pause-restart', handlers.onRestart);
    // Two-tap confirm: the first tap arms the button (mid-run reloads lose
    // the run, so a single stray tap must never fire it).
    const refreshBtn = this.querySelector<HTMLButtonElement>('#pause-refresh');
    if (refreshBtn) {
      refreshBtn.innerHTML = '<span>⟳ Update App</span><span class="settings-val">Reload</span>';
      let armed = false;
      refreshBtn.onclick = () => {
        if (!armed) {
          armed = true;
          refreshBtn.innerHTML = '<span>⟳ Ends this run!</span><span class="settings-val" style="color:#ffab91;">Tap again</span>';
          return;
        }
        refreshBtn.innerHTML = '<span>⟳ Updating…</span><span class="settings-val">…</span>';
        handlers.onForceRefresh();
      };
    }
    this.show();
  }

  /** Hides the pause menu. */
  public hidePauseMenu(): void {
    this.hide();
  }
}

customElements.define('pause-modal', PauseModal);
declare global {
  interface HTMLElementTagNameMap {
    'pause-modal': PauseModal;
  }
}
