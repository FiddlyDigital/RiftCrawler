import { CONFIG } from './config';

export class Player {
  x: number;
  y: number;
  readonly char = '🧙‍♂️';
  hp: number;
  maxHp: number;
  atk: number;

  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
    this.hp = 35;
    this.maxHp = 35;
    this.atk = 6;
  }

  heal(amount: number): number {
    const prev = this.hp;
    this.hp = Math.min(this.maxHp, this.hp + amount);
    return this.hp - prev;
  }

  takeDamage(amount: number): number {
    this.hp = Math.max(0, this.hp - amount);
    return amount;
  }
}

export class Monster {
  constructor(
    public x: number,
    public y: number,
    public readonly char: string,
    public readonly name: string,
    public hp: number,
    public readonly maxHp: number,
    public readonly atk: number,
  ) {}
}

export class Item {
  constructor(
    public x: number,
    public y: number,
    public readonly char: string,
    public readonly name: string,
    public readonly type: 'heal' | 'stat',
    public readonly statValue: number,
  ) {}
}

// Poolable particle — reset() replaces new() to avoid GC pressure
export class Particle {
  x = 0;
  y = 0;
  text = '';
  color = '';
  life = 0;

  reset(gridX: number, gridY: number, text: string, color: string): void {
    this.x = gridX * CONFIG.TILE_SIZE + CONFIG.TILE_SIZE / 2;
    this.y = gridY * CONFIG.TILE_SIZE + CONFIG.TILE_SIZE / 2;
    this.text = text;
    this.color = color;
    this.life = 1.0;
  }

  update(): void {
    this.y -= 0.5;
    this.life -= 0.05;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.globalAlpha = this.life;
    ctx.fillStyle = this.color;
    ctx.font = 'bold 9px monospace';
    ctx.fillText(this.text, this.x - ctx.measureText(this.text).width / 2, this.y);
    ctx.restore();
  }
}

export class ParticlePool {
  private pool: Particle[] = [];
  private active: Particle[] = [];

  constructor(size = 50) {
    for (let i = 0; i < size; i++) {
      this.pool.push(new Particle());
    }
  }

  spawn(gridX: number, gridY: number, text: string, color: string): void {
    const p = this.pool.pop() ?? new Particle();
    p.reset(gridX, gridY, text, color);
    this.active.push(p);
  }

  tick(ctx: CanvasRenderingContext2D): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const p = this.active[i]!;
      p.update();
      p.draw(ctx);
      if (p.life <= 0) {
        this.pool.push(this.active.splice(i, 1)[0]!);
      }
    }
  }
}
