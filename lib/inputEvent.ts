/**
 * Classifies a DOM `input` event as one that actually describes a content
 * change, versus a page's own synthetic re-dispatch of its own `input`
 * event.
 *
 * Native `input` events always carry a non-empty `inputType` (`insertText`,
 * `deleteContentBackward`, `insertFromPaste`, `historyUndo`, ...). Editors
 * that re-dispatch their own `input` event for internal bookkeeping leave
 * `inputType` empty and `data` null — Reddit's `<shreddit-composer>`
 * dispatches a bare `new InputEvent('input')` on its wrapper element right
 * after *every* real keystroke, and Slate/React-based editors commonly
 * dispatch a plain `new Event('input')` after a programmatic change.
 *
 * Both trigger detectors must **ignore** such events rather than treat them
 * as a real edit: they arrive *after* the genuine keystroke they mirror, so
 * acting on them (disarming the idle detector / resetting the space-gesture
 * run) cancels the trigger that keystroke just armed. That is exactly why
 * typing `/fix` in a Reddit comment box did nothing — see
 * `lib/IdleTriggerDetector.ts` and `entrypoints/content.ts`'s gesture
 * wiring.
 */
export function isInformativeInputEvent(event: Event): event is InputEvent {
  return event instanceof InputEvent && !!event.inputType
}
