import { browser } from 'wxt/browser'

/**
 * Test-only overrides read from `browser.storage.local`. Every key here is
 * prefixed `__test` so it's unmistakably not a real user setting — never
 * part of `lib/settings.ts`'s `Settings` shape, never read or written by
 * the options page, and nothing in the extension's own UI ever sets one.
 * This is the first hook of this kind in the codebase — keep it that way
 * unless there's a comparably hard-to-avoid reason to add another (a real
 * device requirement Playwright genuinely can't fake any other way).
 *
 * Right now the only override: whether to enable the three-tap space
 * gesture even on a non-mobile platform (see
 * `lib/spaceGestureDetector.ts`'s `isSpaceGestureEnabled`) — the gesture is
 * deliberately mobile-only in production, but Playwright's e2e harness only
 * ever runs desktop Chromium (see `e2e/fixtures.ts`), so
 * `e2e/space-gesture.spec.ts` sets this key directly in the extension's own
 * storage before loading the test page — the same
 * `serviceWorker.evaluate(() => chrome.storage.local.set(...))` mechanism
 * `e2e/helpers.ts`'s `configureMockProvider` already uses for the (real)
 * `settings` blob, via `e2e/helpers.ts`'s own `enableSpaceGestureForTest`.
 */
const SPACE_GESTURE_TEST_OVERRIDE_KEY = '__test_spaceGestureEnabled'

/**
 * Exported so `e2e/helpers.ts` can write to the exact same key from the
 * Playwright/Node side (via `serviceWorker.evaluate`, which runs in the
 * extension's own context and can't import this module directly — the key
 * has to be passed across that boundary as a plain argument) without the
 * literal string being duplicated and risking drift between the two.
 */
export { SPACE_GESTURE_TEST_OVERRIDE_KEY }

/** Reads the current space-gesture test override — `false` (the safe, production-matching default) unless an e2e spec has explicitly set it. */
export async function getSpaceGestureTestOverride(): Promise<boolean> {
  const stored = await browser.storage.local.get(SPACE_GESTURE_TEST_OVERRIDE_KEY)
  return stored[SPACE_GESTURE_TEST_OVERRIDE_KEY] === true
}
