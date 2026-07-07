// Pure helpers for fatal-error handling — kept DOM-free so they're unit
// testable. main.ts wires these into the actual tick loop / render loop /
// window error events and the crash-recovery modal.

export interface CrashInfo {
  message: string;
  context: string;
}

export function formatCrashInfo(err: unknown, context: string): CrashInfo {
  const message = err instanceof Error ? err.message : String(err);
  return { message, context };
}

// One-shot latch so a burst of errors (e.g. a render error repeating every
// frame) only ever triggers the crash-recovery UI once, not once per frame.
let reported = false;

export function shouldReport(): boolean {
  if (reported) return false;
  reported = true;
  return true;
}

// Test-only reset (also handy if a future "dismiss and keep playing" flow is added).
export function resetCrashState(): void {
  reported = false;
}
