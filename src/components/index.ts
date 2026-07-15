// Side-effect imports — each module calls `customElements.define(...)` at load
// time. Imported once from `main.ts` so every custom element is registered
// before `index.html`'s tags are parsed.
import './crash-modal';
import './pause-modal';
import './boss-warning-modal';
import './modifier-modal';
import './class-modal';
import './floor-event-modal';
