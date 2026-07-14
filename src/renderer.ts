import { CONFIG } from './config';
import { TIER_COLORS } from './colors';
import { Tile, Cell } from './types';
import { ParticlePool } from './entities';
import { getBiomeForFloor, NPCS } from './content';
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

  // One-shot "juice" effects (all gated by reducedMotion at the trigger)
  private hitStopFrames = 0;
  private rowFlash: { ys: number[]; frames: number; maxFrames: number } | null = null;
  private rowSlide: { belowY: number; count: number; frames: number; maxFrames: number } | null = null;
  private dropTrails: Array<{ x: number; fromY: number; toY: number; color: string; frames: number; maxFrames: number }> = [];
  private deathFlashes: Array<{ x: number; y: number; char: string; frames: number; maxFrames: number }> = [];
  private rings: Array<{ x: number; y: number; rgb: string; frames: number; maxFrames: number }> = [];
  private beam: { x: number; frames: number; maxFrames: number } | null = null;
  private moteColor = '#cfc6b0';
  private readonly flashCanvas = document.createElement('canvas');  // scratch for white death-flash tinting
  // Logical (CSS-pixel) canvas size — everything in draw() is written in
  // these units. The actual backing buffer is sized in fitToDisplaySize() to
  // match the canvas's real on-screen size × devicePixelRatio, so sprites
  // render crisp instead of getting blurrily upscaled by the browser (mobile
  // "canvas maximization" can stretch the canvas 2-4× this logical size).
  private readonly logicalW = CONFIG.COLS * CONFIG.TILE_SIZE;
  private readonly logicalH = CONFIG.ROWS * CONFIG.TILE_SIZE;

  constructor(canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.particles = new ParticlePool(90);
    this.motes = Array.from({ length: 14 }, () => this.spawnMote(true));
    this.revealFrames = new Uint8Array(CONFIG.COLS * CONFIG.ROWS);
    // The canvas's own CSS box (width:auto;height:100%) derives its width
    // from ITS OWN aspect ratio — which is exactly the canvas.width/height
    // attributes fitToDisplaySize() is about to set. Observing (or reading
    // the rect of) the canvas itself is circular: resize the buffer, its
    // aspect ratio shifts a hair, its "auto" width recomputes, the observer
    // fires again — the browser eventually kills the tab-visible loop with
    // "ResizeObserver loop completed with undelivered notifications". The
    // container's HEIGHT is never derived from the canvas across any of
    // this app's layout breakpoints (always a `1fr`/`minmax(0,1fr)` grid
    // row), so that's the one dimension safe to measure and observe.
    const container = canvas.parentElement;
    this.fitToDisplaySize(canvas);
    if (container) new ResizeObserver(() => this.fitToDisplaySize(canvas)).observe(container);
  }

  // Matches the canvas's backing pixel buffer to its real displayed size ×
  // devicePixelRatio, then rescales the drawing context so every existing
  // TILE_SIZE-based draw call keeps working unmodified in the same logical
  // (0..logicalW / 0..logicalH) coordinate space.
  private fitToDisplaySize(canvas: HTMLCanvasElement): void {
    const container = canvas.parentElement;
    const dispH = container?.getBoundingClientRect().height ?? 0;
    if (dispH < 1) return;  // not laid out yet
    const dispW = dispH * (this.logicalW / this.logicalH);  // canvas is always height-driven — see constructor note

    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const w = Math.round(dispW * dpr);
    const h = Math.round(dispH * dpr);
    if (canvas.width === w && canvas.height === h) return;
    canvas.width = w;
    canvas.height = h;
    this.ctx.setTransform(w / this.logicalW, 0, 0, h / this.logicalH, 0, 0);
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

  // Freeze rendering for a couple of frames on big hits — classic impact trick.
  triggerHitStop(frames: number): void {
    if (this.reducedMotion) return;
    this.hitStopFrames = Math.max(this.hitStopFrames, frames);
  }

  // Cleared rows: white flash along the rows + everything above sliding down
  // into place, plus a sweep of spark particles across each row.
  triggerRowClear(rows: number[]): void {
    if (this.reducedMotion || rows.length === 0) return;
    this.rowFlash = { ys: [...rows], frames: 8, maxFrames: 8 };
    this.rowSlide = { belowY: Math.max(...rows), count: rows.length, frames: 5, maxFrames: 5 };
    for (const y of rows) {
      for (let x = 0; x < CONFIG.COLS; x++) {
        if (Math.random() < 0.7) {
          this.particles.spawn(
            x + Math.random() * 0.6, y, Math.random() < 0.5 ? '✦' : '·', '#ffe9b0', 9, '',
            (Math.random() - 0.5) * 1.6, -0.4 - Math.random() * 1.2, 0.92,
          );
        }
      }
    }
  }

  // Ghostly streaks along a hard drop's travel path.
  spawnDropTrail(columns: Array<{ x: number; fromY: number; toY: number }>, color: string): void {
    if (this.reducedMotion) return;
    for (const c of columns) {
      if (c.toY > c.fromY) this.dropTrails.push({ ...c, color, frames: 9, maxFrames: 9 });
    }
  }

  // A killed monster flashes white for a few frames instead of just vanishing.
  flashDeath(gx: number, gy: number, char: string): void {
    if (this.reducedMotion) return;
    this.deathFlashes.push({ x: gx, y: gy, char, frames: 5, maxFrames: 5 });
  }

  // Expanding ring pulse (ability flourishes: Time Dilation, Consecrate).
  triggerRing(gx: number, gy: number, rgb: string, frames = 22): void {
    if (this.reducedMotion) return;
    this.rings.push({ x: gx, y: gy, rgb, frames, maxFrames: frames });
  }

  // Vertical column of light on the player (level-ups).
  triggerBeam(gx: number, frames = 26): void {
    if (this.reducedMotion) return;
    this.beam = { x: gx, frames, maxFrames: frames };
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

  // Ambient "alive" aura + gentle idle bob — shared by the player, monsters,
  // wandering NPCs, and the tattoo artist, so anything you can interact with
  // reads as alive rather than a static tile icon. `phase` staggers the bob
  // so multiple instances on screen don't sway in perfect unison; `inset`
  // matches the smaller centered draw used for altar/NPC-style icons.
  // `twitch` adds a brief horizontal shiver every few seconds (monsters only)
  // so a crowd of idlers doesn't read as one synchronized metronome.
  private drawLivingSprite(char: string, gx: number, gy: number, rgb: string, phase = 0, inset = 0, twitch = false): void {
    const TS = CONFIG.TILE_SIZE;
    const idleBob = Math.sin(performance.now() / 500 + phase) * 1.5;
    let jitterX = 0;
    if (twitch && !this.reducedMotion) {
      const t = performance.now() / 1000 + phase;
      const cycle = t % 3.7;
      if (cycle < 0.22) jitterX = Math.sin(cycle * 60) * 1.2;
    }
    const px = gx * TS + TS / 2, py = gy * TS + TS / 2 + idleBob;
    const glow = this.ctx.createRadialGradient(px, py, 0, px, py, TS * 1.4);
    glow.addColorStop(0, `rgba(${rgb},0.38)`);
    glow.addColorStop(1, `rgba(${rgb},0)`);
    this.ctx.fillStyle = glow;
    this.ctx.fillRect(gx * TS - TS, gy * TS - TS, TS * 3, TS * 3);
    this.drawSprite(char, gx * TS + inset + jitterX, gy * TS + inset + idleBob, TS - 2 * inset, TS - 2 * inset);
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

    // Hit-stop: hold the previous frame on screen for a beat.
    if (this.hitStopFrames > 0) { this.hitStopFrames--; return; }

    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, this.logicalW, this.logicalH);

    if (game.dungeonLevel !== this.lastDungeonLevel) {
      this.revealFrames.fill(0);
      this.lastDungeonLevel = game.dungeonLevel;
      this.floorTransitionFrames = 30;
      const biome = getBiomeForFloor(game.dungeonLevel);
      this.floorTransitionColor = biome.tileRgb || '10,10,20';
      this.moteColor = biome.moteColor || '#cfc6b0';
    }

    // ── Screen shake + line-clear settle ─────────────────────────────────
    // The settle is a brief downward camera drop as cleared rows collapse —
    // sells the weight of the clear without re-simulating pre-shift rows.
    ctx.save();
    if (this.shakeFrames > 0) {
      ctx.translate(
        (Math.random() - 0.5) * this.shakeIntensity * 2,
        (Math.random() - 0.5) * this.shakeIntensity * 2,
      );
      this.shakeFrames--;
    }
    if (this.rowSlide) {
      const t = this.rowSlide.frames / this.rowSlide.maxFrames;
      ctx.translate(0, -this.rowSlide.count * TS * t * t * 0.55);
      this.rowSlide.frames--;
      if (this.rowSlide.frames <= 0) this.rowSlide = null;
    }

    // ── Damage flash overlay ──────────────────────────────────────────────
    if (this.damageFlashFrames > 0) {
      ctx.fillStyle = 'rgba(220,20,20,0.22)';
      ctx.fillRect(0, 0, this.logicalW, this.logicalH);
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
          // Stone-block base (alternating crop for non-repeating texture),
          // then the tetromino's own color as a translucent wash on top —
          // keeps piece-color identity readable while the stone's cracks
          // and shading show through underneath.
          this.drawSprite((x + y) % 2 === 0 ? 'tile_stone_a' : 'tile_stone_b', x * TS, y * TS, TS, TS);
          ctx.globalAlpha = alpha * 0.6;
          ctx.fillStyle = isMerchant ? '#0d2d0d' : (game.colors[x]![y] ?? '#444');
          ctx.fillRect(x * TS, y * TS, TS - 1, TS - 1);
          ctx.globalAlpha = alpha;
          ctx.strokeStyle = 'rgba(0,0,0,0.2)';
          ctx.strokeRect(x * TS, y * TS, TS, TS);

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

    // ── Cleared-row white flash ───────────────────────────────────────────
    if (this.rowFlash) {
      const a = 0.5 * (this.rowFlash.frames / this.rowFlash.maxFrames);
      ctx.fillStyle = `rgba(255,244,214,${a})`;
      for (const y of this.rowFlash.ys) ctx.fillRect(0, y * TS, CONFIG.COLS * TS, TS);
      this.rowFlash.frames--;
      if (this.rowFlash.frames <= 0) this.rowFlash = null;
    }

    // ── Hard-drop afterimage streaks ─────────────────────────────────────
    for (let i = this.dropTrails.length - 1; i >= 0; i--) {
      const t = this.dropTrails[i]!;
      const a = 0.22 * (t.frames / t.maxFrames);
      const grad = ctx.createLinearGradient(0, t.fromY * TS, 0, (t.toY + 1) * TS);
      grad.addColorStop(0, 'rgba(255,255,255,0)');
      grad.addColorStop(1, t.color);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.fillStyle = grad;
      ctx.fillRect(t.x * TS + 2, t.fromY * TS, TS - 4, (t.toY - t.fromY + 1) * TS);
      ctx.restore();
      t.frames--;
      if (t.frames <= 0) this.dropTrails.splice(i, 1);
    }

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

        // Same stone-base + color-wash treatment as locked blocks, so the
        // falling piece and the trail it leaves behind read as one material.
        this.drawSprite((tx + ty) % 2 === 0 ? 'tile_stone_a' : 'tile_stone_b', tx * TS, ty * TS, TS, TS);
        ctx.globalAlpha = 0.6;
        ctx.fillStyle = cell === Cell.MERCHANT ? '#1b0535' : cell === Cell.ALTAR ? '#1a0a2a' : cell === Cell.NPC ? '#182418' : game.blockColor;
        ctx.fillRect(tx * TS, ty * TS, TS - 1, TS - 1);
        ctx.globalAlpha = 1.0;
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

    // ── Special tile overlays (swamp / sacred / ice) ─────────────────────
    // Drawn BEFORE the tile-feature glyphs below (stairs/merchant/altar/NPC)
    // so an entity standing on one of these terrain tiles is never painted
    // over by the terrain's own overlay.
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
    // Also drawn before tile-feature glyphs, for the same reason — a trap
    // tile must never paint over an NPC/altar/merchant standing on it.
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

    // ── Tile-feature glyphs (stairs / tattoo artist / altar / NPCs) ────────
    // Drawn AFTER the falling block + ghost (so a descending piece can never
    // hide the feature underneath it) and AFTER the special-tile/hazard
    // overlays above (so an NPC standing on a swamp/ice/trap tile is never
    // hidden beneath that tile's own overlay) — the player always sees what's
    // on a tile, and who's standing on it.
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    for (let x = 0; x < CONFIG.COLS; x++) {
      for (let y = 0; y < CONFIG.ROWS; y++) {
        const visible = game.visibility[x]![y]!;
        if (!visible && !game.explored[x]![y]!) continue;
        const type = game.map[x]![y]!;
        const isMerchant = this.isMerchantTile(game, x, y);
        const altar = this.getAltarAt(game, x, y);
        const npcHere = game.npcTiles.find(n => n.x === x && n.y === y);
        if (type !== Tile.STAIRS && !isMerchant && !altar && !npcHere) continue;

        ctx.globalAlpha = visible ? 1.0 : 0.5;
        if (type === Tile.STAIRS) {
          if (visible) this.drawPulseGlow(x, y, '168,132,184');
          this.drawSprite('tile_stairs', x * TS, y * TS, TS, TS);
        } else if (isMerchant) {
          if (visible) this.drawLivingSprite('tile_merchant', x, y, '217,164,65', x * 7 + y * 13);
          else this.drawSprite('tile_merchant', x * TS, y * TS, TS, TS);
        } else if (altar) {
          if (visible) {
            this.drawPulseGlow(x, y, TIER_COLORS[altar.tier].rgb);
          }
          const inset = TS * 0.1;
          this.drawSprite('tile_altar', x * TS + inset, y * TS + inset, TS - 2 * inset, TS - 2 * inset);
        } else if (npcHere) {
          const isGhost = npcHere.npcId === '__ghost__';
          const char = isGhost ? 'sprite_boss_wraith' : (NPCS.find(n => n.id === npcHere.npcId)?.char ?? 'npc_fili');
          const inset = TS * 0.1;
          if (isGhost) ctx.globalAlpha *= 0.75;  // translucent — it isn't quite here
          if (visible) this.drawLivingSprite(char, x, y, isGhost ? '176,196,222' : '89,159,124', x * 7 + y * 13, inset);
          else this.drawSprite(char, x * TS + inset, y * TS + inset, TS - 2 * inset, TS - 2 * inset);
        }
        ctx.globalAlpha = 1.0;
      }
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
        (game.player.veiledTurns <= 0 || m.isGorgoth) &&
        (Math.abs(m.x - game.player.x) + Math.abs(m.y - game.player.y)) <= m.attackRange;
      if (threatening) {
        this.drawPulseGlow(m.x, m.y, '198,58,50');
        ctx.font = '9px Arial';
        ctx.fillStyle = '#d9695c';
        ctx.fillText('‼', m.x * TS + 5, m.y * TS + 5);
        ctx.font = `${TS * 0.7}px Arial`;
      }

      this.drawLivingSprite(m.char, m.x, m.y, '198,58,50', m.x * 7 + m.y * 13, 0, true);

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

    // ── Death flashes — a killed monster burns white for a beat ──────────
    for (let i = this.deathFlashes.length - 1; i >= 0; i--) {
      const d = this.deathFlashes[i]!;
      this.drawWhiteSprite(d.char, d.x * TS, d.y * TS, TS, TS, 0.9 * (d.frames / d.maxFrames));
      d.frames--;
      if (d.frames <= 0) this.deathFlashes.splice(i, 1);
    }

    // ── Player ────────────────────────────────────────────────────────────
    if (game.player.hp > 0) {
      ctx.font = `${TS * 0.7}px Arial`;

      // Féth Fíada: translucent, wrapped in sea-mist instead of the hero green
      const veiled = game.player.veiledTurns > 0;
      if (veiled) ctx.globalAlpha = 0.55;
      this.drawLivingSprite(game.player.char, game.player.x, game.player.y, veiled ? '63,158,147' : '102,187,106');
      ctx.globalAlpha = 1.0;

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

    // ── Expanding ability rings (Time Dilation, Consecrate) ─────────────
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i]!;
      const t = 1 - r.frames / r.maxFrames;
      const radius = TS * (0.6 + t * 4.5);
      ctx.save();
      ctx.globalAlpha = 0.55 * (r.frames / r.maxFrames);
      ctx.strokeStyle = `rgb(${r.rgb})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(r.x * TS + TS / 2, r.y * TS + TS / 2, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      r.frames--;
      if (r.frames <= 0) this.rings.splice(i, 1);
    }

    // ── Level-up column of light ─────────────────────────────────────────
    if (this.beam) {
      const a = 0.4 * (this.beam.frames / this.beam.maxFrames);
      const bx = this.beam.x * TS;
      const grad = ctx.createLinearGradient(bx, 0, bx + TS, 0);
      grad.addColorStop(0, 'rgba(217,164,65,0)');
      grad.addColorStop(0.5, `rgba(255,228,150,${a})`);
      grad.addColorStop(1, 'rgba(217,164,65,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(bx - TS * 0.2, 0, TS * 1.4, this.logicalH);
      this.beam.frames--;
      if (this.beam.frames <= 0) this.beam = null;
    }

    // ── Particles ─────────────────────────────────────────────────────────
    this.particles.tick(ctx);

    // ── Edge vignettes: critical HP (oxblood) and Bres's presence ───────
    const hpFrac = game.player.maxHp > 0 ? game.player.hp / game.player.maxHp : 1;
    if (game.player.hp > 0 && hpFrac < 0.3) {
      this.drawVignette(`193,68,60`, 0.16 + 0.07 * Math.sin(performance.now() / 350));
    }
    if (game.gorgothSummoned) {
      this.drawVignette(`52,30,74`, 0.30 + 0.05 * Math.sin(performance.now() / 900));
    }

    // ── Combo overlay ─────────────────────────────────────────────────────
    if (this.comboOverlay) {
      const { text, alpha, mult } = this.comboOverlay;
      const cw = this.logicalW, ch = this.logicalH;
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
      ctx.fillRect(0, 0, this.logicalW, this.logicalH);
    }

    // ── Floor transition flash ────────────────────────────────────────────
    if (this.floorTransitionFrames > 0) {
      const flashAlpha = (this.floorTransitionFrames / 30) * 0.88;
      ctx.fillStyle = `rgba(${this.floorTransitionColor},${flashAlpha})`;
      ctx.fillRect(0, 0, this.logicalW, this.logicalH);
      this.floorTransitionFrames--;
    }

    // ── Low-HP vignette ──────────────────────────────────────────────────
    if (game.player.hp > 0 && game.player.hp / game.player.maxHp <= 0.25) {
      const pulse = 0.35 + 0.25 * Math.sin(performance.now() / 300);
      const w = this.logicalW, h = this.logicalH;
      const vignette = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
      vignette.addColorStop(0, 'rgba(180,0,0,0)');
      vignette.addColorStop(1, `rgba(180,0,0,${pulse})`);
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, w, h);
    }

    // ── Pause overlay ─────────────────────────────────────────────────────
    if (game.paused && game.player.hp > 0) {
      const W = this.logicalW, H = this.logicalH;
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
    ctx.fillStyle = this.moteColor;
    for (const m of this.motes) {
      ctx.globalAlpha = m.alpha;
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // Edge-darkening ring in the given rgb — center stays clear.
  private drawVignette(rgb: string, alpha: number): void {
    const { ctx } = this;
    const W = this.logicalW, H = this.logicalH;
    const grad = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.45, W / 2, H / 2, Math.max(W, H) * 0.72);
    grad.addColorStop(0, `rgba(${rgb},0)`);
    grad.addColorStop(1, `rgba(${rgb},${Math.max(0, alpha)})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
  }

  // Draws a sprite silhouetted in white via a scratch canvas (death flash).
  private drawWhiteSprite(key: string, dx: number, dy: number, dw: number, dh: number, alpha: number): void {
    const coord = SPRITE_MAP[key];
    if (!coord || !coord.sheet) return;
    const img = getSpriteImage(coord.sheet);
    if (!img) return;
    const fc = this.flashCanvas;
    fc.width = coord.sw; fc.height = coord.sh;  // setting size also clears
    const fctx = fc.getContext('2d')!;
    fctx.drawImage(img, coord.sx, coord.sy, coord.sw, coord.sh, 0, 0, coord.sw, coord.sh);
    fctx.globalCompositeOperation = 'source-in';
    fctx.fillStyle = '#ffffff';
    fctx.fillRect(0, 0, fc.width, fc.height);
    fctx.globalCompositeOperation = 'source-over';
    const scale = Math.min(dw / coord.sw, dh / coord.sh);
    const fw = coord.sw * scale, fh = coord.sh * scale;
    this.ctx.save();
    this.ctx.globalAlpha = Math.max(0, alpha);
    this.ctx.drawImage(fc, dx + (dw - fw) / 2, dy + (dh - fh) / 2, fw, fh);
    this.ctx.restore();
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
  [Cell.NPC]:            'npc_sidhe',
  [Cell.TRAP_SPIKE]:     'trap_spike',
  [Cell.TRAP_SMOKE]:     'trap_smoke',
  [Cell.TRAP_TELEPORT]:  'trap_teleport',
};
