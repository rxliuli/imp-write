import type { Command } from './settings'

/**
 * The one and only trigger prefix. Not user-configurable — see PLAN.md
 * §4.1's 2026-08-22 addendum for the decision.
 */
export const TRIGGER_PREFIX = '/'

export const BUILTIN_COMMANDS: Command[] = [
  {
    name: 'fix',
    prompt: `
You are a meticulous proofreader. Fix grammar, spelling, and punctuation mistakes in the text below without rewording it or changing its style. Follow these rules:
1. Output only the corrected text, without explanations or additional content (such as "Here is the corrected text:" or "Corrected version:")
2. Keep the original language of the text unchanged
3. Preserve everything that should not be touched: proper nouns, code, URLs, @mentions, and any HTML/Markdown structure

Text to fix:
{{text}}
`.trim(),
  },
  {
    name: 'improve',
    prompt: `
You are a skilled writing editor. Improve the clarity, flow, and word choice of the text below while keeping its original meaning and tone. Follow these rules:
1. Output only the improved text, without explanations or additional content (such as "Here is the improved version:" or "Improved text:")
2. Keep the original language of the text unchanged
3. Preserve everything that should not be touched: proper nouns, code, URLs, @mentions, and any HTML/Markdown structure

Text to improve:
{{text}}
`.trim(),
  },
  {
    name: 'shorten',
    prompt: `
You are a skilled writing editor. Make the text below shorter and more concise while preserving its key meaning and original tone. Follow these rules:
1. Output only the shortened text, without explanations or additional content (such as "Here is the shortened version:" or "Shortened text:")
2. Keep the original language of the text unchanged
3. Preserve everything that should not be touched: proper nouns, code, URLs, @mentions, and any HTML/Markdown structure

Text to shorten:
{{text}}
`.trim(),
  },
  {
    name: 'tl',
    prompt: `
You are a professional translator. Translate the text below into English. Follow these rules:
1. Output only the translation, without explanations or additional content (such as "Here is the translation:" or "Translated text:")
2. If the text is already in English, return it unchanged
3. Preserve everything that should not be touched: proper nouns, code, URLs, @mentions, and any HTML/Markdown structure

Text to translate:
{{text}}
`.trim(),
  },
]

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Parses a trailing command token (e.g. "...帮我看看这段话对不对 /fix") off the end
 * of the raw input value.
 *
 * The token is just `prefix + name` sitting at the very end of the (trimmed)
 * text — unlike an earlier version of this function, it no longer has to be
 * preceded by whitespace or sit at the start of the text (so e.g.
 * `Check/fix` glued together still hits). That's safe because the caller
 * (IdleTriggerDetector's "arm" model) only ever schedules a trigger when the
 * token's last character was just typed by hand — a pasted URL/path never
 * arms — so the old whitespace-boundary guard against `http://a.com/?fix`
 * false positives is no longer needed.
 */
export function parseCommandTrigger(
  rawText: string,
  prefix: string,
  commands: Command[],
): { command: Command; text: string; token: string } | null {
  // Trailing whitespace (regular or full-width) can still show up in the raw
  // input value — e.g. the user paused with a trailing space still in the
  // box — so strip it before looking for the token.
  const trimmed = rawText.replace(/\s+$/, '')
  if (!trimmed) return null

  const escapedPrefix = escapeRegExp(prefix)
  const match = trimmed.match(new RegExp(`(${escapedPrefix}(\\S+))$`))
  if (!match) return null

  const [token, name] = [match[1], match[2]]
  const command = commands.find(
    (c) => c.name.toLowerCase() === name.toLowerCase(),
  )
  if (!command) return null

  const text = trimmed.slice(0, trimmed.length - token.length).trim()
  // `token` is the raw matched substring (e.g. "?FIX"), preserving whatever
  // case the user actually typed — callers that need to compare a keystroke
  // against "the token's last character" (IdleTriggerDetector's arm model)
  // need that literal substring, not a reconstruction from `command.name`.
  return { command, text, token }
}

export function applyTemplate(prompt: string, text: string): string {
  if (prompt.includes('{{text}}')) {
    // Use a replacer function, not a string, as the second argument:
    // String.prototype.replaceAll treats `$&`, `$'`, `` $` ``, `$$`, etc. in
    // a string replacement as special patterns, which would silently mangle
    // user text containing those sequences (e.g. `$$` in prices/LaTeX).
    return prompt.replaceAll('{{text}}', () => text)
  }
  return `${prompt}\n\n${text}`
}
