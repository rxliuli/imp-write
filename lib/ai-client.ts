import { applyRequestInterceptors, type OpenAIRequest } from './interceptors'
import type { ProviderSettings } from './settings'

/**
 * An error from an OpenAI-compatible endpoint, carrying the HTTP status (when
 * there is one) so callers can build human-readable messages without
 * re-parsing response text.
 */
export class ApiError extends Error {
  status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function chatCompletion(
  baseUrl: string,
  apiKey: string,
  model: string,
  prompt: string,
  fetchFn: typeof fetch,
): Promise<string> {
  // Users commonly paste a base URL with a trailing slash (e.g.
  // `https://api.example.com/v1/`); without stripping it, the request path
  // ends up with a double slash (`.../v1//chat/completions`).
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '')
  const endpoint = `${normalizedBaseUrl}/chat/completions`
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  }
  const body: OpenAIRequest['body'] = {
    model,
    messages: [{ role: 'user', content: prompt }],
  }
  // Per-provider tweaks (e.g. disabling reasoning/thinking) to keep the
  // input-box rewrite flow fast — see lib/interceptors.ts.
  applyRequestInterceptors({ endpoint, model, body, headers })
  const res = await fetchFn(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new ApiError(text || `Request failed with status ${res.status}`, res.status)
  }

  const data = await res.json()
  const content = data?.choices?.[0]?.message?.content
  if (typeof content !== 'string') {
    throw new ApiError('Unexpected response shape from the AI provider')
  }
  return content.trim()
}

/**
 * Runs a single already-rendered prompt against the configured provider.
 * Both modes are a single direct call with no retry/failover — `imp` relies
 * on the service managing its own reliability, and `byok` only ever has one
 * configured key. Every failure is thrown as-is for the caller to
 * `humanizeError`.
 */
export async function runPrompt(
  provider: ProviderSettings,
  finalPrompt: string,
  fetchFn: typeof fetch = fetch,
): Promise<string> {
  if (provider.mode === 'imp') {
    if (!provider.imp) {
      throw new ApiError('Connect your Imp account in the extension settings')
    }
    return chatCompletion(
      provider.imp.baseUrl,
      provider.imp.apiKey,
      provider.imp.model,
      finalPrompt,
      fetchFn,
    )
  }

  const { apiKey, baseUrl, model } = provider.byok
  if (!apiKey) {
    throw new ApiError('Add an API key in the extension settings')
  }
  return chatCompletion(baseUrl, apiKey, model, finalPrompt, fetchFn)
}

/**
 * Turns a raw error from `runPrompt` into a short, user-facing message.
 * `mode` matters: the same status code means different things for the
 * Imp Credits service (billing) vs. a BYOK provider (auth/config).
 */
export function humanizeError(error: unknown, mode: ProviderSettings['mode']): string {
  if (error instanceof ApiError) {
    if (mode === 'imp') {
      if (error.status === 402) {
        // No external purchase link here: pointing users at an off-app
        // top-up page violates App Store guideline 3.1.1 (anti-steering).
        // Keep it as plain text only — the purchase flow lives off-app.
        return 'Insufficient credits — top up on the Imp website'
      }
      if (error.status === 429) return 'Rate limited — try again in a moment'
      if (error.status === 401) {
        return 'Your Imp connection has expired — reconnect from the extension settings'
      }
      if (error.status !== undefined && error.status >= 500) {
        return 'Imp Credits service error — try again later'
      }
    } else {
      if (error.status === 401) return 'Invalid API key'
      if (error.status === 403) return 'Forbidden — check your API key permissions'
      if (error.status === 429) return 'Rate limited — try again in a moment'
      if (error.status === 404) {
        return 'Model or URL not found — verify the base URL and model name'
      }
      if (error.status === 400) {
        return 'Bad request — check your model name and base URL'
      }
      if (error.status !== undefined && error.status >= 500) {
        return 'Provider error — try again later'
      }
    }
  }

  const message = error instanceof Error ? error.message : String(error)
  if (message.toLowerCase().includes('failed to fetch')) {
    return 'Cannot reach the server — check the base URL and your network.'
  }
  return message
}
