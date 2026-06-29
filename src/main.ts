import './style.css';
import { Game } from './game';
import { Renderer } from './renderer';
import { UIManager } from './ui';
import { bindKeyboard, bindButtons } from './input';
import { getHighScore, recordRunEnd } from './storage';
import { trackGameStart, trackGameOver, trackInstall } from './analytics';

const ui = new UIManager();
const canvas = document.getElementById('gameCanvas') as HTMLCanvasElement;
const renderer = new Renderer(canvas);

let game: Game;

function startGame(): void {
  game = new Game({
    log: (text, cls) => ui.log(text, cls),
    updateUI: (state) => ui.updateStats(state),
    onDeath: (title, reason, floor, score) => {
      const highScore = recordRunEnd(game);
      trackGameOver(score, floor);
      ui.showDeath(title, reason, floor, score, highScore);
    },
    onParticle: (x, y, text, color) => renderer.spawnParticle(x, y, text, color),
  });
  renderer.start(game);
  trackGameStart(1);
}

startGame();
bindKeyboard(() => game);
bindButtons(() => game);

document.getElementById('restart-btn')!.addEventListener('click', () => {
  ui.hideDeath();
  ui.clearLog();
  startGame();
  ui.log('--- Fresh Rift Opened! Good Luck ---', 'log-success');
});

// Display persisted high score on load
(document.getElementById('best-score') as HTMLElement).textContent = String(getHighScore());

// ── PWA install prompt ───────────────────────────────────────────────────────

type BeforeInstallPromptEvent = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

let installPrompt: BeforeInstallPromptEvent | null = null;
const installBanner = document.getElementById('install-banner')!;
const installBtn = document.getElementById('install-btn')!;
const installDismiss = document.getElementById('install-dismiss')!;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e as BeforeInstallPromptEvent;
  installBanner.hidden = false;
});

installBtn.addEventListener('click', async () => {
  if (!installPrompt) return;
  installBanner.hidden = true;
  await installPrompt.prompt();
  const { outcome } = await installPrompt.userChoice;
  if (outcome === 'accepted') trackInstall();
  installPrompt = null;
});

installDismiss.addEventListener('click', () => {
  installBanner.hidden = true;
});

window.addEventListener('appinstalled', () => {
  installBanner.hidden = true;
  installPrompt = null;
});
