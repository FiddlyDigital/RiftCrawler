import { CONFIG } from './config';
import { Tile, Cell } from './types';
import { ParticlePool } from './entities';
import type { Game } from './game';
import type { SpriteCoord } from './types';
import spriteMapData from './data/sprite-map.json';

const SPRITE_MAP = spriteMapData as Record<string, unknown>;

const SPRITE_SHEETS: Record<string, string> = {
  bat: '/sprites/bat.png',
  brute: '/sprites/brute.png',
  demon: '/sprites/demon.png',
  gnoll: '/sprites/gnoll.png',
  items: '/sprites/items.png',
  king: '/sprites/king.png',
  mage: '/sprites/mage.png',
  rat: '/sprites/rat.png',
  shopkeeper: '/sprites/shopkeeper.png',
  skeleton: '/sprites/skeleton.png',
  slime: '/sprites/slime.png',
  spinner: '/sprites/spinner.png',
  tiles: '/sprites/tiles_caves.png',
  warlock: '/sprites/warlock.png',
  wraith: '/sprites/wraith.png',
};

const spriteImages: Map<string, HTMLImageElement> = new Map();

function loadAllSprites(): void {
  for (const [name, url] of Object.entries(SPRITE_SHEETS)) {
    const img = new Image();
    img.onload = () => spriteImages.set(name, img);
    img.onerror = () => console.warn(`[Sprites] Failed: ${url}`);
    img.src = url;
  }
}

loadAllSprites();

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

  constructor(canvas: HTMLCanvasElement) {
    canvas.width = CONFIG.COLS * CONFIG.TILE_SIZE;
    canvas.height = CONFIG.ROWS * CONFIG.TILE_SIZE;
    this.ctx = canvas.getContext('2d')!;
    this.particles = new ParticlePool(60);
    this.motes = Array.from({ length: 14 }, () => this.spawnMote(true));
    this.revealFrames = new Uint8Array(CONFIG.COLS * CONFIG.ROWS);
  }

  spawnParticle(gridX: number, gridY: number, text: string, color: string): void {
    this.particles.spawn(gridX, gridY, text, color);
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
    const entry = SPRITE_MAP[key];
    if (!entry || typeof entry !== 'object') return false;
    const coord = entry as SpriteCoord;
    if (!coord.sheet) return false;
    const img = spriteImages.get(coord.sheet);
    if (!img) return false;
    this.ctx.drawImage(img, coord.sx, coord.sy, coord.sw, coord.sh, dx, dy, dw, dh);
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

  start(game: Game): void {
    cancelAnimationFrame(this.rafId);
    const loop = (): void => {
      if (!game.active) return;
      try { this.draw(game); } catch (err) { console.error('[Renderer]', err); }
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
        const isMerchant = game.items.length >= 0 && this.isMerchantTile(game, x, y);

        if (!seen && !visible) {
          ctx.fillStyle = '#020204';
          ctx.fillRect(x * TS, y * TS, TS, TS);
          continue;
        }

        const idx = x * CONFIG.ROWS + y;
        if (visible && this.revealFrames[idx]! < FADE_FRAMES) this.revealFrames[idx]!++;
        const fadeFactor = visible ? Math.min(1, this.revealFrames[idx]! / FADE_FRAMES) : 1;
        const alpha = (visible ? 1.0 : 0.35) * fadeFactor;
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

          if (type === Tile.STAIRS) {
            if (visible) this.drawPulseGlow(x, y, '186,104,200');
            if (!this.drawSprite('STAIRS', x * TS, y * TS, TS, TS)) {
              ctx.font = `${TS * 0.7}px Arial`;
              ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
              ctx.fillText('🪜', x * TS + TS / 2, y * TS + TS / 2);
            }
          } else if (isMerchant) {
            if (visible) this.drawPulseGlow(x, y, '102,187,106');
            if (!this.drawSprite('🏪', x * TS, y * TS, TS, TS)) {
              ctx.font = `${TS * 0.7}px Arial`;
              ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
              ctx.fillText('🏪', x * TS + TS / 2, y * TS + TS / 2);
            }
          }
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
    for (let r = 0; r < game.blockMatrix.length; r++) {
      for (let c = 0; c < game.blockMatrix[r]!.length; c++) {
        const cell = game.blockMatrix[r]![c]!;
        if (cell === Cell.EMPTY) continue;
        const tx = game.blockX + c, ty = game.blockY + r;
        if (tx < 0 || tx >= CONFIG.COLS || ty < 0 || ty >= CONFIG.ROWS) continue;

        ctx.fillStyle = cell === Cell.BOMB ? '#ff6b35' : cell === Cell.MERCHANT ? '#1b5e20' : game.blockColor;
        ctx.fillRect(tx * TS, ty * TS, TS - 1, TS - 1);
        ctx.strokeStyle = cell === Cell.BOSS ? '#ff0000' : '#fff';
        ctx.lineWidth = cell === Cell.BOSS ? 2 : 1;
        ctx.strokeRect(tx * TS, ty * TS, TS, TS);
        ctx.lineWidth = 1;

        const emoji = CELL_EMOJI[cell];
        if (emoji) {
          const inset = 2;
          if (!this.drawSprite(emoji, tx * TS + inset, ty * TS + inset, TS - 2 * inset, TS - 2 * inset)) {
            ctx.fillText(emoji, tx * TS + TS / 2, ty * TS + TS / 2);
          }
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

    // ── Hazard overlays ───────────────────────────────────────────────────
    ctx.font = `${TS * 0.55}px Arial`;
    for (const h of game.hazards) {
      if (!game.visibility[h.x]?.[h.y]) continue;
      const hx = h.x * TS, hy = h.y * TS;
      if (h.type === 'spike') {
        ctx.globalAlpha = h.warning ? 0.6 : 0.25;
        ctx.fillStyle = h.warning ? '#ff1744' : '#ff9100';
        ctx.fillRect(hx, hy, TS - 1, TS - 1);
        ctx.globalAlpha = 0.9;
        ctx.fillText('⬆️', hx + TS / 2, hy + TS / 2);
        if (h.warning) {
          ctx.font = '5px monospace';
          ctx.fillStyle = '#ff1744';
          ctx.fillText(String(h.timer), hx + TS - 5, hy + 7);
          ctx.font = `${TS * 0.55}px Arial`;
        }
      } else if (h.type === 'smoke') {
        ctx.globalAlpha = 0.45;
        ctx.fillStyle = '#546e7a';
        ctx.fillRect(hx, hy, TS - 1, TS - 1);
        ctx.globalAlpha = 0.8;
        ctx.fillText('💨', hx + TS / 2, hy + TS / 2);
      } else if (h.type === 'teleport') {
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = '#7c4dff';
        ctx.fillRect(hx, hy, TS - 1, TS - 1);
        ctx.globalAlpha = 0.9;
        ctx.fillText('🌀', hx + TS / 2, hy + TS / 2);
      }
      ctx.globalAlpha = 1.0;
    }
    ctx.font = `${TS * 0.7}px Arial`;

    // ── Items (only if visible) ───────────────────────────────────────────
    for (const item of game.items) {
      if (!game.visibility[item.x]?.[item.y]) continue;
      if (item.type === 'relic') this.drawPulseGlow(item.x, item.y, '156,39,176');
      if (!this.drawSprite(item.char, item.x * TS, item.y * TS, TS, TS)) {
        ctx.fillText(item.char, item.x * TS + TS / 2, item.y * TS + TS / 2);
      }
    }

    // ── Monsters (only if visible) ────────────────────────────────────────
    for (const m of game.monsters) {
      if (!game.visibility[m.x]?.[m.y]) continue;
      if (!this.drawSprite(m.char, m.x * TS, m.y * TS, TS, TS)) {
        ctx.fillText(m.char, m.x * TS + TS / 2, m.y * TS + TS / 2);
      }

      if (m.statuses.length > 0) {
        ctx.font = '7px Arial';
        ctx.fillText('☠', m.x * TS + TS - 4, m.y * TS + 5);
        ctx.font = `${TS * 0.7}px Arial`;
      }

      if (m.isBoss) {
        const barW = TS - 2;
        const pct = m.hp / m.maxHp;
        ctx.fillStyle = '#333';
        ctx.fillRect(m.x * TS + 1, m.y * TS - 4, barW, 3);
        ctx.fillStyle = pct > 0.5 ? '#ef5350' : '#ff1744';
        ctx.fillRect(m.x * TS + 1, m.y * TS - 4, Math.floor(barW * pct), 3);
      }
    }

    // ── Player ────────────────────────────────────────────────────────────
    if (game.player.hp > 0) {
      ctx.font = `${TS * 0.7}px Arial`;

      const px = game.player.x * TS + TS / 2;
      const py = game.player.y * TS + TS / 2;
      const glow = ctx.createRadialGradient(px, py, 0, px, py, TS * 1.4);
      glow.addColorStop(0, 'rgba(102,187,106,0.38)');
      glow.addColorStop(1, 'rgba(102,187,106,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(game.player.x * TS - TS, game.player.y * TS - TS, TS * 3, TS * 3);

      if (!this.drawSprite(game.player.char, game.player.x * TS, game.player.y * TS, TS, TS)) {
        ctx.fillText(game.player.char, game.player.x * TS + TS / 2, game.player.y * TS + TS / 2);
      }

      if (game.player.statuses.length > 0) {
        const icons = game.player.statuses.map(s => s.type === 'poison' ? '☠' : '💫').join('');
        ctx.font = '7px Arial';
        ctx.fillStyle = '#9c27b0';
        ctx.fillText(icons, game.player.x * TS + TS / 2, game.player.y * TS - 3);
      }
    }

    // ── Particles ─────────────────────────────────────────────────────────
    this.particles.tick(ctx);

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

  public triggerDamageFlash(): void { this.damageFlashFrames = 8; }
  public triggerShake(intensity: number, duration: number): void {
    this.shakeIntensity = intensity;
    this.shakeFrames = duration;
  }

  private isMerchantTile(game: Game, x: number, y: number): boolean {
    return (game as unknown as { merchantTiles: Array<{ x: number; y: number }> })
      .merchantTiles.some((t: { x: number; y: number }) => t.x === x && t.y === y);
  }
}

const CELL_EMOJI: Partial<Record<number, string>> = {
  [Cell.MONSTER_RAT]:    '🐀',
  [Cell.MONSTER_SKEL]:   '💀',
  [Cell.MONSTER_ARCHER]: '👺',
  [Cell.MONSTER_SLIME]:  '🫧',
  [Cell.MONSTER_ORC]:    '👹',
  [Cell.MONSTER_BAT]:    '🦠',
  [Cell.ITEM_POTION]:    '🧪',
  [Cell.ITEM_SWORD]:     '🗡️',
  [Cell.STAIRS]:         '🪜',
  [Cell.BOMB]:           '💣',
  [Cell.MERCHANT]:       '🏪',
  [Cell.BOSS]:           '⚠️',
  [Cell.ITEM_EQUIPMENT]: '📦',
  [Cell.RELIC]:          '🔮',
  [Cell.TRAP_SPIKE]:     '⬆️',
  [Cell.TRAP_SMOKE]:     '💨',
  [Cell.TRAP_TELEPORT]:  '🌀',
};
