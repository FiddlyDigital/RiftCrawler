import './style.css';
import { Game, tickMsForLevel } from './game';
import { Renderer } from './renderer';
import { UIManager } from './ui';
import { bindKeyboard, bindButtons } from './input';
import { getHighScore, recordRunEnd, loadHistory } from './storage';
import { trackGameStart, trackGameOver, trackInstall } from './analytics';
import { MERCHANT_STOCK } from './content';

const ui       = new UIManager();
const canvas   = document.getElementById('gameCanvas') as HTMLCanvasElement;
const renderer = new Renderer(canvas);

let game: Game;
let tickTimer: ReturnType<typeof setInterval> | null = null;

// ── Tick management ──────────────────────────────────────────────────────────

function getTickMs(): number {
  return tickMsForLevel(game.dungeonLevel, game.player.tickSlowPercent);
}

function startTick(): void {
  stopTick();
  tickTimer = setInterval(() => {
    if (!game.paused && game.player.hp > 0) game.autoTick();
    else if (game.player.hp <= 0) stopTick();
  }, getTickMs());
}

function stopTick(): void {
  if (tickTimer !== null) { clearInterval(tickTimer); tickTimer = null; }
}

function resetTick(): void { startTick(); }

// ── Game factory ─────────────────────────────────────────────────────────────

function startGame(): void {
  stopTick();
  game = new Game({
    log:      (text, cls)          => ui.log(text, cls),
    updateUI: (state)              => ui.updateStats(state),
    onAction: ()                   => resetTick(),
    onParticle: (x, y, text, col) => renderer.spawnParticle(x, y, text, col),

    onDeath: (title, reason, floor, score) => {
      stopTick();
      const { highScore, history } = recordRunEnd(game, reason);
      trackGameOver(score, floor);
      ui.showDeath(title, reason, floor, score, highScore, history);
      ui.updateBestScore(highScore);
    },

    onLevelUp: (_newLevel) => {
      stopTick();
      const perks = game.getRandomPerks(3);
      ui.showPerkSelection(perks, (perkId) => {
        game.applyPerk(perkId);
        startTick();
      });
    },

    onOpenShop: (gold) => {
      stopTick();
      ui.showShop(
        gold,
        MERCHANT_STOCK,
        (i) => game.buyMerchantItem(i, MERCHANT_STOCK),
        ()  => { game.closeShop(); startTick(); },
      );
    },
  });

  renderer.start(game);
  startTick();
  trackGameStart(1);
}

startGame();
bindKeyboard(() => game);
bindButtons(() => game);

// Restart
document.getElementById('restart-btn')!.addEventListener('click', () => {
  ui.hideDeath();
  ui.clearLog();
  startGame();
  ui.log('--- Fresh Rift Opened! Good Luck ---', 'log-success');
});

// Initial high score / history display
ui.updateBestScore(getHighScore());
const initialHistory = loadHistory();
if (initialHistory.length > 0) {
  // Pre-populate in case page is refreshed before first death
  (document.getElementById('run-history') as HTMLElement).innerHTML =
    initialHistory.map((r, i) =>
      `<div class="history-row${i === 0 ? ' history-latest' : ''}">
        <span>${r.date}</span><span>Fl.${r.floor}</span>
        <span>${r.score.toLocaleString()}</span><span>Lv.${r.playerLevel}</span>
       </div>`,
    ).join('');
}

// ── PWA install prompt ────────────────────────────────────────────────────────

type BeforeInstallPromptEvent = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

let installPrompt: BeforeInstallPromptEvent | null = null;
const installBanner  = document.getElementById('install-banner')!;
const installBtn     = document.getElementById('install-btn')!;
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

installDismiss.addEventListener('click', () => { installBanner.hidden = true; });
window.addEventListener('appinstalled', () => { installBanner.hidden = true; installPrompt = null; });
