import type { BrowserContext } from '@playwright/test'
import { BUILTIN_COMMANDS } from '../lib/commands'
import type { Command } from '../lib/settings'
import { SPACE_GESTURE_TEST_OVERRIDE_KEY } from '../lib/testHooks'

export async function getServiceWorker(context: BrowserContext) {
  let [sw] = context.serviceWorkers()
  if (!sw) sw = await context.waitForEvent('serviceworker')
  return sw
}

/**
 * Points the extension's BYOK provider at the mock server and (optionally)
 * overrides the command table/shortcuts. Settings shape mirrors
 * lib/settings.ts's `Settings` exactly — a partial/malformed shape would
 * just silently fall back to `DEFAULT_SETTINGS` via `mergeSettings`, hiding
 * bugs instead of exercising them.
 *
 * Defaults `commands` to `BUILTIN_COMMANDS` (with `commandsSeeded: true`) —
 * there's no separate read-only built-in table at runtime any more (see
 * `Settings.commands`'s doc comment), so writing `commands: []` here would
 * leave the extension with no commands at all and every scenario relying on
 * `/fix` et al. would simply never trigger.
 *
 * Writes, then verifies the write actually stuck, retrying if not: on a
 * completely fresh profile, `background.ts`'s own unconditional startup
 * `rebuildContextMenus()` call also calls `getSettings()`, which — the very
 * first time storage is read while still empty — now seeds `BUILTIN_COMMANDS`
 * and writes that back too (see `migrateSettings`). That one-time write races
 * this one; whichever `storage.local.set` lands last wins, and losing that
 * race would silently strip the provider/shortcuts this just set.
 */
export async function configureMockProvider(
  context: BrowserContext,
  baseURL: string,
  overrides: {
    commands?: Command[]
    shortcuts?: Record<string, string>
    // Defaults to 'byok'. 'imp' points `provider.imp` at the mock server
    // instead (still filling in `provider.byok` with its usual mock
    // defaults, matching a real settings blob where both can be populated
    // at once — see lib/settings.ts's `ProviderSettings`) — used by
    // error-paths.spec.ts's imp-mode 402/401 scenarios.
    mode?: 'byok' | 'imp'
  } = {},
) {
  const sw = await getServiceWorker(context)
  const mode = overrides.mode ?? 'byok'
  const byok = {
    baseUrl: `${baseURL}/v1`,
    apiKey: 'test-key',
    model: 'mock',
  }
  const provider =
    mode === 'imp'
      ? {
          mode: 'imp' as const,
          imp: {
            apiKey: 'imp_test-key',
            baseUrl: `${baseURL}/v1`,
            model: 'mock',
          },
          byok,
        }
      : {
          mode: 'byok' as const,
          byok,
        }
  const settings = {
    provider,
    commands: overrides.commands ?? BUILTIN_COMMANDS,
    commandsSeeded: true,
    shortcuts: overrides.shortcuts ?? {},
  }

  for (let attempt = 0; attempt < 10; attempt++) {
    await sw.evaluate(async (s) => {
      await chrome.storage.local.set({ settings: s })
    }, settings)
    // Give any in-flight racing write (see doc comment above) a chance to
    // land, then check whether ours is still the one on disk.
    await new Promise((resolve) => setTimeout(resolve, 50))
    const stuck = await sw.evaluate(async (expected) => {
      const stored = (await chrome.storage.local.get('settings')).settings as
        | {
            provider?: {
              mode?: string
              byok?: { baseUrl?: string }
              imp?: { baseUrl?: string }
            }
          }
        | undefined
      if (expected.mode === 'imp') {
        return (
          stored?.provider?.mode === 'imp' &&
          stored?.provider?.imp?.baseUrl === expected.baseUrl
        )
      }
      return (
        stored?.provider?.mode === 'byok' &&
        stored?.provider?.byok?.baseUrl === expected.baseUrl
      )
    }, { mode, baseUrl: mode === 'imp' ? provider.imp!.baseUrl : byok.baseUrl })
    if (stuck) return
  }
  throw new Error(
    'configureMockProvider: settings write did not stick after retrying',
  )
}

export async function getMockRequests(
  baseURL: string,
): Promise<{ count: number; requests: { body: any; receivedAt: number }[] }> {
  const res = await fetch(`${baseURL}/mock/requests`)
  return res.json()
}

/**
 * Holds every subsequent mock `/v1/chat/completions` response open for `ms`
 * milliseconds, so a test can act (e.g. switch tabs) while the write-back is
 * still pending.
 */
export async function setMockDelay(baseURL: string, ms: number): Promise<void> {
  await fetch(`${baseURL}/mock/delay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ms }),
  })
}

/**
 * Makes every subsequent mock `/v1/chat/completions` call fail with `status`
 * until `resetMock` is called — see e2e/server.ts's `/mock/fail`. `body`
 * defaults to a shape mirroring the real imp-credits/BYOK provider response
 * for that status; only the status code is ever asserted on by
 * `lib/ai-client.ts`'s `humanizeError`, so most callers don't need to pass
 * one.
 */
export async function setMockFail(
  baseURL: string,
  status: 402 | 401 | 429 | 500,
  body?: Record<string, unknown>,
): Promise<void> {
  await fetch(`${baseURL}/mock/fail`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ? { status, body } : { status }),
  })
}

/**
 * Clears both the request log and any `setMockFail` state (see
 * e2e/server.ts's `/mock/reset` — it does not touch `setMockDelay`'s state).
 * Not strictly required for isolation between tests in the same spec file —
 * the `baseURL` fixture starts a fresh mock server per test (see
 * e2e/fixtures.ts) — but scenarios call it anyway at the end so a future
 * fixture-scope change (e.g. to a worker-scoped server) doesn't silently
 * leak failure modes across tests.
 */
export async function resetMock(baseURL: string): Promise<void> {
  await fetch(`${baseURL}/mock/reset`, { method: 'POST' })
}

/**
 * Sets the test-only override that makes the three-tap space gesture
 * (`lib/spaceGestureDetector.ts`'s `isSpaceGestureEnabled`) behave as if
 * this were a mobile platform — Playwright's `context` fixture (see
 * `e2e/fixtures.ts`) always launches desktop Chromium, and the gesture is
 * deliberately mobile-only in production (see that function's doc
 * comment), so without this override `e2e/space-gesture.spec.ts` would
 * have no way to exercise the gesture path at all. Writes directly to the
 * same `browser.storage.local` the extension itself reads
 * (`lib/testHooks.ts`'s `getSpaceGestureTestOverride`), via the same
 * `serviceWorker.evaluate` mechanism `configureMockProvider` above uses for
 * the real `settings` blob — the key itself is imported from
 * `lib/testHooks.ts` rather than duplicated as a literal string here, so
 * the two sides can never drift apart.
 */
export async function enableSpaceGestureForTest(context: BrowserContext): Promise<void> {
  const sw = await getServiceWorker(context)
  await sw.evaluate(async (key) => {
    await chrome.storage.local.set({ [key]: true })
  }, SPACE_GESTURE_TEST_OVERRIDE_KEY)
}
