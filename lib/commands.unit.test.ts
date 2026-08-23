import { describe, expect, it } from 'vitest'
import {
  applyTemplate,
  BUILTIN_COMMANDS,
  parseCommandTrigger,
  TRIGGER_PREFIX,
} from './commands'
import type { Command } from './settings'

const commands: Command[] = [
  ...BUILTIN_COMMANDS,
  { name: 'custom', prompt: 'Do something with {{text}}' },
]

describe('parseCommandTrigger', () => {
  it('matches a trailing command token', () => {
    const result = parseCommandTrigger(
      '帮我看看这段话对不对 /fix',
      TRIGGER_PREFIX,
      commands,
    )
    expect(result?.command.name).toBe('fix')
    expect(result?.text).toBe('帮我看看这段话对不对')
  })

  it('is case-insensitive when matching command names', () => {
    const result = parseCommandTrigger('hello world /FIX', TRIGGER_PREFIX, commands)
    expect(result?.command.name).toBe('fix')
  })

  it('strips trailing half-width spaces before matching', () => {
    const result = parseCommandTrigger(
      'hello world /fix   ',
      TRIGGER_PREFIX,
      commands,
    )
    expect(result?.command.name).toBe('fix')
    expect(result?.text).toBe('hello world')
  })

  it('strips trailing full-width spaces before matching', () => {
    const result = parseCommandTrigger(
      'hello world /fix　　　',
      TRIGGER_PREFIX,
      commands,
    )
    expect(result?.command.name).toBe('fix')
    expect(result?.text).toBe('hello world')
  })

  // The whitespace-before-token boundary this used to enforce (specifically
  // to keep `http://a.com/?fix` from misfiring) is gone — see the function's
  // docstring for why that's safe now. A glued token right after any
  // character, including one from a URL/path, does match at the parse
  // level; it's IdleTriggerDetector's "arm" model (a paste never arms) that
  // keeps this from actually misfiring in practice.
  it('matches a token glued directly onto the preceding word (no space required)', () => {
    const result = parseCommandTrigger('Check/fix', TRIGGER_PREFIX, commands)
    expect(result?.command.name).toBe('fix')
    expect(result?.text).toBe('Check')
  })

  it('matches a glued token for a different command too', () => {
    const result = parseCommandTrigger('text/tl', TRIGGER_PREFIX, commands)
    expect(result?.command.name).toBe('tl')
    expect(result?.text).toBe('text')
  })

  // Negative case for the same glued-matching change: a word that merely
  // *ends with* a command name (no prefix character in front of it at all)
  // must not match — the prefix character itself is still required
  // immediately before the name.
  it('does not misdetect a word that ends with a command name but has no prefix character before it', () => {
    const result = parseCommandTrigger('this is a suffix', TRIGGER_PREFIX, commands)
    expect(result).toBeNull()
  })

  it('returns null for an unknown command name', () => {
    const result = parseCommandTrigger('hello world /unknown', TRIGGER_PREFIX, commands)
    expect(result).toBeNull()
  })

  it('supports a custom prefix that is a regex special character (!)', () => {
    const result = parseCommandTrigger('hello world !fix', '!', commands)
    expect(result?.command.name).toBe('fix')
    expect(result?.text).toBe('hello world')
  })

  it('supports a custom prefix that is a regex special character (?)', () => {
    const result = parseCommandTrigger('hello world ?fix', '?', commands)
    expect(result?.command.name).toBe('fix')
    expect(result?.text).toBe('hello world')
  })

  it('extracts the remaining text correctly after removing the token', () => {
    const result = parseCommandTrigger(
      '  leading and trailing text  /improve',
      TRIGGER_PREFIX,
      commands,
    )
    expect(result?.command.name).toBe('improve')
    expect(result?.text).toBe('leading and trailing text')
  })

  it('returns an empty string text when there is no body before the token', () => {
    const result = parseCommandTrigger('/fix', TRIGGER_PREFIX, commands)
    expect(result?.command.name).toBe('fix')
    expect(result?.text).toBe('')
  })

  it('matches a custom command from the provided commands list', () => {
    const result = parseCommandTrigger('do the thing /custom', TRIGGER_PREFIX, commands)
    expect(result?.command.name).toBe('custom')
    expect(result?.text).toBe('do the thing')
  })

  it('returns null when the trimmed text is empty', () => {
    const result = parseCommandTrigger('   ', TRIGGER_PREFIX, commands)
    expect(result).toBeNull()
  })
})

describe('BUILTIN_COMMANDS', () => {
  it('includes a "tl" command whose prompt references {{text}}', () => {
    const tl = BUILTIN_COMMANDS.find((c) => c.name === 'tl')
    expect(tl).toBeDefined()
    expect(tl?.prompt).toContain('{{text}}')
  })
})

describe('applyTemplate', () => {
  it('replaces {{text}} when the prompt contains the placeholder', () => {
    const result = applyTemplate('Rewrite this: {{text}} please', 'hello')
    expect(result).toBe('Rewrite this: hello please')
  })

  it('replaces every occurrence of {{text}}', () => {
    const result = applyTemplate('{{text}} - {{text}}', 'hi')
    expect(result).toBe('hi - hi')
  })

  it('appends the text with a blank line when the prompt has no placeholder', () => {
    const result = applyTemplate('Rewrite this nicely', 'hello')
    expect(result).toBe('Rewrite this nicely\n\nhello')
  })

  it('preserves special replacement patterns ($&, $\', $`, $$) in the text', () => {
    const text = "Use $& and $' plus $$ and $1"
    const result = applyTemplate('{{text}}', text)
    expect(result).toBe(text)
  })
})
