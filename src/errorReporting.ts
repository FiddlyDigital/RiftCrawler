/**
 * Fatal-error handling helpers — kept DOM-free so they're unit testable.
 * `main.ts` wires these into the actual tick loop / render loop / window
 * error events and the crash-recovery modal.
 */

/** A normalized, loggable summary of a caught error. */
export interface CrashInfo {
  /** Human-readable error message. */
  message: string;
  /** Where the error was caught (e.g. `'render'`, `'tick'`). */
  context: string;
}

export class CrashReporter {
  // One-shot latch so a burst of errors (e.g. a render error repeating every
  // frame) only ever triggers the crash-recovery UI once, not once per frame.
  private static reported = false;

  /**
   * Normalizes a caught value (which may not even be an `Error`) into a
   * loggable {@link CrashInfo}.
   * @param err - The caught value, of unknown shape.
   * @param context - Where the error was caught.
   * @throws {TypeError} If `context` is not a non-empty string.
   */
  static formatCrashInfo(err: unknown, context: string): CrashInfo {
    if (typeof context !== 'string' || context.length === 0) {
      throw new TypeError('CrashReporter.formatCrashInfo: "context" must be a non-empty string');
    }
    const message = err instanceof Error ? err.message : String(err);
    return { message, context };
  }

  /**
   * Whether the crash-recovery UI should fire for the current error — true
   * only the first time it's called since the last {@link reset}.
   */
  static shouldReport(): boolean {
    if (CrashReporter.reported) return false;
    CrashReporter.reported = true;
    return true;
  }

  /** Clears the one-shot latch (test-only; also useful for a future "dismiss and keep playing" flow). */
  static reset(): void {
    CrashReporter.reported = false;
  }
}
