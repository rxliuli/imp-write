import { eventToShortcut, type ShortcutKeyEvent } from './shortcut'
import { isInputElement } from './selection'
import type { Command } from './settings'

/**
 * The subset of `KeyboardEvent` the shortcut-matching logic needs. A real
 * `KeyboardEvent` satisfies this structurally (it's a superset of
 * `ShortcutKeyEvent`), so `content.ts` can pass one straight in — but this
 * stays DOM-free otherwise, so it's unit-testable without a real event.
 */
export type ShortcutMatchEvent = ShortcutKeyEvent

export interface ShortcutHandlerDeps {
  /** True while a command is already mid-flight; suppresses re-entrant triggers. */
  isBusy: () => boolean
  /** Resolves the element the shortcut should act on (drills into shadow roots, etc). */
  getActiveElement: () => HTMLElement | null
}

export interface ShortcutMatch {
  command: Command
  element: HTMLElement
}

/**
 * Resolves a keydown event to a bound command, or `null` if it doesn't match
 * anything actionable. Pulled out of `content.ts`'s keydown listener so the
 * matching logic — which used to be inline and untestable — can be exercised
 * directly with synthetic events.
 *
 * Deliberately does **not** check `e.isComposing`. A shortcut spec always
 * requires Ctrl/Alt/Meta (see `eventToShortcut`), and genuine CJK IME
 * candidate-selection keystrokes never hold those modifiers — so a *matched*
 * shortcut can never actually be an in-progress composition keystroke.
 * Checking `isComposing` here used to matter in theory, but broke real
 * shortcuts in practice: on macOS, Option-modified character-producing keys
 * (e.g. Option+T -> "†") are routed through the same NSTextInputClient path
 * as IME composition, and some Chromium versions surface that as
 * `isComposing: true` on the keydown itself even though the character
 * resolves atomically in a single keystroke (no multi-key composition
 * actually happens). Bailing out for those silently let the special
 * character reach the field instead of running the bound command.
 */
export function matchShortcut(
  e: ShortcutMatchEvent,
  shortcuts: Record<string, string>,
  commands: Command[],
  deps: ShortcutHandlerDeps,
): ShortcutMatch | null {
  if (deps.isBusy()) return null

  const spec = eventToShortcut(e)
  if (!spec) return null

  const commandName = Object.entries(shortcuts).find(
    ([, s]) => s === spec,
  )?.[0]
  if (!commandName) return null

  const element = deps.getActiveElement()
  if (!isInputElement(element)) return null

  const command = commands.find(
    (c) => c.name.toLowerCase() === commandName.toLowerCase(),
  )
  if (!command) return null

  return { command, element }
}
