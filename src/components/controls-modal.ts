import { BaseModal } from './base-modal';
import { KeyBindings, ACTION_LABELS, type GameAction } from '../keybinds';

/**
 * The keyboard-remapping screen, reached from the pause menu. Click an
 * action row, press the new key; Esc cancels a pending rebind or closes
 * the screen. While open, a capture-phase key handler swallows keydowns so
 * the app shell's Esc/P/M shortcuts can't fire underneath it.
 */
export class ControlsModal extends BaseModal {
  /** The action awaiting its new key, if a row has been clicked. */
  private listeningFor: GameAction | null = null;
  private onClose: (() => void) | null = null;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;

  protected template(): string {
    return `<div class="modal-card" style="max-width:340px;">
      <div class="modal-title" id="controls-title" style="color:#7986cb;font-size:20px;">⌨ CONTROLS</div>
      <p style="color:#666;margin:4px 0 10px 0;font-size:11px;">Click an action, then press its new key. Esc, P and M stay with the menu.</p>
      <div id="controls-rows" style="display:flex;flex-direction:column;gap:4px;max-height:50vh;overflow-y:auto;"></div>
      <div style="display:flex;gap:8px;margin-top:12px;">
        <button class="settings-row" id="controls-reset" style="flex:1;justify-content:center;"><span>↺ Defaults</span></button>
        <button class="restart-btn" id="controls-close" style="flex:1;font-size:13px;">Done</button>
      </div>
    </div>`;
  }

  private renderRows(): void {
    const container = this.querySelector('#controls-rows')!;
    let lastGroup = '';
    container.innerHTML = '';
    for (const { action, label, group } of ACTION_LABELS) {
      if (group !== lastGroup) {
        lastGroup = group;
        const head = document.createElement('div');
        head.style.cssText = 'font-size:8px;text-transform:uppercase;letter-spacing:.5px;margin:6px 0 2px 0;';
        head.style.color = group === 'hero' ? 'var(--hero-accent, #7fd488)' : 'var(--block-accent, #64b5f6)';
        head.textContent = group === 'hero' ? 'Hero (Rogue)' : 'Block (Tetris)';
        container.appendChild(head);
      }
      const row = document.createElement('button');
      row.className = 'settings-row';
      const listening = this.listeningFor === action;
      const bound = KeyBindings.keysFor(action).map(k => KeyBindings.keyLabel(k)).join(' / ');
      const keys = listening
        ? '<span style="color:#ffd54f;">press a key…</span>'
        : (bound || '<span style="color:#a15c5c;">—</span>');
      row.innerHTML = `<span>${label}</span><span class="settings-val">${keys}</span>`;
      row.onclick = () => {
        this.listeningFor = listening ? null : action;
        this.renderRows();
      };
      container.appendChild(row);
    }
  }

  /** Shows the controls screen; `onClose` fires when it's dismissed. */
  public showControls(onClose: () => void): void {
    if (typeof onClose !== 'function') throw new TypeError('ControlsModal.showControls: "onClose" must be a function');
    this.onClose = onClose;
    this.listeningFor = null;
    this.renderRows();
    this.querySelector<HTMLButtonElement>('#controls-reset')!.onclick = () => {
      KeyBindings.reset();
      this.listeningFor = null;
      this.renderRows();
    };
    this.querySelector<HTMLButtonElement>('#controls-close')!.onclick = () => this.close();
    this.keyHandler = (e: KeyboardEvent) => {
      if (!this.isOpen) return;
      if (this.listeningFor) {
        e.preventDefault();
        e.stopPropagation();
        if (e.key !== 'Escape') {
          // Reserved keys are refused by rebind() — the row just keeps listening.
          if (!KeyBindings.rebind(this.listeningFor, e.key)) return;
        }
        this.listeningFor = null;
        this.renderRows();
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.close();
        return;
      }
      // Swallow everything else so the shell's P/M shortcuts stay inert underneath.
      e.stopPropagation();
    };
    window.addEventListener('keydown', this.keyHandler, { capture: true });
    this.show();
  }

  private close(): void {
    if (this.keyHandler) {
      window.removeEventListener('keydown', this.keyHandler, { capture: true });
      this.keyHandler = null;
    }
    this.listeningFor = null;
    this.hide();
    const cb = this.onClose;
    this.onClose = null;
    cb?.();
  }
}

customElements.define('controls-modal', ControlsModal);
declare global {
  interface HTMLElementTagNameMap {
    'controls-modal': ControlsModal;
  }
}
