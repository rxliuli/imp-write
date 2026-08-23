import { describe, expect, it } from 'vitest'
import { eventToShortcut, formatShortcutForDisplay, type ShortcutKeyEvent } from './shortcut'

function key(
  code: string,
  mods: Partial<Pick<ShortcutKeyEvent, 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>> = {},
): ShortcutKeyEvent {
  return {
    code,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ...mods,
  }
}

describe('eventToShortcut', () => {
  it('builds a spec for Ctrl+letter', () => {
    expect(eventToShortcut(key('KeyF', { ctrlKey: true }))).toBe('Ctrl+F')
  })

  it('builds a spec for Alt+letter', () => {
    expect(eventToShortcut(key('KeyF', { altKey: true }))).toBe('Alt+F')
  })

  it('builds a spec for Meta+letter', () => {
    expect(eventToShortcut(key('KeyF', { metaKey: true }))).toBe('Meta+F')
  })

  it('orders modifiers as Ctrl, Alt, Shift, Meta regardless of press order', () => {
    expect(
      eventToShortcut(
        key('KeyF', { metaKey: true, shiftKey: true, altKey: true, ctrlKey: true }),
      ),
    ).toBe('Ctrl+Alt+Shift+Meta+F')
  })

  it('includes Shift alongside a required modifier', () => {
    expect(eventToShortcut(key('KeyF', { ctrlKey: true, shiftKey: true }))).toBe(
      'Ctrl+Shift+F',
    )
  })

  it('rejects Shift-only combos (no Ctrl/Alt/Meta)', () => {
    expect(eventToShortcut(key('KeyF', { shiftKey: true }))).toBeNull()
  })

  it('rejects a bare key with no modifier at all', () => {
    expect(eventToShortcut(key('KeyF'))).toBeNull()
  })

  it('rejects when the key itself is a modifier (mid-chord)', () => {
    expect(eventToShortcut(key('ControlLeft', { ctrlKey: true }))).toBeNull()
    expect(eventToShortcut(key('AltRight', { altKey: true }))).toBeNull()
    expect(eventToShortcut(key('ShiftLeft', { shiftKey: true }))).toBeNull()
    expect(eventToShortcut(key('MetaLeft', { metaKey: true }))).toBeNull()
  })

  it('strips the "Key" prefix from letter codes', () => {
    expect(eventToShortcut(key('KeyF', { ctrlKey: true }))).toBe('Ctrl+F')
  })

  it('strips the "Digit" prefix from digit codes', () => {
    expect(eventToShortcut(key('Digit1', { ctrlKey: true }))).toBe('Ctrl+1')
  })

  it('leaves other codes untouched (e.g. function keys, punctuation)', () => {
    expect(eventToShortcut(key('F5', { ctrlKey: true }))).toBe('Ctrl+F5')
    expect(eventToShortcut(key('Slash', { ctrlKey: true }))).toBe('Ctrl+Slash')
  })
})

describe('formatShortcutForDisplay', () => {
  it('renders mac symbols with no separators on a mac platform', () => {
    expect(formatShortcutForDisplay('Ctrl+Alt+Shift+Meta+F', 'MacIntel')).toBe(
      '⌃⌥⇧⌘F',
    )
  })

  it('renders a single-modifier spec on mac', () => {
    expect(formatShortcutForDisplay('Ctrl+F', 'MacIntel')).toBe('⌃F')
  })

  it('leaves the spec unchanged on non-mac platforms', () => {
    expect(formatShortcutForDisplay('Ctrl+Alt+F', 'Win32')).toBe('Ctrl+Alt+F')
  })

  it('leaves the spec unchanged on Linux', () => {
    expect(formatShortcutForDisplay('Ctrl+F', 'Linux x86_64')).toBe('Ctrl+F')
  })
})
