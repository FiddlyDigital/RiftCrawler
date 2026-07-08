import { CONFIG } from './config';
import { TIER_COLORS } from './colors';
import { Tile, Cell } from './types';
import { ParticlePool } from './entities';
import { getBiomeForFloor } from './content';
import { MONSTERS } from './dataLoader';
import { SPRITE_MAP, getSpriteImage } from './sprites';
import type { Game } from './game';

const FADE_FRAMES = 10;

interface Mote { x: number; y: number; vy: number; alpha: number; size: number }

export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly particles: ParticlePool;
  private rafId = 0;
  private damageFlashFrames = 0;
  private shakeFrames = 0;
  private shakeIntensity = 0;
  private readonly motes: Mote[];
  private readonly revealFrames: Uint8Array;
  private lastDungeonLevel = 1;
  private comboOverlay: { text: string; alpha: number; mult: number } | null = null;
  private floorTransitionFrames = 0;
  private floorTransitionColor = '10,10,20';
  private reducedMotion = false;
  private impactGlow: { x: number; y: number; rgb: string; frames: number; maxFrames: number } | null = null;

  constructor(canvas: HTMLCanvasElement) {
    canvas.width = CONFIG.COLS * CONFIG.TILE_SIZE;
    canvas.height = CONFIG.ROWS * CONFIG.TILE_SIZE;
    this.ctx = canvas.getContext('2d')!;
    this.particles = new ParticlePool(90);
    this.motes = Array.from({ length: 14 }, () => this.spawnMote(true));
    this.revealFrames = new Uint8Array(CONFIG.COLS * CONFIG.ROWS);
  }

  spawnParticle(gridX: number, gridY: number, text: string, color: string, fontSize = 13, icon = ''): void {
    this.particles.spawn(gridX, gridY, text, color, fontSize, icon);
  }

  spawnBurst(gridX: number, gridY: number, count: number, color: string, icon = ''): void {
    if (this.reducedMotion) return;
    this.particles.spawnBurst(gridX, gridY, count, color, icon);
  }

  triggerImpactGlow(gx: number, gy: number, rgb: string, frames = 16): void {
    if (this.reducedMotion) return;
    this.impactGlow = { x: gx, y: gy, rgb, frames, maxFrames: frames };
  }

  spawnLandingDust(cells: Array<{ x: number; y: number }>): void {
    for (const c of cells) {
      const n = 2 + Math.floor(Math.random() * 2);
      for (let i = 0; i < n; i++) {
        const ox = (Math.random() - 0.5) * 0.7;
        this.particles.spawn(c.x + ox, c.y + 0.3, Math.random() < 0.5 ? '·' : '▪', 'rgba(210,210,220,0.75)');
      }
    }
  }

  private spawnMote(randomY = false): Mote {
    const w = CONFIG.COLS * CONFIG.TILE_SIZE, h = CONFIG.ROWS * CONFIG.TILE_SIZE;
    return {
      x: Math.random() * w,
      y: randomY ? Math.random() * h : h + 4,
      vy: 0.08 + Math.random() * 0.14,
      alpha: 0.05 + Math.random() * 0.12,
      size: 0.6 + Math.random() * 1.3,
    };
  }

  private drawSprite(key: string, dx: number, dy: number, dw: number, dh: number): boolean {
    const coord = SPRITE_MAP[key];
    if (!coord || !coord.sheet) return false;
    const img = getSpriteImage(coord.sheet);
    if (!img) return false;
    // Contain-fit + center so non-square atlas crops don't get squashed.
    const scale = Math.min(dw / coord.sw, dh / coord.sh);
    const fw = coord.sw * scale, fh = coord.sh * scale;
    const fx = dx + (dw - fw) / 2, fy = dy + (dh - fh) / 2;
    this.ctx.drawImage(img, coord.sx, coord.sy, coord.sw, coord.sh, fx, fy, fw, fh);
    return true;
  }

  private drawPulseGlow(gx: number, gy: number, rgb: string): void {
    const TS = CONFIG.TILE_SIZE;
    const alpha = 0.18 + 0.18 * Math.sin(performance.now() / 400);
    const px = gx * TS + TS / 2, py = gy * TS + TS / 2;
    const glow = this.ctx.createRadialGradient(px, py, 0, px, py, TS * 1.1);
    glow.addColorStop(0, `rgba(${rgb},${alpha})`);
    glow.addColorStop(1, `rgba(${rgb},0)`);
    this.ctx.fillStyle = glow;
    this.ctx.fillRect(px - TS * 1.1, py - TS * 1.1, TS * 2.2, TS * 2.2);
  }

  start(game: Game, onError?: (err: unknown) => void): void {
    cancelAnimationFrame(this.rafId);
    const loop = (): void => {
      if (!game.active) return;
      try { this.draw(game); } catch (err) { console.error('[Renderer]', err); onError?.(err); }
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  private draw(game: Game): void {
    const { ctx } = this;
    const TS = CONFIG.TILE_SIZE;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    if (game.dungeonLevel !== this.lastDungeonLevel) {
      this.revealFrames.fill(0);
      this.lastDungeonLevel = game.dungeonLevel;
      this.floorTransitionFrames = 30;
      const biome = getBiomeForFloor(game.dungeonLevel);
      this.floorTransitionColor = biome.tileRgb || '10,10,20';
    }

    // ── Screen shake ─────────────────────────────────────────────────────
    ctx.save();
    if (this.shakeFrames > 0) {
      ctx.translate(
        (Math.random() - 0.5) * this.shakeIntensity * 2,
        (Math.random() - 0.5) * this.shakeIntensity * 2,
      );
      this.shakeFrames--;
    }

    // ── Damage flash overlay ──────────────────────────────────────────────
    if (this.damageFlashFrames > 0) {
      ctx.fillStyle = 'rgba(220,20,20,0.22)';
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      this.damageFlashFrames--;
    }

    // ── Subtle grid lines ─────────────────────────────────────────────────
    ctx.globalAlpha = 0.06;
    ctx.strokeStyle = '#aaaacc';
    ctx.lineWidth = 0.5;
    for (let gx = 0; gx <= CONFIG.COLS; gx++) {
      ctx.beginPath(); ctx.moveTo(gx * TS, 0); ctx.lineTo(gx * TS, CONFIG.ROWS * TS); ctx.stroke();
    }
    for (let gy = 0; gy <= CONFIG.ROWS; gy++) {
      ctx.beginPath(); ctx.moveTo(0, gy * TS); ctx.lineTo(CONFIG.COLS * TS, gy * TS); ctx.stroke();
    }
    ctx.globalAlpha = 1.0;
    ctx.lineWidth = 1;

    // ── Map tiles with fog of war ─────────────────────────────────────────
    for (let x = 0; x < CONFIG.COLS; x++) {
      for (let y = 0; y < CONFIG.ROWS; y++) {
        const visible = game.visibility[x]![y]!;
        const seen = game.explored[x]![y]!;
        const type = game.map[x]![y]!;
        const isMerchant = this.isMerchantTile(game, x, y);

        if (!seen && !visible) {
          ctx.fillStyle = '#020204';
          ctx.fillRect(x * TS, y * TS, TS, TS);
          continue;
        }

        const idx = x * CONFIG.ROWS + y;
        if (visible && this.revealFrames[idx]! < FADE_FRAMES) this.revealFrames[idx]!++;
        const fadeFactor = visible ? Math.min(1, this.revealFrames[idx]! / FADE_FRAMES) : 1;
        // Explored-but-out-of-sight tiles stay at a clearly legible shadowed
        // shade (not just visible/invisible) — memory of the floor's shape,
        // never any monster/hazard content, which only draw when `visible`.
        const alpha = (visible ? 1.0 : 0.5) * fadeFactor;
        ctx.globalAlpha = alpha;

        if (type === Tile.FLOOR || type === Tile.STAIRS || isMerchant) {
          // Draw block color base first — preserves tetris color identity
          ctx.fillStyle = isMerchant ? '#0d2d0d' : (game.colors[x]![y] ?? '#444');
          ctx.fillRect(x * TS, y * TS, TS - 1, TS - 1);
          ctx.strokeStyle = 'rgba(0,0,0,0.2)';
          ctx.strokeRect(x * TS, y * TS, TS, TS);

          // Overlay floor texture at ~45% to add pixel-art depth without hiding color
          ctx.globalAlpha = alpha * 0.45;
          this.drawSprite('FLOOR', x * TS, y * TS, TS, TS);
          ctx.globalAlpha = alpha;

          // Tile-feature glyphs (stairs / tattoo artist / altar) are drawn in a
          // later pass so a descending tetromino never hides what's on the tile.
        } else {
          ctx.fillStyle = '#06060a';
          ctx.fillRect(x * TS, y * TS, TS, TS);
          ctx.strokeStyle = '#0d0d14';
          ctx.strokeRect(x * TS, y * TS, TS, TS);
        }
        ctx.globalAlpha = 1.0;
      }
    }

    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.globalAlpha = 1.0;

    // ── Ambient dust motes ──────────────────────────────────────────────────
    this.updateMotes();
    this.drawMotes();

    // ── Falling block (always visible) ────────────────────────────────────
    ctx.font = `${TS * 0.7}px Arial`;
    // Preview the terrain an S/L/J/Z piece lays down on lock so it isn't a surprise.
    const TERRAIN_HINT: Record<string, string> = { S: 'special_swamp', L: 'special_sacred', J: 'special_ice', Z: 'trap_spike' };
    const terrainHint = TERRAIN_HINT[game.currentType];
    for (let r = 0; r < game.blockMatrix.length; r++) {
      for (let c = 0; c < game.blockMatrix[r]!.length; c++) {
        const cell = game.blockMatrix[r]![c]!;
        if (cell === Cell.EMPTY) continue;
        const tx = game.blockX + c, ty = game.blockY + r;
        if (tx < 0 || tx >= CONFIG.COLS || ty < 0 || ty >= CONFIG.ROWS) continue;

        ctx.fillStyle = cell === Cell.MERCHANT ? '#1b0535' : cell === Cell.ALTAR ? '#1a0a2a' : game.blockColor;
        ctx.fillRect(tx * TS, ty * TS, TS - 1, TS - 1);
        if (cell === Cell.BOSS) {
          ctx.strokeStyle = '#ff0000'; ctx.lineWidth = 2;
        } else if (game.currentCursed) {
          ctx.strokeStyle = '#ef5350'; ctx.lineWidth = 2;
        } else if (game.currentBlessed) {
          ctx.strokeStyle = '#ffd54f'; ctx.lineWidth = 2;
        } else {
          ctx.strokeStyle = '#fff'; ctx.lineWidth = 1;
        }
        ctx.strokeRect(tx * TS, ty * TS, TS, TS);
        ctx.lineWidth = 1;

        const spriteKey = CELL_SPRITE[cell];
        if (spriteKey) {
          const inset = 2;
          this.drawSprite(spriteKey, tx * TS + inset, ty * TS + inset, TS - 2 * inset, TS - 2 * inset);
        } else if (terrainHint) {
          // Plain cell of a terrain piece — show what it will become.
          ctx.globalAlpha = 0.85;
          const hintInset = TS * 0.28;
          this.drawSprite(terrainHint, tx * TS + hintInset, ty * TS + hintInset, TS - 2 * hintInset, TS - 2 * hintInset);
          ctx.globalAlpha = 1.0;
        }
      }
    }

    // ── Ghost / shadow piece ──────────────────────────────────────────────
    const ghostY = game.computeGhostBlockY();
    if (ghostY > game.blockY) {
      ctx.globalAlpha = 0.28;
      for (let r = 0; r < game.blockMatrix.length; r++) {
        for (let c = 0; c < game.blockMatrix[r]!.length; c++) {
          if (game.blockMatrix[r]![c] === Cell.EMPTY) continue;
          const tx = game.blockX + c, ty = ghostY + r;
          if (tx < 0 || tx >= CONFIG.COLS || ty < 0 || ty >= CONFIG.ROWS) continue;
          ctx.fillStyle = game.blockColor;
          ctx.fillRect(tx * TS, ty * TS, TS - 1, TS - 1);
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1;
          ctx.strokeRect(tx * TS, ty * TS, TS, TS);
        }
      }
      ctx.globalAlpha = 1.0;
    }

    // ── Tile-feature glyphs (stairs / tattoo artist / altar) ───────────────
    // Drawn AFTER the falling block + ghost so a descending piece can never
    // hide the feature underneath it — the player always sees what's on a tile.
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    for (let x = 0; x < CONFIG.COLS; x++) {
      for (let y = 0; y < CONFIG.ROWS; y++) {
        const visible = game.visibility[x]![y]!;
        if (!visible && !game.explored[x]![y]!) continue;
        const type = game.map[x]![y]!;
        const isMerchant = this.isMerchantTile(game, x, y);
        const altar = this.getAltarAt(game, x, y);
        if (type !== Tile.STAIRS && !isMerchant && !altar) continue;

        ctx.globalAlpha = visible ? 1.0 : 0.5;
        if (type === Tile.STAIRS) {
          if (visible) this.drawPulseGlow(x, y, '168,132,184');
          this.drawSprite('tile_stairs', x * TS, y * TS, TS, TS);
        } else if (isMerchant) {
          if (visible) this.drawPulseGlow(x, y, '122,58,150');
          this.drawSprite('tile_merchant', x * TS, y * TS, TS, TS);
        } else if (altar) {
          if (visible) {
            this.drawPulseGlow(x, y, TIER_COLORS[altar.tier].rgb);
          }
          const inset = TS * 0.1;
          this.drawSprite('tile_altar', x * TS + inset, y * TS + inset, TS - 2 * inset, TS - 2 * inset);
        }
        ctx.globalAlpha = 1.0;
      }
    }

    // ── Special tile overlays (swamp / sacred / ice) ─────────────────────
    for (const t of game.specialTiles) {
      if (!game.visibility[t.x]?.[t.y]) continue;
      const sx = t.x * TS, sy = t.y * TS;
      const inset = TS * 0.22;
      if (t.type === 'swamp') {
        ctx.globalAlpha = 0.45;
        ctx.fillStyle = '#388e3c';
        ctx.fillRect(sx, sy, TS - 1, TS - 1);
        ctx.globalAlpha = 0.9;
        this.drawSprite('special_swamp', sx + inset, sy + inset, TS - 2 * inset, TS - 2 * inset);
      } else if (t.type === 'sacred') {
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = '#ffb74d';
        ctx.fillRect(sx, sy, TS - 1, TS - 1);
        ctx.globalAlpha = 0.9;
        this.drawSprite('special_sacred', sx + inset, sy + inset, TS - 2 * inset, TS - 2 * inset);
      } else if (t.type === 'ice') {
        ctx.globalAlpha = 0.50;
        ctx.fillStyle = '#81d4fa';
        ctx.fillRect(sx, sy, TS - 1, TS - 1);
        ctx.globalAlpha = 0.9;
        this.drawSprite('special_ice', sx + inset, sy + inset, TS - 2 * inset, TS - 2 * inset);
      }
      ctx.globalAlpha = 1.0;
    }

    // ── Hazard overlays ───────────────────────────────────────────────────
    for (const h of game.hazards) {
      if (!game.visibility[h.x]?.[h.y]) continue;
      const hx = h.x * TS, hy = h.y * TS;
      const inset = TS * 0.22;
      if (h.type === 'spike') {
        ctx.globalAlpha = h.warning ? 0.6 : 0.25;
        ctx.fillStyle = h.warning ? '#ff1744' : '#ff9100';
        ctx.fillRect(hx, hy, TS - 1, TS - 1);
        ctx.globalAlpha = 0.9;
        this.drawSprite('trap_spike', hx + inset, hy + inset, TS - 2 * inset, TS - 2 * inset);
        if (h.warning) {
          ctx.font = '5px monospace';
          ctx.fillStyle = '#ff1744';
          ctx.fillText(String(h.timer), hx + TS - 5, hy + 7);
          ctx.font = `${TS * 0.7}px Arial`;
        }
      } else if (h.type === 'smoke') {
        ctx.globalAlpha = 0.45;
        ctx.fillStyle = '#546e7a';
        ctx.fillRect(hx, hy, TS - 1, TS - 1);
        ctx.globalAlpha = 0.8;
        this.drawSprite('trap_smoke', hx + inset, hy + inset, TS - 2 * inset, TS - 2 * inset);
      } else if (h.type === 'teleport') {
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = '#7c4dff';
        ctx.fillRect(hx, hy, TS - 1, TS - 1);
        ctx.globalAlpha = 0.9;
        ctx.save();
        ctx.translate(hx + TS / 2, hy + TS / 2);
        ctx.rotate(performance.now() / 600);
        this.drawSprite('trap_teleport', -(TS - 2 * inset) / 2, -(TS - 2 * inset) / 2, TS - 2 * inset, TS - 2 * inset);
        ctx.restore();
      }
      ctx.globalAlpha = 1.0;
    }

    // ── Monsters (only if visible) ────────────────────────────────────────
    for (const m of game.monsters) {
      if (!game.visibility[m.x]?.[m.y]) continue;

      if (m.isElite) this.drawPulseGlow(m.x, m.y, '212,175,55');
      if (m.isGorgoth) this.drawPulseGlow(m.x, m.y, '139,26,26');  // ominous final-boss aura

      // Telegraph: a monster that can strike the player next turn pulses red and
      // shows a ‼ marker, so incoming damage is a read rather than a surprise.
      // Combat is orthogonal-only, so this is Manhattan range (attackRange 1 =
      // the four orthogonal tiles; ranged monsters use their larger range).
      const threatening = game.player.hp > 0 && !m.isStunned &&
        (Math.abs(m.x - game.player.x) + Math.abs(m.y - game.player.y)) <= m.attackRange;
      if (threatening) {
        this.drawPulseGlow(m.x, m.y, '198,58,50');
        ctx.font = '9px Arial';
        ctx.fillStyle = '#d9695c';
        ctx.fillText('‼', m.x * TS + 5, m.y * TS + 5);
        ctx.font = `${TS * 0.7}px Arial`;
      }

      this.drawSprite(m.char, m.x * TS, m.y * TS, TS, TS);

      if (m.isElite) {
        ctx.strokeStyle = '#ffd700';
        ctx.lineWidth = 2;
        ctx.strokeRect(m.x * TS, m.y * TS, TS, TS);
        ctx.lineWidth = 1;
      }

      if (m.statuses.length > 0) {
        this.drawSprite('status_poison', m.x * TS + TS - 9, m.y * TS - 2, 9, 9);
      }

      if (m.isBoss || m.isElite) {
        const barW = TS - 2;
        const pct = m.hp / m.maxHp;
        ctx.fillStyle = '#333';
        ctx.fillRect(m.x * TS + 1, m.y * TS - 4, barW, 3);
        ctx.fillStyle = m.isBoss
          ? (pct > 0.5 ? '#ef5350' : '#ff1744')
          : (pct > 0.5 ? '#ffd700' : '#ff9100');
        ctx.fillRect(m.x * TS + 1, m.y * TS - 4, Math.floor(barW * pct), 3);
      }
    }

    // ── Player ────────────────────────────────────────────────────────────
    if (game.player.hp > 0) {
      ctx.font = `${TS * 0.7}px Arial`;

      const idleBob = Math.sin(performance.now() / 500) * 1.5;
      const px = game.player.x * TS + TS / 2;
      const py = game.player.y * TS + TS / 2 + idleBob;
      const glow = ctx.createRadialGradient(px, py, 0, px, py, TS * 1.4);
      glow.addColorStop(0, 'rgba(102,187,106,0.38)');
      glow.addColorStop(1, 'rgba(102,187,106,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(game.player.x * TS - TS, game.player.y * TS - TS, TS * 3, TS * 3);

      this.drawSprite(game.player.char, game.player.x * TS, game.player.y * TS + idleBob, TS, TS);

      if (game.player.statuses.length > 0) {
        const iconSize = 8;
        game.player.statuses.forEach((s, i) => {
          const key = s.type === 'poison' ? 'status_poison' : 'status_stun';
          this.drawSprite(key, game.player.x * TS + TS / 2 - iconSize - 1 + i * (iconSize + 1), game.player.y * TS - iconSize - 1, iconSize, iconSize);
        });
      }
    }

    // ── One-shot impact glow (crit/boss/phase moments) ──────────────────────
    if (this.impactGlow) {
      const { x, y, rgb, frames, maxFrames } = this.impactGlow;
      const alpha = 0.5 * (frames / maxFrames);
      const TSg = CONFIG.TILE_SIZE;
      const px = x * TSg + TSg / 2, py = y * TSg + TSg / 2;
      const glow = ctx.createRadialGradient(px, py, 0, px, py, TSg * 2.2);
      glow.addColorStop(0, `rgba(${rgb},${alpha})`);
      glow.addColorStop(1, `rgba(${rgb},0)`);
      ctx.fillStyle = glow;
      ctx.fillRect(px - TSg * 2.2, py - TSg * 2.2, TSg * 4.4, TSg * 4.4);
      this.impactGlow.frames--;
      if (this.impactGlow.frames <= 0) this.impactGlow = null;
    }

    // ── Particles ─────────────────────────────────────────────────────────
    this.particles.tick(ctx);

    // ── Combo overlay ─────────────────────────────────────────────────────
    if (this.comboOverlay) {
      const { text, alpha, mult } = this.comboOverlay;
      const cw = ctx.canvas.width, ch = ctx.canvas.height;
      const fontSize = 22 + Math.min(mult, 8) * 2;
      const color = mult >= 5 ? '#ff1744' : '#ff9100';
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.font = `bold ${fontSize}px 'VT323', monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillText(text, cw / 2 + 1, ch / 2 + 1);
      ctx.fillStyle = color;
      ctx.fillText(text, cw / 2, ch / 2);
      ctx.restore();
      this.comboOverlay.alpha -= 0.028;
      if (this.comboOverlay.alpha <= 0) this.comboOverlay = null;
    }

    // ── Biome tint overlay ────────────────────────────────────────────────
    const biome = getBiomeForFloor(game.dungeonLevel);
    if (biome.tileRgb) {
      ctx.fillStyle = `rgba(${biome.tileRgb},0.07)`;
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    }

    // ── Floor transition flash ────────────────────────────────────────────
    if (this.floorTransitionFrames > 0) {
      const flashAlpha = (this.floorTransitionFrames / 30) * 0.88;
      ctx.fillStyle = `rgba(${this.floorTransitionColor},${flashAlpha})`;
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      this.floorTransitionFrames--;
    }

    // ── Low-HP vignette ──────────────────────────────────────────────────
    if (game.player.hp > 0 && game.player.hp / game.player.maxHp <= 0.25) {
      const pulse = 0.35 + 0.25 * Math.sin(performance.now() / 300);
      const w = ctx.canvas.width, h = ctx.canvas.height;
      const vignette = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
      vignette.addColorStop(0, 'rgba(180,0,0,0)');
      vignette.addColorStop(1, `rgba(180,0,0,${pulse})`);
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, w, h);
    }

    // ── Pause overlay ─────────────────────────────────────────────────────
    if (game.paused && game.player.hp > 0) {
      const W = ctx.canvas.width, H = ctx.canvas.height;
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
      ctx.font = "bold 14px var(--font-pixel, 'VT323', monospace)";
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#666';
      ctx.fillText('— PAUSED —', W / 2, H / 2);
      ctx.restore();
    }

    ctx.restore();
  }

  private updateMotes(): void {
    for (const m of this.motes) {
      m.y -= m.vy;
      if (m.y < -4) Object.assign(m, this.spawnMote(false));
    }
  }

  private drawMotes(): void {
    const { ctx } = this;
    ctx.save();
    ctx.fillStyle = '#aeeaff';
    for (const m of this.motes) {
      ctx.globalAlpha = m.alpha;
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  public showCombo(multiplier: number): void {
    this.comboOverlay = { text: `×${multiplier} COMBO`, alpha: 1.0, mult: multiplier };
  }

  public setReducedMotion(on: boolean): void { this.reducedMotion = on; }
  public triggerDamageFlash(): void { if (!this.reducedMotion) this.damageFlashFrames = 8; }
  public triggerShake(intensity: number, duration: number): void {
    if (this.reducedMotion) return;  // no screen shake when reduced motion is on
    this.shakeIntensity = intensity;
    this.shakeFrames = duration;
  }

  private isMerchantTile(game: Game, x: number, y: number): boolean {
    return (game as unknown as { tattooTiles: Array<{ x: number; y: number }> })
      .tattooTiles.some((t: { x: number; y: number }) => t.x === x && t.y === y);
  }

  private getAltarAt(game: Game, x: number, y: number): { tier: 1 | 2 | 3 } | undefined {
    return (game as unknown as { altarTiles: Array<{ x: number; y: number; tier: 1 | 2 | 3 }> })
      .altarTiles.find((a: { x: number; y: number }) => a.x === x && a.y === y);
  }
}

const CELL_SPRITE: Partial<Record<number, string>> = {
  [Cell.MONSTER_RAT]:    MONSTERS['rat']!.char,
  [Cell.MONSTER_SKEL]:   MONSTERS['skeleton']!.char,
  [Cell.MONSTER_ARCHER]: MONSTERS['goblin_archer']!.char,
  [Cell.MONSTER_SLIME]:  MONSTERS['cave_slime']!.char,
  [Cell.MONSTER_ORC]:    MONSTERS['berserker_orc']!.char,
  [Cell.MONSTER_BAT]:    MONSTERS['plague_bat']!.char,
  [Cell.STAIRS]:         'tile_stairs',
  [Cell.MERCHANT]:       'tile_merchant',
  [Cell.BOSS]:           'ui_warning',
  [Cell.ALTAR]:          'tile_altar',
  [Cell.TRAP_SPIKE]:     'trap_spike',
  [Cell.TRAP_SMOKE]:     'trap_smoke',
  [Cell.TRAP_TELEPORT]:  'trap_teleport',
};
