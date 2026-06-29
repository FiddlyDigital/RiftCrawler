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
