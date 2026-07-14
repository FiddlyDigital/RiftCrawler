import spriteMapData from './data/sprite-map.json';
import type { SpriteCoord } from './types';

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Small stateless string-escaping helpers shared by the UI layer. */
export class HtmlUtils {
  /**
   * Escapes the five HTML-significant characters in `text` so it's safe to
   * interpolate into an `innerHTML` string.
   * @param text - The raw text to escape.
   * @throws {TypeError} If `text` is not a string.
   */
  static escapeHtml(text: string): string {
    if (typeof text !== 'string') throw new TypeError(`HtmlUtils.escapeHtml: "text" must be a string, got ${typeof text}`);
    return text.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]!);
  }
}

/**
 * Central sprite registry — shared by the canvas renderer and any HTML/UI
 * code that needs an inline icon. Edit `src/data/sprite-map.json` to
 * retarget or re-crop any icon; nothing here needs to change.
 */
export class SpriteService {
  /** Every named sprite crop, keyed by icon key (e.g. `'sprite_player'`). */
  static readonly MAP: Record<string, SpriteCoord> = (() => {
    const { _comment: _unused, ...entries } = spriteMapData as Record<string, unknown>;
    return entries as Record<string, SpriteCoord>;
  })();

  /**
   * Every sprite sheet, keyed by sheet name — see `src/data/sprite-map.json`.
   * Paths are built from `BASE_URL` (not hardcoded `"/..."`) so they still
   * resolve correctly when served from a subpath, e.g. GitHub Pages project sites.
   */
  static readonly SHEETS: Record<string, string> = (() => {
    const base = import.meta.env.BASE_URL;
    return {
      monsters: `${base}sprites/monsters.png`,
      rogues:   `${base}sprites/rogues.png`,
      items:    `${base}sprites/items.png`,
      tiles:    `${base}sprites/tiles.png`,
    };
  })();

  private static readonly images: Map<string, HTMLImageElement> = new Map();
  private static readonly iconCache: Map<string, string> = new Map();

  private static loadAll(): void {
    if (typeof Image === 'undefined') return;  // no DOM (e.g. running under node test environment)
    for (const [name, url] of Object.entries(SpriteService.SHEETS)) {
      const img = new Image();
      img.onload = () => SpriteService.images.set(name, img);
      img.onerror = () => console.warn(`[Sprites] Failed: ${url}`);
      img.src = url;
    }
  }

  static {
    SpriteService.loadAll();
  }

  /**
   * Looks up a loaded sheet image by name (may still be mid-load, or absent
   * outside a browser — callers already treat `undefined` as "not ready yet").
   * @param sheet - Sheet name, e.g. `'monsters'`.
   * @throws {TypeError} If `sheet` is not a non-empty string.
   */
  static getImage(sheet: string): HTMLImageElement | undefined {
    if (typeof sheet !== 'string' || sheet.length === 0) {
      throw new TypeError('SpriteService.getImage: "sheet" must be a non-empty string');
    }
    return SpriteService.images.get(sheet);
  }

  /**
   * Renders a sprite-map entry as a small `<img>` (data-URL crop) so it can
   * be dropped into any `innerHTML` string (log lines, buttons, badges,
   * tooltips). Aspect ratio is preserved and centered within a `size`x`size` box.
   * @param key - Sprite-map key.
   * @param size - Rendered box size in pixels.
   * @param className - CSS class applied to the `<img>`.
   * @throws {TypeError} If `key` is not a non-empty string.
   */
  static iconHTML(key: string, size = 14, className = 'sprite-icon'): string {
    if (typeof key !== 'string' || key.length === 0) {
      throw new TypeError('SpriteService.iconHTML: "key" must be a non-empty string');
    }
    const coord = SpriteService.MAP[key];
    if (!coord || typeof document === 'undefined') return '';
    const cacheKey = `${key}:${size}`;
    let dataUrl = SpriteService.iconCache.get(cacheKey);
    if (!dataUrl) {
      const img = SpriteService.images.get(coord.sheet);
      if (!img || !img.complete || img.naturalWidth === 0) return '';
      const scale = Math.min(size / coord.sw, size / coord.sh);
      const dw = Math.max(1, Math.round(coord.sw * scale));
      const dh = Math.max(1, Math.round(coord.sh * scale));
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d')!;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, coord.sx, coord.sy, coord.sw, coord.sh, (size - dw) / 2, (size - dh) / 2, dw, dh);
      dataUrl = canvas.toDataURL();
      SpriteService.iconCache.set(cacheKey, dataUrl);
    }
    return `<img class="${className}" src="${dataUrl}" width="${size}" height="${size}" alt="" />`;
  }

  /**
   * Renders a tetromino preview as a grid of colored squares (the color
   * already lives on the shape, so this needs no sprite lookup).
   * @param shape - A shape's cell matrix and fill color.
   * @param cellPx - Pixel size of each grid cell.
   * @throws {TypeError} If `shape` is null/undefined.
   */
  static shapePreviewHTML(shape: { matrix: number[][]; color: string }, cellPx = 9): string {
    if (shape === null || shape === undefined) {
      throw new TypeError('SpriteService.shapePreviewHTML: "shape" must not be null/undefined');
    }
    const rows = shape.matrix.map(row =>
      `<div style="display:flex;gap:1px;">${row.map(cell =>
        `<span style="width:${cellPx}px;height:${cellPx}px;background:${cell ? shape.color : 'transparent'};display:inline-block;"></span>`
      ).join('')}</div>`
    ).join('');
    return `<div style="display:flex;flex-direction:column;gap:1px;align-items:center;">${rows}</div>`;
  }
}
