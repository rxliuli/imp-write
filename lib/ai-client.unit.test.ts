import { describe, expect, it, vi } from 'vitest'
import { ApiError, humanizeError, runPrompt } from './ai-client'
import type { ProviderSettings } from './settings'

function byokProvider(apiKey: string): ProviderSettings {
  return {
    mode: 'byok',
    byok: {
      baseUrl: 'https://api.example.com/v1',
      apiKey,
      model: 'gpt-test',
    },
  }
}

function impProvider(apiKey = 'imp_key'): ProviderSettings {
  return {
    mode: 'imp',
    imp: { apiKey, baseUrl: 'https://imp.example.com/v1', model: 'imp-model' },
    byok: { baseUrl: 'https://api.example.com/v1', apiKey: '', model: 'gpt-test' },
  }
}

function okResponse(content: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content } }] }),
  }
}

function errorResponse(status: number, body = `error ${status}`) {
  return {
    ok: false,
    status,
    text: async () => body,
  }
}

describe('runPrompt (byok mode)', () => {
  it('resolves the trimmed message content on success', async () => {
    const fetchFn = vi.fn().mockResolvedValue(okResponse('  hello world  '))
    const result = await runPrompt(byokProvider('key-a'), 'prompt', fetchFn)
    expect(result).toBe('hello world')
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(fetchFn).toHaveBeenCalledWith(
      'https://api.example.com/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer key-a' }),
      }),
    )
  })

  it('strips a trailing slash from baseUrl to avoid a double slash in the request URL', async () => {
    const fetchFn = vi.fn().mockResolvedValue(okResponse('ok'))
    const provider = byokProvider('key-a')
    provider.byok.baseUrl = 'https://api.example.com/v1/'
    await runPrompt(provider, 'p', fetchFn)
    expect(fetchFn).toHaveBeenCalledWith(
      'https://api.example.com/v1/chat/completions',
      expect.anything(),
    )
  })

  it('sends model and prompt as a single user message', async () => {
    const fetchFn = vi.fn().mockResolvedValue(okResponse('ok'))
    await runPrompt(byokProvider('key-a'), 'fix this text', fetchFn)
    const [, init] = fetchFn.mock.calls[0]
    const body = JSON.parse(init.body)
    expect(body).toEqual({
      model: 'gpt-test',
      messages: [{ role: 'user', content: 'fix this text' }],
    })
  })

  it('does not retry on a 429 — fails immediately after a single call', async () => {
    const fetchFn = vi.fn().mockResolvedValue(errorResponse(429))
    await expect(
      runPrompt(byokProvider('key-a'), 'p', fetchFn),
    ).rejects.toMatchObject({ status: 429 })
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('does not retry on a 401 — fails immediately after a single call', async () => {
    const fetchFn = vi.fn().mockResolvedValue(errorResponse(401, 'invalid key'))
    await expect(
      runPrompt(byokProvider('key-a'), 'p', fetchFn),
    ).rejects.toMatchObject({ status: 401 })
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('propagates a network error (fetch rejecting) without retrying', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new TypeError('failed to fetch'))
    await expect(runPrompt(byokProvider('key-a'), 'p', fetchFn)).rejects.toThrow(
      'failed to fetch',
    )
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('throws when there is no configured key, without calling fetch', async () => {
    const fetchFn = vi.fn()
    await expect(runPrompt(byokProvider(''), 'p', fetchFn)).rejects.toThrow(
      'Add an API key in the extension settings',
    )
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('throws on an invalid response shape without retrying', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ nope: true }),
    })
    await expect(
      runPrompt(byokProvider('key-a'), 'p', fetchFn),
    ).rejects.toThrow('Unexpected response shape')
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })
})

describe('runPrompt (per-provider request interceptors)', () => {
  it('adds reasoning_effort=low when byok points at Gemini with a gemini-3 model', async () => {
    const fetchFn = vi.fn().mockResolvedValue(okResponse('ok'))
    const provider = byokProvider('key-a')
    provider.byok.baseUrl = 'https://generativelanguage.googleapis.com/v1beta/openai'
    provider.byok.model = 'gemini-3-flash'
    await runPrompt(provider, 'p', fetchFn)
    const [, init] = fetchFn.mock.calls[0]
    const body = JSON.parse(init.body)
    expect(body.reasoning_effort).toBe('low')
  })

  it('leaves the body untouched for an unrelated host', async () => {
    const fetchFn = vi.fn().mockResolvedValue(okResponse('ok'))
    const provider = byokProvider('key-a')
    provider.byok.baseUrl = 'https://api.example.com/v1'
    provider.byok.model = 'gemini-3-flash'
    await runPrompt(provider, 'p', fetchFn)
    const [, init] = fetchFn.mock.calls[0]
    const body = JSON.parse(init.body)
    expect(body.reasoning_effort).toBeUndefined()
  })
})

describe('runPrompt (imp mode)', () => {
  it('calls the imp endpoint directly with the imp key', async () => {
    const fetchFn = vi.fn().mockResolvedValue(okResponse('done'))
    const result = await runPrompt(impProvider('imp_abc'), 'p', fetchFn)
    expect(result).toBe('done')
    expect(fetchFn).toHaveBeenCalledWith(
      'https://imp.example.com/v1/chat/completions',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer imp_abc' }),
      }),
    )
  })

  it('does not retry — a single failure fails immediately', async () => {
    const fetchFn = vi.fn().mockResolvedValue(errorResponse(429))
    await expect(runPrompt(impProvider(), 'p', fetchFn)).rejects.toMatchObject({
      status: 429,
    })
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('throws when not connected, without calling fetch', async () => {
    const fetchFn = vi.fn()
    const provider: ProviderSettings = {
      mode: 'imp',
      byok: { baseUrl: 'https://api.example.com/v1', apiKey: '', model: 'gpt-test' },
    }
    await expect(runPrompt(provider, 'p', fetchFn)).rejects.toThrow(
      'Connect your Imp account in the extension settings',
    )
    expect(fetchFn).not.toHaveBeenCalled()
  })
})

describe('humanizeError', () => {
  it('imp mode: 402 points at the top-up page', () => {
    expect(humanizeError(new ApiError('x', 402), 'imp')).toContain(
      'https://imp.rxliuli.com/buy',
    )
  })

  it('imp mode: 429 is a rate-limit message', () => {
    expect(humanizeError(new ApiError('x', 429), 'imp')).toBe(
      'Rate limited — try again in a moment',
    )
  })

  it('imp mode: 401 suggests reconnecting', () => {
    expect(humanizeError(new ApiError('x', 401), 'imp')).toContain('reconnect')
  })

  it('byok mode: 401 is an invalid key message', () => {
    expect(humanizeError(new ApiError('x', 401), 'byok')).toBe('Invalid API key')
  })

  it('byok mode: 404 mentions the model/URL', () => {
    expect(humanizeError(new ApiError('x', 404), 'byok')).toContain('base URL')
  })

  it('byok mode: 5xx is a provider error', () => {
    expect(humanizeError(new ApiError('x', 503), 'byok')).toBe(
      'Provider error — try again later',
    )
  })

  it('recognizes a failed-to-fetch network error', () => {
    expect(humanizeError(new TypeError('Failed to fetch'), 'byok')).toContain(
      'Cannot reach the server',
    )
  })

  it('falls back to the raw message for anything else', () => {
    expect(humanizeError(new Error('Add an API key in the extension settings'), 'byok')).toBe(
      'Add an API key in the extension settings',
    )
  })
})
