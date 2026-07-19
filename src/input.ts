import type { Game } from './game';
import { GameConfig } from './config';
import { HapticsController } from './haptics';
import { KeyBindings } from './keybinds';

type GameGetter = () => Game;
type InspectCallback = (gx: number, gy: number, clientX: number, clientY: number) => void;

// Swipe vocabulary on the canvas itself — left/right/up/down move & rotate
// the falling block, a fast or long downward flick hard-drops it. A short
// tap (below TAP_THRESHOLD movement) still inspects the tapped tile.
const TAP_THRESHOLD        = 12;   // px — below this, it's a tap not a swipe
const SWIPE_THRESHOLD       = 28;   // px — minimum movement to count as a swipe
const HARD_DROP_DISTANCE    = 140;  // px — a long downward swipe is a hard drop
const HARD_DROP_VELOCITY    = 1.0;  // px/ms — a fast flick down is a hard drop regardless of distance

// Buttons that only make sense as a single press — holding them fires once,
// not repeatedly, matching the gamepad's ONE_SHOT set.
const BUTTON_ONE_SHOT = new Set(['block-drop', 'hero-ranged', 'spell-cycle']);
const BUTTON_INITIAL_DELAY = 200; // ms before auto-repeat kicks in
const BUTTON_REPEAT_MS     = 120; // ms between repeated fires

/**
 * Wires every input source (keyboard, touch/swipe, gamepad, on-screen
 * buttons) to a `Game` instance. Each `bindX` method is called exactly once
 * at app bootstrap in `main.ts`; all state is closed over per-binding rather
 * than stored on the class, since a game can only ever have one of each input source.
 */
export class InputBinder {
  private static heroMove(game: Game, dx: number, dy: number): void {
    game.handleHeroMove(dx, dy);
    if (game.player.bonusHeroMoves > 0 && !game.paused && game.player.hp > 0) {
      game.handleHeroMove(dx, dy);
    }
  }

  /**
   * Binds the keyboard to the game through the remappable {@link KeyBindings}
   * layer (defaults: WASD/arrows for the hero, JLIKX/H for the block,
   * Space/Q/E for wait/ability/spell).
   * @throws {TypeError} If `getGame` is not a function.
   */
  static bindKeyboard(getGame: GameGetter): void {
    if (typeof getGame !== 'function') throw new TypeError('InputBinder.bindKeyboard: "getGame" must be a function');
    window.addEventListener('keydown', (e) => {
      const game = getGame();
      if (game.player.hp <= 0) return;
      const action = KeyBindings.actionForKey(e.key);
      if (action) InputBinder.fireGameAction(game, action);
    });
  }

  // Grid-fraction based, not canvas.width/TILE_SIZE based — stays correct
  // regardless of the canvas's internal backing-buffer resolution (which is
  // scaled by devicePixelRatio for sprite crispness; see renderer.ts).
  private static toGrid(canvas: HTMLCanvasElement, clientX: number, clientY: number): { gx: number; gy: number } {
    const rect = canvas.getBoundingClientRect();
    const gx = Math.floor((clientX - rect.left) / rect.width * GameConfig.COLS);
    const gy = Math.floor((clientY - rect.top) / rect.height * GameConfig.ROWS);
    return { gx, gy };
  }

  /**
   * Binds touch swipes (block move/rotate/drop) and taps/clicks (tile
   * inspect) on the game canvas.
   * @throws {TypeError} If `canvas` is null/undefined, `getGame` is not a function, or `onInspect` is not a function.
   */
  static bindCanvasInspect(canvas: HTMLCanvasElement, getGame: GameGetter, onInspect: InspectCallback): void {
    if (canvas === null || canvas === undefined) throw new TypeError('InputBinder.bindCanvasInspect: "canvas" must not be null/undefined');
    if (typeof getGame !== 'function') throw new TypeError('InputBinder.bindCanvasInspect: "getGame" must be a function');
    if (typeof onInspect !== 'function') throw new TypeError('InputBinder.bindCanvasInspect: "onInspect" must be a function');

    let startX = 0, startY = 0, startT = 0;

    canvas.addEventListener('touchstart', (e) => {
      const t = e.changedTouches[0]!;
      startX = t.clientX; startY = t.clientY; startT = performance.now();
      e.preventDefault();
    }, { passive: false });

    canvas.addEventListener('touchend', (e) => {
      const game = getGame();
      if (game.player.hp <= 0) { e.preventDefault(); return; }
      const t = e.changedTouches[0]!;
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);

      if (absDx < TAP_THRESHOLD && absDy < TAP_THRESHOLD) {
        const { gx, gy } = InputBinder.toGrid(canvas, t.clientX, t.clientY);
        onInspect(gx, gy, t.clientX, t.clientY);
      } else if (absDx > absDy && absDx > SWIPE_THRESHOLD) {
        if (dx < 0) game.handleBlockLeft(); else game.handleBlockRight();
        HapticsController.vibrate(4);
      } else if (absDy > SWIPE_THRESHOLD) {
        const elapsedMs = Math.max(1, performance.now() - startT);
        if (dy < 0) {
          game.handleBlockRotate();
          HapticsController.vibrate(4);
        } else if (absDy > HARD_DROP_DISTANCE || absDy / elapsedMs > HARD_DROP_VELOCITY) {
          game.handleBlockDrop();
          HapticsController.vibrate(12);
        } else {
          game.handleBlockSoftDrop();
          HapticsController.vibrate(4);
        }
      }
      e.preventDefault();
    }, { passive: false });

    canvas.addEventListener('click', (e) => {
      const game = getGame();
      if (game.player.hp <= 0) return;
      const { gx, gy } = InputBinder.toGrid(canvas, e.clientX, e.clientY);
      onInspect(gx, gy, e.clientX, e.clientY);
    });
  }

  /** Dispatches a named game action — the shared vocabulary of the keyboard, gamepad, and on-screen button bindings. */
  private static fireGameAction(game: Game, action: string): void {
    switch (action) {
      case 'hero-up':        InputBinder.heroMove(game, 0, -1);  break;
      case 'hero-down':      InputBinder.heroMove(game, 0,  1);  break;
      case 'hero-left':      InputBinder.heroMove(game, -1, 0);  break;
      case 'hero-right':     InputBinder.heroMove(game,  1, 0);  break;
      case 'hero-wait':      game.handleHeroWait();        break;
      case 'hero-ranged':    game.handleRangedAttack();    break;
      case 'spell-cycle':    game.handleCycleSpell();      break;
      case 'block-left':     game.handleBlockLeft();       break;
      case 'block-right':    game.handleBlockRight();      break;
      case 'block-rotate':   game.handleBlockRotate();     break;
      case 'block-drop':     game.handleBlockDrop();       break;
      case 'block-softdrop': game.handleBlockSoftDrop();   break;
      case 'block-hold':     game.handleBlockHold();       break;
    }
  }

  /**
   * Binds gamepad d-pad/stick/button polling (via `requestAnimationFrame`) to the game.
   * @throws {TypeError} If `getGame` is not a function.
   */
  static bindGamepad(getGame: GameGetter): void {
    if (typeof getGame !== 'function') throw new TypeError('InputBinder.bindGamepad: "getGame" must be a function');

    const DEAD_ZONE     = 0.4;
    const INITIAL_DELAY = 200; // ms before auto-repeat kicks in
    const REPEAT_MS     = 120; // ms between repeated fires

    // These fire once per press; holding does nothing extra
    const ONE_SHOT = new Set(['block-drop', 'hero-ranged']);

    const nextFireAt = new Map<string, number>(); // action → next allowed fire time
    const prevActive = new Set<string>();         // actions active last frame
    let rafId: number | null = null;

    function getActiveActions(): Set<string> {
      const active = new Set<string>();
      for (const gp of navigator.getGamepads()) {
        if (!gp?.connected) continue;
        const b = gp.buttons;
        const a = gp.axes;

        // D-pad (12-15) + left stick (axes 0/1) → hero movement
        if (b[12]?.pressed || (a[1] ?? 0) < -DEAD_ZONE) active.add('hero-up');
        if (b[13]?.pressed || (a[1] ?? 0) >  DEAD_ZONE) active.add('hero-down');
        if (b[14]?.pressed || (a[0] ?? 0) < -DEAD_ZONE) active.add('hero-left');
        if (b[15]?.pressed || (a[0] ?? 0) >  DEAD_ZONE) active.add('hero-right');

        // A (0) → wait/heal
        if (b[0]?.pressed) active.add('hero-wait');
        // B (1) or RT (7) → ranged ability
        if (b[1]?.pressed || b[7]?.pressed) active.add('hero-ranged');

        // X (2) → block rotate   Y (3) → hard drop
        if (b[2]?.pressed) active.add('block-rotate');
        if (b[3]?.pressed) active.add('block-drop');

        // LB (4) or right-stick left  → block left
        // RB (5) or right-stick right → block right
        if (b[4]?.pressed || (a[2] ?? 0) < -DEAD_ZONE) active.add('block-left');
        if (b[5]?.pressed || (a[2] ?? 0) >  DEAD_ZONE) active.add('block-right');

        // LT (6) or right-stick down → soft drop
        if ((b[6]?.value ?? 0) > 0.5 || (a[3] ?? 0) > DEAD_ZONE) active.add('block-softdrop');
      }
      return active;
    }

    function fireAction(action: string): void {
      InputBinder.fireGameAction(getGame(), action);
    }

    function poll(): void {
      const now    = Date.now();
      const active = getActiveActions();

      for (const action of active) {
        if (!prevActive.has(action)) {
          // Rising edge — fire immediately
          fireAction(action);
          if (!ONE_SHOT.has(action)) nextFireAt.set(action, now + INITIAL_DELAY);
        } else if (!ONE_SHOT.has(action) && now >= (nextFireAt.get(action) ?? Infinity)) {
          // Auto-repeat
          fireAction(action);
          nextFireAt.set(action, now + REPEAT_MS);
        }
      }

      for (const action of prevActive) {
        if (!active.has(action)) nextFireAt.delete(action);
      }
      prevActive.clear();
      for (const action of active) prevActive.add(action);

      rafId = requestAnimationFrame(poll);
    }

    function startPolling(): void {
      if (rafId === null) rafId = requestAnimationFrame(poll);
    }

    function stopPolling(): void {
      if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
    }

    function updateIndicator(on: boolean): void {
      const el = document.getElementById('gamepad-indicator');
      if (el) el.style.display = on ? '' : 'none';
    }

    window.addEventListener('gamepadconnected', (e) => {
      updateIndicator(true);
      startPolling();
      console.log(`Gamepad connected: ${(e as GamepadEvent).gamepad.id}`);
    });

    window.addEventListener('gamepaddisconnected', () => {
      const anyLeft = Array.from(navigator.getGamepads()).some(g => g?.connected);
      if (!anyLeft) { updateIndicator(false); stopPolling(); }
    });

    // Some browsers don't fire gamepadconnected for pre-existing connections
    requestAnimationFrame(() => {
      const any = Array.from(navigator.getGamepads()).some(g => g?.connected);
      if (any) { updateIndicator(true); startPolling(); }
    });
  }

  private static performButtonAction(game: Game, btn: HTMLElement): void {
    const action = btn.dataset['action'];
    switch (action) {
      case 'block-rotate':   game.handleBlockRotate();   break;
      case 'block-left':     game.handleBlockLeft();     break;
      case 'block-right':    game.handleBlockRight();    break;
      case 'block-drop':     game.handleBlockDrop();     break;
      case 'block-softdrop': game.handleBlockSoftDrop(); break;
      case 'block-hold':     game.handleBlockHold();     break;
      case 'hero-wait':      game.handleHeroWait();      break;
      case 'hero-ranged':    game.handleRangedAttack();  break;
      case 'spell-cycle':    game.handleCycleSpell();    break;
      case 'hero-move': {
        const dx = Number(btn.dataset['dx'] ?? 0);
        const dy = Number(btn.dataset['dy'] ?? 0);
        InputBinder.heroMove(game, dx, dy);
        break;
      }
    }
  }

  /**
   * Binds every `[data-action]` on-screen button (tap-and-hold with
   * auto-repeat for repeatable actions) to the game.
   * @throws {TypeError} If `getGame` is not a function.
   */
  static bindButtons(getGame: GameGetter): void {
    if (typeof getGame !== 'function') throw new TypeError('InputBinder.bindButtons: "getGame" must be a function');
    const buttons = document.querySelectorAll<HTMLElement>('[data-action]');

    buttons.forEach((btn) => {
      let repeatTimer: ReturnType<typeof setTimeout> | null = null;
      let activePointerId: number | null = null;

      function fire(): void {
        const game = getGame();
        if (game.player.hp <= 0) return;
        InputBinder.performButtonAction(game, btn);
      }

      function scheduleRepeat(): void {
        const action = btn.dataset['action'];
        if (action !== undefined && BUTTON_ONE_SHOT.has(action)) return;
        repeatTimer = setTimeout(function repeat() {
          fire();
          repeatTimer = setTimeout(repeat, BUTTON_REPEAT_MS);
        }, BUTTON_INITIAL_DELAY);
      }

      function stopRepeat(): void {
        if (repeatTimer !== null) { clearTimeout(repeatTimer); repeatTimer = null; }
        activePointerId = null;
      }

      btn.addEventListener('pointerdown', (e) => {
        if (activePointerId !== null) return; // already pressed by another pointer
        e.preventDefault();
        activePointerId = e.pointerId;
        // Capture is best-effort (keeps repeat firing if the finger slides off
        // the button) — some browsers throw NotFoundError on a fast tap when
        // the pointer is no longer "active" by the time this call lands.
        try { btn.setPointerCapture?.(e.pointerId); } catch { /* not critical */ }
        HapticsController.vibrate(4);
        fire();
        scheduleRepeat();
      });
      btn.addEventListener('pointerup', (e) => {
        if (e.pointerId !== activePointerId) return;
        stopRepeat();
      });
      btn.addEventListener('pointercancel', () => stopRepeat());
    });
  }
}
