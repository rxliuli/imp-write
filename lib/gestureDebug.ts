import { browser } from 'wxt/browser'

// Storage flag to force gesture debug logging on a *production* build, where
// `import.meta.env.DEV` is `false` (Vite inlines it). Not part of `Settings`
// — read straight from `browser.storage.local`, the same convention as
// `lib/testHooks.ts`'s test-override keys, so it can't leak into a user's
// real settings blob. Set it from the service worker console while debugging
// on a real device:
//
//   chrome.storage.local.set({ __impWriteGestureDebug: true })
//
// The whole module is a dev-only aid; the `gestureDebug` calls are pure
// `console.debug` (invisible at the default log level) and a no-op when
// disabled, so a production build at worst omits them.
const GESTURE_DEBUG_KEY = '__impWriteGestureDebug'

let enabled = import.meta.env.DEV
let initialized = false

/**
 * Reads the debug flag from storage exactly once. Called at content-script
 * init, before any gesture can possibly fire (the gesture isn't armed until
 * `setupSpaceGesture` runs, which is after this resolves). A storage read
 * failure just leaves us on the `import.meta.env.DEV` gate.
 */
export async function initGestureDebug(): Promise<void> {
  if (initialized) return
  initialized = true
  try {
    const stored = await browser.storage.local.get(GESTURE_DEBUG_KEY)
    if (stored[GESTURE_DEBUG_KEY] === true) enabled = true
  } catch {
    // Non-fatal — stay on the DEV gate.
  }
}

/** Debug-only logger for the space-gesture path. No-op unless enabled. */
export function gestureDebug(...args: unknown[]): void {
  if (!enabled) return
  console.debug('[imp-write/gesture]', ...args)
}
