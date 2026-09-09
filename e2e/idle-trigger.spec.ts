import { test, expect } from './fixtures'
import { configureMockProvider, getMockRequests } from './helpers'

// IdleTriggerDetector only arms on real keystrokes (`insertText` input
// events) — `pressSequentially` produces those; `fill()` does not, and would
// never trigger anything under the "arm" model. See
// lib/IdleTriggerDetector.ts's docstring.

test('pausing after typing a command token replaces the field (idle trigger, full chain)', async ({
  context,
  baseURL,
}) => {
  await configureMockProvider(context, baseURL)
  const page = await context.newPage()
  await page.goto(baseURL)

  const ta = page.locator('#ta')
  await ta.click()
  await ta.pressSequentially('hello world /fix', { delay: 20 })

  await expect.poll(() => ta.inputValue(), { timeout: 5000 }).toContain('[MOCK]')

  const value = await ta.inputValue()
  expect(value).not.toContain('/fix')

  const { count } = await getMockRequests(baseURL)
  expect(count).toBe(1)
})

// Regression: a user-initiated native undo (Cmd/Ctrl+Z) restores the
// pre-replacement text — which still ends in the command token — but must
// not re-arm/re-trigger the detector. `historyUndo` input events
// unconditionally disarm (lib/IdleTriggerDetector.ts).
test('Cmd/Ctrl+Z undo does not re-trigger the command (regression)', async ({
  context,
  baseURL,
}) => {
  await configureMockProvider(context, baseURL)
  const page = await context.newPage()
  await page.goto(baseURL)

  const ta = page.locator('#ta')
  await ta.click()
  await ta.pressSequentially('hello world /fix', { delay: 20 })
  await expect.poll(() => ta.inputValue(), { timeout: 5000 }).toContain('[MOCK]')

  await page.keyboard.press('ControlOrMeta+z')

  const restored = await ta.inputValue()
  expect(restored).not.toContain('[MOCK]')
  expect(restored).toContain('/fix')

  // Idle window (300ms) plus margin — the value must not flip back to a
  // replacement on its own.
  await page.waitForTimeout(1200)

  expect(await ta.inputValue()).toBe(restored)
  const { count } = await getMockRequests(baseURL)
  expect(count).toBe(1)
})

// Regression (user-reported): after an undo, typing a trailing space and
// then backspacing it back out must not re-trigger either. Both the space
// (doesn't complete the token, and the detector isn't armed) and the
// backspace (a deletion, which unconditionally disarms) are inert under the
// arm model.
test('space + backspace after undo does not re-trigger (regression)', async ({
  context,
  baseURL,
}) => {
  await configureMockProvider(context, baseURL)
  const page = await context.newPage()
  await page.goto(baseURL)

  const ta = page.locator('#ta')
  await ta.click()
  await ta.pressSequentially('hello world /fix', { delay: 20 })
  await expect.poll(() => ta.inputValue(), { timeout: 5000 }).toContain('[MOCK]')

  await page.keyboard.press('ControlOrMeta+z')
  const restored = await ta.inputValue()
  expect(restored).toContain('/fix')

  // The browser's native undo leaves the restored text selected (it was
  // reverting a select-all + insertText edit) — collapse the caret to the
  // end first, like a real user would before typing more, so the space
  // below appends rather than replacing the whole selection.
  await page.keyboard.press('End')
  await ta.pressSequentially(' ', { delay: 20 })
  await page.keyboard.press('Backspace')

  await page.waitForTimeout(1200)

  const finalValue = await ta.inputValue()
  expect(finalValue).not.toContain('[MOCK]')
  expect(finalValue).toBe(restored)
  const { count } = await getMockRequests(baseURL)
  expect(count).toBe(1)
})

test('Esc reverts the replacement back to the original text', async ({ context, baseURL }) => {
  await configureMockProvider(context, baseURL)
  const page = await context.newPage()
  await page.goto(baseURL)

  const ta = page.locator('#ta')
  await ta.click()
  await ta.pressSequentially('hello world /fix', { delay: 20 })
  await expect.poll(() => ta.inputValue(), { timeout: 5000 }).toContain('[MOCK]')

  await page.keyboard.press('Escape')

  const restored = await ta.inputValue()
  expect(restored).not.toContain('[MOCK]')
  expect(restored).toContain('/fix')
  expect(restored).toContain('hello world')
})

// Regression: Reddit's <shreddit-composer> re-dispatches a bare `input`
// event (empty `inputType`) on its wrapper element after every real
// keystroke. Before lib/inputEvent.ts, that second event was classified as
// a non-insertText edit and disarmed the detector, cancelling the trigger
// the genuine keystroke had just armed — so a command token typed in a
// Reddit comment box never fired.
test('still triggers when the page mirrors each keystroke with a synthetic input event (Reddit composer)', async ({
  context,
  baseURL,
}) => {
  await configureMockProvider(context, baseURL)
  const page = await context.newPage()
  await page.goto(baseURL)

  const ce = page.locator('#ce-reddit')
  await ce.click()
  await ce.pressSequentially('hello world /fix', { delay: 20 })

  await expect
    .poll(() => ce.innerText(), { timeout: 5000 })
    .toContain('[MOCK]')

  const { count } = await getMockRequests(baseURL)
  expect(count).toBe(1)
})
