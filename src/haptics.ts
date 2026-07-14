/**
 * Thin wrapper around the Vibration API. Silently no-ops on browsers/devices
 * that don't support it (iOS Safari, desktop) — callers never need to check
 * support themselves. Gated by the same "reduced motion" setting as particle
 * effects, since both are sensory-intensity accessibility knobs.
 */
export class HapticsController {
  private static enabled = true;

  /**
   * Enables or disables all future {@link vibrate} calls (a no-op toggle,
   * used to honor the reduced-motion preference).
   * @param on - Whether haptics should fire.
   * @throws {TypeError} If `on` is not a boolean.
   */
  static setEnabled(on: boolean): void {
    if (typeof on !== 'boolean') throw new TypeError(`HapticsController.setEnabled: "on" must be a boolean, got ${typeof on}`);
    HapticsController.enabled = on;
  }

  /**
   * Fires a device vibration pattern. No-ops if haptics are disabled or the
   * Vibration API isn't available on this device.
   * @param pattern - A single duration in ms, or an alternating vibrate/pause
   * duration array, per the Vibration API.
   * @throws {TypeError} If `pattern` is not a finite number or an array of finite numbers.
   */
  static vibrate(pattern: number | number[]): void {
    const isValidNumber = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
    const isValid = isValidNumber(pattern) || (Array.isArray(pattern) && pattern.every(isValidNumber));
    if (!isValid) throw new TypeError('HapticsController.vibrate: "pattern" must be a finite number or an array of finite numbers');

    if (!HapticsController.enabled) return;
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
    navigator.vibrate(pattern);
  }
}
