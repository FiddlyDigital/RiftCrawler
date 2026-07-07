// Thin wrapper around the Vibration API. Silently no-ops on browsers/devices
// that don't support it (iOS Safari, desktop) — never throws, never checked
// by callers. Gated by the same "reduced motion" setting as particle effects
// since both are sensory-intensity accessibility knobs.

let enabled = true;

export function setHapticsEnabled(on: boolean): void {
  enabled = on;
}

export function vibrate(pattern: number | number[]): void {
  if (!enabled) return;
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  navigator.vibrate(pattern);
}
