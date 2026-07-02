import { NEXT_PREVIEWS } from './config';
import type { LogClass, UIState, RunStats, BossDef, ModifierDef, InspectInfo, ClassDef, FloorEventDef, BoonDef } from './types';
import type { PerkDef, MerchantItem } from './content';
import type { RunRecord } from './types';

export class UIManager {
  private readonly logPanel: HTMLElement;
  private readonly modal: HTMLElement;
  private readonly perkModal: HTMLElement;
  private readonly shopModal: HTMLElement;
  private readonly modifierModal: HTMLElement;
  private readonly bossWarningModal: HTMLElement;
  private readonly classModal: HTMLElement;
  private readonly floorEventModal: HTMLElement;
  private readonly inspectTooltip: HTMLElement;
  private readonly altarModal: HTMLElement;
  private readonly els: Record<string, HTMLElement>;
  private lastScore = -1;
  private inspectDismissTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.logPanel          = document.getElementById('log-panel')!;
    this.modal             = document.getElementById('game-over-modal')!;
    this.perkModal         = document.getElementById('perk-modal')!;
    this.shopModal         = document.getElementById('shop-modal')!;
    this.modifierModal     = document.getElementById('modifier-modal')!;
    this.bossWarningModal  = document.getElementById('boss-warning-modal')!;
    this.classModal        = document.getElementById('class-modal')!;
    this.floorEventModal   = document.getElementById('floor-event-modal')!;
    this.inspectTooltip    = document.getElementById('inspect-tooltip')!;
    this.altarModal        = document.getElementById('altar-modal')!;
    this.els = {
      floor:            document.getElementById('stat-floor')!,
      score:            document.getElementById('stat-score')!,
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
      statusRow:        document.getElementById('status-row')!,
      runHistory:       document.getElementById('run-history')!,
      relicSlots:       document.getElementById('relic-slots')!,
      activeModifier:   document.getElementById('active-modifier-badge')!,
      activeClass:      document.getElementById('active-class-badge')!,
      biomeName:        document.getElementById('biome-badge')!,
      rangedAbility:    document.getElementById('ranged-ability-badge')!,
      heldPreview:      document.getElementById('held-preview-box')!,
      pieceStateBadge:  document.getElementById('piece-state-badge')!,
      potionPouch:      document.getElementById('potion-pouch')!,
      runStatsGrid:     document.getElementById('run-stats-grid')!,
      shareContainer:   document.getElementById('share-container')!,
      shareText:        document.getElementById('share-text')!,
    };
  }

  log(text: string, cls: LogClass = 'log-neutral'): void {
    const div = document.createElement('div');
    div.className = `log-entry ${cls}`;
    div.innerText = text;
    this.logPanel.appendChild(div);
    this.logPanel.scrollTop = this.logPanel.scrollHeight;
    if (this.logPanel.children.length > 50) this.logPanel.firstChild?.remove();
  }

  updateStats(state: UIState): void {
    this.els['floor']!.textContent       = String(state.floor);
    this.els['score']!.textContent       = String(state.score);
    this.els['hp']!.textContent          = `${state.hp}/${state.maxHp}`;
    this.els['rate']!.textContent        = `${state.gravityRate}ms`;
    const hpBar = this.els['hpBar']!;
    hpBar.style.width = `${Math.max(0, (state.hp / state.maxHp) * 100)}%`;
    const hpPct = state.maxHp > 0 ? state.hp / state.maxHp : 1;
    hpBar.classList.remove('hp-full', 'hp-warning', 'hp-critical');
    hpBar.classList.add(hpPct > 0.6 ? 'hp-full' : hpPct >= 0.3 ? 'hp-warning' : 'hp-critical');
    hpBar.parentElement?.classList.toggle('hp-critical-glow', hpPct < 0.3);

    const glowValue = hpPct > 0.6
      ? '0 0 28px rgba(41,182,246,.15), 0 0 6px rgba(41,182,246,.06)'
      : hpPct >= 0.3
        ? '0 0 28px rgba(255,152,0,.3), 0 0 6px rgba(255,152,0,.14)'
        : '0 0 28px rgba(220,20,20,.5), 0 0 8px rgba(220,20,20,.22)';
    document.documentElement.style.setProperty('--canvas-glow', glowValue);

    if (state.score !== this.lastScore) {
      const scoreEl = this.els['score']!;
      scoreEl.classList.remove('score-pop');
      void scoreEl.offsetWidth;
      scoreEl.classList.add('score-pop');
      setTimeout(() => scoreEl.classList.remove('score-pop'), 320);
      this.lastScore = state.score;
    }

    this.els['nextPreview']!.innerHTML = NEXT_PREVIEWS[state.nextType] ?? '';

    // Held piece display
    const heldBox = this.els['heldPreview']!;
    heldBox.innerHTML = state.heldType ? (NEXT_PREVIEWS[state.heldType] ?? '') : '—';
    heldBox.style.opacity = state.canHold ? '1' : '0.35';

    // Cursed / blessed piece badge
    const psBadge = this.els['pieceStateBadge']!;
    if (state.pieceState === 'cursed') {
      psBadge.style.display = '';
      psBadge.style.color = '#ef5350';
      psBadge.textContent = '⛧ CURSED PIECE';
    } else if (state.pieceState === 'blessed') {
      psBadge.style.display = '';
      psBadge.style.color = '#ffd54f';
      psBadge.textContent = '✨ BLESSED PIECE';
    } else {
      psBadge.style.display = 'none';
    }

    this.els['playerLevel']!.textContent = `Lv.${state.playerLevel}`;
    this.els['xpBar']!.style.width       = `${Math.min(100, (state.xp / state.xpToNext) * 100)}%`;
    this.els['xpLabel']!.textContent     = `${state.xp}/${state.xpToNext} XP`;
    this.updateBoons(state.boons);

    // Status effect tags
    this.els['statusRow']!.innerHTML = state.statuses
      .map(s => `<span class="status-tag status-${s.type}">${s.type === 'poison' ? '☠️' : '💫'} ${s.type} ${s.duration}</span>`)
      .join('');

    // Relic slots
    this.els['relicSlots']!.innerHTML = state.relics
      .map(r => `<span class="relic-badge" title="${r.name}: ${r.desc}">${r.char}</span>`)
      .join('');

    // Active modifier badge
    if (state.activeModifier) {
      this.els['activeModifier']!.style.display = '';
      this.els['activeModifier']!.textContent = `${state.activeModifier.emoji} ${state.activeModifier.name}`;
    } else {
      this.els['activeModifier']!.style.display = 'none';
    }

    // Active class badge
    if (state.activeClass) {
      this.els['activeClass']!.style.display = '';
      this.els['activeClass']!.textContent = `${state.activeClass.emoji} ${state.activeClass.name}`;
    } else {
      this.els['activeClass']!.style.display = 'none';
    }

    // Biome badge (only show when not on the default biome)
    if (state.biomeName && state.biomeName !== 'Stone Halls') {
      this.els['biomeName']!.style.display = '';
      this.els['biomeName']!.textContent = `🌐 ${state.biomeName}`;
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
      this.els['rangedAbility']!.style.display = '';
      this.els['rangedAbility']!.style.color = ready ? '#ffd700' : '#888';
      this.els['rangedAbility']!.style.fontSize = '9px';
      this.els['rangedAbility']!.textContent = `${ra.emoji} ${ra.name}${ammoText}${cdText}  (Q)`;
      if (rangedBtn) {
        rangedBtn.textContent = `${ra.emoji} ${ra.name}${ammoText}${cdText}`;
        rangedBtn.disabled = !ready;
        rangedBtn.style.opacity = ready ? '1' : '0.4';
      }
    } else {
      this.els['rangedAbility']!.style.display = 'none';
      if (rangedBtn) { rangedBtn.disabled = true; rangedBtn.style.opacity = '0.3'; rangedBtn.textContent = 'Q — No ability'; }
    }

    // Potion pouch display
    const pouchEl = this.els['potionPouch']!;
    if (state.potionPouch.length === 0) {
      pouchEl.textContent = '—';
    } else {
      pouchEl.innerHTML = '';
      for (const p of state.potionPouch) {
        const span = document.createElement('span');
        span.textContent = p.char;
        span.title = p.name;
        pouchEl.appendChild(span);
      }
    }
  }

  showDeath(title: string, reason: string, floor: number, score: number, highScore: number, history: RunRecord[], stats?: RunStats): void {
    this.els['deathTitle']!.textContent  = title;
    this.els['deathReason']!.textContent = reason;
    this.els['finalFloor']!.textContent  = String(floor);
    this.els['finalScore']!.textContent  = String(score);
    this.els['highScore']!.textContent   = String(highScore);

    // Run stats grid
    if (stats) {
      this.els['runStatsGrid']!.innerHTML = `
        <div class="run-stats-grid">
          <div class="stat-cell">☠️ <b>${stats.monstersKilled}</b><br><span>Monsters</span></div>
          <div class="stat-cell">👑 <b>${stats.bossesKilled}</b><br><span>Bosses</span></div>
          <div class="stat-cell">🧱 <b>${stats.linesCleared}</b><br><span>Lines</span></div>
          <div class="stat-cell">💥 <b>${stats.biggestCombo > 0 ? `×${stats.biggestCombo + 1}` : '—'}</b><br><span>Best Combo</span></div>
          <div class="stat-cell">💔 <b>${stats.damageTaken}</b><br><span>Dmg Taken</span></div>
          <div class="stat-cell">🎒 <b>${stats.itemsPickedUp}</b><br><span>Items</span></div>
        </div>`;
      const shareStr = `🗡️ Fl.${floor} · ☠️ ${stats.monstersKilled} kills · 🧱 ${stats.linesCleared} lines · 💥 Best combo ×${stats.biggestCombo + 1} · 🏆 ${score.toLocaleString()} pts`;
      (this.els['shareText'] as HTMLTextAreaElement).value = shareStr;
      this.els['shareContainer']!.style.display = '';
      const copyBtn = document.getElementById('copy-share-btn');
      if (copyBtn) {
        copyBtn.onclick = () => {
          navigator.clipboard?.writeText(shareStr).catch(() => {
            (this.els['shareText'] as HTMLTextAreaElement).select();
            document.execCommand('copy');
          });
          copyBtn.textContent = '✅ Copied!';
          setTimeout(() => { copyBtn.textContent = '📋 Copy Summary'; }, 1800);
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
        <span>${r.score.toLocaleString()}</span><span>Lv.${r.playerLevel}</span>
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
      btn.innerHTML = `<span class="modifier-emoji">${mod.emoji}</span><div class="modifier-info"><strong>${mod.name}</strong><span>${mod.desc}</span></div>`;
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
      btn.innerHTML = `<span class="modifier-emoji">${cls.emoji}</span><div class="modifier-info"><strong>${cls.name}</strong><span>${cls.tagline}</span><span style="color:#555;font-size:9px;">${cls.statPreview}</span></div>`;
      btn.addEventListener('click', () => {
        this.classModal.style.display = 'none';
        onSelect(cls.id);
      });
      container.appendChild(btn);
    }
    this.classModal.style.display = 'flex';
  }

  showFloorEvent(event: FloorEventDef, onChoice: (index: number) => void): void {
    (document.getElementById('floor-event-emoji') as HTMLElement).textContent  = event.emoji;
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
    (document.getElementById('boss-warning-emoji') as HTMLElement).textContent = boss.char;
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

  showPerkSelection(perks: PerkDef[], onSelect: (id: string) => void): void {
    const container = document.getElementById('perk-choices')!;
    container.innerHTML = '';
    for (const perk of perks) {
      const btn = document.createElement('button');
      const emojiMatch = perk.name.match(/^(\p{Emoji_Presentation}|\p{Extended_Pictographic})\s*/u);
      const emoji = emojiMatch?.[0].trim() ?? '✨';
      const label = emojiMatch ? perk.name.slice(emojiMatch[0].length) : perk.name;
      btn.className = 'modifier-btn';
      btn.innerHTML = `<span class="modifier-emoji">${emoji}</span><div class="modifier-info"><strong>${label}</strong><span>${perk.desc}</span></div>`;
      btn.addEventListener('click', () => {
        this.perkModal.style.display = 'none';
        onSelect(perk.id);
      });
      container.appendChild(btn);
    }
    this.perkModal.style.display = 'flex';
  }

  showShop(gold: number, stock: MerchantItem[], onBuy: (i: number) => number | null, onClose: () => void): void {
    const goldEl = document.getElementById('shop-gold')!;
    const container = document.getElementById('shop-items')!;
    const buttons: HTMLButtonElement[] = [];

    const refreshAffordability = (currentScore: number): void => {
      goldEl.textContent = currentScore.toLocaleString();
      for (let j = 0; j < buttons.length; j++) {
        (buttons[j] as HTMLButtonElement).disabled = currentScore < stock[j]!.cost;
      }
    };

    goldEl.textContent = gold.toLocaleString();
    container.innerHTML = '';
    for (let i = 0; i < stock.length; i++) {
      const item = stock[i]!;
      const btn = document.createElement('button');
      btn.className = 'shop-item-btn';
      btn.innerHTML = `<span>${item.char} ${item.name}</span><span class="shop-cost">${item.cost} pts</span>`;
      btn.disabled = gold < item.cost;
      btn.addEventListener('click', () => {
        const newScore = onBuy(i);
        if (newScore !== null) refreshAffordability(newScore);
      });
      buttons.push(btn);
      container.appendChild(btn);
    }
    document.getElementById('shop-close')!.onclick = () => {
      this.shopModal.style.display = 'none';
      onClose();
    };
    this.shopModal.style.display = 'flex';
  }

  updateBestScore(score: number): void {
    this.els['bestScore']!.textContent = String(score);
  }

  updateBoons(boons: Array<{ char: string; name: string; stacks: number }>): void {
    const panel = this.els['boonPanel']!;
    if (boons.length === 0) {
      panel.textContent = '—';
      return;
    }
    panel.innerHTML = boons
      .map(b => `<span class="boon-chip" title="${b.name} ×${b.stacks}">${b.char}×${b.stacks}</span>`)
      .join('');
  }

  showAltarModal(tier: 1 | 2 | 3, choices: BoonDef[], onChoice: (index: number) => void): void {
    const tierNames: Record<1 | 2 | 3, string> = { 1: 'Minor Altar', 2: 'Ruined Altar', 3: 'Grand Altar' };
    const titleEl = document.getElementById('altar-title')!;
    titleEl.textContent = `⛩️ ${tierNames[tier]} — Choose a Boon`;
    const container = document.getElementById('altar-choices')!;
    container.innerHTML = '';
    for (let i = 0; i < choices.length; i++) {
      const boon = choices[i]!;
      const btn = document.createElement('button');
      btn.className = 'modifier-btn';
      btn.innerHTML = `<span class="modifier-emoji">${boon.char}</span><div class="modifier-info"><strong>${boon.name}</strong><span>${boon.desc}</span></div>`;
      btn.addEventListener('click', () => {
        this.altarModal.style.display = 'none';
        onChoice(i);
      });
      container.appendChild(btn);
    }
    this.altarModal.style.display = 'flex';
  }

  showStart(highScore: number): void {
    const el = document.getElementById('start-best');
    if (el) el.textContent = highScore > 0 ? `Best run: ${highScore.toLocaleString()} pts` : '';
    document.getElementById('start-modal')!.style.display = 'flex';
  }

  hideStart(): void {
    document.getElementById('start-modal')!.style.display = 'none';
  }

  showInspectTooltip(info: InspectInfo, clientX: number, clientY: number): void {
    const el = this.inspectTooltip;
    el.innerHTML = `
      <div class="inspect-header"><span class="inspect-icon">${info.icon}</span><span class="inspect-title">${info.title}</span></div>
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
    this.log(`⚠️ ${message}`, 'log-damage');
  }

  clearLog(): void { this.logPanel.innerHTML = ''; }
}
