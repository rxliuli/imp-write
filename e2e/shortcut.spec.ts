import { test, expect } from './fixtures'
import { configureMockProvider, getMockRequests } from './helpers'

// Regression: an Alt-modified letter shortcut (e.g. Alt+T) used to leak a
// stray character into the field on some platforms because matchShortcut
// bailed out on `e.isComposing` — Option-modified keys on macOS can surface
// as mid-composition even though the character resolves atomically. See
// lib/shortcutHandler.ts's docstring. matchShortcut no longer checks
// isComposing; this asserts the fix holds end-to-end.
test('keyboard shortcut triggers a command without leaking extra characters (regression: Alt+T)', async ({
  context,
  baseURL,
}) => {
  await configureMockProvider(context, baseURL, { shortcuts: { tl: 'Alt+T' } })
  const page = await context.newPage()
  await page.goto(baseURL)

  const ta = page.locator('#ta')
  await ta.click()
  await ta.pressSequentially('bonjour le monde', { delay: 20 })

  await page.keyboard.press('Alt+t')

  await expect.poll(() => ta.inputValue(), { timeout: 5000 }).toContain('[MOCK]')

  const value = await ta.inputValue()
  // The stray character the regression used to leak.
  expect(value).not.toContain('†')
  expect(value).toContain('bonjour le monde')

  const { count } = await getMockRequests(baseURL)
  expect(count).toBe(1)
})

test('shortcut with an active selection replaces only the selection', async ({
  context,
  baseURL,
}) => {
  await configureMockProvider(context, baseURL, { shortcuts: { fix: 'Alt+F' } })
  const page = await context.newPage()
  await page.goto(baseURL)

  const ta = page.locator('#ta')
  await ta.click()
  await ta.fill('aaa bbb ccc')
  await ta.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(4, 7)) // "bbb"

  await page.keyboard.press('Alt+f')

  await expect.poll(() => ta.inputValue(), { timeout: 5000 }).toContain('[MOCK]')

  const value = await ta.inputValue()
  // The untouched-selection parts ("aaa " / " ccc") survive verbatim; only
  // the selected "bbb" was sent to the (mock) AI and replaced in place.
  // (The mock echoes the whole received prompt back, which itself embeds
  // "bbb" — the text the "fix" command was asked to fix — so "bbb"
  // reappearing inside the [MOCK] block is expected, not a leak of the
  // untouched original.)
  expect(value.startsWith('aaa [MOCK]')).toBe(true)
  expect(value.endsWith(' ccc')).toBe(true)
  expect(value).not.toBe('aaa bbb ccc')
  expect(value.match(/\[MOCK\]/g)?.length).toBe(1)

  const { count } = await getMockRequests(baseURL)
  expect(count).toBe(1)
})
