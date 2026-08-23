import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serve } from '@hono/node-server'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

// One page serving every element the scenarios need: a plain textarea, a
// contenteditable region, and two adjacent textareas (for future
// cross-field isolation checks). The extension does not inject into
// about:blank/data: URLs, so tests must load a real http page from this
// server rather than using page.setContent().
const pages: Record<string, string> = {
  '/': `<!DOCTYPE html>
<html lang="en">
<head><title>Imp Write Test Page</title></head>
<body>
  <textarea id="ta" rows="4" cols="60"></textarea>
  <div id="ce" contenteditable="true" role="textbox" style="border:1px solid #ccc; min-height:2em; padding:4px; width:400px;"></div>
  <textarea id="ta1" rows="2" cols="30"></textarea>
  <textarea id="ta2" rows="2" cols="30"></textarea>
</body>
</html>`,
}

interface MockRequest {
  body: unknown
  receivedAt: number
}

interface MockFailMode {
  status: number
  body: unknown
}

// Module-level state, reset on each server start — tests run serially (one
// worker) and each test gets a fresh server instance via the `baseURL`
// fixture, so this is safe.
const mockState = {
  requests: [] as MockRequest[],
  delayMs: 0,
  failMode: null as MockFailMode | null,
}

// Bodies mirroring the real imp-credits service's response shape for the
// statuses error-paths.spec.ts exercises against `provider.mode === 'imp'`
// (see PLAN.md/lib/ai-client.ts's `humanizeError`, which only inspects
// `status` — these exist purely so `/mock/fail` looks like the real thing
// when a caller doesn't pass an explicit `body`, not because anything reads
// their fields).
function defaultFailBody(status: number): unknown {
  switch (status) {
    case 402:
      return {
        error:
          'insufficient balance (0.0000 USD remaining) — top up at https://imp.rxliuli.com/buy',
        balanceMicros: 0,
      }
    case 401:
      return { error: 'unauthorized' }
    default:
      return { error: `mock failure (${status})` }
  }
}

const app = new Hono()

app.use('/v1/*', cors())

// Mirrors the one OpenAI-compatible endpoint lib/ai-client.ts calls:
// POST {baseUrl}/chat/completions with a single user message containing the
// fully-rendered prompt (command template + `{{text}}` already substituted).
// The response wraps that entire received content in `[MOCK]...` so tests
// can assert both "a replacement happened" (contains `[MOCK]`) and "the
// trigger token didn't leak into the AI call" (doesn't contain `/fix` etc,
// since content.ts strips the token before building the prompt).
app.post('/v1/chat/completions', async (c) => {
  const data = await c.req.json()
  mockState.requests.push({ body: data, receivedAt: Date.now() })
  // Lets tests hold the response open long enough to switch tabs (or do
  // anything else async) before the write-back races against it — see
  // `/mock/delay`.
  if (mockState.delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, mockState.delayMs))
  }
  // Programmable failure mode — see `/mock/fail`. Checked after the delay
  // (matching a real provider: a slow error still takes time to arrive) and
  // before the success path so a test can force every subsequent call to
  // fail without having to fake a different endpoint.
  if (mockState.failMode) {
    const { status, body } = mockState.failMode
    return c.json(body, status as ContentfulStatusCode)
  }
  const content: string = data.messages?.[0]?.content ?? ''
  return c.json({
    choices: [{ message: { role: 'assistant', content: `[MOCK]${content}` } }],
  })
})

// Makes every subsequent `/v1/chat/completions` call fail with `status`
// until `/mock/reset` is called. `body` defaults to a shape mirroring the
// real imp-credits service for 402/401 (see `defaultFailBody`) — pass an
// explicit `body` to override it.
app.post('/mock/fail', async (c) => {
  const { status, body } = await c.req.json()
  mockState.failMode = { status, body: body ?? defaultFailBody(status) }
  return c.json({ ok: true })
})

// Delays every subsequent /v1/chat/completions response by `ms`, so tests
// can reliably act (e.g. switch tabs) while a request is still in flight.
app.post('/mock/delay', async (c) => {
  const { ms } = await c.req.json()
  mockState.delayMs = typeof ms === 'number' ? ms : 0
  return c.json({ ok: true })
})

// Lets tests assert "no second request happened" after an undo/Esc, without
// having to plumb a spy through the extension itself.
app.get('/mock/requests', (c) =>
  c.json({ count: mockState.requests.length, requests: mockState.requests }),
)
app.post('/mock/reset', (c) => {
  mockState.requests = []
  mockState.failMode = null
  return c.json({ ok: true })
})

app.get('/:path{.*}', (c) => {
  const html = pages[`/${c.req.param('path') ?? ''}`] ?? pages[c.req.path]
  if (html) return c.html(html)
  return c.notFound()
})

export function createTestServer(): { start(): Promise<string>; stop(): Promise<void> } {
  let server: ReturnType<typeof serve> | null = null

  return {
    async start() {
      mockState.requests = []
      mockState.delayMs = 0
      mockState.failMode = null
      return new Promise<string>((resolve) => {
        server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }, (info) => {
          resolve(`http://127.0.0.1:${info.port}`)
        })
      })
    },
    async stop() {
      if (server) server.close()
    },
  }
}
