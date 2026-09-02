import { describe, expect, it } from 'vitest'
import { applyRequestInterceptors, type OpenAIRequest } from './interceptors'

const OPENAI_ENDPOINT = 'https://api.openai.com/v1/chat/completions'
const DEEPSEEK_ENDPOINT = 'https://api.deepseek.com/v1/chat/completions'
const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'
const LOCAL_ENDPOINT = 'http://localhost:11434/v1/chat/completions'

function makeReq(model: string, endpoint = OPENAI_ENDPOINT): OpenAIRequest {
  return {
    endpoint,
    model,
    headers: { 'Content-Type': 'application/json' },
    body: { model, messages: [] },
  }
}

describe('disableOpenAIReasoning', () => {
  it('sets reasoning_effort=minimal for the bare gpt-5 model', () => {
    const req = makeReq('gpt-5')
    applyRequestInterceptors(req)
    expect(req.body.reasoning_effort).toBe('minimal')
  })

  it('sets reasoning_effort=minimal for gpt-5-mini', () => {
    const req = makeReq('gpt-5-mini')
    applyRequestInterceptors(req)
    expect(req.body.reasoning_effort).toBe('minimal')
  })

  it('sets reasoning_effort=minimal for gpt-5.1', () => {
    const req = makeReq('gpt-5.1')
    applyRequestInterceptors(req)
    expect(req.body.reasoning_effort).toBe('minimal')
  })

  it('does NOT set for gpt-4o (legacy family is skipped)', () => {
    const req = makeReq('gpt-4o')
    applyRequestInterceptors(req)
    expect(req.body.reasoning_effort).toBeUndefined()
  })

  it('does NOT set for gpt-3.5-turbo (legacy family is skipped)', () => {
    const req = makeReq('gpt-3.5-turbo')
    applyRequestInterceptors(req)
    expect(req.body.reasoning_effort).toBeUndefined()
  })

  it('does NOT set for gpt-5 on a non-OpenAI endpoint', () => {
    const req = makeReq('gpt-5', DEEPSEEK_ENDPOINT)
    applyRequestInterceptors(req)
    expect(req.body.reasoning_effort).toBeUndefined()
  })

  it('does NOT set for gpt-5 on a local endpoint', () => {
    const req = makeReq('gpt-5', LOCAL_ENDPOINT)
    applyRequestInterceptors(req)
    expect(req.body.reasoning_effort).toBeUndefined()
  })
})

describe('disableDeepSeekThinking', () => {
  it('adds reasoning_effort=low for deepseek-v4 on the DeepSeek endpoint', () => {
    const req = makeReq('deepseek-v4', DEEPSEEK_ENDPOINT)
    applyRequestInterceptors(req)
    expect(req.body.reasoning_effort).toBe('low')
  })

  it('does NOT add for deepseek-chat on the DeepSeek endpoint', () => {
    const req = makeReq('deepseek-chat', DEEPSEEK_ENDPOINT)
    applyRequestInterceptors(req)
    expect(req.body.reasoning_effort).toBeUndefined()
  })

  it('does NOT add for deepseek-v4 on a non-DeepSeek endpoint', () => {
    const req = makeReq('deepseek-v4', LOCAL_ENDPOINT)
    applyRequestInterceptors(req)
    expect(req.body.reasoning_effort).toBeUndefined()
  })
})

describe('disableGeminiThinking', () => {
  it('adds reasoning_effort=low for gemini-2.5-flash on the Gemini endpoint', () => {
    const req = makeReq('gemini-2.5-flash', GEMINI_ENDPOINT)
    applyRequestInterceptors(req)
    expect(req.body.reasoning_effort).toBe('low')
  })

  it('adds reasoning_effort=low for gemini-3-flash on the Gemini endpoint', () => {
    const req = makeReq('gemini-3-flash', GEMINI_ENDPOINT)
    applyRequestInterceptors(req)
    expect(req.body.reasoning_effort).toBe('low')
  })

  it('does NOT add for gemini-2.0-flash on the Gemini endpoint', () => {
    const req = makeReq('gemini-2.0-flash', GEMINI_ENDPOINT)
    applyRequestInterceptors(req)
    expect(req.body.reasoning_effort).toBeUndefined()
  })

  it('does NOT add for gemini-2.5-flash on a non-Gemini endpoint', () => {
    const req = makeReq('gemini-2.5-flash', DEEPSEEK_ENDPOINT)
    applyRequestInterceptors(req)
    expect(req.body.reasoning_effort).toBeUndefined()
  })
})

describe('applyRequestInterceptors', () => {
  it('leaves the body untouched for an unrelated host', () => {
    const req = makeReq('gpt-5', LOCAL_ENDPOINT)
    applyRequestInterceptors(req)
    expect(req.body).toEqual({ model: 'gpt-5', messages: [] })
  })

  it('does not throw and does not modify the body for a malformed endpoint', () => {
    const req: OpenAIRequest = {
      endpoint: 'not-a-valid-url',
      model: 'gpt-5',
      headers: {},
      body: { model: 'gpt-5', messages: [] },
    }
    expect(() => applyRequestInterceptors(req)).not.toThrow()
    expect(req.body).toEqual({ model: 'gpt-5', messages: [] })
  })

  it('does not throw and does not modify the body for an empty endpoint', () => {
    const req: OpenAIRequest = {
      endpoint: '',
      model: 'gemini-2.5-flash',
      headers: {},
      body: { model: 'gemini-2.5-flash', messages: [] },
    }
    expect(() => applyRequestInterceptors(req)).not.toThrow()
    expect(req.body).toEqual({ model: 'gemini-2.5-flash', messages: [] })
  })

  it('only one interceptor fires per request across the whole combination', () => {
    const req = makeReq('deepseek-v4', DEEPSEEK_ENDPOINT)
    applyRequestInterceptors(req)
    expect(req.body).toEqual({
      model: 'deepseek-v4',
      messages: [],
      reasoning_effort: 'low',
    })
  })
})
