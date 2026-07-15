import './style.css';
import './components';
import { Game, GameMath } from './game';
import { Renderer } from './renderer';
import { UIManager } from './ui';
import { InputBinder } from './input';
import { StorageService } from './storage';
import { CrashReporter } from './errorReporting';
import { audio } from './audio';
import { HapticsController } from './haptics';
import type { AudioEvent, BoonDef, BrandDef, ClassDef, FloorEventDef } from './types';

const DRAWER_EDGE_ZONE       = 24; // px from the right screen edge that starts an "open" gesture
const DRAWER_SWIPE_THRESHOLD = 50; // px of horizontal movement to count as a swipe

type BeforeInstallPromptEvent = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

/**
 * The application composition root: owns the single `Game`/`Renderer`/
 * `UIManager` instance for the whole page lifetime, the tick timer, every
 * settings/pause/drawer/character-sheet UI state flag, and every top-level
 * DOM event listener. Constructed once at module load; there is exactly one
 * `GameApp` per page.
 */
class GameApp {
  private readonly ui: UIManager;
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: Renderer;
  private game!: Game;
  private tickTimer: ReturnType<typeof setInterval> | null = null;

  private soundOn: boolean;
  private reducedMotion: boolean;
  private manualPaused = false;
  private masterVolume: number;

  private readonly fullscreenBtn: HTMLButtonElement | null;
  private readonly fullscreenTarget: HTMLElement;

  private readonly drawerToggleBtn: HTMLButtonElement | null;
  private readonly sidebarPanel: HTMLElement | null;
  private readonly sidebarBackdrop: HTMLElement | null;
  /** True only when the drawer itself paused the game, so closing it doesn't steal control from some other pause source (pause menu, altar, etc.). */
  private drawerPausedGame = false;
  private charSheetPausedGame = false;
  private codexPausedGame = false;
  private edgeSwipeStartX: number | null = null;
  private drawerSwipeStartX: number | null = null;

  private lastInspectTile: { x: number; y: number } | null = null;
  private installPrompt: BeforeInstallPromptEvent | null = null;

  constructor() {
    this.ui = new UIManager();
    this.canvas = document.getElementById('gameCanvas') as HTMLCanvasElement;
    this.renderer = new Renderer(this.canvas);

    // ── Fatal-error recovery ─────────────────────────────────────────────────
    // A single safety net for the tick loop, the render loop, and anything else
    // (input handlers, async work) that throws uncaught — reports once and
    // shows a recovery modal rather than leaving a frozen game with no explanation.
    // The reload button itself is wired inside <crash-modal>.
    window.addEventListener('error', (e) => this.handleFatalError(e.error ?? e.message, 'window'));
    window.addEventListener('unhandledrejection', (e) => this.handleFatalError(e.reason, 'promise'));

    // ── Settings ───────────────────────────────────────────────────────────
    this.soundOn = !StorageService.loadMute();
    // No stored preference → follow the OS reduced-motion setting.
    this.reducedMotion = StorageService.loadReducedMotion() ?? (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
    this.renderer.setReducedMotion(this.reducedMotion);
    HapticsController.setEnabled(!this.reducedMotion);
    this.masterVolume = StorageService.loadVolume();
    audio.setVolume(this.masterVolume);

    // ── Fullscreen ─────────────────────────────────────────────────────────
    // Fullscreens the whole document, not just #game-wrapper — every modal
    // (char sheet, codex, pause menu, etc.) lives as a sibling of #game-wrapper
    // in the DOM, and the Fullscreen API only paints the fullscreen element's
    // own subtree, so scoping this any narrower hides those modals entirely.
    this.fullscreenBtn = document.getElementById('fullscreen-btn') as HTMLButtonElement | null;
    this.fullscreenTarget = document.documentElement;
    if (this.fullscreenBtn && document.fullscreenEnabled) {
      this.fullscreenBtn.hidden = false;
      this.fullscreenBtn.addEventListener('click', () => { void this.toggleFullscreen(); });
      document.addEventListener('fullscreenchange', () => this.updateFullscreenButton());
    }

    // Auto-pause when the app is backgrounded (phone: switching apps / locking;
    // desktop: switching tabs) — otherwise gravity keeps ticking while the player
    // can't see or act, which is a death sentence mid-run. openPauseMenu's guards
    // make this a no-op on the start screen, over modals, or when already paused;
    // resume stays a deliberate tap on the pause menu.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.openPauseMenu();
    });

    // ── Sidebar drawer (mobile) ────────────────────────────────────────────
    // On mobile the sidebar becomes a slide-in drawer over the canvas; on desktop
    // and landscape-phone layouts it's always visible and this toggle is hidden.
    this.drawerToggleBtn = document.getElementById('drawer-toggle-btn') as HTMLButtonElement | null;
    this.sidebarPanel = document.getElementById('sidebar-panel');
    this.sidebarBackdrop = document.getElementById('sidebar-backdrop');
    this.drawerToggleBtn?.addEventListener('click', () => { this.isDrawerOpen() ? this.closeDrawer() : this.openDrawer(); });
    this.sidebarBackdrop?.addEventListener('click', () => this.closeDrawer());

    // ── Character sheet ────────────────────────────────────────────────────
    // Read-only stat totals overlay — pauses like the drawer so reading it is free.
    // The close button itself is wired inside <char-sheet-modal>.
    document.getElementById('char-sheet-btn')?.addEventListener('click', () => this.openCharacterSheet());

    // ── Lore codex ──────────────────────────────────────────────────────────
    // Read-only, cross-run discovery log — pauses like the character sheet.
    // The close button itself is wired inside <codex-modal>.
    document.getElementById('codex-btn')?.addEventListener('click', () => this.openCodex());

    // ── Drawer swipe gestures (mobile) ─────────────────────────────────────
    // Edge-swipe in from the right screen edge opens the drawer; swiping right
    // on the open drawer closes it — the standard mobile drawer idiom.
    document.addEventListener('touchstart', (e) => {
      this.edgeSwipeStartX = null;
      if (!this.isDrawerUIActive() || this.isDrawerOpen()) return;
      if ((e.target as Element)?.closest('[data-action]')) return; // don't hijack D-pad presses
      const t = e.touches[0];
      if (t && t.clientX > window.innerWidth - DRAWER_EDGE_ZONE) this.edgeSwipeStartX = t.clientX;
    }, { passive: true });

    document.addEventListener('touchend', (e) => {
      if (this.edgeSwipeStartX === null) return;
      const t = e.changedTouches[0];
      if (t && this.edgeSwipeStartX - t.clientX > DRAWER_SWIPE_THRESHOLD) this.openDrawer();
      this.edgeSwipeStartX = null;
    }, { passive: true });

    this.sidebarPanel?.addEventListener('touchstart', (e) => {
      const t = e.touches[0];
      this.drawerSwipeStartX = t ? t.clientX : null;
    }, { passive: true });

    this.sidebarPanel?.addEventListener('touchend', (e) => {
      if (this.drawerSwipeStartX === null) return;
      const t = e.changedTouches[0];
      if (t && t.clientX - this.drawerSwipeStartX > DRAWER_SWIPE_THRESHOLD) this.closeDrawer();
      this.drawerSwipeStartX = null;
    }, { passive: true });

    // ── Boot sequence ──────────────────────────────────────────────────────
    this.startGame(true); // initialise paused — start screen sits on top
    InputBinder.bindKeyboard(() => this.game);
    InputBinder.bindButtons(() => this.game);
    InputBinder.bindGamepad(() => this.game);

    InputBinder.bindCanvasInspect(this.canvas, () => this.game, (gx, gy, clientX, clientY) => {
      if (this.lastInspectTile && this.lastInspectTile.x === gx && this.lastInspectTile.y === gy && this.ui.isInspectTooltipVisible()) {
        this.ui.hideInspectTooltip();
        this.lastInspectTile = null;
        return;
      }
      const info = this.game.getInspectInfo(gx, gy);
      if (info) {
        this.ui.showInspectTooltip(info, clientX, clientY);
        this.lastInspectTile = { x: gx, y: gy };
      } else {
        this.ui.hideInspectTooltip();
        this.lastInspectTile = null;
      }
    });

    // The Begin Descent button itself is wired inside <start-modal>.
    this.ui.showStart(StorageService.getHighXp(), () => {
      audio.init(); // unlock AudioContext on first user gesture
      if (StorageService.loadMute()) audio.toggle();
      this.launchWithModifier(() => {
        this.game.paused = false;
        this.startTick();
        audio.startAmbient();
        audio.playDescend();
        this.ui.log('The rift yawns open... descend!', 'log-success');
      });
    });

    document.getElementById('pause-btn')?.addEventListener('click', () => this.togglePauseMenu());

    // Keyboard: M = mute, Esc/P = pause menu
    window.addEventListener('keydown', (e) => {
      if (e.key === 'm' || e.key === 'M') this.toggleMute();
      else if (e.key === 'Escape' && this.ui.isCharacterSheetOpen()) this.closeCharacterSheet();
      else if (e.key === 'Escape' && this.ui.isCodexOpen()) this.closeCodex();
      else if (e.key === 'Escape' && this.isDrawerOpen()) this.closeDrawer();
      else if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') this.togglePauseMenu();
    });

    // Initial high score / history display
    this.ui.updateBestScore(StorageService.getHighXp());
    const initialHistory = StorageService.loadHistory();
    if (initialHistory.length > 0) {
      (document.getElementById('run-history') as HTMLElement).innerHTML =
        initialHistory.map((r, i) =>
          `<div class="history-row${i === 0 ? ' history-latest' : ''}">
            <span>${r.date}</span><span>Fl.${r.floor}</span>
            <span>${r.totalXpEarned.toLocaleString()}</span><span>Lv.${r.playerLevel}</span>
           </div>`,
        ).join('');
    }

    this.bindInstallPrompt();
  }

  // ── Fatal-error recovery ────────────────────────────────────────────────

  private handleFatalError(err: unknown, context: string): void {
    const info = CrashReporter.formatCrashInfo(err, context);
    console.error(`[Fatal:${info.context}]`, err);
    if (!CrashReporter.shouldReport()) return;  // already showing the crash modal for an earlier error
    this.stopTick();
    this.game.active = false;  // the renderer's RAF loop checks this and stops itself
    this.ui.showCrash(info.message);
  }

  // ── Tick management ─────────────────────────────────────────────────────

  private getTickMs(): number {
    return GameMath.tickMsForLevel(
      this.game.dungeonLevel,
      this.game.player.tickSlowPercent + this.game.biomeGravityPct + (this.game.timeDilationTurns > 0 ? this.game.timeDilationSlowPct : 0),
    );
  }

  private startTick(): void {
    this.stopTick();
    this.tickTimer = setInterval(() => {
      if (!this.game.paused && this.game.player.hp > 0) {
        try { this.game.autoTick(); } catch (err) { this.handleFatalError(err, 'tick'); }
      } else if (this.game.player.hp <= 0) this.stopTick();
    }, this.getTickMs());
  }

  private stopTick(): void {
    if (this.tickTimer !== null) { clearInterval(this.tickTimer); this.tickTimer = null; }
  }

  private resetTick(): void { this.startTick(); }

  // ── Settings & pause ─────────────────────────────────────────────────────

  /** Cycles 100% → 75% → 50% → 25% → back to 100%. */
  private cycleVolume(): void {
    this.masterVolume = this.masterVolume > 0.75 ? 0.75 : this.masterVolume > 0.5 ? 0.5 : this.masterVolume > 0.25 ? 0.25 : 1;
    audio.setVolume(this.masterVolume);
    StorageService.saveVolume(this.masterVolume);
    audio.playBlockRotate();  // instant audible feedback at the new level
    if (this.manualPaused) this.refreshPauseMenu();
  }

  private toggleMute(): void {
    this.soundOn = audio.toggle();
    StorageService.saveMute(!this.soundOn);
    this.ui.log(`Sound ${this.soundOn ? 'on' : 'off'}`, 'log-neutral');
    if (this.manualPaused) this.refreshPauseMenu();
  }

  private toggleReducedMotion(): void {
    this.reducedMotion = !this.reducedMotion;
    this.renderer.setReducedMotion(this.reducedMotion);
    HapticsController.setEnabled(!this.reducedMotion);
    StorageService.saveReducedMotion(this.reducedMotion);
    this.ui.log(`Reduced motion ${this.reducedMotion ? 'on' : 'off'}`, 'log-neutral');
    if (this.manualPaused) this.refreshPauseMenu();
  }

  private refreshPauseMenu(): void {
    this.ui.showPauseMenu({ soundOn: this.soundOn, reducedMotion: this.reducedMotion, volumePct: Math.round(this.masterVolume * 100) }, {
      onResume:       () => this.closePauseMenu(),
      onToggleMute:   () => this.toggleMute(),
      onToggleMotion: () => this.toggleReducedMotion(),
      onCycleVolume:  () => this.cycleVolume(),
      onRestart:      () => this.restartRun(),
    });
  }

  private openPauseMenu(): void {
    // Only from active play — never over a boon/altar/cinematic pause or a dead hero.
    if (this.manualPaused || this.game.paused || this.game.player.hp <= 0) return;
    this.manualPaused = true;
    this.game.paused = true;
    this.stopTick();
    this.refreshPauseMenu();
  }

  private closePauseMenu(): void {
    if (!this.manualPaused) return;
    this.manualPaused = false;
    this.ui.hidePauseMenu();
    if (this.game.player.hp > 0) { this.game.paused = false; this.startTick(); }
  }

  private togglePauseMenu(): void {
    if (this.manualPaused) this.closePauseMenu();
    else this.openPauseMenu();
  }

  private restartRun(): void {
    this.manualPaused = false;
    this.ui.hidePauseMenu();
    this.ui.hideDeath();
    this.ui.clearLog();
    this.startGame(true);
    this.launchWithModifier(() => {
      this.game.paused = false;
      this.startTick();
      audio.startAmbient();
      this.ui.log('--- Fresh Rift Opened! Good Luck ---', 'log-success');
    });
  }

  // ── Fullscreen ───────────────────────────────────────────────────────────

  private isFullscreenActive(): boolean {
    return document.fullscreenElement != null;
  }

  private updateFullscreenButton(): void {
    if (!this.fullscreenBtn) return;
    const active = this.isFullscreenActive();
    this.fullscreenBtn.classList.toggle('is-active', active);
    this.fullscreenBtn.setAttribute('aria-label', active ? 'Exit fullscreen' : 'Enter fullscreen');
    this.fullscreenBtn.title = active ? 'Exit fullscreen' : 'Enter fullscreen';
  }

  private async toggleFullscreen(): Promise<void> {
    try {
      if (this.isFullscreenActive()) await document.exitFullscreen();
      else await this.fullscreenTarget.requestFullscreen();
    } catch {
      // Denied (no user gesture, unsupported context, etc.) — fail silently.
    }
  }

  // ── Sidebar drawer (mobile) ─────────────────────────────────────────────

  private isDrawerOpen(): boolean {
    return this.sidebarPanel?.classList.contains('drawer-open') ?? false;
  }

  // The toggle button (and the whole drawer treatment) only exists in the
  // mobile CSS — hidden via display:none on desktop/landscape.
  private isDrawerUIActive(): boolean {
    return !!this.drawerToggleBtn && this.drawerToggleBtn.offsetParent !== null;
  }

  private openDrawer(): void {
    this.sidebarPanel?.classList.add('drawer-open');
    this.sidebarBackdrop?.classList.add('visible');
    if (this.drawerToggleBtn) { this.drawerToggleBtn.textContent = '✕'; this.drawerToggleBtn.setAttribute('aria-label', 'Close menu'); }
    // Reading the sidebar shouldn't cost the player HP — pause the run while
    // it's open, unless something else already owns the pause state.
    if (!this.manualPaused && !this.game.paused && this.game.player.hp > 0) {
      this.drawerPausedGame = true;
      this.game.paused = true;
      this.stopTick();
    }
  }

  private closeDrawer(): void {
    this.sidebarPanel?.classList.remove('drawer-open');
    this.sidebarBackdrop?.classList.remove('visible');
    if (this.drawerToggleBtn) { this.drawerToggleBtn.textContent = '☰'; this.drawerToggleBtn.setAttribute('aria-label', 'Open menu'); }
    if (this.drawerPausedGame) {
      this.drawerPausedGame = false;
      if (!this.manualPaused && this.game.player.hp > 0) { this.game.paused = false; this.startTick(); }
    }
  }

  // ── Character sheet ──────────────────────────────────────────────────────

  private openCharacterSheet(): void {
    this.ui.showCharacterSheet(() => this.closeCharacterSheet());
    if (!this.manualPaused && !this.game.paused && this.game.player.hp > 0) {
      this.charSheetPausedGame = true;
      this.game.paused = true;
      this.stopTick();
    }
  }

  private closeCharacterSheet(): void {
    this.ui.hideCharacterSheet();
    if (this.charSheetPausedGame) {
      this.charSheetPausedGame = false;
      if (!this.manualPaused && this.game.player.hp > 0) { this.game.paused = false; this.startTick(); }
    }
  }

  // ── Lore codex ────────────────────────────────────────────────────────────

  private openCodex(): void {
    this.ui.showCodex(() => this.closeCodex());
    if (!this.manualPaused && !this.game.paused && this.game.player.hp > 0) {
      this.codexPausedGame = true;
      this.game.paused = true;
      this.stopTick();
    }
  }

  private closeCodex(): void {
    this.ui.hideCodex();
    if (this.codexPausedGame) {
      this.codexPausedGame = false;
      if (!this.manualPaused && this.game.player.hp > 0) { this.game.paused = false; this.startTick(); }
    }
  }

  // ── Audio event router ───────────────────────────────────────────────────

  private handleAudio(event: AudioEvent, data?: number): void {
    switch (event) {
      case 'blockLand':    audio.playBlockLand();    this.renderer.triggerShake(2, 4); HapticsController.vibrate(5); break;
      case 'blockRotate':  audio.playBlockRotate();      break;
      case 'blockMove':    audio.playBlockMove();        break;
      case 'hit':             audio.playHit();              break;
      case 'playerDamage':    audio.playPlayerDamage(); this.renderer.triggerDamageFlash(); this.renderer.triggerShake(4, 7); HapticsController.vibrate(25); break;
      case 'kill':            audio.playKill();             break;
      case 'lineClear':
        audio.playLineClear(data ?? 1);
        this.renderer.triggerShake(data && data >= 4 ? 5 : 3, data && data >= 4 ? 8 : 5);
        HapticsController.vibrate(data && data >= 4 ? 25 : 15);
        break;
      case 'descend':         audio.playDescend();          break;
      case 'poison':          audio.playPoison();           break;
      case 'bossWarn':        audio.playBossWarn();         this.renderer.triggerShake(6, 18); HapticsController.vibrate([40, 60, 40, 60, 50]); break;
      case 'teleport':        audio.playTeleport();         break;
      case 'comboMilestone':  audio.playComboMilestone(data ?? 2); break;
      case 'npcEncounter':    audio.playNpcGreeting();      break;
      case 'ghostEncounter':  audio.playGhost();            HapticsController.vibrate([15, 40, 15]); break;
      case 'bountyFulfilled': audio.playBountyFulfilled();  HapticsController.vibrate([20, 30, 20, 30, 40]); break;
      case 'pactSworn':       audio.playPactSworn();        HapticsController.vibrate([30, 50, 60]); break;
    }
  }

  // ── Game factory ─────────────────────────────────────────────────────────

  private startGame(startPaused = false): void {
    this.stopTick();
    this.game = new Game({
      log:      (text, cls, icon)    => this.ui.log(text, cls, icon),
      updateUI: (state)              => this.ui.updateStats(state),
      onAction: ()                   => this.resetTick(),
      onParticle: (x, y, text, col, fontSize, icon) => this.renderer.spawnParticle(x, y, text, col, fontSize, icon),
      onParticleBurst: (x, y, count, col, icon)     => this.renderer.spawnBurst(x, y, count, col, icon),
      onImpactGlow: (x, y, rgb, frames)             => this.renderer.triggerImpactGlow(x, y, rgb, frames),
      onRowClear: (rows)                            => this.renderer.triggerRowClear(rows),
      onHardDrop: (columns, color)                  => this.renderer.spawnDropTrail(columns, color),
      onMonsterDeath: (x, y, char)                  => { this.renderer.flashDeath(x, y, char); this.renderer.spawnBurst(x, y, 3, '#9aa08a'); },
      onHitStop: (frames)                           => this.renderer.triggerHitStop(frames),
      onRingPulse: (x, y, rgb)                      => this.renderer.triggerRing(x, y, rgb),
      onBeam: (x, rgb)                              => this.renderer.triggerBeam(x, rgb),
      onCodexDiscover: (kind, id)                   => StorageService.recordCodexDiscovery(kind, id),
      onAudio:  (event, data)        => this.handleAudio(event, data),
      onBlockLand: (cells)           => this.renderer.spawnLandingDust(cells),
      onCombo:     (mult)            => this.renderer.showCombo(mult),

      onDeath: (title, reason, floor, totalXpEarned, stats, story) => {
        this.stopTick();
        audio.stopAmbient();
        audio.playDeath();
        const { highXp, history } = StorageService.recordRunEnd(this.game, reason, stats);

        // This fallen character may return as a ghost in a future run.
        StorageService.saveGhostRecord({
          id: String(Date.now()),
          playerLevel: this.game.player.playerLevel,
          floor,
          classId: this.game.activeClassId,
          cause: reason,
          date: new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        });

        // The Try Again button itself is wired inside <game-over-modal>.
        this.ui.showDeath(title, reason, floor, totalXpEarned, highXp, history, () => this.restartRun(), stats, story);
        this.ui.updateBestScore(highXp);
      },

      onVictory: (floor, totalXpEarned, stats, story) => {
        this.stopTick();
        audio.stopAmbient();
        audio.playLevelUp();
        const { highXp, history } = StorageService.recordRunEnd(this.game, 'Defeated Bres the Beautiful', stats);

        this.ui.showVictory(floor, totalXpEarned, highXp, history, () => this.restartRun(), stats, story);
        this.ui.updateBestScore(highXp);
      },

      onGhostLaidToRest: (id) => StorageService.removeGhostRecord(id),

      onLevelUp: (choices: BoonDef[], onChoice) => {
        this.stopTick();
        audio.playLevelUp();
        this.ui.showAltarModal(1, choices, this.game.player.boons, (index) => {
          onChoice(index);
          audio.playPerk();
          this.startTick();
        }, 'LEVEL UP — Choose a Boon');
      },

      onOpenTattooArtist: (choices: BrandDef[], onChoice, reroll) => {
        this.stopTick();
        audio.playShop();
        this.ui.showTattooModal(choices, this.game.player.brands, (i) => {
          onChoice(i);
          this.startTick();
        }, reroll);
      },

      onOpenShop: (stock, gold, buy, close) => {
        this.stopTick();
        audio.playShop();
        this.ui.showShop(stock, gold, buy, () => {
          close();
          this.startTick();
        });
      },

      onBossWarning: (boss, onDone) => {
        audio.playBossWarn();
        this.ui.showBossWarning(boss, () => {
          onDone();
          this.startTick();
        });
      },

      onFloorEvent: (event: FloorEventDef, onChoice) => {
        this.stopTick();
        this.ui.showFloorEvent(event, (index) => {
          onChoice(index);
          audio.playPerk();
          this.startTick();
        });
      },

      onOpenAltar: (tier, choices, onChoice, reroll) => {
        this.stopTick();
        audio.playPerk();
        this.ui.showAltarModal(tier, choices, this.game.player.boons, (index) => {
          onChoice(index);
          this.startTick();
        }, undefined, reroll);
      },
    });

    // Fallen characters from previous runs — the first floor never rolls a
    // ghost (this loads just after the constructor's initial floor setup), but
    // every descent after can.
    this.game.availableGhosts = StorageService.loadGhosts();

    if (startPaused) this.game.paused = true;
    this.renderer.start(this.game, (err) => this.handleFatalError(err, 'render'));
    if (!startPaused) this.startTick();
  }

  // ── Class + Modifier picker then launch ───────────────────────────────────

  private launchWithModifier(onReady: () => void): void {
    const classes: ClassDef[] = this.game.getRandomClasses(3);
    this.ui.showClassSelection(classes, (classId) => {
      this.game.applyClass(classId);
      const mods = this.game.getRandomModifiers(3);
      this.ui.showModifierPick(mods, (modId) => {
        this.game.applyModifier(modId);
        onReady();
      });
    });
  }

  // ── PWA install prompt ─────────────────────────────────────────────────────

  private bindInstallPrompt(): void {
    const installBanner  = document.getElementById('install-banner')!;
    const installBtn     = document.getElementById('install-btn')!;
    const installDismiss = document.getElementById('install-dismiss')!;

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.installPrompt = e as BeforeInstallPromptEvent;
      installBanner.hidden = false;
    });

    installBtn.addEventListener('click', async () => {
      if (!this.installPrompt) return;
      installBanner.hidden = true;
      await this.installPrompt.prompt();
      const { outcome } = await this.installPrompt.userChoice;
      console.log('PWA install prompt outcome:', outcome);
      this.installPrompt = null;
    });

    installDismiss.addEventListener('click', () => { installBanner.hidden = true; });
    window.addEventListener('appinstalled', () => { installBanner.hidden = true; this.installPrompt = null; });
  }
}

new GameApp();
