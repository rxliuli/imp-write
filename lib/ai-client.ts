import { ApiError, humanizeError, rewrite } from '@rxliuli/imp-credits-sdk'
import { applyRequestInterceptors, type OpenAIRequest } from './interceptors'
import type { ProviderSettings } from './settings'

// Re-export so callers (background) and tests keep importing these from here;
// they're the SDK's single source of truth for error shape + user-facing copy.
export { ApiError, humanizeError }

/**
 * BYOK path: a plain OpenAI-compatible call to the user's own endpoint. The
 * SDK only covers the Imp Credits metered API (`/rewrite`); BYOK is not Imp
 * Credits, so it stays here with its per-provider interceptors.
 */
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
 * `imp` goes through the SDK's `/rewrite` (the server owns model selection,
 * billing and error semantics; we render the prompt). `byok` is a direct
 * OpenAI-compatible call with no retry/failover. Every failure is thrown as-is
 * for the caller to `humanizeError`.
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
    const { text } = await rewrite({
      baseUrl: provider.imp.baseUrl,
      apiKey: provider.imp.apiKey,
      prompt: finalPrompt,
      fetchFn,
    })
    return text
  }

  const { apiKey, baseUrl, model } = provider.byok
  if (!apiKey) {
    throw new ApiError('Add an API key in the extension settings')
  }
  return chatCompletion(baseUrl, apiKey, model, finalPrompt, fetchFn)
}
