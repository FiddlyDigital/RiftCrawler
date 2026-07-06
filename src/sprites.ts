import spriteMapData from './data/sprite-map.json';
import type { SpriteCoord } from './types';

// Central sprite registry — shared by the canvas renderer and any HTML/UI
// code that needs an inline icon. Edit src/data/sprite-map.json to
// retarget or re-crop any icon; nothing here needs to change.
const { _comment: _unused, ...spriteMapEntries } = spriteMapData as Record<string, unknown>;
export const SPRITE_MAP = spriteMapEntries as Record<string, SpriteCoord>;

// Every sprite is cropped from one of these sheets — see src/data/sprite-map.json.
export const SPRITE_SHEETS: Record<string, string> = {
  monsters: '/sprites/monsters.png',
  rogues:   '/sprites/rogues.png',
  items:    '/sprites/items.png',
  tiles:    '/sprites/tiles.png',
};

const spriteImages: Map<string, HTMLImageElement> = new Map();

function loadAllSprites(): void {
  if (typeof Image === 'undefined') return;  // no DOM (e.g. running under node test environment)
  for (const [name, url] of Object.entries(SPRITE_SHEETS)) {
    const img = new Image();
    img.onload = () => spriteImages.set(name, img);
    img.onerror = () => console.warn(`[Sprites] Failed: ${url}`);
    img.src = url;
  }
}

loadAllSprites();

export function getSpriteImage(sheet: string): HTMLImageElement | undefined {
  return spriteImages.get(sheet);
}

// ── Inline HTML icons ──────────────────────────────────────────────────────
// Renders a sprite-map entry as a small <img> (data URL crop) so it can be
// dropped into any innerHTML string (log lines, buttons, badges, tooltips).
// Aspect ratio is preserved and centered within a `size`x`size` box.

const htmlIconCache: Map<string, string> = new Map();

export function spriteIconHTML(key: string, size = 14, className = 'sprite-icon'): string {
  const coord = SPRITE_MAP[key];
  if (!coord || typeof document === 'undefined') return '';
  const cacheKey = `${key}:${size}`;
  let dataUrl = htmlIconCache.get(cacheKey);
  if (!dataUrl) {
    const img = spriteImages.get(coord.sheet);
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
    htmlIconCache.set(cacheKey, dataUrl);
  }
  return `<img class="${className}" src="${dataUrl}" width="${size}" height="${size}" alt="" />`;
}

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]!);
}

// Renders a tetromino preview as a grid of colored squares (replaces the old
// colored-heart-emoji preview strings — the color already lives on the shape).
export function shapePreviewHTML(shape: { matrix: number[][]; color: string }, cellPx = 9): string {
  const rows = shape.matrix.map(row =>
    `<div style="display:flex;gap:1px;">${row.map(cell =>
      `<span style="width:${cellPx}px;height:${cellPx}px;background:${cell ? shape.color : 'transparent'};display:inline-block;"></span>`
    ).join('')}</div>`
  ).join('');
  return `<div style="display:flex;flex-direction:column;gap:1px;align-items:center;">${rows}</div>`;
}
