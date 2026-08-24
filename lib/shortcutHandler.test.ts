import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { matchShortcut } from './shortcutHandler'
import type { Command } from './settings'

const commands: Command[] = [{ name: 'tl', prompt: 'Translate {{text}}' }]
const shortcuts: Record<string, string> = { tl: 'Alt+T' }

let textarea: HTMLTextAreaElement

beforeEach(() => {
  textarea = document.createElement('textarea')
  document.body.append(textarea)
  textarea.focus()
})

afterEach(() => {
  textarea.remove()
})

/**
 * Wires up a document-level capturing keydown listener exactly like
 * `entrypoints/content.ts` does, so these tests exercise the real
 * request/response shape (a dispatched event, `defaultPrevented`) instead of
 * just calling `matchShortcut` directly.
 */
function wireContentScriptListener(onMatch: (command: Command) => void) {
  const listener = (e: KeyboardEvent) => {
    const match = matchShortcut(e, shortcuts, commands, {
      isBusy: () => false,
      getActiveElement: () => document.activeElement as HTMLElement | null,
    })
    if (!match) return
    e.preventDefault()
    e.stopPropagation()
    onMatch(match.command)
  }
  document.addEventListener('keydown', listener, true)
  return () => document.removeEventListener('keydown', listener, true)
}

describe('matchShortcut', () => {
  it('matches a bound Ctrl/Alt/Meta chord against the focused input element', () => {
    const match = matchShortcut(
      { code: 'KeyT', altKey: true, ctrlKey: false, shiftKey: false, metaKey: false },
      shortcuts,
      commands,
      { isBusy: () => false, getActiveElement: () => textarea },
    )
    expect(match?.command.name).toBe('tl')
    expect(match?.element).toBe(textarea)
  })

  it('returns null when no shortcut is bound to the pressed combo', () => {
    const match = matchShortcut(
      { code: 'KeyZ', altKey: true, ctrlKey: false, shiftKey: false, metaKey: false },
      shortcuts,
      commands,
      { isBusy: () => false, getActiveElement: () => textarea },
    )
    expect(match).toBeNull()
  })

  it('returns null while busy, even for a bound combo', () => {
    const match = matchShortcut(
      { code: 'KeyT', altKey: true, ctrlKey: false, shiftKey: false, metaKey: false },
      shortcuts,
      commands,
      { isBusy: () => true, getActiveElement: () => textarea },
    )
    expect(match).toBeNull()
  })

  it('returns null when the active element is not an editable input', () => {
    const div = document.createElement('div')
    document.body.append(div)
    const match = matchShortcut(
      { code: 'KeyT', altKey: true, ctrlKey: false, shiftKey: false, metaKey: false },
      shortcuts,
      commands,
      { isBusy: () => false, getActiveElement: () => div },
    )
    expect(match).toBeNull()
    div.remove()
  })

  // --- Bug 2026-08-22: Alt+T leaking "†" into the field on macOS ---
  //
  // On macOS, Option (Alt) + a letter can produce a special character (e.g.
  // Option+T -> "†") directly, in a single keystroke — no multi-key dead-key
  // sequence. Some Chromium versions still route this through the same
  // NSTextInputClient plumbing used for IME composition and surface it as
  // `isComposing: true` on the keydown event itself, even though nothing is
  // actually mid-composition. A shortcut-matching handler that bails out on
  // `isComposing` before checking whether the combo is a *bound* shortcut
  // silently lets the special character reach the field instead of running
  // the command.
  it('matches a bound chord even when the keydown event reports isComposing: true', () => {
    const event = {
      code: 'KeyT',
      altKey: true,
      ctrlKey: false,
      shiftKey: false,
      metaKey: false,
      isComposing: true,
    }
    const match = matchShortcut(event as any, shortcuts, commands, {
      isBusy: () => false,
      getActiveElement: () => textarea,
    })
    expect(match?.command.name).toBe('tl')
  })

  it('wired as content.ts does: a real Alt+T KeyboardEvent with isComposing true is prevented and dispatches the command', () => {
    const onMatch = vi.fn()
    const unwire = wireContentScriptListener(onMatch)

    const event = new KeyboardEvent('keydown', {
      key: '†',
      code: 'KeyT',
      altKey: true,
      isComposing: true,
      bubbles: true,
      cancelable: true,
    })
    textarea.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(onMatch).toHaveBeenCalledTimes(1)
    expect(onMatch.mock.calls[0]![0].name).toBe('tl')

    unwire()
  })

  it('wired as content.ts does: an unbound combo is left alone (not prevented)', () => {
    const onMatch = vi.fn()
    const unwire = wireContentScriptListener(onMatch)

    const event = new KeyboardEvent('keydown', {
      key: 'z',
      code: 'KeyZ',
      altKey: true,
      bubbles: true,
      cancelable: true,
    })
    textarea.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(false)
    expect(onMatch).not.toHaveBeenCalled()

    unwire()
  })
})
