import type { Game } from './game';

/** Gameplay signals the tutorial listens for, forwarded from main.ts's existing callback stream. */
export type TutorialEvent =
  | 'tick'          // any UI refresh — used to watch hero position
  | 'blockSteer'    // block moved or rotated
  | 'blockLand'
  | 'lineClear'
  | 'kill'
  | 'stairsChoice'  // the delve-or-rest dialog opened
  | 'descend'
  | 'waystation';

interface TutorialStep {
  title: string;
  /** [keyboard copy, touch copy] */
  text: [string, string];
  /** Which events complete this step (heroMove is handled specially via position watching). */
  doneOn: TutorialEvent[] | 'heroMove' | 'button';
  /** Auto-advance after this many block landings, so a step can never stall the run. */
  fallbackLands?: number;
}

const STEPS: TutorialStep[] = [
  {
    title: 'This is you',
    text: [
      'The figure on the platform is your hero. Take a step — WASD or the arrow keys.',
      'The figure on the platform is your hero. Take a step with the right-hand HERO pad.',
    ],
    doneOn: 'heroMove',
  },
  {
    title: 'The stone is yours too',
    text: [
      'You steer the falling block as well — you are building this dungeon. Nudge it: J / L to move, I to rotate.',
      'You steer the falling block as well — you are building this dungeon. Nudge it with the left BLOCK pad, or swipe ◀ ▶ / ▲ to rotate.',
    ],
    doneOn: ['blockSteer'],
  },
  {
    title: 'Stone becomes floor',
    text: [
      'Wherever a block lands becomes ground your hero can walk on. Drop this one — K hard-drops, X drops it gently.',
      'Wherever a block lands becomes ground your hero can walk on. Drop this one — flick ▼ or tap the drop button.',
    ],
    doneOn: ['blockLand'],
  },
  {
    title: 'Clear rows',
    text: [
      'Fill a row wall-to-wall and it CLEARS: gold, XP, and every monster standing on it is crushed. Let the stack reach the ceiling and it collapses on your head — build low and tidy.',
      'Fill a row wall-to-wall and it CLEARS: gold, XP, and every monster standing on it is crushed. Let the stack reach the ceiling and it collapses on your head — build low and tidy.',
    ],
    doneOn: ['lineClear'],
    fallbackLands: 8,
  },
  {
    title: 'Fight',
    text: [
      'Monsters ride down inside the stone. Walk INTO one to strike it; anything beside you strikes back on its turn. Space waits a turn and heals a little.',
      'Monsters ride down inside the stone. Walk INTO one to strike it; anything beside you strikes back on its turn. The ● button waits a turn and heals a little.',
    ],
    doneOn: ['kill'],
    fallbackLands: 10,
  },
  {
    title: 'Descend',
    text: [
      'Stairs form in the stone as you build. Step onto them to go deeper — or duck into the sídhe mound first: a safe hall with a healing hearth, a shop, and everyone you rescue on the way down.',
      'Stairs form in the stone as you build. Step onto them to go deeper — or duck into the sídhe mound first: a safe hall with a healing hearth, a shop, and everyone you rescue on the way down.',
    ],
    doneOn: ['stairsChoice', 'descend', 'waystation'],
  },
  {
    title: 'The way is down',
    text: [
      'Deeper floors are deadlier and richer — smiths, omens, dark pacts, and the ghosts of runs past. The causeway remembers those who fall. Good luck.',
      'Deeper floors are deadlier and richer — smiths, omens, dark pacts, and the ghosts of runs past. The causeway remembers those who fall. Good luck.',
    ],
    doneOn: 'button',
  },
];

/**
 * A skippable, non-blocking guided tutorial for the first run: a small
 * callout card over the canvas whose steps advance when the player actually
 * performs each action (observed from the game's normal event stream — the
 * game itself is never paused or modified). Steps that depend on luck (a
 * line clear, a monster kill) auto-advance after a few block landings so
 * the tutorial can never stall.
 */
export class TutorialController {
  private readonly host: HTMLElement;
  private readonly keyboard: boolean;
  private readonly onFinished: () => void;
  private el: HTMLElement | null = null;
  private idx = -1;
  private lands = 0;
  private landsAtStepStart = 0;
  private lastHeroPos: { x: number; y: number } | null = null;

  /** True while the tutorial is showing. */
  public get active(): boolean { return this.idx >= 0 && this.idx < STEPS.length; }

  /**
   * @param host - Element the callout card is appended to (the canvas container).
   * @param keyboard - Chooses keyboard vs touch copy.
   * @param onFinished - Called once when the tutorial ends (completed or skipped) — persist the done-flag here.
   * @throws {TypeError} If `host` or `onFinished` is null/undefined.
   */
  constructor(host: HTMLElement, keyboard: boolean, onFinished: () => void) {
    if (!host) throw new TypeError('TutorialController: "host" must not be null/undefined');
    if (typeof onFinished !== 'function') throw new TypeError('TutorialController: "onFinished" must be a function');
    this.host = host;
    this.keyboard = keyboard;
    this.onFinished = onFinished;
  }

  /** Begins the tutorial at step 1 (no-op if already running). */
  public start(game: Game): void {
    if (this.active) return;
    this.idx = 0;
    this.lands = 0;
    this.landsAtStepStart = 0;
    this.lastHeroPos = { x: game.player.x, y: game.player.y };
    this.render();
  }

  /** Ends the tutorial immediately (death, new run, skip) and reports finished. */
  public stop(): void {
    if (this.idx === -1) return;
    this.idx = STEPS.length;
    this.el?.remove();
    this.el = null;
    this.onFinished();
  }

  /** Feed one gameplay event; advances the current step when its condition is met. */
  public notify(ev: TutorialEvent, game: Game): void {
    if (!this.active) return;
    const step = STEPS[this.idx]!;
    if (ev === 'blockLand') this.lands++;

    let done = false;
    if (step.doneOn === 'heroMove') {
      const p = this.lastHeroPos;
      if (p && (game.player.x !== p.x || game.player.y !== p.y)) done = true;
    } else if (Array.isArray(step.doneOn)) {
      done = step.doneOn.includes(ev);
    }
    if (!done && step.fallbackLands !== undefined && this.lands - this.landsAtStepStart >= step.fallbackLands) {
      done = true;  // the dungeon didn't cooperate — move on rather than stall
    }
    if (done) this.advance(game);
  }

  private advance(game: Game): void {
    this.idx++;
    this.landsAtStepStart = this.lands;
    this.lastHeroPos = { x: game.player.x, y: game.player.y };
    if (this.idx >= STEPS.length) { this.stop(); return; }
    this.render();
  }

  private render(): void {
    const step = STEPS[this.idx]!;
    if (!this.el) {
      this.el = document.createElement('div');
      this.el.id = 'tutorial-callout';
      this.host.appendChild(this.el);
    }
    const last = step.doneOn === 'button';
    this.el.innerHTML = `
      <div class="tut-head">
        <span class="tut-title">${step.title}</span>
        <span class="tut-count">${this.idx + 1}/${STEPS.length}</span>
      </div>
      <div class="tut-text">${step.text[this.keyboard ? 0 : 1]}</div>
      <div class="tut-actions">
        ${last
          ? '<button id="tut-done" class="tut-btn tut-btn-primary">✓ Got it</button>'
          : '<button id="tut-skip" class="tut-btn">Skip tutorial</button>'}
      </div>`;
    const skip = this.el.querySelector<HTMLButtonElement>('#tut-skip');
    if (skip) skip.onclick = () => this.stop();
    const doneBtn = this.el.querySelector<HTMLButtonElement>('#tut-done');
    if (doneBtn) doneBtn.onclick = () => this.stop();
    // Re-trigger the entrance animation on each step.
    this.el.classList.remove('tut-pop');
    void this.el.offsetWidth;
    this.el.classList.add('tut-pop');
  }
}
