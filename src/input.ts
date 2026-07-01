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
      case 'hero-ranged':    game.handleRangedAttack();  break;
      case 'hero-move': {
        const dx = Number(btn.dataset['dx'] ?? 0);
        const dy = Number(btn.dataset['dy'] ?? 0);
        game.handleHeroMove(dx, dy);
        break;
      }
    }
  });
}
