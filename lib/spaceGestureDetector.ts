/**
 * The "three spaces in a row" gesture for summoning the floating command
 * menu (`lib/commandMenu.ts`) — the desktop/all-platforms counterpart to the
 * mobile toolbar-icon tap (`entrypoints/background.ts`'s `action.onClicked`
 * + `showCommandMenu`). Ported from a prior "UniversalSpaceDetector"
 * (originally written for the sibling `input-translator` extension, at
 * `/Users/rxliuli/code/web/input-translator/lib/UniversalSpaceDetector.ts`)
 * but reworked to match this codebase's "arm" model
 * (`lib/IdleTriggerDetector.ts`) instead of upstream's own keydown/beforeinput
 * split: rather than a dedicated class with its own desktop-vs-mobile event
 * wiring, `reduceSpaceGesture` below is a single pure function driven by the
 * exact same `input`-event source `IdleTriggerDetector` already listens
 * on — content.ts wires up a second, independent capture-phase `input`
 * listener that calls this function, the same way `entrypoints/content.ts`'s
 * keyboard-shortcut listener calls `lib/shortcutHandler.ts`'s `matchShortcut`
 * inline rather than wrapping it in a class.
 *
 * ## Porting note: upstream has no iOS/Gboard "double-space → period"
 * handling
 *
 * Some mobile keyboards (iOS's own keyboard, Gboard) auto-convert two quick
 * space taps right after a word into ". " (a period + one space) — so a
 * literal "three real space keystrokes in a row" can, on those keyboards,
 * never actually reach the page as three `insertText`/data===" " events; the
 * would-be second tap arrives as something else entirely (commonly a
 * `deleteContentBackward` removing the trailing space, followed by an
 * `insertText` whose `data` is `". "` or `"."`). The upstream
 * `UniversalSpaceDetector` (checked directly against its current source and
 * full git history in the sibling repo above) has **no special-casing for
 * this** — it only widens the accepted "space" character set (CJK ideographic
 * space, NBSP) and gives mobile a longer inter-tap timeout (800ms vs 500ms).
 * Reworking this function to reverse-engineer that OS-level substitution
 * would be speculative (unverifiable without a real device, and easy to get
 * subtly wrong for something this codebase has no way to test), so it isn't
 * attempted here. Practically: this gesture may simply be less reliable on
 * a keyboard with that autocorrect feature enabled — see this module's
 * `stripTrailingGestureSpaces` and its doc comment for the resulting
 * constraint on cleanup, and the top-level task write-up for this flagged
 * limitation.
 */

/** How many real, consecutive space keystrokes summon the menu. */
export const SPACE_GESTURE_TARGET_COUNT = 3

/**
 * How long a gap between two qualifying space keystrokes is still considered
 * "the same run" — generous enough for a deliberately-slow triple-tap, tight
 * enough that idly resting a finger on the space bar between unrelated
 * sentences doesn't accidentally chain into a trigger.
 */
export const SPACE_GESTURE_MAX_GAP_MS = 600

export interface SpaceGestureState {
  /** The element the current run is happening in — a run never carries over across a focus change. */
  element: HTMLElement | null
  /** Consecutive qualifying space keystrokes seen so far in this run. */
  count: number
  /** `Date.now()` of the last qualifying keystroke, for `SPACE_GESTURE_MAX_GAP_MS`. */
  lastTime: number
}

export const INITIAL_SPACE_GESTURE_STATE: SpaceGestureState = {
  element: null,
  count: 0,
  lastTime: 0,
}

/**
 * The subset of `InputEvent` this function needs. A real `InputEvent`
 * satisfies this structurally — same convention as
 * `lib/shortcutHandler.ts`'s `ShortcutMatchEvent` — so content.ts can pass
 * one straight in, while this stays DOM-free otherwise for easy unit
 * testing.
 */
export interface SpaceGestureInputEvent {
  inputType: string
  data: string | null
  isComposing: boolean
}

export interface SpaceGestureMatch {
  /** The next state to carry into the following call. */
  state: SpaceGestureState
  /** True exactly once, the instant `count` reaches `SPACE_GESTURE_TARGET_COUNT` — `state` is already reset back to a fresh run at that point, so the caller doesn't need to reset anything itself. */
  fire: boolean
}

/**
 * Pure reducer: given the gesture's current `state`, the element the input
 * event landed in (already resolved by the caller — see
 * `lib/selection.ts`'s `getActiveElement`, which drills through shadow
 * roots — `null` if there wasn't a qualifying editable element focused),
 * the qualifying `event` fields, and `now`, decides whether this keystroke
 * extends the run, starts a new one, or breaks it outright.
 *
 * Mirrors `IdleTriggerDetector`'s "arm" model's reset philosophy: anything
 * that isn't a genuine, single `insertText` space keystroke — deletions,
 * paste, native undo/redo (`historyUndo`/`historyRedo`), drag-and-drop, IME
 * composition commits, or simply no qualifying element focused — breaks the
 * run outright rather than merely failing to extend it. A composing
 * (`isComposing: true`) event is the one exception: it's left untouched
 * (neither extends nor breaks the run) rather than either arming or
 * resetting on it, because some Chromium builds mark certain single, atomic,
 * non-IME keystrokes as `isComposing: true` — e.g. macOS's
 * Option-modified character keys (Option+T → "†"), per
 * `lib/shortcutHandler.ts`'s identical documented pitfall. Without this
 * guard, an unrelated Option-modified keystroke landing between two
 * legitimate space taps would silently wipe out an otherwise-valid run.
 */
export function reduceSpaceGesture(
  state: SpaceGestureState,
  element: HTMLElement | null,
  event: SpaceGestureInputEvent,
  now: number,
): SpaceGestureMatch {
  if (event.isComposing) {
    return { state, fire: false }
  }

  if (!element || event.inputType !== 'insertText' || event.data !== ' ') {
    // Not a genuine, single real-space keystroke in a qualifying element —
    // deletions, paste, historyUndo/historyRedo, drop, any other inserted
    // text (including a single non-space character) all land here and
    // break the run outright, same as `IdleTriggerDetector.disarm()`.
    return { state: INITIAL_SPACE_GESTURE_STATE, fire: false }
  }

  const continuesRun =
    state.element === element && now - state.lastTime <= SPACE_GESTURE_MAX_GAP_MS

  const count = (continuesRun ? state.count : 0) + 1
  if (count >= SPACE_GESTURE_TARGET_COUNT) {
    return { state: INITIAL_SPACE_GESTURE_STATE, fire: true }
  }
  return { state: { element, count, lastTime: now }, fire: false }
}

/**
 * Strips the gesture's own trailing space run off `text` before it's used
 * as a command's prompt input — the menu-summoning gesture shouldn't itself
 * become part of what gets sent to the AI, the same way
 * `lib/commands.ts`'s `parseCommandTrigger` consumes the `/token` it
 * matched rather than passing it through. Only strips the run if it's
 * still exactly there (a no-op otherwise) — mirrors `parseCommandTrigger`
 * only ever consuming what it actually matched, never guessing.
 *
 * `spaceCount` (defaults to `SPACE_GESTURE_TARGET_COUNT`) is how many
 * trailing spaces to strip — not always exactly 3: a same-rhythm extra tap
 * absorbed by the open menu (see `shouldAbsorbGestureMenuInput` below)
 * grows the field by one more real space character each time, and the
 * caller is expected to pass the *actual* resulting count here so this
 * strips precisely what the gesture (plus any absorbed extra taps) really
 * typed — never more, never less. Only ever removes exactly that many
 * spaces, not "however many trailing spaces happen to be there" — if the
 * field already had its own trailing spaces before the gesture started,
 * those are left alone; only the run the gesture (and any absorbed taps)
 * itself typed is consumed.
 */
export function stripTrailingGestureSpaces(
  text: string,
  spaceCount: number = SPACE_GESTURE_TARGET_COUNT,
): string {
  if (spaceCount <= 0) return text
  const suffix = ' '.repeat(spaceCount)
  return text.endsWith(suffix) ? text.slice(0, -suffix.length) : text
}

/**
 * Tracks how many trailing gesture spaces are believed to currently be in
 * the field while its command menu is open, and the timestamp of the most
 * recently counted one — the "residue" `stripTrailingGestureSpaces` above
 * needs to strip precisely, and the anchor `shouldAbsorbGestureMenuInput`
 * (below) measures its rhythm window against.
 */
export interface GestureMenuResidueState {
  /** How many trailing real gesture spaces are in the field right now — starts at `SPACE_GESTURE_TARGET_COUNT` the instant the menu opens, +1 per absorbed extra tap. */
  count: number
  /** `Date.now()` of the most recently counted gesture space (initially, the one that opened the menu). */
  lastTime: number
}

export interface GestureMenuInputDecision {
  /** The next residue state — unchanged (by reference) when `absorb` is `false`. */
  state: GestureMenuResidueState
  /** Whether this input should be absorbed — the menu should stay open rather than close. */
  absorb: boolean
}

/**
 * Decides whether a `beforeinput` the target element receives *while its
 * gesture-triggered command menu is still open* should be "absorbed" —
 * extending the gesture's own trailing space run and keeping the menu open
 * — rather than closing it like any other new input normally would (see
 * `CommandMenu`'s `onTargetInput` callback, which this feeds).
 *
 * Only a genuine, single, real space keystroke (`insertText`,
 * `data === ' '`, not mid-composition) landing within
 * `SPACE_GESTURE_MAX_GAP_MS` of the last counted gesture space qualifies —
 * reusing `reduceSpaceGesture`'s own rhythm-window constant rather than a
 * new one, so "3 spaces summons the menu" and "one more space right after
 * doesn't close it" share one definition of "right after". A space typed
 * *outside* that window is a deliberate boundary, not an oversight: the
 * user paused, looked at the menu, and pressed space again — that's
 * ordinary new input, not a same-rhythm mis-tap, and closes the menu like
 * anything else would. Every other input (a letter, a deletion, a paste,
 * ...) is never absorbed either, regardless of timing.
 */
export function shouldAbsorbGestureMenuInput(
  state: GestureMenuResidueState,
  event: SpaceGestureInputEvent,
  now: number,
): GestureMenuInputDecision {
  if (
    event.isComposing ||
    event.inputType !== 'insertText' ||
    event.data !== ' ' ||
    now - state.lastTime > SPACE_GESTURE_MAX_GAP_MS
  ) {
    return { state, absorb: false }
  }
  return { state: { count: state.count + 1, lastTime: now }, absorb: true }
}
