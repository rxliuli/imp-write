import { test, expect } from './fixtures'
import { configureMockProvider, getMockRequests, resetMock, setMockFail } from './helpers'

// Regression coverage for the error-hint copy manually verified today for
// the two AI-call failure modes users are most likely to hit: an Imp
// Credits billing problem (402/401) and a misconfigured/rejected BYOK
// provider (401/5xx/429). Every hint string here is asserted verbatim
// against `lib/ai-client.ts`'s `humanizeError` — never against the hint
// element's style/position/class, since those are being reworked
// concurrently (see lib/hint.ts).
//
// `showHint` renders a plain `textContent` node with no children, so
// `getByText(..., { exact: true })` is a precise, layout-independent match.
// The hint self-dismisses after ~2.5-4s; `toBeVisible({ timeout: 5000 })`
// only needs it to *appear* within that window, not to still be visible by
// the time the assertion resolves.

test('imp mode: 402 shows an insufficient-credits hint and leaves the input untouched', async ({
  context,
  baseURL,
}) => {
  await configureMockProvider(context, baseURL, { mode: 'imp' })
  await setMockFail(baseURL, 402)

  const page = await context.newPage()
  await page.goto(baseURL)

  const ta = page.locator('#ta')
  await ta.click()
  const original = 'hello world /fix'
  await ta.pressSequentially(original, { delay: 20 })

  await expect(
    page.getByText('Insufficient credits — top up at https://imp.rxliuli.com/buy', {
      exact: true,
    }),
  ).toBeVisible({ timeout: 5000 })

  // A failed call never reaches the write-back step — the field (including
  // the still-unconsumed trigger token) must be exactly what the user typed.
  expect(await ta.inputValue()).toBe(original)
  expect((await getMockRequests(baseURL)).count).toBe(1)

  await resetMock(baseURL)
})

test('imp mode: 401 shows a reconnect hint', async ({ context, baseURL }) => {
  await configureMockProvider(context, baseURL, { mode: 'imp' })
  await setMockFail(baseURL, 401)

  const page = await context.newPage()
  await page.goto(baseURL)

  const ta = page.locator('#ta')
  await ta.click()
  const original = 'hello world /fix'
  await ta.pressSequentially(original, { delay: 20 })

  await expect(
    page.getByText('Your Imp connection has expired — reconnect from the extension settings', {
      exact: true,
    }),
  ).toBeVisible({ timeout: 5000 })

  expect(await ta.inputValue()).toBe(original)
  expect((await getMockRequests(baseURL)).count).toBe(1)

  await resetMock(baseURL)
})

test('byok mode: 401 shows an invalid-API-key hint', async ({ context, baseURL }) => {
  await configureMockProvider(context, baseURL)
  await setMockFail(baseURL, 401)

  const page = await context.newPage()
  await page.goto(baseURL)

  const ta = page.locator('#ta')
  await ta.click()
  const original = 'hello world /fix'
  await ta.pressSequentially(original, { delay: 20 })

  await expect(page.getByText('Invalid API key', { exact: true })).toBeVisible({
    timeout: 5000,
  })

  expect(await ta.inputValue()).toBe(original)
  expect((await getMockRequests(baseURL)).count).toBe(1)

  await resetMock(baseURL)
})

test('byok mode: 500 shows a provider-error hint', async ({ context, baseURL }) => {
  await configureMockProvider(context, baseURL)
  await setMockFail(baseURL, 500)

  const page = await context.newPage()
  await page.goto(baseURL)

  const ta = page.locator('#ta')
  await ta.click()
  const original = 'hello world /fix'
  await ta.pressSequentially(original, { delay: 20 })

  // Verbatim string from lib/ai-client.ts's `humanizeError` (byok, >= 500).
  await expect(page.getByText('Provider error — try again later', { exact: true })).toBeVisible({
    timeout: 5000,
  })

  expect(await ta.inputValue()).toBe(original)
  expect((await getMockRequests(baseURL)).count).toBe(1)

  await resetMock(baseURL)
})

test('429 shows a rate-limit hint regardless of provider mode', async ({ context, baseURL }) => {
  await configureMockProvider(context, baseURL)
  await setMockFail(baseURL, 429)

  const page = await context.newPage()
  await page.goto(baseURL)

  const ta = page.locator('#ta')
  await ta.click()
  const original = 'hello world /fix'
  await ta.pressSequentially(original, { delay: 20 })

  await expect(
    page.getByText('Rate limited — try again in a moment', { exact: true }),
  ).toBeVisible({ timeout: 5000 })

  expect(await ta.inputValue()).toBe(original)
  expect((await getMockRequests(baseURL)).count).toBe(1)

  await resetMock(baseURL)
})
