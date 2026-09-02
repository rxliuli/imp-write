export interface OpenAIRequest {
  endpoint: string
  model: string
  body: Record<string, any>
  headers: Record<string, string>
}

export type RequestInterceptor = (req: OpenAIRequest) => void

const OPENAI_LEGACY_MODELS = /\bgpt-(3|4)/

/**
 * Safely reads the hostname of `req.endpoint`. imp-write's BYOK base URL is
 * user-typed free text, so a malformed value must not blow up the request —
 * interceptors just become no-ops for it.
 */
function safeHostname(endpoint: string): string | undefined {
  try {
    return new URL(endpoint).hostname
  } catch {
    return undefined
  }
}

function disableOpenAIReasoning(req: OpenAIRequest): void {
  if (safeHostname(req.endpoint) !== 'api.openai.com') return
  if (OPENAI_LEGACY_MODELS.test(req.model)) return
  // gpt-5 family: push reasoning effort to its floor so the input-box rewrite
  // stays fast. `none` is the ideal "off", but newer variants (gpt-5-mini,
  // gpt-5.1, ...) reject it with a 400 — `minimal` is the lowest value the
  // whole family accepts (and is what bare `gpt-5` already used).
  req.body.reasoning_effort = 'minimal'
}

function disableDeepSeekThinking(req: OpenAIRequest): void {
  if (safeHostname(req.endpoint) === 'api.deepseek.com' && /\bdeepseek-v4\b/.test(req.model)) {
    req.body.reasoning_effort = 'low'
  }
}

function disableGeminiThinking(req: OpenAIRequest): void {
  if (
    safeHostname(req.endpoint) === 'generativelanguage.googleapis.com' &&
    /\bgemini-(2\.5|3)/.test(req.model)
  ) {
    req.body.reasoning_effort = 'low'
  }
}

export const requestInterceptors: RequestInterceptor[] = [
  disableOpenAIReasoning,
  disableDeepSeekThinking,
  disableGeminiThinking,
]

export function applyRequestInterceptors(req: OpenAIRequest): void {
  for (const interceptor of requestInterceptors) {
    interceptor(req)
  }
}
