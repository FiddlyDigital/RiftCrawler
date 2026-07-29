import { GameConfig } from './config';
import { SpriteService } from './sprites';

/**
 * Render-layer particle system: floating damage numbers, heal ticks and burst
 * motes drawn straight onto the game canvas.
 *
 * This lives outside the simulation on purpose. `Particle.draw()` takes a
 * `CanvasRenderingContext2D` and resolves sprite atlas coordinates, so it is
 * pure presentation — swapping the renderer means replacing this file, not
 * touching `Game`. Only `renderer.ts` consumes it.
 */
/**
 * A poolable floating-text/icon particle (damage numbers, heal ticks, crit
 * bursts). `reset()` replaces `new()` when recycled from a {@link ParticlePool}
 * to avoid GC pressure.
 */
export class Particle {
  private x = 0;
  private y = 0;
  private text = '';
  private icon = '';
  private color = '';
  /** Fraction of lifetime remaining, `1` (just spawned) down to `<= 0` (recyclable). Read by `ParticlePool.tick()` to know when to recycle. */
  life = 0;
  private fontSize = 13;
  private vx = 0;
  private vy = -0.7;
  /** `1` = no decay (today's constant-rise drift); `< 1` = outward-then-settle for bursts. */
  private drag = 1;

  /** Reinitializes a recycled (or fresh) particle in place. */
  reset(
    gridX: number, gridY: number, text: string, color: string, fontSize = 13, icon = '',
    vx = 0, vy = -0.7, drag = 1,
  ): void {
    this.x = gridX * GameConfig.TILE_SIZE + GameConfig.TILE_SIZE / 2 + (Math.random() - 0.5) * GameConfig.TILE_SIZE * 0.4;
    this.y = gridY * GameConfig.TILE_SIZE + GameConfig.TILE_SIZE / 4 + Math.random() * GameConfig.TILE_SIZE * 0.3;
    this.text = text;
    this.icon = icon;
    this.color = color;
    this.life = 1.0;
    this.fontSize = fontSize;
    this.vx = vx;
    this.vy = vy;
    this.drag = drag;
  }

  /** Advances one animation frame: position, velocity decay, and lifetime countdown. */
  update(): void {
    this.x += this.vx;
    this.y += this.vy;
    this.vx *= this.drag;
    this.vy *= this.drag;
    this.life -= 0.04;
  }

  /** Draws the particle's current frame (icon and/or text, with pop-in scale and a stroke outline). */
  draw(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.globalAlpha = this.life;
    // Pop-in: spawn at ~1.5× size and settle over the first few frames, so
    // damage numbers (and burst motes) punch instead of drifting into view.
    const pop = 1 + 0.55 * Math.max(0, (this.life - 0.78) / 0.22);
    const size = Math.round(this.fontSize * pop);
    ctx.font = `bold ${size}px monospace`;
    const tw = this.text ? ctx.measureText(this.text).width : 0;
    const iconSize = this.icon ? size : 0;
    const totalW = tw + (this.icon && this.text ? iconSize + 2 : iconSize);
    let cursorX = this.x - totalW / 2;

    if (this.icon) {
      const coord = SpriteService.MAP[this.icon];
      const img = coord && SpriteService.getImage(coord.sheet);
      if (img) {
        const scale = Math.min(iconSize / coord.sw, iconSize / coord.sh);
        const iw = coord.sw * scale, ih = coord.sh * scale;
        ctx.drawImage(img, coord.sx, coord.sy, coord.sw, coord.sh, cursorX, this.y - ih / 2 - size * 0.15, iw, ih);
      }
      cursorX += iconSize + (this.text ? 2 : 0);
    }

    if (this.text) {
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.strokeText(this.text, cursorX, this.y);
      ctx.fillStyle = this.color;
      ctx.fillText(this.text, cursorX, this.y);
    }
    ctx.restore();
  }
}

/** Fixed-capacity object pool of {@link Particle}s, recycled to avoid per-frame GC churn. */
export class ParticlePool {
  private pool: Particle[] = [];
  private active: Particle[] = [];

  /** @throws {TypeError} If `size` is not a finite number. */
  constructor(size = 60) {
    if (typeof size !== 'number' || !Number.isFinite(size)) throw new TypeError('ParticlePool: "size" must be a finite number');
    for (let i = 0; i < size; i++) this.pool.push(new Particle());
  }

  /** Spawns a single particle (damage number, heal tick, etc.), reusing a pooled instance when available. */
  spawn(gridX: number, gridY: number, text: string, color: string, fontSize = 13, icon = '', vx = 0, vy = -0.7, drag = 1): void {
    const p = this.pool.pop() ?? new Particle();
    p.reset(gridX, gridY, text, color, fontSize, icon, vx, vy, drag);
    this.active.push(p);
  }

  /**
   * Radial burst: `count` icon/dot particles fly outward from the tile then
   * settle (drag < 1), for high-impact moments (crits, kills, level-ups, ...).
   */
  spawnBurst(gridX: number, gridY: number, count: number, color: string, icon = '', fontSize = 10): void {
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.6;
      const speed = 0.5 + Math.random() * 0.7;
      const p = this.pool.pop() ?? new Particle();
      p.reset(gridX, gridY, '', color, fontSize, icon, Math.cos(angle) * speed, Math.sin(angle) * speed, 0.90);
      this.active.push(p);
    }
  }

  /** Advances and draws every active particle for one frame, recycling any that have expired. */
  tick(ctx: CanvasRenderingContext2D): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const p = this.active[i]!;
      p.update();
      p.draw(ctx);
      if (p.life <= 0) this.pool.push(this.active.splice(i, 1)[0]!);
    }
  }
}
