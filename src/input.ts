import type { Game } from './game';
import { CONFIG } from './config';

type GameGetter = () => Game;
type InspectCallback = (gx: number, gy: number, clientX: number, clientY: number) => void;

export function bindKeyboard(getGame: GameGetter): void {
  window.addEventListener('keydown', (e) => {
    const game = getGame();
    if (game.player.hp <= 0) return;

    switch (e.key) {
      case 'w': case 'ArrowUp':    game.handleHeroMove(0, -1);  break;
      case 's': case 'ArrowDown':  game.handleHeroMove(0, 1);   break;
      case 'a': case 'ArrowLeft':  game.handleHeroMove(-1, 0);  break;
      case 'd': case 'ArrowRight': game.handleHeroMove(1, 0);   break;
      case ' ':                    game.handleHeroWait();        break;
      case 'q': case 'Q':          game.handleRangedAttack();    break;
      case 'j':                    game.handleBlockLeft();       break;
      case 'l':                    game.handleBlockRight();      break;
      case 'i':                    game.handleBlockRotate();     break;
      case 'k':                    game.handleBlockDrop();       break;
      case 'x':                    game.handleBlockSoftDrop();   break;
      case 'h': case 'H':          game.handleBlockHold();       break;
      case 'u': case 'U':          game.handleUseItem();       break;
    }
  });
}

export function bindCanvasInspect(canvas: HTMLCanvasElement, getGame: GameGetter, onInspect: InspectCallback): void {
  let startX = 0, startY = 0;

  function toGrid(clientX: number, clientY: number): { gx: number; gy: number } {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const gx = Math.floor((clientX - rect.left) * scaleX / CONFIG.TILE_SIZE);
    const gy = Math.floor((clientY - rect.top) * scaleY / CONFIG.TILE_SIZE);
    return { gx, gy };
  }

  canvas.addEventListener('touchstart', (e) => {
    const t = e.changedTouches[0]!;
    startX = t.clientX; startY = t.clientY;
    e.preventDefault();
  }, { passive: false });

  canvas.addEventListener('touchend', (e) => {
    const game = getGame();
    if (game.player.hp <= 0) return;
    const t = e.changedTouches[0]!;
    const absDx = Math.abs(t.clientX - startX);
    const absDy = Math.abs(t.clientY - startY);

    if (absDx < 12 && absDy < 12) {
      const { gx, gy } = toGrid(t.clientX, t.clientY);
      onInspect(gx, gy, t.clientX, t.clientY);
    }
    e.preventDefault();
  }, { passive: false });

  canvas.addEventListener('click', (e) => {
    const game = getGame();
    if (game.player.hp <= 0) return;
    const { gx, gy } = toGrid(e.clientX, e.clientY);
    onInspect(gx, gy, e.clientX, e.clientY);
  });
}

export function bindGamepad(getGame: GameGetter): void {
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
    const game = getGame();
    switch (action) {
      case 'hero-up':        game.handleHeroMove(0, -1);  break;
      case 'hero-down':      game.handleHeroMove(0,  1);  break;
      case 'hero-left':      game.handleHeroMove(-1, 0);  break;
      case 'hero-right':     game.handleHeroMove( 1, 0);  break;
      case 'hero-wait':      game.handleHeroWait();        break;
      case 'hero-ranged':    game.handleRangedAttack();    break;
      case 'block-left':     game.handleBlockLeft();       break;
      case 'block-right':    game.handleBlockRight();      break;
      case 'block-rotate':   game.handleBlockRotate();     break;
      case 'block-drop':     game.handleBlockDrop();       break;
      case 'block-softdrop': game.handleBlockSoftDrop();  break;
    }
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

export function bindButtons(getGame: GameGetter): void {
  document.addEventListener('click', (e) => {
    const btn = (e.target as Element).closest<HTMLElement>('[data-action]');
    if (!btn) return;

    const game = getGame();
    if (game.player.hp <= 0) return;

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
      case 'hero-use':       game.handleUseItem();     break;
      case 'hero-move': {
        const dx = Number(btn.dataset['dx'] ?? 0);
        const dy = Number(btn.dataset['dy'] ?? 0);
        game.handleHeroMove(dx, dy);
        break;
      }
    }
  });
}
