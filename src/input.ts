import type { Game } from './game';

type GameGetter = () => Game;

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
      case 'j':                    game.handleBlockLeft();       break;
      case 'l':                    game.handleBlockRight();      break;
      case 'i':                    game.handleBlockRotate();     break;
      case 'k':                    game.handleBlockDrop();       break;
      case 'x':                    game.handleBlockSoftDrop();   break;
    }
  });
}

export function bindTouch(canvas: HTMLCanvasElement, getGame: GameGetter): void {
  let startX = 0, startY = 0, startTime = 0;

  canvas.addEventListener('touchstart', (e) => {
    const t = e.changedTouches[0]!;
    startX = t.clientX; startY = t.clientY; startTime = Date.now();
    e.preventDefault();
  }, { passive: false });

  canvas.addEventListener('touchend', (e) => {
    const game = getGame();
    if (game.paused || game.player.hp <= 0) return;
    const t = e.changedTouches[0]!;
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;
    const dt = Date.now() - startTime;
    const absDx = Math.abs(dx), absDy = Math.abs(dy);

    if (absDx < 12 && absDy < 12) {
      game.handleBlockRotate(); // tap → rotate
    } else if (absDx > absDy) {
      dx < 0 ? game.handleBlockLeft() : game.handleBlockRight(); // horizontal swipe
    } else if (dy > 0) {
      dt < 220 ? game.handleBlockDrop() : game.handleBlockSoftDrop(); // fast flick = hard drop
    }
    e.preventDefault();
  }, { passive: false });
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
      case 'hero-wait':      game.handleHeroWait();      break;
      case 'hero-move': {
        const dx = Number(btn.dataset['dx'] ?? 0);
        const dy = Number(btn.dataset['dy'] ?? 0);
        game.handleHeroMove(dx, dy);
        break;
      }
    }
  });
}
