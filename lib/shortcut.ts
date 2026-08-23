/**
 * The subset of `KeyboardEvent` that shortcut recording actually needs.
 * Kept as its own interface (rather than importing `KeyboardEvent` directly)
 * so this stays a pure, DOM-free function that's testable under Node without
 * a browser/jsdom environment — a real `KeyboardEvent` satisfies this
 * structurally, so content.ts and `ShortcutInput` can pass one straight in.
 */
export interface ShortcutKeyEvent {
  code: string
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  metaKey: boolean
}

// Fixed modifier ordering used both when building and when displaying a
// shortcut spec string, so specs are always canonical (no "Alt+Ctrl+F" vs.
// "Ctrl+Alt+F" duplicates for the same physical combo).
const MODIFIER_ORDER = ['Ctrl', 'Alt', 'Shift', 'Meta'] as const

const MODIFIER_CODES = new Set([
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'ShiftLeft',
  'ShiftRight',
  'MetaLeft',
  'MetaRight',
])

function codeToKeyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice('Key'.length)
  if (code.startsWith('Digit')) return code.slice('Digit'.length)
  return code
}

/**
 * Turns a keydown event into a canonical shortcut spec string, e.g.
 * `Ctrl+Alt+Shift+Meta+F` (modifiers always in that fixed order, only the
 * ones actually held are included).
 *
 * Returns `null` when the combo isn't usable as a global, page-wide
 * shortcut:
 * - The event's own key *is* a modifier (still mid-chord — nothing to record
 *   yet).
 * - None of Ctrl/Alt/Meta is held. A shortcut of just Shift, or a bare key
 *   with no modifier at all, would fire on ordinary typing inside a text
 *   field — exactly where this extension lives — so it's rejected outright
 *   rather than merely discouraged.
 */
export function eventToShortcut(e: ShortcutKeyEvent): string | null {
  if (MODIFIER_CODES.has(e.code)) return null
  if (!e.ctrlKey && !e.altKey && !e.metaKey) return null

  const parts: string[] = []
  if (e.ctrlKey) parts.push('Ctrl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  if (e.metaKey) parts.push('Meta')
  parts.push(codeToKeyLabel(e.code))
  return parts.join('+')
}

const MAC_SYMBOLS: Record<(typeof MODIFIER_ORDER)[number], string> = {
  Ctrl: '⌃',
  Alt: '⌥',
  Shift: '⇧',
  Meta: '⌘',
}

function isMacPlatform(platform: string): boolean {
  return /Mac|iPhone|iPad|iPod/i.test(platform)
}

/**
 * Formats a shortcut spec string (as produced by `eventToShortcut`) for
 * display. On macOS this renders the VSCode-style symbols (⌃⌥⇧⌘) with no
 * separators; everywhere else it's returned as-is (`Ctrl+Alt+F`).
 *
 * `platform` defaults to `navigator.platform` but can be overridden, so this
 * stays testable without a real `navigator` (or across simulated platforms)
 * under Node.
 */
export function formatShortcutForDisplay(
  s: string,
  platform: string = typeof navigator === 'undefined' ? '' : navigator.platform,
): string {
  if (!isMacPlatform(platform)) return s
  return s
    .split('+')
    .map((part) => (part in MAC_SYMBOLS ? MAC_SYMBOLS[part as keyof typeof MAC_SYMBOLS] : part))
    .join('')
}
