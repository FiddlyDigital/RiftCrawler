import './style.css';
import { Game, tickMsForLevel } from './game';
import { Renderer } from './renderer';
import { UIManager } from './ui';
import { bindKeyboard, bindButtons, bindCanvasInspect, bindGamepad } from './input';
import { getHighXp, recordRunEnd, loadHistory, saveMute, loadMute, saveReducedMotion, loadReducedMotion } from './storage';
import { trackGameStart, trackGameOver, trackInstall, trackError } from './analytics';
import { formatCrashInfo, shouldReport } from './errorReporting';
import { audio } from './audio';
import { vibrate, setHapticsEnabled } from './haptics';
import type { AudioEvent } from './types';

const ui       = new UIManager();
const canvas   = document.getElementById('gameCanvas') as HTMLCanvasElement;
const renderer = new Renderer(canvas);

let game: Game;
let tickTimer: ReturnType<typeof setInterval> | null = null;

// ── Fatal-error recovery ─────────────────────────────────────────────────────
// A single safety net for the tick loop, the render loop, and anything else
// (input handlers, async work) that throws uncaught — reports once and shows
// a recovery modal rather than leaving a frozen game with no explanation.

function handleFatalError(err: unknown, context: string): void {
  const info = formatCrashInfo(err, context);
  console.error(`[Fatal:${info.context}]`, err);
  trackError(info.context, info.message);
  if (!shouldReport()) return;  // already showing the crash modal for an earlier error
  stopTick();
  game.active = false;  // the renderer's RAF loop checks this and stops itself
  ui.showCrash(info.message);
}

window.addEventListener('error', (e) => handleFatalError(e.error ?? e.message, 'window'));
window.addEventListener('unhandledrejection', (e) => handleFatalError(e.reason, 'promise'));
document.getElementById('crash-reload')?.addEventListener('click', () => location.reload());

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
    if (!game.paused && game.player.hp > 0) {
      try { game.autoTick(); } catch (err) { handleFatalError(err, 'tick'); }
    } else if (game.player.hp <= 0) stopTick();
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
setHapticsEnabled(!reducedMotion);
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
  setHapticsEnabled(!reducedMotion);
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

// Auto-pause when the app is backgrounded (phone: switching apps / locking;
// desktop: switching tabs) — otherwise gravity keeps ticking while the player
// can't see or act, which is a death sentence mid-run. openPauseMenu's guards
// make this a no-op on the start screen, over modals, or when already paused;
// resume stays a deliberate tap on the pause menu.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) openPauseMenu();
});

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

// ── Fullscreen ───────────────────────────────────────────────────────────────

const fullscreenBtn = document.getElementById('fullscreen-btn') as HTMLButtonElement | null;
const fullscreenTarget = document.getElementById('game-wrapper') ?? document.documentElement;

function isFullscreenActive(): boolean {
  return document.fullscreenElement != null;
}

function updateFullscreenButton(): void {
  if (!fullscreenBtn) return;
  const active = isFullscreenActive();
  fullscreenBtn.classList.toggle('is-active', active);
  fullscreenBtn.setAttribute('aria-label', active ? 'Exit fullscreen' : 'Enter fullscreen');
  fullscreenBtn.title = active ? 'Exit fullscreen' : 'Enter fullscreen';
}

async function toggleFullscreen(): Promise<void> {
  try {
    if (isFullscreenActive()) await document.exitFullscreen();
    else await fullscreenTarget.requestFullscreen();
  } catch {
    // Denied (no user gesture, unsupported context, etc.) — fail silently.
  }
}

if (fullscreenBtn && document.fullscreenEnabled) {
  fullscreenBtn.hidden = false;
  fullscreenBtn.addEventListener('click', () => { void toggleFullscreen(); });
  document.addEventListener('fullscreenchange', updateFullscreenButton);
}

// ── Sidebar drawer (mobile) ─────────────────────────────────────────────────
// On mobile the sidebar becomes a slide-in drawer over the canvas; on desktop
// and landscape-phone layouts it's always visible and this toggle is hidden.

const drawerToggleBtn = document.getElementById('drawer-toggle-btn') as HTMLButtonElement | null;
const sidebarPanel     = document.getElementById('sidebar-panel');
const sidebarBackdrop  = document.getElementById('sidebar-backdrop');

// True only when the drawer itself paused the game, so closing it doesn't
// steal control from some other pause source (pause menu, altar, etc.).
let drawerPausedGame = false;

function isDrawerOpen(): boolean {
  return sidebarPanel?.classList.contains('drawer-open') ?? false;
}

// The toggle button (and the whole drawer treatment) only exists in the
// mobile CSS — hidden via display:none on desktop/landscape.
function isDrawerUIActive(): boolean {
  return !!drawerToggleBtn && drawerToggleBtn.offsetParent !== null;
}

function openDrawer(): void {
  sidebarPanel?.classList.add('drawer-open');
  sidebarBackdrop?.classList.add('visible');
  if (drawerToggleBtn) { drawerToggleBtn.textContent = '✕'; drawerToggleBtn.setAttribute('aria-label', 'Close menu'); }
  // Reading the sidebar shouldn't cost the player HP — pause the run while
  // it's open, unless something else already owns the pause state.
  if (!manualPaused && !game.paused && game.player.hp > 0) {
    drawerPausedGame = true;
    game.paused = true;
    stopTick();
  }
}

function closeDrawer(): void {
  sidebarPanel?.classList.remove('drawer-open');
  sidebarBackdrop?.classList.remove('visible');
  if (drawerToggleBtn) { drawerToggleBtn.textContent = '☰'; drawerToggleBtn.setAttribute('aria-label', 'Open menu'); }
  if (drawerPausedGame) {
    drawerPausedGame = false;
    if (!manualPaused && game.player.hp > 0) { game.paused = false; startTick(); }
  }
}

drawerToggleBtn?.addEventListener('click', () => { isDrawerOpen() ? closeDrawer() : openDrawer(); });
sidebarBackdrop?.addEventListener('click', closeDrawer);

// ── Drawer swipe gestures (mobile) ───────────────────────────────────────────
// Edge-swipe in from the right screen edge opens the drawer; swiping right
// on the open drawer closes it — the standard mobile drawer idiom.

const DRAWER_EDGE_ZONE       = 24; // px from the right screen edge that starts an "open" gesture
const DRAWER_SWIPE_THRESHOLD = 50; // px of horizontal movement to count as a swipe

let edgeSwipeStartX: number | null = null;

document.addEventListener('touchstart', (e) => {
  edgeSwipeStartX = null;
  if (!isDrawerUIActive() || isDrawerOpen()) return;
  if ((e.target as Element)?.closest('[data-action]')) return; // don't hijack D-pad presses
  const t = e.touches[0];
  if (t && t.clientX > window.innerWidth - DRAWER_EDGE_ZONE) edgeSwipeStartX = t.clientX;
}, { passive: true });

document.addEventListener('touchend', (e) => {
  if (edgeSwipeStartX === null) return;
  const t = e.changedTouches[0];
  if (t && edgeSwipeStartX - t.clientX > DRAWER_SWIPE_THRESHOLD) openDrawer();
  edgeSwipeStartX = null;
}, { passive: true });

let drawerSwipeStartX: number | null = null;

sidebarPanel?.addEventListener('touchstart', (e) => {
  const t = e.touches[0];
  drawerSwipeStartX = t ? t.clientX : null;
}, { passive: true });

sidebarPanel?.addEventListener('touchend', (e) => {
  if (drawerSwipeStartX === null) return;
  const t = e.changedTouches[0];
  if (t && t.clientX - drawerSwipeStartX > DRAWER_SWIPE_THRESHOLD) closeDrawer();
  drawerSwipeStartX = null;
}, { passive: true });

// ── Audio event router ───────────────────────────────────────────────────────

function handleAudio(event: AudioEvent, data?: number): void {
  switch (event) {
    case 'blockLand':    audio.playBlockLand();    renderer.triggerShake(2, 4); vibrate(5); break;
    case 'blockRotate':  audio.playBlockRotate();      break;
    case 'blockMove':    audio.playBlockMove();        break;
    case 'hit':             audio.playHit();              break;
    case 'playerDamage':    audio.playPlayerDamage(); renderer.triggerDamageFlash(); renderer.triggerShake(4, 7); vibrate(25); break;
    case 'kill':            audio.playKill();             break;
    case 'lineClear':
      audio.playLineClear(data ?? 1);
      renderer.triggerShake(data && data >= 4 ? 5 : 3, data && data >= 4 ? 8 : 5);
      vibrate(data && data >= 4 ? 25 : 15);
      break;
    case 'descend':         audio.playDescend();          break;
    case 'poison':          audio.playPoison();           break;
    case 'bossWarn':        audio.playBossWarn();         vibrate([40, 60, 40, 60, 50]); break;
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
    onParticleBurst: (x, y, count, col, icon)     => renderer.spawnBurst(x, y, count, col, icon),
    onImpactGlow: (x, y, rgb, frames)             => renderer.triggerImpactGlow(x, y, rgb, frames),
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
      ui.showAltarModal(1, choices, game.player.boons, (index) => {
        onChoice(index);
        audio.playPerk();
        startTick();
      }, 'LEVEL UP — Choose a Boon');
    },

    onOpenTattooArtist: (choices, onChoice, reroll) => {
      stopTick();
      audio.playShop();
      ui.showTattooModal(choices, game.player.brands, (i) => {
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
      ui.showAltarModal(tier, choices, game.player.boons, (index) => {
        onChoice(index);
        startTick();
      }, undefined, reroll);
    },
  });

  if (startPaused) game.paused = true;
  renderer.start(game, (err) => handleFatalError(err, 'render'));
  if (!startPaused) startTick();
  trackGameStart(1);
}

// ── Class + Modifier picker then launch ──────────────────────────────────────

function launchWithModifier(onReady: () => void): void {
  const classes = game.getRandomClasses(2);
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
  else if (e.key === 'Escape' && isDrawerOpen()) closeDrawer();
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
