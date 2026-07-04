// Plausible Analytics integration. The script tag is included in index.html
// (commented out). Enable it by uncommenting and replacing 'your-domain.com'.
// All calls here are no-ops when Plausible is not loaded.

declare global {
  interface Window {
    plausible?: (event: string, opts?: { props?: Record<string, string | number> }) => void;
  }
}

export function trackEvent(name: string, props?: Record<string, string | number>): void {
  window.plausible?.(name, props ? { props } : undefined);
}

export function trackGameStart(floor: number): void {
  trackEvent('game_start', { floor });
}

export function trackGameOver(xp: number, floor: number): void {
  trackEvent('game_over', { xp, floor });
}

export function trackInstall(): void {
  trackEvent('pwa_install');
}
