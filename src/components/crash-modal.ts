import { BaseModal } from './base-modal';

/** The fatal-error recovery overlay — shown once per crash, offers a reload. */
export class CrashModal extends BaseModal {
  protected template(): string {
    return `<div class="modal-card">
      <div class="modal-title" id="crash-title" style="color:var(--hp-color);">⚠ SOMETHING WENT WRONG</div>
      <p style="color:#888;margin:5px 0 10px 0;">An unexpected error occurred and this run can't safely continue. Reloading is the safest way to keep playing — your high score and run history are saved separately and won't be lost.</p>
      <p id="crash-detail" style="color:#666;font-size:10px;font-family:monospace;margin:8px 0;word-break:break-word;"></p>
      <button class="restart-btn" id="crash-reload">🔄 Reload Game</button>
    </div>`;
  }

  protected connectedCallback(): void {
    super.connectedCallback();
    this.querySelector('#crash-reload')?.addEventListener('click', () => location.reload());
  }

  /** Shows the crash modal with the given error message. */
  public showCrash(message: string): void {
    if (typeof message !== 'string') throw new TypeError('CrashModal.showCrash: "message" must be a string');
    const detail = this.querySelector('#crash-detail');
    if (detail) detail.textContent = message;
    this.show();
  }
}

customElements.define('crash-modal', CrashModal);
declare global {
  interface HTMLElementTagNameMap {
    'crash-modal': CrashModal;
  }
}
