/**
 * Shared show/hide/isOpen behavior for every modal-style custom element.
 * Renders in the light DOM (no shadow root) so the existing global
 * `style.css` keeps styling every modal's markup unchanged — only the outer
 * wrapper tag changes from `<div>` to a custom element.
 */
export abstract class BaseModal extends HTMLElement {
  private rendered = false;

  /** Renders {@link template} into this element's light DOM, once, the first time it's connected. */
  protected connectedCallback(): void {
    if (this.rendered) return;
    this.innerHTML = this.template();
    this.rendered = true;
  }

  /** This modal's inner markup — everything inside the `.modal-overlay` host element. */
  protected abstract template(): string;

  /** Shows the modal (`display: flex`, matching `.modal-overlay`'s CSS). */
  public show(): void {
    this.style.display = 'flex';
  }

  /** Hides the modal. */
  public hide(): void {
    this.style.display = 'none';
  }

  /** Whether the modal is currently shown. */
  public get isOpen(): boolean {
    return this.style.display === 'flex';
  }
}
