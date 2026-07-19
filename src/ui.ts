import { SHAPES } from './config';
import { SpriteService, HtmlUtils } from './sprites';
import type { CrashModal } from './components/crash-modal';
import type { PauseModal, PauseMenuState, PauseMenuHandlers } from './components/pause-modal';
import type { BossWarningModal } from './components/boss-warning-modal';
import type { ModifierModal } from './components/modifier-modal';
import type { ClassModal } from './components/class-modal';
import type { FloorEventModal } from './components/floor-event-modal';
import type { OfferModal } from './components/offer-modal';
import type { ShopModal } from './components/shop-modal';
import type { CharSheetModal } from './components/char-sheet-modal';
import type { CodexModal } from './components/codex-modal';
import type { GameOverModal } from './components/game-over-modal';
import type { StartModal } from './components/start-modal';
import type { LogClass, UIState, RunStats, BossDef, ModifierDef, InspectInfo, ClassDef, FloorEventDef, BoonDef, BrandDef, BodyPart, RerollCfg, ShopItem, CharacterSheetSection } from './types';
import type { RunRecord } from './types';

/**
 * Owns the always-visible HUD (stats, log, sidebar chips, inspect tooltip)
 * and is a thin typed delegator to every modal, each its own custom element
 * under `src/components/` (`<crash-modal>`, `<start-modal>`, …) grabbed via
 * `document.querySelector`. `main.ts` is the only caller — it wires `Game`'s
 * callbacks to these methods and drives modal show/hide around user actions.
 */
export class UIManager {
  private readonly logPanel: HTMLElement;
  private readonly modal: GameOverModal;
  private readonly startModal: StartModal;
  private readonly modifierModal: ModifierModal;
  private readonly bossWarningModal: BossWarningModal;
  private readonly classModal: ClassModal;
  private readonly floorEventModal: FloorEventModal;
  private readonly inspectTooltip: HTMLElement;
  private readonly toastBanner: HTMLElement;
  private toastDismissTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly offerModal: OfferModal;
  private readonly shopModal: ShopModal;
  private readonly crashModal: CrashModal;
  private readonly pauseModal: PauseModal;
  private readonly charSheetModal: CharSheetModal;
  private readonly codexModal: CodexModal;
  private readonly els: Record<string, HTMLElement>;
  private lastXpEarned = -1;
  private lastCharacterSheet: CharacterSheetSection[] = [];
  private inspectDismissTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly fullLog: { text: string; cls: LogClass; icon?: string }[] = [];

  constructor() {
    this.logPanel          = document.getElementById('log-panel')!;
    this.modal             = document.querySelector('game-over-modal')!;
    this.startModal        = document.querySelector('start-modal')!;
    this.modifierModal     = document.querySelector('modifier-modal')!;
    this.bossWarningModal  = document.querySelector('boss-warning-modal')!;
    this.classModal        = document.querySelector('class-modal')!;
    this.floorEventModal   = document.querySelector('floor-event-modal')!;
    this.inspectTooltip    = document.getElementById('inspect-tooltip')!;
    this.toastBanner       = document.getElementById('toast-banner')!;
    this.offerModal        = document.querySelector('offer-modal')!;
    this.shopModal         = document.querySelector('shop-modal')!;
    this.crashModal        = document.querySelector('crash-modal')!;
    this.pauseModal        = document.querySelector('pause-modal')!;
    this.charSheetModal    = document.querySelector('char-sheet-modal')!;
    this.codexModal        = document.querySelector('codex-modal')!;
    this.els = {
      floor:            document.getElementById('stat-floor')!,
      xpTotal:          document.getElementById('stat-xp-total')!,
      hp:               document.getElementById('stat-hp')!,
      rate:             document.getElementById('stat-rate')!,
      hpBar:            document.getElementById('hp-bar')!,
      nextPreview:      document.getElementById('next-preview-box')!,
      hudHp:            document.getElementById('hud-hp-text')!,
      hudHpBar:         document.getElementById('hud-hp-bar')!,
      hudFloor:         document.getElementById('hud-floor-num')!,
      hudGold:          document.getElementById('hud-gold-num')!,
      hudNextPreview:   document.getElementById('hud-next-preview')!,
      hudFloorProgress: document.getElementById('hud-floor-progress')!,
      statFloorProgress: document.getElementById('stat-floor-progress')!,
      omenBadge:        document.getElementById('omen-badge')!,
      gold:             document.getElementById('stat-gold')!,
      bestScore:        document.getElementById('best-score')!,
      xpBar:            document.getElementById('xp-bar')!,
      xpLabel:          document.getElementById('xp-label')!,
      playerLevel:      document.getElementById('player-level')!,
      boonPanel:        document.getElementById('boon-panel')!,
      brandPanel:       document.getElementById('brand-panel')!,
      brandCount:       document.getElementById('brand-count')!,
      statusRow:        document.getElementById('status-row')!,
      activeModifier:   document.getElementById('active-modifier-badge')!,
      activeClass:      document.getElementById('active-class-badge')!,
      biomeName:        document.getElementById('biome-badge')!,
      rangedAbility:    document.getElementById('ranged-ability-badge')!,
      heldPreview:      document.getElementById('held-preview-box')!,
      pieceStateBadge:  document.getElementById('piece-state-badge')!,
    };
  }

  /** Appends one line to the scrolling log panel (and the full-run log kept for the death-screen recap). */
  public log(text: string, cls: LogClass = 'log-neutral', icon?: string): void {
    const div = document.createElement('div');
    div.className = `log-entry ${cls}`;
    div.innerHTML = icon ? `${SpriteService.iconHTML(icon, 13, 'sprite-icon log-icon')}${HtmlUtils.escapeHtml(text)}` : HtmlUtils.escapeHtml(text);
    this.logPanel.appendChild(div);
    this.logPanel.scrollTop = this.logPanel.scrollHeight;
    if (this.logPanel.children.length > 50) this.logPanel.firstChild?.remove();
    this.fullLog.push({ text, cls, icon });
  }

  // Static HTML can't embed sprite icons (sheets load async), so icon slots
  // are <span class="spr" data-sprite="..."> hydrated here once the sheet is
  // ready — retried each update until SpriteService.iconHTML returns real markup.
  private hydrateSpriteSlots(): void {
    document.querySelectorAll<HTMLElement>('.spr[data-sprite]:not([data-hydrated])').forEach(el => {
      const html = SpriteService.iconHTML(el.dataset['sprite']!, Number(el.dataset['size'] ?? 12));
      if (html) { el.innerHTML = html; el.dataset['hydrated'] = '1'; }
    });
  }

  /** Pushes a fresh `UIState` snapshot into every HUD/sidebar element. Called once per game tick/action. */
  public updateStats(state: UIState): void {
    this.hydrateSpriteSlots();
    this.els['floor']!.textContent       = String(state.floor);
    this.els['xpTotal']!.textContent     = String(state.totalXpEarned);
    this.els['hp']!.textContent          = `${state.hp}/${state.maxHp}`;
    this.els['gold']!.textContent        = state.gold.toLocaleString();
    // Seconds-per-turn reads as a game fact; raw milliseconds read as debug output.
    this.els['rate']!.textContent        = `${(state.gravityRate / 1000).toFixed(1)}s/turn`;
    const hpBar = this.els['hpBar']!;
    hpBar.style.width = `${Math.max(0, (state.hp / state.maxHp) * 100)}%`;
    const hpPct = state.maxHp > 0 ? state.hp / state.maxHp : 1;
    hpBar.classList.remove('hp-full', 'hp-warning', 'hp-critical');
    hpBar.classList.add(hpPct > 0.6 ? 'hp-full' : hpPct >= 0.3 ? 'hp-warning' : 'hp-critical');
    hpBar.parentElement?.classList.toggle('hp-critical-glow', hpPct < 0.3);

    const glowValue = hpPct > 0.6
      ? '0 0 28px rgba(63,158,147,.15), 0 0 6px rgba(63,158,147,.06)'
      : hpPct >= 0.3
        ? '0 0 28px rgba(201,140,44,.3), 0 0 6px rgba(201,140,44,.14)'
        : '0 0 28px rgba(178,58,58,.5), 0 0 8px rgba(178,58,58,.22)';
    document.documentElement.style.setProperty('--canvas-glow', glowValue);

    // Mobile persistent HUD strip — mirrors HP/floor/next-piece for at-a-glance
    // visibility while the full sidebar lives behind the slide-in drawer.
    this.els['hudHp']!.textContent = `${state.hp}/${state.maxHp}`;
    this.els['hudFloor']!.textContent = String(state.floor);
    // Abbreviate in the narrow HUD strip; the sidebar shows the full figure.
    this.els['hudGold']!.textContent = state.gold >= 10000 ? `${(state.gold / 1000).toFixed(1)}k` : String(state.gold);
    const hudHpBar = this.els['hudHpBar']!;
    hudHpBar.style.width = hpBar.style.width;
    hudHpBar.classList.remove('hp-full', 'hp-warning', 'hp-critical');
    hudHpBar.classList.add(hpPct > 0.6 ? 'hp-full' : hpPct >= 0.3 ? 'hp-warning' : 'hp-critical');

    if (state.totalXpEarned !== this.lastXpEarned) {
      const xpEl = this.els['xpTotal']!;
      xpEl.classList.remove('score-pop');
      void xpEl.offsetWidth;
      xpEl.classList.add('score-pop');
      setTimeout(() => xpEl.classList.remove('score-pop'), 320);
      this.lastXpEarned = state.totalXpEarned;
    }

    this.els['nextPreview']!.innerHTML = SpriteService.shapePreviewHTML(SHAPES[state.nextType]);
    this.els['hudNextPreview']!.innerHTML = SpriteService.shapePreviewHTML(SHAPES[state.nextType], 6);

    // Held piece display
    const heldBox = this.els['heldPreview']!;
    heldBox.innerHTML = state.heldType ? SpriteService.shapePreviewHTML(SHAPES[state.heldType]) : '—';
    heldBox.style.opacity = state.canHold ? '1' : '0.35';

    // Floor-milestone dial — one segment per pending threshold, so the player
    // can see exactly what more Tetris buys on this floor.
    const fp = state.floorProgress;
    const fpSegments: string[] = [];
    const fpSidebar: string[] = [];
    if (fp.smithTarget !== null) {
      fpSegments.push(`<span class="fp-smith">${SpriteService.iconHTML('smith_goibniu', 10)}${Math.min(fp.pieces, fp.smithTarget)}/${fp.smithTarget}</span>`);
      fpSidebar.push(`Smith at ${fp.smithTarget} blocks (${Math.min(fp.pieces, fp.smithTarget)})`);
    }
    if (fp.bossFillTarget !== null) {
      fpSegments.push(`<span class="fp-boss">${SpriteService.iconHTML('ui_warning', 10)}${Math.min(fp.fillPct, fp.bossFillTarget)}/${fp.bossFillTarget}%</span>`);
      fpSidebar.push(`Boss at ${fp.bossFillTarget}% built (${fp.fillPct}%)`);
    }
    if (fp.stairsPity && fp.stairsPity.placed > 0) {
      fpSegments.push(`<span class="fp-stairs">${SpriteService.iconHTML('tile_stairs_up', 10)}${Math.min(fp.stairsPity.placed, fp.stairsPity.target)}/${fp.stairsPity.target}</span>`);
      fpSidebar.push(`Stairs within ${Math.max(0, fp.stairsPity.target - fp.stairsPity.placed)} blocks`);
    }
    const hudFp = this.els['hudFloorProgress']!;
    hudFp.classList.toggle('active', fpSegments.length > 0);
    hudFp.innerHTML = fpSegments.join('');
    this.els['statFloorProgress']!.innerHTML = fpSidebar.join('<br>');

    // Cursed / blessed piece badge
    const psBadge = this.els['pieceStateBadge']!;
    if (state.pieceState === 'cursed') {
      psBadge.style.display = '';
      psBadge.style.color = '#ef5350';
      psBadge.innerHTML = `${SpriteService.iconHTML('status_poison', 12)}CURSED PIECE`;
    } else if (state.pieceState === 'blessed') {
      psBadge.style.display = '';
      psBadge.style.color = '#ffd54f';
      psBadge.innerHTML = `${SpriteService.iconHTML('special_sacred', 12)}BLESSED PIECE`;
    } else {
      psBadge.style.display = 'none';
    }

    this.els['playerLevel']!.textContent = `Lv.${state.playerLevel}`;
    this.els['xpBar']!.style.width       = `${Math.min(100, (state.xp / state.xpToNext) * 100)}%`;
    this.els['xpLabel']!.textContent     = `${state.xp}/${state.xpToNext} XP`;
    this.updateBoons(state.boons);
    this.updateBrands(state.brands);
    this.els['brandCount']!.textContent = `(${state.brandsAcquiredTotal}/${state.brandsMaxLifetime})`;
    this.lastCharacterSheet = state.characterSheet;

    // Status effect tags
    this.els['statusRow']!.innerHTML = state.statuses
      .map(s => `<span class="status-tag status-${s.type}">${SpriteService.iconHTML(s.type === 'poison' ? 'status_poison' : 'status_stun', 12)}${s.type} ${s.duration}</span>`)
      .join('');

    // Active modifier badge
    if (state.activeModifier) {
      this.els['activeModifier']!.style.display = '';
      this.els['activeModifier']!.innerHTML = `${SpriteService.iconHTML(state.activeModifier.emoji, 12)}${HtmlUtils.escapeHtml(state.activeModifier.name)}`;
    } else {
      this.els['activeModifier']!.style.display = 'none';
    }

    // Active class badge
    if (state.activeClass) {
      this.els['activeClass']!.style.display = '';
      this.els['activeClass']!.innerHTML = `${SpriteService.iconHTML(state.activeClass.emoji, 12)}${HtmlUtils.escapeHtml(state.activeClass.name)}`;
    } else {
      this.els['activeClass']!.style.display = 'none';
    }

    // Biome badge (only show when not on the default biome)
    if (state.biomeName && state.biomeName !== 'Stone Halls') {
      this.els['biomeName']!.style.display = '';
      this.els['biomeName']!.textContent = state.biomeName;
    } else {
      this.els['biomeName']!.style.display = 'none';
    }

    // Omen badge — this floor's active modifier, if any
    if (state.activeOmen) {
      this.els['omenBadge']!.style.display = '';
      this.els['omenBadge']!.innerHTML = `${SpriteService.iconHTML(state.activeOmen.icon, 12)}${HtmlUtils.escapeHtml(state.activeOmen.name)}`;
    } else {
      this.els['omenBadge']!.style.display = 'none';
    }

    // Ranged ability badge + button state
    const rangedBtn = document.getElementById('ranged-btn') as HTMLButtonElement | null;
    const cycleBtn  = document.getElementById('spell-cycle-btn') as HTMLButtonElement | null;
    if (state.rangedAbility) {
      const ra = state.rangedAbility;
      const ready = ra.cooldown === 0 && ra.ammo !== 0;
      const ammoText  = ra.ammo !== null ? ` ×${ra.ammo}` : '';
      const costText  = ra.hpCostPct !== null ? ` · ${Math.round(ra.hpCostPct * 100)}% HP` : '';
      const bookText  = ra.spellCount > 1 ? ` (${ra.spellIndex + 1}/${ra.spellCount})` : '';
      const cdText    = ra.cooldown > 0 ? ` [${ra.cooldown}t]` : ' [Ready]';
      const label = `${HtmlUtils.escapeHtml(ra.name)}${bookText}${ammoText}${cdText}${costText}`;
      this.els['rangedAbility']!.style.display = '';
      this.els['rangedAbility']!.style.color = ready ? '#ffd700' : '#888';
      this.els['rangedAbility']!.style.fontSize = '9px';
      const cycleHint = ra.spellCount > 1 ? ' · E switches' : '';
      this.els['rangedAbility']!.innerHTML = `${SpriteService.iconHTML(ra.emoji, 12)}${label}<span class="kbd-hint">  (Q)${cycleHint}</span>`;
      if (rangedBtn) {
        // Short generic label (not the ability name) so the button stays as
        // narrow as the Hold button — full detail lives in the sidebar badge.
        rangedBtn.innerHTML = `${SpriteService.iconHTML(ra.emoji, 12)}Special`;
        rangedBtn.disabled = !ready;
        rangedBtn.style.opacity = ready ? '1' : '0.4';
      }
      if (cycleBtn) cycleBtn.style.display = ra.spellCount > 1 ? '' : 'none';
    } else {
      this.els['rangedAbility']!.style.display = 'none';
      if (rangedBtn) { rangedBtn.disabled = true; rangedBtn.style.opacity = '0.3'; rangedBtn.textContent = 'Special'; }
      if (cycleBtn) cycleBtn.style.display = 'none';
    }
  }

  /** Shows the death screen with the run's final stats and history. */
  public showDeath(title: string, reason: string, floor: number, totalXpEarned: number, highXp: number, history: RunRecord[], onRestart: () => void, stats?: RunStats, story?: string): void {
    this.modal.showDeath(title, reason, floor, totalXpEarned, highXp, history, this.fullLog, onRestart, stats, story);
  }

  /** Shows the victory screen (Bres defeated) with the run's final stats and history. */
  public showVictory(floor: number, totalXpEarned: number, highXp: number, history: RunRecord[], onRestart: () => void, stats?: RunStats, story?: string): void {
    this.modal.showVictory(floor, totalXpEarned, highXp, history, this.fullLog, onRestart, stats, story);
  }

  /** Hides the death/victory modal. */
  public hideDeath(): void { this.modal.hide(); }

  /** Shows the fatal-error recovery modal with the crash message. */
  public showCrash(message: string): void {
    this.crashModal.showCrash(message);
  }

  /** Shows the run-start modifier (Rift Curse) picker. */
  public showModifierPick(mods: ModifierDef[], onSelect: (id: string) => void): void {
    this.modifierModal.showModifierPick(mods, onSelect);
  }

  /** Shows the run-start class picker. */
  public showClassSelection(classes: ClassDef[], onSelect: (id: string) => void): void {
    this.classModal.showClassSelection(classes, onSelect);
  }

  /** Shows a narrative floor-event modal (shrine, spring, NPC encounter, pact ceremony, etc.). */
  public showFloorEvent(event: FloorEventDef, onChoice: (index: number) => void): void {
    this.floorEventModal.showFloorEvent(event, onChoice);
  }

  /** Shows the boss-warning cinematic banner for ~1.8s, then calls `onDone`. */
  public showBossWarning(boss: BossDef, onDone: () => void): void {
    this.bossWarningModal.showBossWarning(boss, onDone);
  }

  /** Updates the displayed best-score figure. */
  public updateBestScore(score: number): void {
    this.els['bestScore']!.textContent = String(score);
  }

  // Make a sidebar chip tap/click to show its details in the shared inspect
  // tooltip (works on touch, unlike the native `title` hover).
  private bindChipInspect(chip: HTMLElement, buildInfo: () => InspectInfo): void {
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      const rect = chip.getBoundingClientRect();
      this.showInspectTooltip(buildInfo(), rect.left + rect.width / 2, rect.bottom);
    });
  }

  /** Rebuilds the boon (Geis) chip row in the sidebar. */
  public updateBoons(boons: UIState['boons']): void {
    const panel = this.els['boonPanel']!;
    panel.innerHTML = '';
    if (boons.length === 0) { panel.textContent = '—'; return; }
    for (const b of boons) {
      const chip = document.createElement('span');
      chip.className = 'boon-chip';
      chip.innerHTML = `${SpriteService.iconHTML(b.char, 14)}×${b.stacks}`;
      chip.title = `${b.name} ×${b.stacks}`;
      this.bindChipInspect(chip, () => ({
        icon: b.char,
        title: `${b.name} ×${b.stacks}`,
        lines: [b.desc],
      }));
      panel.appendChild(chip);
    }
  }

  /** Rebuilds the brand (Ogham Mark) chip row in the sidebar, grouped by brand with a set-completion indicator. */
  public updateBrands(brands: UIState['brands']): void {
    const panel = this.els['brandPanel']!;
    panel.innerHTML = '';
    if (brands.length === 0) { panel.textContent = '—'; return; }
    // Group by brand name; collect the slots each occupies for the tooltip.
    const grouped = new Map<string, {
      char: string; name: string; count: number; setActive: boolean;
      desc: string; setDesc: string; setSize: number; slots: string[];
    }>();
    for (const b of brands) {
      const slotLabel = b.slot.replace('_', ' ');
      const existing = grouped.get(b.name);
      if (existing) { existing.count++; existing.setActive = b.setActive; existing.slots.push(slotLabel); }
      else grouped.set(b.name, {
        char: b.char, name: b.name, count: 1, setActive: b.setActive,
        desc: b.desc, setDesc: b.setDesc, setSize: b.setSize, slots: [slotLabel],
      });
    }
    for (const b of grouped.values()) {
      const chip = document.createElement('span');
      chip.className = 'brand-chip' + (b.setActive ? ' brand-set-active' : '');
      chip.innerHTML = `${SpriteService.iconHTML(b.char, 14)}×${b.count}`;
      chip.title = `${b.name}${b.setActive ? ' ✓ SET ACTIVE' : ''}`;
      this.bindChipInspect(chip, () => ({
        icon: b.char,
        title: b.name,
        lines: [
          b.desc,
          `Set ${Math.min(b.count, b.setSize)}/${b.setSize}: ${b.setDesc}`,
          b.setActive ? '✓ Set bonus active' : `${b.setSize - b.count} more to complete the set`,
          `Worn on: ${b.slots.join(', ')}`,
        ],
      }));
      panel.appendChild(chip);
    }
  }

  /** Shows the full character-sheet modal, from the most recent `updateStats` snapshot. */
  public showCharacterSheet(onClose: () => void): void {
    this.charSheetModal.showCharacterSheet(this.lastCharacterSheet, onClose);
  }

  /** Hides the character-sheet modal. */
  public hideCharacterSheet(): void {
    this.charSheetModal.hide();
  }

  /** Shows the lore codex: every boss/NPC/biome/patron discovered across all past runs, from `StorageService`'s persisted record. */
  public showCodex(onClose: () => void): void {
    this.codexModal.showCodex(onClose);
  }

  /** Hides the lore codex modal. */
  public hideCodex(): void {
    this.codexModal.hide();
  }

  /** Whether the lore codex modal is currently open. */
  public isCodexOpen(): boolean {
    return this.codexModal.isOpen;
  }

  /** Whether the character-sheet modal is currently open. */
  public isCharacterSheetOpen(): boolean {
    return this.charSheetModal.isOpen;
  }

  /** Shows the wandering peddler's shop modal. */
  public showShop(
    stock: ShopItem[], gold: number, buy: (id: string) => { gold: number; ok: boolean }, onClose: () => void,
    titleOverride?: string, subtitleOverride?: string,
  ): void {
    this.shopModal.showShop(stock, gold, buy, onClose, titleOverride, subtitleOverride);
  }

  /** Shows the tattoo-artist brand-choice modal, with an optional gold reroll. */
  public showTattooModal(
    choices: BrandDef[],
    ownedBrands: Array<{ slot: BodyPart; brand: BrandDef }>,
    onChoice: (i: number) => void,
    reroll?: RerollCfg<BrandDef>,
  ): void {
    this.offerModal.showTattooModal(choices, ownedBrands, onChoice, reroll);
  }

  /** Shows the altar boon-choice modal for the given reward tier, with an optional gold reroll. */
  public showAltarModal(
    tier: 1 | 2 | 3,
    choices: BoonDef[],
    ownedBoons: Array<{ id: string; stacks: number; def: BoonDef }>,
    onChoice: (index: number) => void,
    titleOverride?: string,
    reroll?: RerollCfg<BoonDef>,
  ): void {
    this.offerModal.showAltarModal(tier, choices, ownedBoons, onChoice, titleOverride, reroll);
  }

  /** Shows the start-screen modal (with a Continue card when a resumable mid-run save exists). */
  public showStart(
    highScore: number,
    onBegin: () => void,
    onBeginTutorial?: () => void,
    resume?: { floor: number; classLabel: string; onResume: () => void },
  ): void {
    this.startModal.showStart(highScore, onBegin, onBeginTutorial, resume);
  }

  /** Hides the start-screen modal. */
  public hideStart(): void {
    this.startModal.hide();
  }

  /** Shows the pause menu with the current sound/motion/volume state and button handlers. */
  public showPauseMenu(state: PauseMenuState, handlers: PauseMenuHandlers): void {
    this.pauseModal.showPauseMenu(state, handlers);
  }

  /** Hides the pause menu. */
  public hidePauseMenu(): void {
    this.pauseModal.hidePauseMenu();
  }

  /** Shows the tap/click-to-inspect tooltip near `(clientX, clientY)`, clamped to stay on-screen. Auto-dismisses after 3s. */
  public showInspectTooltip(info: InspectInfo, clientX: number, clientY: number): void {
    const el = this.inspectTooltip;
    el.innerHTML = `
      <div class="inspect-header"><span class="inspect-icon">${SpriteService.iconHTML(info.icon, 20)}</span><span class="inspect-title">${info.title}</span></div>
      <div class="inspect-lines">${info.lines.map(l => `<div>${l}</div>`).join('')}</div>
    `;
    el.hidden = false;
    el.classList.remove('inspect-show');
    void el.offsetWidth;
    el.classList.add('inspect-show');

    const margin = 8;
    const rect = el.getBoundingClientRect();
    let left = clientX + 12;
    let top = clientY + 12;
    if (left + rect.width + margin > window.innerWidth) left = clientX - rect.width - 12;
    if (top + rect.height + margin > window.innerHeight) top = clientY - rect.height - 12;
    left = Math.max(margin, Math.min(left, window.innerWidth - rect.width - margin));
    top = Math.max(margin, Math.min(top, window.innerHeight - rect.height - margin));
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;

    if (this.inspectDismissTimer) clearTimeout(this.inspectDismissTimer);
    this.inspectDismissTimer = setTimeout(() => this.hideInspectTooltip(), 3000);
  }

  /** Hides the inspect tooltip. */
  public hideInspectTooltip(): void {
    this.inspectTooltip.hidden = true;
    this.inspectTooltip.classList.remove('inspect-show');
    if (this.inspectDismissTimer) { clearTimeout(this.inspectDismissTimer); this.inspectDismissTimer = null; }
  }

  /** Whether the inspect tooltip is currently visible. */
  public isInspectTooltipVisible(): boolean {
    return !this.inspectTooltip.hidden;
  }

  /** Shows a brief auto-dismissing banner over the canvas (e.g. an ambient floor hint). Replaces any toast already showing. */
  public showToast(text: string, icon?: string, durationMs = 9000): void {
    if (this.toastDismissTimer) clearTimeout(this.toastDismissTimer);
    this.toastBanner.innerHTML = icon ? `${SpriteService.iconHTML(icon, 13, 'sprite-icon')}${HtmlUtils.escapeHtml(text)}` : HtmlUtils.escapeHtml(text);
    this.toastBanner.classList.add('visible');
    this.toastDismissTimer = setTimeout(() => {
      this.toastBanner.classList.remove('visible');
      this.toastDismissTimer = null;
    }, durationMs);
  }

  /** Logs an error to the console and the in-game log panel. */
  public showError(message: string): void {
    console.error('[CausewayToEriu]', message);
    this.log(message, 'log-damage', 'ui_warning');
  }

  /** Clears the log panel and the full-run log. */
  public clearLog(): void { this.logPanel.innerHTML = ''; this.fullLog.length = 0; }
}
