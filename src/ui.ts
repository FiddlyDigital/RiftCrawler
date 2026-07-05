import { SHAPES } from './config';
import { spriteIconHTML, escapeHtml, shapePreviewHTML } from './sprites';
import type { LogClass, UIState, RunStats, BossDef, ModifierDef, InspectInfo, ClassDef, FloorEventDef, BoonDef, BrandDef, RerollCfg } from './types';
import type { RunRecord } from './types';

export class UIManager {
  private readonly logPanel: HTMLElement;
  private readonly modal: HTMLElement;
  private readonly modifierModal: HTMLElement;
  private readonly bossWarningModal: HTMLElement;
  private readonly classModal: HTMLElement;
  private readonly floorEventModal: HTMLElement;
  private readonly inspectTooltip: HTMLElement;
  private readonly altarModal: HTMLElement;
  private readonly els: Record<string, HTMLElement>;
  private lastXpEarned = -1;
  private inspectDismissTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.logPanel          = document.getElementById('log-panel')!;
    this.modal             = document.getElementById('game-over-modal')!;
    this.modifierModal     = document.getElementById('modifier-modal')!;
    this.bossWarningModal  = document.getElementById('boss-warning-modal')!;
    this.classModal        = document.getElementById('class-modal')!;
    this.floorEventModal   = document.getElementById('floor-event-modal')!;
    this.inspectTooltip    = document.getElementById('inspect-tooltip')!;
    this.altarModal        = document.getElementById('altar-modal')!;
    this.els = {
      floor:            document.getElementById('stat-floor')!,
      xpTotal:          document.getElementById('stat-xp-total')!,
      hp:               document.getElementById('stat-hp')!,
      rate:             document.getElementById('stat-rate')!,
      hpBar:            document.getElementById('hp-bar')!,
      nextPreview:      document.getElementById('next-preview-box')!,
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
      shareContainer:   document.getElementById('share-container')!,
      shareText:        document.getElementById('share-text')!,
    };
  }

  log(text: string, cls: LogClass = 'log-neutral', icon?: string): void {
    const div = document.createElement('div');
    div.className = `log-entry ${cls}`;
    div.innerHTML = icon ? `${spriteIconHTML(icon, 13, 'sprite-icon log-icon')}${escapeHtml(text)}` : escapeHtml(text);
    this.logPanel.appendChild(div);
    this.logPanel.scrollTop = this.logPanel.scrollHeight;
    if (this.logPanel.children.length > 50) this.logPanel.firstChild?.remove();
  }

  updateStats(state: UIState): void {
    this.els['floor']!.textContent       = String(state.floor);
    this.els['xpTotal']!.textContent     = String(state.totalXpEarned);
    this.els['hp']!.textContent          = `${state.hp}/${state.maxHp}`;
    this.els['rate']!.textContent        = `${state.gravityRate}ms`;
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

    if (state.totalXpEarned !== this.lastXpEarned) {
      const xpEl = this.els['xpTotal']!;
      xpEl.classList.remove('score-pop');
      void xpEl.offsetWidth;
      xpEl.classList.add('score-pop');
      setTimeout(() => xpEl.classList.remove('score-pop'), 320);
      this.lastXpEarned = state.totalXpEarned;
    }

    this.els['nextPreview']!.innerHTML = shapePreviewHTML(SHAPES[state.nextType]);

    // Held piece display
    const heldBox = this.els['heldPreview']!;
    heldBox.innerHTML = state.heldType ? shapePreviewHTML(SHAPES[state.heldType]) : '—';
    heldBox.style.opacity = state.canHold ? '1' : '0.35';

    // Cursed / blessed piece badge
    const psBadge = this.els['pieceStateBadge']!;
    if (state.pieceState === 'cursed') {
      psBadge.style.display = '';
      psBadge.style.color = '#ef5350';
      psBadge.innerHTML = `${spriteIconHTML('status_poison', 12)}CURSED PIECE`;
    } else if (state.pieceState === 'blessed') {
      psBadge.style.display = '';
      psBadge.style.color = '#ffd54f';
      psBadge.innerHTML = `${spriteIconHTML('special_sacred', 12)}BLESSED PIECE`;
    } else {
      psBadge.style.display = 'none';
    }

    this.els['playerLevel']!.textContent = `Lv.${state.playerLevel}`;
    this.els['xpBar']!.style.width       = `${Math.min(100, (state.xp / state.xpToNext) * 100)}%`;
    this.els['xpLabel']!.textContent     = `${state.xp}/${state.xpToNext} XP`;
    this.updateBoons(state.boons);
    this.updateBrands(state.brands);
    this.els['brandCount']!.textContent = `(${state.brandsAcquiredTotal}/${state.brandsMaxLifetime})`;

    // Status effect tags
    this.els['statusRow']!.innerHTML = state.statuses
      .map(s => `<span class="status-tag status-${s.type}">${spriteIconHTML(s.type === 'poison' ? 'status_poison' : 'status_stun', 12)}${s.type} ${s.duration}</span>`)
      .join('');

    // Active modifier badge
    if (state.activeModifier) {
      this.els['activeModifier']!.style.display = '';
      this.els['activeModifier']!.innerHTML = `${spriteIconHTML(state.activeModifier.emoji, 12)}${escapeHtml(state.activeModifier.name)}`;
    } else {
      this.els['activeModifier']!.style.display = 'none';
    }

    // Active class badge
    if (state.activeClass) {
      this.els['activeClass']!.style.display = '';
      this.els['activeClass']!.innerHTML = `${spriteIconHTML(state.activeClass.emoji, 12)}${escapeHtml(state.activeClass.name)}`;
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
    if (state.rangedAbility) {
      const ra = state.rangedAbility;
      const ready = ra.cooldown === 0 && ra.ammo !== 0;
      const ammoText  = ra.ammo !== null ? ` ×${ra.ammo}` : '';
      const cdText    = ra.cooldown > 0 ? ` [${ra.cooldown}t]` : ' [Ready]';
      const label = `${escapeHtml(ra.name)}${ammoText}${cdText}`;
      this.els['rangedAbility']!.style.display = '';
      this.els['rangedAbility']!.style.color = ready ? '#ffd700' : '#888';
      this.els['rangedAbility']!.style.fontSize = '9px';
      this.els['rangedAbility']!.innerHTML = `${spriteIconHTML(ra.emoji, 12)}${label}  (Q)`;
      if (rangedBtn) {
        rangedBtn.innerHTML = `${spriteIconHTML(ra.emoji, 12)}${label}`;
        rangedBtn.disabled = !ready;
        rangedBtn.style.opacity = ready ? '1' : '0.4';
      }
    } else {
      this.els['rangedAbility']!.style.display = 'none';
      if (rangedBtn) { rangedBtn.disabled = true; rangedBtn.style.opacity = '0.3'; rangedBtn.textContent = 'Q — No ability'; }
    }
  }

  showDeath(title: string, reason: string, floor: number, totalXpEarned: number, highXp: number, history: RunRecord[], stats?: RunStats): void {
    this.els['deathTitle']!.textContent  = title;
    this.els['deathReason']!.textContent = reason;
    this.modal.querySelector('.modal-card')?.classList.remove('victory');
    this.populateEndModal(floor, totalXpEarned, highXp, history, stats);
  }

  showVictory(floor: number, totalXpEarned: number, highXp: number, history: RunRecord[], stats?: RunStats): void {
    this.els['deathTitle']!.innerHTML   = `${spriteIconHTML('item_trophy', 16)}BRES VANQUISHED`;
    this.els['deathReason']!.textContent = 'You felled Bres the Beautiful and shattered his bridge — the run is won.';
    this.modal.querySelector('.modal-card')?.classList.add('victory');
    this.populateEndModal(floor, totalXpEarned, highXp, history, stats);
  }

  private populateEndModal(floor: number, totalXpEarned: number, highXp: number, history: RunRecord[], stats?: RunStats): void {
    this.els['finalFloor']!.textContent  = String(floor);
    this.els['finalScore']!.textContent  = String(totalXpEarned);
    this.els['highScore']!.textContent   = String(highXp);

    // Run stats grid
    if (stats) {
      this.els['runStatsGrid']!.innerHTML = `
        <div class="run-stats-grid">
          <div class="stat-cell">${spriteIconHTML('status_poison', 14)}<b>${stats.monstersKilled}</b><br><span>Monsters</span></div>
          <div class="stat-cell">${spriteIconHTML('sprite_boss_boneking', 14)}<b>${stats.bossesKilled}</b><br><span>Bosses</span></div>
          <div class="stat-cell"><span class="brick-icon"></span><b>${stats.linesCleared}</b><br><span>Lines</span></div>
          <div class="stat-cell">${spriteIconHTML('fx_impact', 14)}<b>${stats.biggestCombo > 0 ? `×${stats.biggestCombo + 1}` : '—'}</b><br><span>Best Combo</span></div>
          <div class="stat-cell">${spriteIconHTML('item_heart', 14)}<b>${stats.damageTaken}</b><br><span>Dmg Taken</span></div>
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

  hideDeath(): void { this.modal.style.display = 'none'; }

  showModifierPick(mods: ModifierDef[], onSelect: (id: string) => void): void {
    const container = document.getElementById('modifier-choices')!;
    container.innerHTML = '';
    for (const mod of mods) {
      const btn = document.createElement('button');
      btn.className = 'modifier-btn';
      btn.innerHTML = `<span class="modifier-emoji">${spriteIconHTML(mod.emoji, 24)}</span><div class="modifier-info"><strong>${mod.name}</strong><span>${mod.desc}</span></div>`;
      btn.addEventListener('click', () => {
        this.modifierModal.style.display = 'none';
        onSelect(mod.id);
      });
      container.appendChild(btn);
    }
    this.modifierModal.style.display = 'flex';
  }

  showClassSelection(classes: ClassDef[], onSelect: (id: string) => void): void {
    const container = document.getElementById('class-choices')!;
    container.innerHTML = '';
    for (const cls of classes) {
      const btn = document.createElement('button');
      btn.className = 'modifier-btn';
      btn.innerHTML = `<span class="modifier-emoji">${spriteIconHTML(cls.emoji, 24)}</span><div class="modifier-info"><strong>${cls.name}</strong><span>${cls.tagline}</span><span style="color:#555;font-size:9px;">${cls.statPreview}</span></div>`;
      btn.addEventListener('click', () => {
        this.classModal.style.display = 'none';
        onSelect(cls.id);
      });
      container.appendChild(btn);
    }
    this.classModal.style.display = 'flex';
  }

  showFloorEvent(event: FloorEventDef, onChoice: (index: number) => void): void {
    (document.getElementById('floor-event-emoji') as HTMLElement).innerHTML  = spriteIconHTML(event.emoji, 28);
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

  showBossWarning(boss: BossDef, onDone: () => void): void {
    (document.getElementById('boss-warning-emoji') as HTMLElement).innerHTML = spriteIconHTML(boss.char, 32);
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

  updateBestScore(score: number): void {
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

  updateBoons(boons: UIState['boons']): void {
    const panel = this.els['boonPanel']!;
    panel.innerHTML = '';
    if (boons.length === 0) { panel.textContent = '—'; return; }
    for (const b of boons) {
      const chip = document.createElement('span');
      chip.className = 'boon-chip';
      chip.innerHTML = `${spriteIconHTML(b.char, 14)}×${b.stacks}`;
      chip.title = `${b.name} ×${b.stacks}`;
      this.bindChipInspect(chip, () => ({
        icon: b.char,
        title: `${b.name} ×${b.stacks}`,
        lines: [b.desc],
      }));
      panel.appendChild(chip);
    }
  }

  updateBrands(brands: UIState['brands']): void {
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
      chip.innerHTML = `${spriteIconHTML(b.char, 14)}×${b.count}`;
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
  }): void {
    const titleEl = document.getElementById('altar-title')!;
    titleEl.innerHTML = opts.titleIcon ? `${spriteIconHTML(opts.titleIcon, 16)}${escapeHtml(opts.title)}` : escapeHtml(opts.title);
    const subEl = document.getElementById('altar-subtitle');
    if (subEl) subEl.textContent = opts.subtitle;
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
          ? `${spriteIconHTML('item_dice', 14)}Reroll — ${cost}g (you have ${gold}g)`
          : `${spriteIconHTML('item_dice', 14)}Reroll — need ${cost - gold} more gold`;
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

  showTattooModal(choices: BrandDef[], onChoice: (i: number) => void, reroll?: RerollCfg<BrandDef>): void {
    this.renderOfferModal({
      title: 'Occult Tattoo Artist — Choose an Ogham Mark',
      titleIcon: 'tile_altar',
      subtitle: 'Ogham marks are permanent — you may only ever bear 5 in this life. Choose your identity.',
      choices, onChoice, reroll,
      buttonInner: (b) => `<span class="modifier-emoji">${spriteIconHTML(b.char, 24)}</span><div class="modifier-info"><strong>${b.name}</strong><span>${b.desc}</span><span style="font-size:9px;color:#a78bfa;">${b.setDesc} (need ${b.setSize})</span></div>`,
    });
  }

  showAltarModal(tier: 1 | 2 | 3, choices: BoonDef[], onChoice: (index: number) => void, titleOverride?: string, reroll?: RerollCfg<BoonDef>): void {
    const tierNames: Record<1 | 2 | 3, string> = { 1: 'Minor Altar', 2: 'Ruined Altar', 3: 'Grand Altar' };
    this.renderOfferModal({
      title: titleOverride ?? `${tierNames[tier]} — Choose a Geis`,
      titleIcon: 'tile_altar',
      subtitle: 'Geasa are unlimited — stack freely, and pick the same one again to amplify its effect.',
      choices, onChoice, reroll,
      buttonInner: (b) => `<span class="modifier-emoji">${spriteIconHTML(b.char, 24)}</span><div class="modifier-info"><strong>${b.name}</strong><span>${b.desc}</span></div>`,
    });
  }

  showStart(highScore: number): void {
    const el = document.getElementById('start-best');
    if (el) el.textContent = highScore > 0 ? `Best run: ${highScore.toLocaleString()} XP` : '';
    document.getElementById('start-modal')!.style.display = 'flex';
  }

  hideStart(): void {
    document.getElementById('start-modal')!.style.display = 'none';
  }

  showPauseMenu(
    state: { soundOn: boolean; reducedMotion: boolean },
    handlers: { onResume: () => void; onToggleMute: () => void; onToggleMotion: () => void; onRestart: () => void },
  ): void {
    const modal = document.getElementById('pause-modal');
    if (!modal) return;
    const muteState = document.getElementById('pause-mute-state');
    const motionState = document.getElementById('pause-motion-state');
    if (muteState) muteState.textContent = state.soundOn ? 'On' : 'Off';
    if (motionState) motionState.textContent = state.reducedMotion ? 'On' : 'Off';
    const bind = (id: string, fn: () => void): void => { const el = document.getElementById(id); if (el) el.onclick = fn; };
    bind('pause-resume', handlers.onResume);
    bind('pause-mute', handlers.onToggleMute);
    bind('pause-motion', handlers.onToggleMotion);
    bind('pause-restart', handlers.onRestart);
    modal.style.display = 'flex';
  }

  hidePauseMenu(): void {
    const modal = document.getElementById('pause-modal');
    if (modal) modal.style.display = 'none';
  }

  showInspectTooltip(info: InspectInfo, clientX: number, clientY: number): void {
    const el = this.inspectTooltip;
    el.innerHTML = `
      <div class="inspect-header"><span class="inspect-icon">${spriteIconHTML(info.icon, 20)}</span><span class="inspect-title">${info.title}</span></div>
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

  hideInspectTooltip(): void {
    this.inspectTooltip.hidden = true;
    this.inspectTooltip.classList.remove('inspect-show');
    if (this.inspectDismissTimer) { clearTimeout(this.inspectDismissTimer); this.inspectDismissTimer = null; }
  }

  isInspectTooltipVisible(): boolean {
    return !this.inspectTooltip.hidden;
  }

  showError(message: string): void {
    console.error('[RiftCrawler]', message);
    this.log(message, 'log-damage', 'ui_warning');
  }

  clearLog(): void { this.logPanel.innerHTML = ''; }
}
