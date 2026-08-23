export interface OpenAIRequest {
  endpoint: string
  model: string
  body: Record<string, any>
  headers: Record<string, string>
}

export type RequestInterceptor = (req: OpenAIRequest) => void

const OPENAI_LEGACY_MODELS = /\bgpt-(3|4)/
const OPENAI_GPT5_BASE = /\bgpt-5\b$/

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
  if (OPENAI_GPT5_BASE.test(req.model)) {
    req.body.reasoning_effort = 'minimal'
    return
  }
  req.body.reasoning_effort = 'none'
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
