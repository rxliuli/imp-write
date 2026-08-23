import { test, expect } from './fixtures'
import { configureMockProvider } from './helpers'

// contenteditable is best-effort in v1 (see README's "v1 limitations") — the
// write-back path (lib/selection.ts's editableSelection) tries a synthetic
// paste first, then falls back to execCommand('insertText'), and headless
// Chromium's contenteditable normalization can be flaky across versions. If
// this proves unstable in CI, it's the one scenario allowed to be
// fixme'd — see the task report for details.
test('contenteditable region gets replaced after pausing on a command token', async ({
  context,
  baseURL,
}) => {
  await configureMockProvider(context, baseURL)
  const page = await context.newPage()
  await page.goto(baseURL)

  const ce = page.locator('#ce')
  await ce.click()
  await ce.pressSequentially('hello world /fix', { delay: 20 })

  await expect
    .poll(() => ce.innerText(), { timeout: 5000 })
    .toContain('[MOCK]')

  const text = await ce.innerText()
  expect(text).not.toContain('/fix')
})
