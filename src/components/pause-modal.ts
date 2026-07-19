import { BaseModal } from './base-modal';

/** Settings/handlers passed fresh each time the pause menu is (re)shown. */
export interface PauseMenuState {
  soundOn: boolean;
  reducedMotion: boolean;
  /** Impact shake + damage flash (independent of reduced motion, which disables far more). */
  screenEffects: boolean;
  /** Colorblind-safe cursed/blessed piece marking (blue dashed vs gold). */
  colorblind: boolean;
  volumePct: number;
  /** True when a new service worker is installed and waiting — reveals the Update App row. */
  updateAvailable: boolean;
}

export interface PauseMenuHandlers {
  onResume: () => void;
  onToggleMute: () => void;
  onToggleMotion: () => void;
  onToggleFx: () => void;
  onToggleColorblind: () => void;
  onOpenControls: () => void;
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
        <button class="settings-row" id="pause-fx"><span>💥 Shake &amp; Flash</span><span id="pause-fx-state" class="settings-val">On</span></button>
        <button class="settings-row" id="pause-colorblind"><span>👁 Colorblind Marks</span><span id="pause-colorblind-state" class="settings-val">Off</span></button>
        <button class="settings-row kbd-only" id="pause-controls"><span>⌨ Controls</span><span class="settings-val">Remap…</span></button>
        <button class="restart-btn" id="pause-restart" style="background-color:#3a1414;color:#ffab91;margin-top:4px;">↻ New Run</button>
        <button class="settings-row" id="pause-refresh" style="display:none;border-color:#d9a441;color:#ffd54f;"><span>⟳ Update App</span><span class="settings-val">New version!</span></button>
      </div>
      <p class="kbd-only" style="color:#444;font-size:8px;margin-top:10px;">Esc or P to resume · M mutes</p>
      <p style="color:#3a3a3a;font-size:8px;margin-top:6px;">Causeway to Ériu v${__APP_VERSION__}</p>
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
    const fxState = this.querySelector('#pause-fx-state');
    const cbState = this.querySelector('#pause-colorblind-state');
    const volumeState = this.querySelector('#pause-volume-state');
    if (muteState) muteState.textContent = state.soundOn ? 'On' : 'Off';
    if (motionState) motionState.textContent = state.reducedMotion ? 'On' : 'Off';
    if (fxState) fxState.textContent = state.screenEffects ? 'On' : 'Off';
    if (cbState) cbState.textContent = state.colorblind ? 'On' : 'Off';
    if (volumeState) volumeState.textContent = `${state.volumePct}%`;
    this.bind('pause-resume', handlers.onResume);
    this.bind('pause-mute', handlers.onToggleMute);
    this.bind('pause-motion', handlers.onToggleMotion);
    this.bind('pause-fx', handlers.onToggleFx);
    this.bind('pause-colorblind', handlers.onToggleColorblind);
    this.bind('pause-controls', handlers.onOpenControls);
    this.bind('pause-volume', handlers.onCycleVolume);
    this.bind('pause-restart', handlers.onRestart);
    // Only shown while a new version is actually waiting; two-tap confirm,
    // since the update reload ends the current run.
    const refreshBtn = this.querySelector<HTMLButtonElement>('#pause-refresh');
    if (refreshBtn) {
      refreshBtn.style.display = state.updateAvailable ? '' : 'none';
      refreshBtn.innerHTML = '<span>⟳ Update App</span><span class="settings-val">New version!</span>';
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
