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
    this.particles = new ParticlePool(60);
  }

  spawnParticle(gridX: number, gridY: number, text: string, color: string): void {
    this.particles.spawn(gridX, gridY, text, color);
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
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    // ── Map tiles with fog of war ─────────────────────────────────────────
    for (let x = 0; x < CONFIG.COLS; x++) {
      for (let y = 0; y < CONFIG.ROWS; y++) {
        const visible = game.visibility[x]![y]!;
        const seen = game.explored[x]![y]!;
        const type = game.map[x]![y]!;
        const isMerchant = game.items.length >= 0 && this.isMerchantTile(game, x, y);

        if (!seen && !visible) {
          // Never explored — deep void
          ctx.fillStyle = '#020204';
          ctx.fillRect(x * TS, y * TS, TS, TS);
          continue;
        }

        const alpha = visible ? 1.0 : 0.35;
        ctx.globalAlpha = alpha;

        if (type === Tile.FLOOR || type === Tile.STAIRS || isMerchant) {
          ctx.fillStyle = isMerchant ? '#0d2d0d' : (game.colors[x]![y] ?? '#444');
          ctx.fillRect(x * TS, y * TS, TS - 1, TS - 1);
          ctx.strokeStyle = 'rgba(0,0,0,0.2)';
          ctx.strokeRect(x * TS, y * TS, TS, TS);

          if (type === Tile.STAIRS) {
            ctx.font = `${TS * 0.7}px Arial`;
            ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
            ctx.fillText('🪜', x * TS + TS / 2, y * TS + TS / 2);
          } else if (isMerchant) {
            ctx.font = `${TS * 0.7}px Arial`;
            ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
            ctx.fillText('🏪', x * TS + TS / 2, y * TS + TS / 2);
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
        if (emoji) ctx.fillText(emoji, tx * TS + TS / 2, ty * TS + TS / 2);
      }
    }

    // ── Items (only if visible) ───────────────────────────────────────────
    for (const item of game.items) {
      if (!game.visibility[item.x]?.[item.y]) continue;
      ctx.fillText(item.char, item.x * TS + TS / 2, item.y * TS + TS / 2);
    }

    // ── Monsters (only if visible) ────────────────────────────────────────
    for (const m of game.monsters) {
      if (!game.visibility[m.x]?.[m.y]) continue;
      ctx.fillText(m.char, m.x * TS + TS / 2, m.y * TS + TS / 2);

      // Status indicator above monster
      if (m.statuses.length > 0) {
        ctx.font = '7px Arial';
        ctx.fillText('☠', m.x * TS + TS - 4, m.y * TS + 5);
        ctx.font = `${TS * 0.7}px Arial`;
      }

      // Mini HP bar for bosses
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
      ctx.fillText(game.player.char, game.player.x * TS + TS / 2, game.player.y * TS + TS / 2);

      // Status indicators on player
      if (game.player.statuses.length > 0) {
        const icons = game.player.statuses.map(s => s.type === 'poison' ? '☠' : '💫').join('');
        ctx.font = '7px Arial';
        ctx.fillStyle = '#9c27b0';
        ctx.fillText(icons, game.player.x * TS + TS / 2, game.player.y * TS - 3);
      }
    }

    // ── Particles ─────────────────────────────────────────────────────────
    this.particles.tick(ctx);
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
};
