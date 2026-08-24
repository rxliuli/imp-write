// Always-on logger for the space-gesture path — used during active
// debugging to capture exactly where the flow stops (whether the content
// script injected, whether listeners were attached, the shape of each
// input event, and every guard that early-returns). `console.log` (not
// `console.debug`) so it's visible at the default log level and can be
// copied straight out of the Console panel.
//
// TEMP: this is intentionally un-gated right now so a device test shows the
// logs. Gate it (or delete the calls) before a real release.
export function gestureDebug(...args: unknown[]): void {
  console.log('[imp-write/gesture]', ...args)
}

/**
 * Kept as a no-op so the `initGestureDebug()` call site in content.ts stays
 * valid; the logs are always on, so there's nothing to initialize. (If a
 * gate is added back later, this is where the storage flag read would go.)
 */
export async function initGestureDebug(): Promise<void> {
  // no-op
}
