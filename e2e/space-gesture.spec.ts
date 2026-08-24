import { test, expect } from './fixtures'
import { configureMockProvider, enableSpaceGestureForTest, getMockRequests } from './helpers'
import type { Command } from '../lib/settings'

// Same rationale as e2e/idle-trigger.spec.ts: the gesture only arms on real
// keystrokes (`insertText` input events with `data === ' '`) — pressSequentially
// produces those; `fill()` does not, and would never trigger anything. See
// lib/spaceGestureDetector.ts's docstring.

const MENU_HOST = '#imp-write-command-menu-host'
// Playwright's default CSS engine pierces open shadow roots automatically,
// so this reaches the buttons `lib/commandMenu.ts` renders inside its
// `attachShadow({ mode: 'open' })` root without any extra chaining.
const FIX_BUTTON = `${MENU_HOST} button:text-is("/fix")`
const MENU_LIST = `${MENU_HOST} .imp-write-menu-list`
// Settings is now a gear icon in the menu header (no longer a full-width
// footer row) — an inlined SVG button keyed by its aria-label, since the
// SVG carries no text content. See `lib/commandMenu.ts`'s `buildMenuElement`.
const SETTINGS_BUTTON = `${MENU_HOST} button[aria-label="Settings"]`

test('three real spaces at the end of a field summons the command menu', async ({
  context,
  baseURL,
}) => {
  await configureMockProvider(context, baseURL)
  // Desktop Chromium (what Playwright always launches — see
  // e2e/fixtures.ts) never satisfies `isSpaceGestureEnabled`'s mobile
  // check on its own; this test-only override (see lib/testHooks.ts) is
  // what lets the gesture actually fire here. The one deliberate exception
  // is the "disabled by default on desktop" negative case below, which
  // omits this call on purpose.
  await enableSpaceGestureForTest(context)
  const page = await context.newPage()
  await page.goto(baseURL)

  const ta = page.locator('#ta')
  await ta.click()
  await ta.pressSequentially('hello world', { delay: 20 })
  await ta.pressSequentially('   ', { delay: 20 })

  await expect(page.locator(MENU_HOST)).toBeVisible()
  await expect(page.locator(FIX_BUTTON)).toBeVisible()

  // The gesture only summons the menu — it never touches the text or runs
  // anything on its own.
  expect(await ta.inputValue()).toBe('hello world   ')
  const { count } = await getMockRequests(baseURL)
  expect(count).toBe(0)
})

test('picking a command from the gesture menu runs it and strips the trailing gesture spaces from the AI prompt', async ({
  context,
  baseURL,
}) => {
  await configureMockProvider(context, baseURL)
  // Desktop Chromium (what Playwright always launches — see
  // e2e/fixtures.ts) never satisfies `isSpaceGestureEnabled`'s mobile
  // check on its own; this test-only override (see lib/testHooks.ts) is
  // what lets the gesture actually fire here. The one deliberate exception
  // is the "disabled by default on desktop" negative case below, which
  // omits this call on purpose.
  await enableSpaceGestureForTest(context)
  const page = await context.newPage()
  await page.goto(baseURL)

  const ta = page.locator('#ta')
  await ta.click()
  await ta.pressSequentially('hello world', { delay: 20 })
  await ta.pressSequentially('   ', { delay: 20 })

  await expect(page.locator(FIX_BUTTON)).toBeVisible()
  await page.locator(FIX_BUTTON).click()

  await expect(page.locator(MENU_HOST)).toBeHidden()
  await expect.poll(() => ta.inputValue(), { timeout: 5000 }).toContain('[MOCK]')

  const { count, requests } = await getMockRequests(baseURL)
  expect(count).toBe(1)
  const content: string = requests[0]!.body.messages[0].content
  // The three gesture spaces never reached the AI prompt...
  expect(content).not.toContain('hello world   ')
  // ...but the real content did, immediately followed by nothing (the
  // built-in "fix" command's template ends right at `{{text}}`).
  expect(content.endsWith('hello world')).toBe(true)
})

test('continuing to type after the gesture menu opens closes it without running anything', async ({
  context,
  baseURL,
}) => {
  await configureMockProvider(context, baseURL)
  // Desktop Chromium (what Playwright always launches — see
  // e2e/fixtures.ts) never satisfies `isSpaceGestureEnabled`'s mobile
  // check on its own; this test-only override (see lib/testHooks.ts) is
  // what lets the gesture actually fire here. The one deliberate exception
  // is the "disabled by default on desktop" negative case below, which
  // omits this call on purpose.
  await enableSpaceGestureForTest(context)
  const page = await context.newPage()
  await page.goto(baseURL)

  const ta = page.locator('#ta')
  await ta.click()
  await ta.pressSequentially('hello world', { delay: 20 })
  await ta.pressSequentially('   ', { delay: 20 })

  await expect(page.locator(MENU_HOST)).toBeVisible()

  await ta.pressSequentially('!', { delay: 20 })

  await expect(page.locator(MENU_HOST)).toBeHidden()
  expect(await ta.inputValue()).toBe('hello world   !')
  const { count } = await getMockRequests(baseURL)
  expect(count).toBe(0)
})

test('three spaces in an otherwise-empty field does not summon the menu', async ({
  context,
  baseURL,
}) => {
  await configureMockProvider(context, baseURL)
  // Desktop Chromium (what Playwright always launches — see
  // e2e/fixtures.ts) never satisfies `isSpaceGestureEnabled`'s mobile
  // check on its own; this test-only override (see lib/testHooks.ts) is
  // what lets the gesture actually fire here. The one deliberate exception
  // is the "disabled by default on desktop" negative case below, which
  // omits this call on purpose.
  await enableSpaceGestureForTest(context)
  const page = await context.newPage()
  await page.goto(baseURL)

  const ta = page.locator('#ta')
  await ta.click()
  await ta.pressSequentially('   ', { delay: 20 })

  await page.waitForTimeout(500)
  await expect(page.locator(MENU_HOST)).toHaveCount(0)
})

test('clicking outside the gesture menu closes it without running anything (regression: caret-anchored desktop positioning)', async ({
  context,
  baseURL,
}) => {
  await configureMockProvider(context, baseURL)
  // Desktop Chromium (what Playwright always launches — see
  // e2e/fixtures.ts) never satisfies `isSpaceGestureEnabled`'s mobile
  // check on its own; this test-only override (see lib/testHooks.ts) is
  // what lets the gesture actually fire here. The one deliberate exception
  // is the "disabled by default on desktop" negative case below, which
  // omits this call on purpose.
  await enableSpaceGestureForTest(context)
  const page = await context.newPage()
  await page.goto(baseURL)

  const ta = page.locator('#ta')
  await ta.click()
  await ta.pressSequentially('hello world', { delay: 20 })
  await ta.pressSequentially('   ', { delay: 20 })

  await expect(page.locator(MENU_HOST)).toBeVisible()

  await page.mouse.click(5, 5)

  await expect(page.locator(MENU_HOST)).toBeHidden()
  const { count } = await getMockRequests(baseURL)
  expect(count).toBe(0)
})

test('using a command moves it to the front the next time any command menu opens (MRU)', async ({
  context,
  baseURL,
}) => {
  await configureMockProvider(context, baseURL)
  // Desktop Chromium (what Playwright always launches — see
  // e2e/fixtures.ts) never satisfies `isSpaceGestureEnabled`'s mobile
  // check on its own; this test-only override (see lib/testHooks.ts) is
  // what lets the gesture actually fire here. The one deliberate exception
  // is the "disabled by default on desktop" negative case below, which
  // omits this call on purpose.
  await enableSpaceGestureForTest(context)
  const page = await context.newPage()
  await page.goto(baseURL)

  const ta = page.locator('#ta')
  await ta.click()
  await ta.pressSequentially('hello world', { delay: 20 })
  await ta.pressSequentially('   ', { delay: 20 })

  // Initial order matches BUILTIN_COMMANDS (settings order): fix first.
  // Select the first *command* item, not the first <button> — the header
  // Settings gear is now a button too and sits before the command list.
  const firstButtonText = () =>
    page.locator(`${MENU_HOST} .imp-write-menu-item`).first().textContent()
  await expect.poll(firstButtonText).toBe('/fix')

  // Pick the last command ("tl") instead of the first.
  await page.locator(`${MENU_HOST} button:text-is("/tl")`).click()
  await expect.poll(() => ta.inputValue(), { timeout: 5000 }).toContain('[MOCK]')

  // Summon the menu again — "tl" should now sort ahead of "fix".
  await ta.pressSequentially(' more text', { delay: 20 })
  await ta.pressSequentially('   ', { delay: 20 })

  await expect(page.locator(MENU_HOST)).toBeVisible()
  await expect.poll(firstButtonText).toBe('/tl')
})

// Regression: typing a command token right before the gesture (e.g.
// "hello /fix   ") used to leave the idle-pause detector armed and counting
// down *underneath* the just-opened menu — after ~300ms it would silently
// run "/fix" on its own, overwriting the field and closing the menu before
// the user ever got to actually choose from it. `isCandidate` (content.ts)
// now bails out whenever `commandMenu.isOpen`, which `IdleTriggerDetector`
// re-checks immediately before firing — so nothing should happen here even
// well past the 300ms idle window.
test('a command token right before the gesture does not let the idle-pause trigger fire while the menu is open (regression)', async ({
  context,
  baseURL,
}) => {
  await configureMockProvider(context, baseURL)
  // Desktop Chromium (what Playwright always launches — see
  // e2e/fixtures.ts) never satisfies `isSpaceGestureEnabled`'s mobile
  // check on its own; this test-only override (see lib/testHooks.ts) is
  // what lets the gesture actually fire here. The one deliberate exception
  // is the "disabled by default on desktop" negative case below, which
  // omits this call on purpose.
  await enableSpaceGestureForTest(context)
  const page = await context.newPage()
  await page.goto(baseURL)

  const ta = page.locator('#ta')
  await ta.click()
  await ta.pressSequentially('hello /fix', { delay: 20 })
  await ta.pressSequentially('   ', { delay: 20 })

  await expect(page.locator(MENU_HOST)).toBeVisible()

  await page.waitForTimeout(400)

  // Still open, nothing ran on its own, and the field is untouched.
  await expect(page.locator(MENU_HOST)).toBeVisible()
  expect(await ta.inputValue()).toBe('hello /fix   ')
  const { count } = await getMockRequests(baseURL)
  expect(count).toBe(0)
})

// An accidental extra space tap right after the gesture opens the menu (the
// "fat-fingered a 4th space" case) is absorbed rather than treated like any
// other new input — the menu stays open, and the extra space is stripped
// from the AI prompt just like the original 3.
test('an extra same-rhythm space tap after the gesture menu opens is absorbed, not closed', async ({
  context,
  baseURL,
}) => {
  await configureMockProvider(context, baseURL)
  // Desktop Chromium (what Playwright always launches — see
  // e2e/fixtures.ts) never satisfies `isSpaceGestureEnabled`'s mobile
  // check on its own; this test-only override (see lib/testHooks.ts) is
  // what lets the gesture actually fire here. The one deliberate exception
  // is the "disabled by default on desktop" negative case below, which
  // omits this call on purpose.
  await enableSpaceGestureForTest(context)
  const page = await context.newPage()
  await page.goto(baseURL)

  const ta = page.locator('#ta')
  await ta.click()
  await ta.pressSequentially('hello world', { delay: 20 })
  await ta.pressSequentially('   ', { delay: 20 })

  // Wait for the menu to actually be showing (confirms `CommandMenu`'s own
  // `beforeinput` listener — which the absorption decision routes through
  // — is attached) before sending the extra tap, so this test is about the
  // absorption logic itself, not a race with the menu's own async
  // `show()` work.
  await expect(page.locator(MENU_HOST)).toBeVisible()

  // A 4th space, right after, in the same rhythm.
  await ta.pressSequentially(' ', { delay: 20 })
  await expect(page.locator(MENU_HOST)).toBeVisible()
  expect(await ta.inputValue()).toBe('hello world    ')

  await page.locator(FIX_BUTTON).click()
  await expect.poll(() => ta.inputValue(), { timeout: 5000 }).toContain('[MOCK]')

  const { count, requests } = await getMockRequests(baseURL)
  expect(count).toBe(1)
  const content: string = requests[0]!.body.messages[0].content
  // No trailing spaces at all leaked into the prompt — all 4 were stripped.
  expect(content.endsWith('hello world')).toBe(true)
  expect(content).not.toMatch(/ $/)
})

// The explicit boundary the absorption behavior draws: it only covers
// same-*rhythm* extra taps, not "no space can ever close this menu again".
// A space typed well after the gesture's own rhythm window has elapsed —
// the user looked at the menu, paused, then pressed space — is ordinary new
// input and closes the menu exactly like any other keystroke would.
test('a space typed well after the gesture menu opened (outside the rhythm window) closes it like any other input', async ({
  context,
  baseURL,
}) => {
  await configureMockProvider(context, baseURL)
  // Desktop Chromium (what Playwright always launches — see
  // e2e/fixtures.ts) never satisfies `isSpaceGestureEnabled`'s mobile
  // check on its own; this test-only override (see lib/testHooks.ts) is
  // what lets the gesture actually fire here. The one deliberate exception
  // is the "disabled by default on desktop" negative case below, which
  // omits this call on purpose.
  await enableSpaceGestureForTest(context)
  const page = await context.newPage()
  await page.goto(baseURL)

  const ta = page.locator('#ta')
  await ta.click()
  await ta.pressSequentially('hello world', { delay: 20 })
  await ta.pressSequentially('   ', { delay: 20 })

  await expect(page.locator(MENU_HOST)).toBeVisible()

  // Comfortably past SPACE_GESTURE_MAX_GAP_MS (600ms).
  await page.waitForTimeout(800)
  await ta.pressSequentially(' ', { delay: 20 })

  await expect(page.locator(MENU_HOST)).toBeHidden()
  const { count } = await getMockRequests(baseURL)
  expect(count).toBe(0)
})

// "Mashing the space bar a few extra times" — every tap in the same rhythm
// (each within 600ms of the previous one) is absorbed, not just a single
// extra one.
test('several extra same-rhythm space taps in a row are all absorbed', async ({
  context,
  baseURL,
}) => {
  await configureMockProvider(context, baseURL)
  // Desktop Chromium (what Playwright always launches — see
  // e2e/fixtures.ts) never satisfies `isSpaceGestureEnabled`'s mobile
  // check on its own; this test-only override (see lib/testHooks.ts) is
  // what lets the gesture actually fire here. The one deliberate exception
  // is the "disabled by default on desktop" negative case below, which
  // omits this call on purpose.
  await enableSpaceGestureForTest(context)
  const page = await context.newPage()
  await page.goto(baseURL)

  const ta = page.locator('#ta')
  await ta.click()
  await ta.pressSequentially('hello world', { delay: 20 })
  await ta.pressSequentially('   ', { delay: 20 })
  await expect(page.locator(MENU_HOST)).toBeVisible()

  // Two more extra taps (5 total real spaces), each well within the
  // rhythm window of the previous one.
  await ta.pressSequentially('  ', { delay: 20 })

  await expect(page.locator(MENU_HOST)).toBeVisible()
  expect(await ta.inputValue()).toBe('hello world     ')

  await page.locator(FIX_BUTTON).click()
  await expect.poll(() => ta.inputValue(), { timeout: 5000 }).toContain('[MOCK]')

  const { requests } = await getMockRequests(baseURL)
  const content: string = requests[0]!.body.messages[0].content
  expect(content.endsWith('hello world')).toBe(true)
  expect(content).not.toMatch(/ $/)
})

// Regression/negative case for the platform gate itself
// (`isSpaceGestureEnabled` — see lib/spaceGestureDetector.ts): deliberately
// does *not* call `enableSpaceGestureForTest`, so this exercises the exact
// production default on desktop Chromium. Markdown authors routinely type
// 3+ consecutive spaces (indenting a code block) without ever meaning to
// summon a command menu — this is why the gesture is mobile-only at all.
test('three real spaces does not summon the command menu on desktop by default (no test override)', async ({
  context,
  baseURL,
}) => {
  await configureMockProvider(context, baseURL)
  const page = await context.newPage()
  await page.goto(baseURL)

  const ta = page.locator('#ta')
  await ta.click()
  await ta.pressSequentially('hello world', { delay: 20 })
  await ta.pressSequentially('   ', { delay: 20 })

  await page.waitForTimeout(500)
  await expect(page.locator(MENU_HOST)).toHaveCount(0)
  expect(await ta.inputValue()).toBe('hello world   ')
  const { count } = await getMockRequests(baseURL)
  expect(count).toBe(0)
})

// Usability regression for a menu with dozens of commands (lib/commandMenu.ts's
// `.imp-write-menu-list`): before this, the menu had no max-height and no
// internal scroll area, so a long command list ran off the bottom of the
// viewport — the trailing commands (and the Settings entry, then a footer
// row) were simply unreachable. Now the list is capped to `MAX_VISIBLE_COMMANDS`
// rows and scrolls internally, and Settings lives in the header so it never
// scrolls out of reach. It also relied on a capture-phase `window` scroll
// listener to dismiss the menu, which (pre-fix) would close it the moment
// the list itself was scrolled.
test('with dozens of commands, the menu stays usable: Settings stays reachable and scrolling the list does not close it', async ({
  context,
  baseURL,
}) => {
  const manyCommands: Command[] = Array.from({ length: 30 }, (_, i) => ({
    name: `cmd${i}`,
    prompt: `Do something with {{text}} (${i})`,
  }))
  await configureMockProvider(context, baseURL, { commands: manyCommands })
  // See the other scenarios' identical comment above — this override is
  // what lets the gesture fire on Playwright's desktop Chromium at all.
  await enableSpaceGestureForTest(context)
  const page = await context.newPage()
  await page.goto(baseURL)

  const ta = page.locator('#ta')
  await ta.click()
  await ta.pressSequentially('hello world', { delay: 20 })
  await ta.pressSequentially('   ', { delay: 20 })

  const menuHost = page.locator(MENU_HOST)
  await expect(menuHost).toBeVisible()

  // The Settings gear is pinned in the header (not the scrollable command
  // list), so it stays within the viewport regardless of how long the list
  // above it is.
  const settingsButton = page.locator(SETTINGS_BUTTON)
  await expect(settingsButton).toBeVisible()
  const viewport = page.viewportSize()!
  const settingsBox = (await settingsButton.boundingBox())!
  expect(settingsBox.y).toBeGreaterThanOrEqual(0)
  expect(settingsBox.y + settingsBox.height).toBeLessThanOrEqual(viewport.height)

  // Scrolling inside the command list must not dismiss the menu. Polled
  // rather than read once — the wheel event's resulting scroll isn't
  // guaranteed to have landed by the time `mouse.wheel` resolves.
  const list = page.locator(MENU_LIST)
  await list.hover()
  await page.mouse.wheel(0, 400)
  await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
  await expect(menuHost).toBeVisible()
})
