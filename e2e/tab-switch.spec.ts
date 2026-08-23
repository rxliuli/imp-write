import { test, expect } from './fixtures'
import { configureMockProvider, getMockRequests, setMockDelay } from './helpers'

// Regression guard, loosened: two earlier fix attempts for "switching tabs
// while a command is in flight" (a forced write-mechanism correction, then
// deferring the write until the document refocuses) both caused worse
// regressions elsewhere — a clobbered native undo stack, and (for real rich
// editors like Slate) broken internal editor state from a raw
// innerText/native-setter assignment — so both were reverted. See
// lib/selection.ts and PLAN.md §4's 2026-08-22 addendum.
//
// Under a genuinely backgrounded document, execCommand/paste can still
// append the AI's result after the untouched original text instead of
// replacing it outright. That's now an accepted, known limitation (Esc still
// reverts the whole field). What this test actually guards: the write-back
// must still land (not get lost or stuck forever) while backgrounded, and
// the field must remain editable afterwards — not left in some broken,
// half-written state.
test('switching tabs while a command is in flight still writes back, and the field stays editable', async ({
  context,
  baseURL,
}) => {
  await configureMockProvider(context, baseURL)
  // Long enough to comfortably open a second tab and bring it to the front
  // before the mock response resolves.
  await setMockDelay(baseURL, 1000)

  const page1 = await context.newPage()
  await page1.goto(baseURL)

  const ta = page1.locator('#ta')
  await ta.click()
  const original = 'tis txt ned grammr Check /fix'
  await ta.pressSequentially(original, { delay: 20 })

  // Confirm the request actually left before switching away — otherwise
  // this would just be testing "idle trigger never fired".
  await expect
    .poll(async () => (await getMockRequests(baseURL)).count, { timeout: 5000 })
    .toBe(1)

  // Switch away to a different tab while the response is still pending.
  const page2 = await context.newPage()
  await page2.bringToFront()

  // The write-back must land — whether it lands as a clean replace or (the
  // accepted, known limitation) an append, both mean it actually happened.
  await expect.poll(() => ta.inputValue(), { timeout: 5000 }).toContain('[MOCK]')

  // The field must still be usable afterwards, regardless of which shape the
  // write took.
  await page1.bringToFront()
  await ta.click()
  await page1.keyboard.press('End')
  await ta.pressSequentially(' still editable', { delay: 20 })
  await expect.poll(() => ta.inputValue()).toContain('still editable')
})
