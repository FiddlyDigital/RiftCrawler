import './style.css';
import { Game, tickMsForLevel } from './game';
import { Renderer } from './renderer';
import { UIManager } from './ui';
import { bindKeyboard, bindButtons, bindCanvasInspect, bindGamepad } from './input';
import { getHighXp, recordRunEnd, loadHistory, saveMute, loadMute, saveReducedMotion, loadReducedMotion } from './storage';
import { trackGameStart, trackGameOver, trackInstall } from './analytics';
import { audio } from './audio';
import type { AudioEvent } from './types';

const ui       = new UIManager();
const canvas   = document.getElementById('gameCanvas') as HTMLCanvasElement;
const renderer = new Renderer(canvas);

// Keep sidebar exactly as tall as the canvas on mobile; let CSS control it on desktop
const sidebar = document.getElementById('sidebar-panel') as HTMLDivElement;
const syncSidebarHeight = (): void => {
  sidebar.style.height = window.innerWidth < 640 ? `${canvas.clientHeight}px` : '';
};
new ResizeObserver(syncSidebarHeight).observe(canvas);
window.addEventListener('resize', syncSidebarHeight);

let game: Game;
let tickTimer: ReturnType<typeof setInterval> | null = null;

// ── Tick management ──────────────────────────────────────────────────────────

function getTickMs(): number {
  return tickMsForLevel(
    game.dungeonLevel,
    game.player.tickSlowPercent + game.biomeGravityPct + (game.timeDilationTurns > 0 ? game.timeDilationSlowPct : 0),
  );
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

// ── Settings & pause ───────────────────────────────────────────────────────────

let soundOn = !loadMute();
// No stored preference → follow the OS reduced-motion setting.
let reducedMotion = loadReducedMotion() ?? (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
renderer.setReducedMotion(reducedMotion);
let manualPaused = false;

function toggleMute(): void {
  soundOn = audio.toggle();
  saveMute(!soundOn);
  ui.log(`Sound ${soundOn ? 'on' : 'off'}`, 'log-neutral');
  if (manualPaused) refreshPauseMenu();
}

function toggleReducedMotion(): void {
  reducedMotion = !reducedMotion;
  renderer.setReducedMotion(reducedMotion);
  saveReducedMotion(reducedMotion);
  ui.log(`Reduced motion ${reducedMotion ? 'on' : 'off'}`, 'log-neutral');
  if (manualPaused) refreshPauseMenu();
}

function refreshPauseMenu(): void {
  ui.showPauseMenu({ soundOn, reducedMotion }, {
    onResume:       closePauseMenu,
    onToggleMute:   toggleMute,
    onToggleMotion: toggleReducedMotion,
    onRestart:      restartRun,
  });
}

function openPauseMenu(): void {
  // Only from active play — never over a boon/altar/cinematic pause or a dead hero.
  if (manualPaused || game.paused || game.player.hp <= 0) return;
  manualPaused = true;
  game.paused = true;
  stopTick();
  refreshPauseMenu();
}

function closePauseMenu(): void {
  if (!manualPaused) return;
  manualPaused = false;
  ui.hidePauseMenu();
  if (game.player.hp > 0) { game.paused = false; startTick(); }
}

function togglePauseMenu(): void {
  if (manualPaused) closePauseMenu();
  else openPauseMenu();
}

function restartRun(): void {
  manualPaused = false;
  ui.hidePauseMenu();
  ui.hideDeath();
  ui.clearLog();
  startGame(true);
  launchWithModifier(() => {
    game.paused = false;
    startTick();
    audio.startAmbient();
    ui.log('--- Fresh Rift Opened! Good Luck ---', 'log-success');
  });
}

// ── Audio event router ───────────────────────────────────────────────────────

function handleAudio(event: AudioEvent, data?: number): void {
  switch (event) {
    case 'blockLand':    audio.playBlockLand();    renderer.triggerShake(2, 4); break;
    case 'blockRotate':  audio.playBlockRotate();      break;
    case 'blockMove':    audio.playBlockMove();        break;
    case 'hit':             audio.playHit();              break;
    case 'playerDamage':    audio.playPlayerDamage(); renderer.triggerDamageFlash(); renderer.triggerShake(4, 7); break;
    case 'kill':            audio.playKill();             break;
    case 'lineClear':
      audio.playLineClear(data ?? 1);
      renderer.triggerShake(data && data >= 4 ? 5 : 3, data && data >= 4 ? 8 : 5);
      break;
    case 'descend':         audio.playDescend();          break;
    case 'poison':          audio.playPoison();           break;
    case 'bossWarn':        audio.playBossWarn();         break;
    case 'teleport':        audio.playTeleport();         break;
    case 'comboMilestone':  audio.playComboMilestone(data ?? 2); break;
  }
}

// ── Game factory ─────────────────────────────────────────────────────────────

function startGame(startPaused = false): void {
  stopTick();
  game = new Game({
    log:      (text, cls, icon)    => ui.log(text, cls, icon),
    updateUI: (state)              => ui.updateStats(state),
    onAction: ()                   => resetTick(),
    onParticle: (x, y, text, col, fontSize, icon) => renderer.spawnParticle(x, y, text, col, fontSize, icon),
    onAudio:  (event, data)        => handleAudio(event, data),
    onBlockLand: (cells)           => renderer.spawnLandingDust(cells),
    onCombo:     (mult)            => renderer.showCombo(mult),

    onDeath: (title, reason, floor, totalXpEarned, stats) => {
      stopTick();
      audio.stopAmbient();
      audio.playDeath();
      const { highXp, history } = recordRunEnd(game, reason, stats);
      trackGameOver(totalXpEarned, floor);
      ui.showDeath(title, reason, floor, totalXpEarned, highXp, history, stats);
      ui.updateBestScore(highXp);
    },

    onVictory: (floor, totalXpEarned, stats) => {
      stopTick();
      audio.stopAmbient();
      audio.playLevelUp();
      const { highXp, history } = recordRunEnd(game, 'Defeated Bres the Beautiful', stats);
      trackGameOver(totalXpEarned, floor);
      ui.showVictory(floor, totalXpEarned, highXp, history, stats);
      ui.updateBestScore(highXp);
    },

    onLevelUp: (choices, onChoice) => {
      stopTick();
      audio.playLevelUp();
      ui.showAltarModal(1, choices, (index) => {
        onChoice(index);
        audio.playPerk();
        startTick();
      }, 'LEVEL UP — Choose a Boon');
    },

    onOpenTattooArtist: (choices, onChoice, reroll) => {
      stopTick();
      audio.playShop();
      ui.showTattooModal(choices, (i) => {
        onChoice(i);
        startTick();
      }, reroll);
    },

    onBossWarning: (boss, onDone) => {
      audio.playBossWarn();
      ui.showBossWarning(boss, () => {
        onDone();
        startTick();
      });
    },

    onFloorEvent: (event, onChoice) => {
      stopTick();
      ui.showFloorEvent(event, (index) => {
        onChoice(index);
        audio.playPerk();
        startTick();
      });
    },

    onOpenAltar: (tier, choices, onChoice, reroll) => {
      stopTick();
      audio.playPerk();
      ui.showAltarModal(tier, choices, (index) => {
        onChoice(index);
        startTick();
      }, undefined, reroll);
    },
  });

  if (startPaused) game.paused = true;
  renderer.start(game);
  if (!startPaused) startTick();
  trackGameStart(1);
}

// ── Class + Modifier picker then launch ──────────────────────────────────────

function launchWithModifier(onReady: () => void): void {
  const classes = game.getRandomClasses(4);
  ui.showClassSelection(classes, (classId) => {
    game.applyClass(classId);
    const mods = game.getRandomModifiers(3);
    ui.showModifierPick(mods, (modId) => {
      game.applyModifier(modId);
      onReady();
    });
  });
}

// ── Boot sequence ─────────────────────────────────────────────────────────────

startGame(true); // initialise paused — start screen sits on top
bindKeyboard(() => game);
bindButtons(() => game);
bindGamepad(() => game);

let lastInspectTile: { x: number; y: number } | null = null;
bindCanvasInspect(canvas, () => game, (gx, gy, clientX, clientY) => {
  if (lastInspectTile && lastInspectTile.x === gx && lastInspectTile.y === gy && ui.isInspectTooltipVisible()) {
    ui.hideInspectTooltip();
    lastInspectTile = null;
    return;
  }
  const info = game.getInspectInfo(gx, gy);
  if (info) {
    ui.showInspectTooltip(info, clientX, clientY);
    lastInspectTile = { x: gx, y: gy };
  } else {
    ui.hideInspectTooltip();
    lastInspectTile = null;
  }
});

ui.showStart(getHighXp());

document.getElementById('start-btn')!.addEventListener('click', () => {
  audio.init(); // unlock AudioContext on first user gesture
  if (loadMute()) audio.toggle();
  ui.hideStart();
  launchWithModifier(() => {
    game.paused = false;
    startTick();
    audio.startAmbient();
    audio.playDescend();
    ui.log('The rift yawns open... descend!', 'log-success');
  });
});

// Restart
document.getElementById('restart-btn')!.addEventListener('click', restartRun);

// On-screen pause / settings button
document.getElementById('pause-btn')?.addEventListener('click', togglePauseMenu);

// Keyboard: M = mute, Esc/P = pause menu
window.addEventListener('keydown', (e) => {
  if (e.key === 'm' || e.key === 'M') toggleMute();
  else if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') togglePauseMenu();
});

// Initial high score / history display
ui.updateBestScore(getHighXp());
const initialHistory = loadHistory();
if (initialHistory.length > 0) {
  (document.getElementById('run-history') as HTMLElement).innerHTML =
    initialHistory.map((r, i) =>
      `<div class="history-row${i === 0 ? ' history-latest' : ''}">
        <span>${r.date}</span><span>Fl.${r.floor}</span>
        <span>${r.totalXpEarned.toLocaleString()}</span><span>Lv.${r.playerLevel}</span>
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
