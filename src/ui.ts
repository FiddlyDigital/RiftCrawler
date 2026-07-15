import { SHAPES } from './config';
import { SpriteService, HtmlUtils } from './sprites';
import type { LogClass, UIState, RunStats, BossDef, ModifierDef, InspectInfo, ClassDef, FloorEventDef, BoonDef, BrandDef, BodyPart, RerollCfg, ShopItem, CharacterSheetSection } from './types';
import type { RunRecord } from './types';

/**
 * Owns every DOM-facing HUD/modal/tooltip element and renders `Game` state
 * and callbacks into them. `main.ts` is the only caller — it wires `Game`'s
 * callbacks to these methods and drives modal show/hide around user actions.
 */
export class UIManager {
  private readonly logPanel: HTMLElement;
  private readonly modal: HTMLElement;
  private readonly modifierModal: HTMLElement;
  private readonly bossWarningModal: HTMLElement;
  private readonly classModal: HTMLElement;
  private readonly floorEventModal: HTMLElement;
  private readonly inspectTooltip: HTMLElement;
  private readonly altarModal: HTMLElement;
  private readonly crashModal: HTMLElement;
  private readonly charSheetModal: HTMLElement;
  private readonly els: Record<string, HTMLElement>;
  private lastXpEarned = -1;
  private lastCharacterSheet: CharacterSheetSection[] = [];
  private inspectDismissTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly fullLog: { text: string; cls: LogClass; icon?: string }[] = [];

  constructor() {
    this.logPanel          = document.getElementById('log-panel')!;
    this.modal             = document.getElementById('game-over-modal')!;
    this.modifierModal     = document.getElementById('modifier-modal')!;
    this.bossWarningModal  = document.getElementById('boss-warning-modal')!;
    this.classModal        = document.getElementById('class-modal')!;
    this.floorEventModal   = document.getElementById('floor-event-modal')!;
    this.inspectTooltip    = document.getElementById('inspect-tooltip')!;
    this.altarModal        = document.getElementById('altar-modal')!;
    this.crashModal        = document.getElementById('crash-modal')!;
    this.charSheetModal    = document.getElementById('char-sheet-modal')!;
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
      gold:             document.getElementById('stat-gold')!,
      deathTitle:       document.getElementById('death-title')!,
      deathReason:      document.getElementById('death-reason')!,
      finalFloor:       document.getElementById('final-floor')!,
      finalScore:       document.getElementById('final-score')!,
      highScore:        document.getElementById('high-score')!,
      bestScore:        document.getElementById('best-score')!,
      xpBar:            document.getElementById('xp-bar')!,
      xpLabel:          document.getElementById('xp-label')!,
      playerLevel:      document.getElementById('player-level')!,
      boonPanel:        document.getElementById('boon-panel')!,
      brandPanel:       document.getElementById('brand-panel')!,
      brandCount:       document.getElementById('brand-count')!,
      statusRow:        document.getElementById('status-row')!,
      runHistory:       document.getElementById('run-history')!,
      activeModifier:   document.getElementById('active-modifier-badge')!,
      activeClass:      document.getElementById('active-class-badge')!,
      biomeName:        document.getElementById('biome-badge')!,
      rangedAbility:    document.getElementById('ranged-ability-badge')!,
      heldPreview:      document.getElementById('held-preview-box')!,
      pieceStateBadge:  document.getElementById('piece-state-badge')!,
      runStatsGrid:     document.getElementById('run-stats-grid')!,
      runLogFull:       document.getElementById('run-log-full')!,
      shareContainer:   document.getElementById('share-container')!,
      shareText:        document.getElementById('share-text')!,
      charSheetBody:    document.getElementById('char-sheet-body')!,
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
  public showDeath(title: string, reason: string, floor: number, totalXpEarned: number, highXp: number, history: RunRecord[], stats?: RunStats, story?: string): void {
    this.els['deathTitle']!.textContent  = title;
    this.els['deathReason']!.textContent = reason;
    this.modal.querySelector('.modal-card')?.classList.remove('victory');
    this.populateEndModal(floor, totalXpEarned, highXp, history, stats, story);
  }

  /** Shows the victory screen (Bres defeated) with the run's final stats and history. */
  public showVictory(floor: number, totalXpEarned: number, highXp: number, history: RunRecord[], stats?: RunStats, story?: string): void {
    this.els['deathTitle']!.innerHTML   = `${SpriteService.iconHTML('item_trophy', 16)}BRES VANQUISHED`;
    this.els['deathReason']!.textContent = 'You felled Bres the Beautiful and shattered his bridge — the run is won.';
    this.modal.querySelector('.modal-card')?.classList.add('victory');
    this.populateEndModal(floor, totalXpEarned, highXp, history, stats, story);
  }

  /** Shared body for {@link showDeath}/{@link showVictory}: fills in the stats grid, share text, run log, and history table. */
  private populateEndModal(floor: number, totalXpEarned: number, highXp: number, history: RunRecord[], stats?: RunStats, story?: string): void {
    this.els['finalFloor']!.textContent  = String(floor);
    this.els['finalScore']!.textContent  = String(totalXpEarned);
    this.els['highScore']!.textContent   = String(highXp);

    // Short narrative recap of the run's notable moments
    const storyEl = document.getElementById('run-story');
    if (storyEl) {
      storyEl.textContent = story ?? '';
      storyEl.style.display = story ? '' : 'none';
    }

    // Run stats grid
    if (stats) {
      this.els['runStatsGrid']!.innerHTML = `
        <div class="run-stats-grid">
          <div class="stat-cell">${SpriteService.iconHTML('status_poison', 14)}<b>${stats.monstersKilled}</b><br><span>Monsters</span></div>
          <div class="stat-cell">${SpriteService.iconHTML('sprite_boss_boneking', 14)}<b>${stats.bossesKilled}</b><br><span>Bosses</span></div>
          <div class="stat-cell"><span class="brick-icon"></span><b>${stats.linesCleared}</b><br><span>Lines</span></div>
          <div class="stat-cell">${SpriteService.iconHTML('fx_impact', 14)}<b>${stats.biggestCombo > 0 ? `×${stats.biggestCombo + 1}` : '—'}</b><br><span>Best Combo</span></div>
          <div class="stat-cell">${SpriteService.iconHTML('item_heart', 14)}<b>${stats.damageTaken}</b><br><span>Dmg Taken</span></div>
        </div>`;
      const shareStr = `Fl.${floor} · ${stats.monstersKilled} kills · ${stats.linesCleared} lines · Best combo ×${stats.biggestCombo + 1} · ${totalXpEarned.toLocaleString()} XP`;
      (this.els['shareText'] as HTMLTextAreaElement).value = shareStr;
      this.els['shareContainer']!.style.display = '';
      const copyBtn = document.getElementById('copy-share-btn');
      if (copyBtn) {
        copyBtn.onclick = () => {
          navigator.clipboard?.writeText(shareStr).catch(() => {
            (this.els['shareText'] as HTMLTextAreaElement).select();
            document.execCommand('copy');
          });
          copyBtn.textContent = 'Copied!';
          setTimeout(() => { copyBtn.textContent = 'Copy Summary'; }, 1800);
        };
      }
    } else {
      this.els['runStatsGrid']!.innerHTML = '';
      this.els['shareContainer']!.style.display = 'none';
    }

    // Full run log — scrolling box + copy/download
    this.els['runLogFull']!.innerHTML = this.fullLog.map(e =>
      `<div class="log-entry ${e.cls}">${e.icon ? `${SpriteService.iconHTML(e.icon, 13, 'sprite-icon log-icon')}${HtmlUtils.escapeHtml(e.text)}` : HtmlUtils.escapeHtml(e.text)}</div>`
    ).join('') || '<div style="color:#555;font-size:9px">No events recorded.</div>';
    const logText = this.fullLog.map(e => e.text).join('\n');
    const copyLogBtn = document.getElementById('copy-log-btn');
    if (copyLogBtn) {
      copyLogBtn.onclick = () => {
        navigator.clipboard?.writeText(logText).catch(() => {
          const ta = document.createElement('textarea');
          ta.value = logText;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          ta.remove();
        });
        copyLogBtn.textContent = 'Copied!';
        setTimeout(() => { copyLogBtn.textContent = '📋 Copy Log'; }, 1800);
      };
    }
    const downloadLogBtn = document.getElementById('download-log-btn');
    if (downloadLogBtn) {
      downloadLogBtn.onclick = () => {
        const blob = new Blob([logText], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `causeway-to-eriu-run-log-fl${floor}.txt`;
        a.click();
        URL.revokeObjectURL(url);
      };
    }

    // Run history table
    const lines = history.map((r, i) =>
      `<div class="history-row${i === 0 ? ' history-latest' : ''}">
        <span>${r.date}</span><span>Fl.${r.floor}</span>
        <span>${r.totalXpEarned.toLocaleString()}</span><span>Lv.${r.playerLevel}</span>
        <span>${r.cause?.split(' ').slice(0, 2).join(' ') ?? ''}</span>
       </div>`
    ).join('');
    this.els['runHistory']!.innerHTML = lines || '<div style="color:#555;font-size:9px">No runs yet.</div>';

    this.modal.style.display = 'flex';
  }

  /** Hides the death/victory modal. */
  public hideDeath(): void { this.modal.style.display = 'none'; }

  /** Shows the fatal-error recovery modal with the crash message. */
  public showCrash(message: string): void {
    const detail = document.getElementById('crash-detail');
    if (detail) detail.textContent = message;
    this.crashModal.style.display = 'flex';
  }

  /** Shows the run-start modifier (Rift Curse) picker. */
  public showModifierPick(mods: ModifierDef[], onSelect: (id: string) => void): void {
    const container = document.getElementById('modifier-choices')!;
    container.innerHTML = '';
    for (const mod of mods) {
      const btn = document.createElement('button');
      btn.className = 'modifier-btn';
      btn.innerHTML = `<span class="modifier-emoji">${SpriteService.iconHTML(mod.emoji, 24)}</span><div class="modifier-info"><strong>${mod.name}</strong><span>${mod.desc}</span></div>`;
      btn.addEventListener('click', () => {
        this.modifierModal.style.display = 'none';
        onSelect(mod.id);
      });
      container.appendChild(btn);
    }
    this.modifierModal.style.display = 'flex';
  }

  /** Shows the run-start class picker. */
  public showClassSelection(classes: ClassDef[], onSelect: (id: string) => void): void {
    const container = document.getElementById('class-choices')!;
    container.innerHTML = '';
    for (const cls of classes) {
      const btn = document.createElement('button');
      btn.className = 'modifier-btn';
      const chips = cls.statChips.map(c => `<span class="class-chip">${HtmlUtils.escapeHtml(c)}</span>`).join('');
      btn.innerHTML = `<span class="modifier-emoji">${SpriteService.iconHTML(cls.emoji, 24)}</span><div class="modifier-info"><strong>${cls.name}</strong><span>${cls.tagline}</span><span class="class-chip-row">${chips}</span></div>`;
      btn.addEventListener('click', () => {
        this.classModal.style.display = 'none';
        onSelect(cls.id);
      });
      container.appendChild(btn);
    }
    this.classModal.style.display = 'flex';
  }

  /** Shows a narrative floor-event modal (shrine, spring, NPC encounter, pact ceremony, etc.). */
  public showFloorEvent(event: FloorEventDef, onChoice: (index: number) => void): void {
    (document.getElementById('floor-event-emoji') as HTMLElement).innerHTML  = SpriteService.iconHTML(event.emoji, 28);
    (document.getElementById('floor-event-title') as HTMLElement).textContent  = event.title;
    (document.getElementById('floor-event-flavor') as HTMLElement).textContent = event.flavor;
    const container = document.getElementById('floor-event-choices')!;
    container.innerHTML = '';
    event.options.forEach((opt, i) => {
      const btn = document.createElement('button');
      btn.className = 'modifier-btn';
      btn.innerHTML = `<div class="modifier-info"><strong>${opt.label}</strong><span>${opt.desc}</span></div>`;
      btn.addEventListener('click', () => {
        this.floorEventModal.style.display = 'none';
        onChoice(i);
      });
      container.appendChild(btn);
    });
    this.floorEventModal.style.display = 'flex';
  }

  /** Shows the boss-warning cinematic banner for ~1.8s, then calls `onDone`. */
  public showBossWarning(boss: BossDef, onDone: () => void): void {
    (document.getElementById('boss-warning-emoji') as HTMLElement).innerHTML = SpriteService.iconHTML(boss.char, 32);
    (document.getElementById('boss-warning-name')  as HTMLElement).textContent = boss.name.toUpperCase();
    (document.getElementById('boss-warning-flavor') as HTMLElement).textContent = boss.flavorText;
    this.bossWarningModal.style.display = 'flex';
    const bar = document.getElementById('boss-countdown-bar') as HTMLElement | null;
    if (bar) {
      bar.style.transition = 'none';
      bar.style.width = '100%';
      void bar.offsetWidth;
      bar.style.transition = 'width 1700ms linear';
      bar.style.width = '0%';
    }
    setTimeout(() => {
      this.bossWarningModal.style.display = 'none';
      onDone();
    }, 1800);
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
  public showCharacterSheet(): void {
    this.els['charSheetBody']!.innerHTML = this.lastCharacterSheet.map(section => `
      <div class="char-sheet-section">
        <div class="char-sheet-section-title">${SpriteService.iconHTML(section.icon, 13)}${HtmlUtils.escapeHtml(section.title)}</div>
        <div class="char-sheet-rows">
          ${section.stats.map(s => `<div class="char-sheet-row"><span>${HtmlUtils.escapeHtml(s.label)}</span><span>${HtmlUtils.escapeHtml(s.value)}</span></div>`).join('')}
        </div>
      </div>`).join('');
    this.charSheetModal.style.display = 'flex';
  }

  /** Hides the character-sheet modal. */
  public hideCharacterSheet(): void {
    this.charSheetModal.style.display = 'none';
  }

  /** Whether the character-sheet modal is currently open. */
  public isCharacterSheetOpen(): boolean {
    return this.charSheetModal.style.display === 'flex';
  }

  // Owned-summary chips shown above the choices so a player picking a new
  // Geis/Ogham Mark can see what they already have before committing.
  private buildOwnedBoonsHTML(boons: Array<{ id: string; stacks: number; def: BoonDef }>): string {
    if (boons.length === 0) return '';
    return boons.map(b =>
      `<span class="boon-chip" title="${HtmlUtils.escapeHtml(b.def.desc)}">${SpriteService.iconHTML(b.def.char, 14)}${HtmlUtils.escapeHtml(b.def.name)} ×${b.stacks}</span>`,
    ).join('');
  }

  private buildOwnedBrandsHTML(brands: Array<{ slot: BodyPart; brand: BrandDef }>): string {
    if (brands.length === 0) return '';
    const grouped = new Map<string, { char: string; name: string; count: number; setSize: number }>();
    for (const b of brands) {
      const existing = grouped.get(b.brand.id);
      if (existing) existing.count++;
      else grouped.set(b.brand.id, { char: b.brand.char, name: b.brand.name, count: 1, setSize: b.brand.setSize });
    }
    return Array.from(grouped.values()).map(g => {
      const setActive = g.count >= g.setSize;
      return `<span class="brand-chip${setActive ? ' brand-set-active' : ''}" title="${HtmlUtils.escapeHtml(g.name)}${setActive ? ' — set active' : ''}">${SpriteService.iconHTML(g.char, 14)}${HtmlUtils.escapeHtml(g.name)} ×${g.count}</span>`;
    }).join('');
  }

  // Shared renderer for the 3-choice altar/tattoo modal. Supports an optional
  // gold reroll that redraws the choices in place without closing the modal.
  private renderOfferModal<T extends { char: string; name: string }>(opts: {
    title: string;
    titleIcon?: string;
    subtitle: string;
    choices: T[];
    buttonInner: (c: T) => string;
    onChoice: (index: number) => void;
    reroll?: RerollCfg<T>;
    ownedHTML?: string;
  }): void {
    const titleEl = document.getElementById('altar-title')!;
    titleEl.innerHTML = opts.titleIcon ? `${SpriteService.iconHTML(opts.titleIcon, 16)}${HtmlUtils.escapeHtml(opts.title)}` : HtmlUtils.escapeHtml(opts.title);
    const subEl = document.getElementById('altar-subtitle');
    if (subEl) subEl.textContent = opts.subtitle;
    const ownedWrap = document.getElementById('altar-owned-summary');
    const ownedChips = document.getElementById('altar-owned-chips');
    if (ownedWrap && ownedChips) {
      if (opts.ownedHTML) { ownedChips.innerHTML = opts.ownedHTML; ownedWrap.style.display = ''; }
      else { ownedChips.innerHTML = ''; ownedWrap.style.display = 'none'; }
    }
    const container = document.getElementById('altar-choices')!;

    const render = (choices: T[], gold: number, cost: number): void => {
      container.innerHTML = '';
      choices.forEach((c, i) => {
        const btn = document.createElement('button');
        btn.className = 'modifier-btn';
        btn.innerHTML = opts.buttonInner(c);
        btn.addEventListener('click', () => {
          this.altarModal.style.display = 'none';
          opts.onChoice(i);
        });
        container.appendChild(btn);
      });
      if (opts.reroll) {
        const rb = document.createElement('button');
        rb.className = 'reroll-btn';
        rb.disabled = gold < cost;
        rb.innerHTML = gold >= cost
          ? `${SpriteService.iconHTML('item_dice', 14)}Reroll — ${cost}g (you have ${gold}g)`
          : `${SpriteService.iconHTML('item_dice', 14)}Reroll — need ${cost - gold} more gold`;
        rb.addEventListener('click', () => {
          const next = opts.reroll!.run();
          if (next) render(next.choices, next.gold, next.cost);
        });
        container.appendChild(rb);
      }
    };

    render(opts.choices, opts.reroll?.gold ?? 0, opts.reroll?.cost ?? 0);
    this.altarModal.style.display = 'flex';
  }

  /** Shows the wandering peddler's shop modal. */
  public showShop(stock: ShopItem[], gold: number, buy: (id: string) => { gold: number; ok: boolean }, onClose: () => void): void {
    const modal  = document.getElementById('shop-modal')!;
    const goldEl = document.getElementById('shop-gold')!;
    const items  = document.getElementById('shop-items')!;

    const render = (g: number): void => {
      goldEl.textContent = `${g.toLocaleString()}g`;
      items.innerHTML = '';
      for (const item of stock) {
        const btn = document.createElement('button');
        btn.className = 'shop-item-btn';
        btn.disabled = item.purchased || g < item.cost;
        btn.innerHTML =
          `<span style="display:flex;align-items:center;gap:8px;">${SpriteService.iconHTML(item.icon, 18)}` +
          `<span style="text-align:left;"><b>${HtmlUtils.escapeHtml(item.name)}</b><br>` +
          `<span style="color:#888;font-size:10px;">${HtmlUtils.escapeHtml(item.desc)}</span></span></span>` +
          `<span class="shop-cost">${item.purchased ? 'SOLD' : `${item.cost}g`}</span>`;
        btn.addEventListener('click', () => {
          const result = buy(item.id);
          if (result.ok) render(result.gold);
        });
        items.appendChild(btn);
      }
    };

    render(gold);
    (document.getElementById('shop-close') as HTMLButtonElement).onclick = () => {
      modal.style.display = 'none';
      onClose();
    };
    modal.style.display = 'flex';
  }

  /** Shows the tattoo-artist brand-choice modal, with an optional gold reroll. */
  public showTattooModal(
    choices: BrandDef[],
    ownedBrands: Array<{ slot: BodyPart; brand: BrandDef }>,
    onChoice: (i: number) => void,
    reroll?: RerollCfg<BrandDef>,
  ): void {
    this.renderOfferModal({
      title: 'Occult Tattoo Artist — Choose an Ogham Mark',
      titleIcon: 'tile_altar',
      subtitle: 'Ogham marks are permanent — you may only ever bear 5 in this life. Choose your identity.',
      choices, onChoice, reroll,
      ownedHTML: this.buildOwnedBrandsHTML(ownedBrands),
      buttonInner: (b) => `<span class="modifier-emoji">${SpriteService.iconHTML(b.char, 24)}</span><div class="modifier-info"><strong>${b.name}</strong><span>${b.desc}</span><span style="font-size:9px;color:#a78bfa;">${b.setDesc} (need ${b.setSize})</span></div>`,
    });
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
    const tierNames: Record<1 | 2 | 3, string> = { 1: 'Minor Altar', 2: 'Ruined Altar', 3: 'Grand Altar' };
    this.renderOfferModal({
      title: titleOverride ?? `${tierNames[tier]} — Choose a Geis`,
      titleIcon: 'tile_altar',
      subtitle: 'Geasa are unlimited — stack freely, and pick the same one again to amplify its effect.',
      choices, onChoice, reroll,
      ownedHTML: this.buildOwnedBoonsHTML(ownedBoons),
      buttonInner: (b) => `<span class="modifier-emoji">${SpriteService.iconHTML(b.char, 24)}</span><div class="modifier-info"><strong>${b.name}</strong><span>${b.desc}</span></div>`,
    });
  }

  /** Shows the start-screen modal. */
  public showStart(highScore: number): void {
    const el = document.getElementById('start-best');
    if (el) el.textContent = highScore > 0 ? `Best run: ${highScore.toLocaleString()} XP` : '';
    document.getElementById('start-modal')!.style.display = 'flex';
  }

  /** Hides the start-screen modal. */
  public hideStart(): void {
    document.getElementById('start-modal')!.style.display = 'none';
  }

  /** Shows the pause menu with the current sound/motion/volume state and button handlers. */
  public showPauseMenu(
    state: { soundOn: boolean; reducedMotion: boolean; volumePct: number },
    handlers: { onResume: () => void; onToggleMute: () => void; onToggleMotion: () => void; onCycleVolume: () => void; onRestart: () => void },
  ): void {
    const modal = document.getElementById('pause-modal');
    if (!modal) return;
    const muteState = document.getElementById('pause-mute-state');
    const motionState = document.getElementById('pause-motion-state');
    const volumeState = document.getElementById('pause-volume-state');
    if (muteState) muteState.textContent = state.soundOn ? 'On' : 'Off';
    if (motionState) motionState.textContent = state.reducedMotion ? 'On' : 'Off';
    if (volumeState) volumeState.textContent = `${state.volumePct}%`;
    const bind = (id: string, fn: () => void): void => { const el = document.getElementById(id); if (el) el.onclick = fn; };
    bind('pause-resume', handlers.onResume);
    bind('pause-mute', handlers.onToggleMute);
    bind('pause-motion', handlers.onToggleMotion);
    bind('pause-volume', handlers.onCycleVolume);
    bind('pause-restart', handlers.onRestart);
    modal.style.display = 'flex';
  }

  /** Hides the pause menu. */
  public hidePauseMenu(): void {
    const modal = document.getElementById('pause-modal');
    if (modal) modal.style.display = 'none';
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

  /** Logs an error to the console and the in-game log panel. */
  public showError(message: string): void {
    console.error('[CausewayToEriu]', message);
    this.log(message, 'log-damage', 'ui_warning');
  }

  /** Clears the log panel and the full-run log. */
  public clearLog(): void { this.logPanel.innerHTML = ''; this.fullLog.length = 0; }
}
