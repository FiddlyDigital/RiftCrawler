import { CONFIG } from './config';
import { Tile, Cell } from './types';
import { ParticlePool } from './entities';
import type { Game } from './game';

export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly particles: ParticlePool;
  private rafId = 0;

  constructor(canvas: HTMLCanvasElement) {
    canvas.width = CONFIG.COLS * CONFIG.TILE_SIZE;
    canvas.height = CONFIG.ROWS * CONFIG.TILE_SIZE;
    this.ctx = canvas.getContext('2d')!;
    this.particles = new ParticlePool(50);
  }

  spawnParticle(gridX: number, gridY: number, text: string, color: string): void {
    this.particles.spawn(gridX, gridY, text, color);
  }

  start(game: Game): void {
    cancelAnimationFrame(this.rafId);
    const loop = (): void => {
      if (!game.active) return;
      try {
        this.draw(game);
      } catch (err) {
        console.error('[Renderer] draw error:', err);
      }
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  private draw(game: Game): void {
    const { ctx } = this;
    const TS = CONFIG.TILE_SIZE;

    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.fillStyle = '#030305';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    // Map tiles
    for (let x = 0; x < CONFIG.COLS; x++) {
      for (let y = 0; y < CONFIG.ROWS; y++) {
        const type = game.map[x]![y]!;
        if (type === Tile.FLOOR || type === Tile.STAIRS) {
          ctx.fillStyle = game.colors[x]![y] ?? '#444';
          ctx.fillRect(x * TS, y * TS, TS - 1, TS - 1);
          ctx.strokeStyle = 'rgba(0,0,0,0.2)';
          ctx.strokeRect(x * TS, y * TS, TS, TS);
          if (type === Tile.STAIRS) {
            ctx.font = `${TS * 0.7}px Arial`;
            ctx.textBaseline = 'middle';
            ctx.textAlign = 'center';
            ctx.fillText('🪜', x * TS + TS / 2, y * TS + TS / 2);
          }
        } else {
          ctx.fillStyle = '#06060a';
          ctx.fillRect(x * TS, y * TS, TS, TS);
          ctx.strokeStyle = '#0d0d14';
          ctx.strokeRect(x * TS, y * TS, TS, TS);
        }
      }
    }

    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.font = `${TS * 0.7}px Arial`;

    // Active falling block
    for (let r = 0; r < game.blockMatrix.length; r++) {
      for (let c = 0; c < game.blockMatrix[r]!.length; c++) {
        const cell = game.blockMatrix[r]![c]!;
        if (cell === Cell.EMPTY) continue;
        const tx = game.blockX + c;
        const ty = game.blockY + r;
        if (tx < 0 || tx >= CONFIG.COLS || ty < 0 || ty >= CONFIG.ROWS) continue;

        ctx.fillStyle = game.blockColor;
        ctx.fillRect(tx * TS, ty * TS, TS - 1, TS - 1);
        ctx.strokeStyle = '#fff';
        ctx.strokeRect(tx * TS, ty * TS, TS, TS);

        const emoji = CELL_EMOJI[cell];
        if (emoji) ctx.fillText(emoji, tx * TS + TS / 2, ty * TS + TS / 2);
      }
    }

    // Floor items
    for (const item of game.items) {
      ctx.fillText(item.char, item.x * TS + TS / 2, item.y * TS + TS / 2);
    }

    // Monsters
    for (const m of game.monsters) {
      ctx.fillText(m.char, m.x * TS + TS / 2, m.y * TS + TS / 2);
    }

    // Player
    if (game.player.hp > 0) {
      ctx.fillText(game.player.char, game.player.x * TS + TS / 2, game.player.y * TS + TS / 2);
    }

    // Particles (pool-managed)
    this.particles.tick(ctx);
  }
}

const CELL_EMOJI: Partial<Record<number, string>> = {
  [Cell.MONSTER_RAT]: '🐀',
  [Cell.MONSTER_SKEL]: '💀',
  [Cell.ITEM_POTION]: '🧪',
  [Cell.ITEM_SWORD]: '🗡️',
  [Cell.STAIRS]: '🪜',
};
