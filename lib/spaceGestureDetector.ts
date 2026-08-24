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
 * ## The "double-space → period" autocorrect, and why it used to break this
 *
 * Several platforms auto-convert two quick space taps right after a word
 * into a trailing period — so a literal "three real space keystrokes in a
 * row" doesn't always reach the page as three plain `insertText`/`data===' '`
 * events; the second physical tap can arrive as something else entirely.
 * This was originally treated as an unfixable, device-only quirk (no way to
 * test it without a real device) — but real on-device traces (captured with
 * an input-inspector devtools recorder, one per platform/language
 * combination) turned out to show four small, closed, and — as long as the
 * exact `inputType`/`data`/`dataTransfer` shape is matched precisely —
 * reliably-recognizable event patterns for the second tap:
 *
 * - **macOS, English**: a single `insertText` event with `data === ". "`
 *   (period + one space) — this one event *replaces* the previous trailing
 *   space outright, its own `data` already carrying the space back.
 * - **macOS, Chinese/Japanese/Korean-input locale**: the same shape, but
 *   `data === "。"` (the fullwidth ideographic full stop) — no trailing
 *   space baked in, since the fullwidth punctuation already reads as
 *   "closed" without one.
 * - **iOS, English**: an `insertReplacementText` event whose `data` is
 *   `null` — the actual replacement text (`"."`) instead lives in
 *   `event.dataTransfer.getData('text/plain')` — **immediately followed by
 *   a *separate* `insertText`/`data === ' '` event**, both firing within a
 *   couple of milliseconds of each other, for that one same physical tap.
 * - **iOS, Chinese/Japanese/Korean-input locale**: a `deleteContentBackward`
 *   (removing the old trailing space) immediately followed by a separate
 *   `insertText`/`data === "。"` event, again both within a couple of
 *   milliseconds — no single combined "replacement" event at all here.
 *
 * (On macOS specifically, the *second* tap's own `keydown` was observed
 * firing *after* the beforeinput/input pair that performs the
 * substitution — a real ordering inversion, not a trace artifact. This
 * module and its caller never look at `keydown` at all, only `input`
 * events, so it doesn't matter here — flagged only so nobody "fixes" this
 * by reaching for `keydown` later.)
 *
 * `reduceSpaceGesture` below recognizes all four shapes (folded into "R1"
 * for the two macOS cases, "R2" for iOS English, "R3" for iOS
 * Chinese/Japanese/Korean) as *one* physical keystroke each — counted
 * toward the gesture's `tapCount` exactly like an ordinary space tap would
 * be, with the field's actual resulting trailing content (`residueLen`
 * characters — no longer always exactly 3 literal spaces) tracked precisely
 * enough that `stripTrailingGestureResidue` can still remove exactly, and
 * only, what the gesture itself produced. A completely unrecognized
 * substitution shape (e.g. some other browser/OS's own autocorrect,
 * spell-check, or Android's — not covered by any available trace) simply
 * isn't special-cased and falls through to the ordinary "not a real space
 * keystroke → the run breaks" rule, the same graceful degradation this
 * module already had for every other kind of unexpected input.
 */

/** How many *physical* keystrokes (not necessarily 3 literal space characters — see the module docstring) summon the menu. */
export const SPACE_GESTURE_TARGET_COUNT = 3

/**
 * How long a gap between two qualifying keystrokes is still considered "the
 * same run" — generous enough for a deliberately-slow triple-tap, tight
 * enough that idly resting a finger on the space bar between unrelated
 * sentences doesn't accidentally chain into a trigger.
 */
export const SPACE_GESTURE_MAX_GAP_MS = 600

/**
 * How long a *second* `input` event is still considered part of the exact
 * same physical keystroke as a preceding one — specifically, the gap
 * between an R2/R3 substitution's two halves (see the module docstring).
 * On-device traces show this gap as sub-millisecond to a few milliseconds;
 * 100ms is generous slack on top of that while staying nowhere near
 * `SPACE_GESTURE_MAX_GAP_MS`, so it can never be confused with "the next
 * separate tap in the same rhythm".
 */
export const SAME_TAP_WINDOW_MS = 100

// A period-like character: the plain full stop, the fullwidth/ideographic
// full stop (macOS/iOS CJK-locale autocorrect), and the fullwidth Latin
// full stop (a third variant some IMEs use) — deliberately not a broader
// "any punctuation" class, since only these specific characters have been
// observed in a real substitution trace.
const PERIOD_CHARS = '.。．'
// R1 (macOS): the substitution's `data` is a period-like character,
// optionally followed by exactly one trailing space (English bakes the
// space in; Chinese/Japanese/Korean doesn't). A literal ` ?` rather than
// `\s?` — only a plain ASCII space has ever been observed in a real
// substitution trace, and `\s` would also admit tabs/other whitespace
// noise the OS substitution itself never actually produces.
const PERIOD_WITH_OPTIONAL_SPACE_RE = new RegExp(`^[${PERIOD_CHARS}] ?$`)
// R2/R3: a lone period-like character on its own — R2's
// `dataTransfer.getData('text/plain')`, or R3's follow-up `insertText.data`.
const PERIOD_CHAR_RE = new RegExp(`^[${PERIOD_CHARS}]$`)
// The defensive check `stripTrailingGestureResidue` runs before removing
// anything: every trailing character it's about to strip must individually
// be either a literal space or one of the period-like characters above.
const GESTURE_RESIDUE_CHAR_RE = new RegExp(`^[ ${PERIOD_CHARS}]$`)

export interface SpaceGestureState {
  /** The element the current run is happening in — a run never carries over across a focus change. */
  element: HTMLElement | null
  /** Consecutive qualifying *physical keystrokes* seen so far in this run — not always the same as the number of characters typed; see `residueLen`. */
  tapCount: number
  /** How many characters the run has actually deposited at the end of the field so far — usually equal to `tapCount` (each tap is one space), but diverges once an R1/R2/R3 substitution is involved (see the module docstring). This is what `stripTrailingGestureResidue` removes. */
  residueLen: number
  /** `Date.now()` of the last event that advanced `tapCount`/`residueLen` (including entering `pendingDelete`), for `SPACE_GESTURE_MAX_GAP_MS`. */
  lastTime: number
  /**
   * Non-null for exactly one subsequent event, right after an R2
   * (iOS-English) substitution: the timestamp of that substitution, so the
   * very next event can be checked against `SAME_TAP_WINDOW_MS` to decide
   * whether it's the substitution's own trailing-space half (same
   * keystroke, coalesced) or a genuinely new, separate tap.
   */
  justSubstitutedAt: number | null
  /**
   * True for exactly one subsequent event, right after a
   * `deleteContentBackward` that might be the first half of an R3
   * (iOS-Chinese/Japanese/Korean) substitution: the very next event is
   * checked against `SAME_TAP_WINDOW_MS` (measured from `lastTime`, which a
   * transition into this state also updates) to decide whether it's R3's
   * completing period, or a genuine, unrelated deletion — in which case the
   * whole run disarms. No menu can ever fire while this is `true` (see
   * `reduceSpaceGesture`'s doc comment).
   */
  pendingDelete: boolean
}

// Frozen — this single shared instance is returned from many call sites
// below (every "disarm" branch), so it must never be mutated in place; a
// caller that accidentally wrote through it (rather than replacing its own
// local reference) would silently corrupt every other in-progress run too.
export const INITIAL_SPACE_GESTURE_STATE: SpaceGestureState = Object.freeze({
  element: null,
  tapCount: 0,
  residueLen: 0,
  lastTime: 0,
  justSubstitutedAt: null,
  pendingDelete: false,
})

/**
 * The subset of `InputEvent` this function needs. A real `InputEvent`
 * satisfies this structurally — same convention as
 * `lib/shortcutHandler.ts`'s `ShortcutMatchEvent` — so content.ts can pass
 * one straight in, while this stays DOM-free otherwise for easy unit
 * testing. `dataTransfer` is optional (real `insertReplacementText` events
 * always populate it, but a hand-built test event may omit it entirely
 * rather than explicitly passing `null`).
 */
export interface SpaceGestureInputEvent {
  inputType: string
  data: string | null
  isComposing: boolean
  dataTransfer?: DataTransfer | null
}

export interface SpaceGestureMatch {
  /** The next state to carry into the following call. */
  state: SpaceGestureState
  /** True exactly once, the instant `tapCount` reaches `SPACE_GESTURE_TARGET_COUNT` — `state` is already reset back to a fresh run at that point, so the caller doesn't need to reset anything itself. */
  fire: boolean
  /**
   * How many trailing residue characters this event's run has deposited so
   * far — the same value `state.residueLen` would hold, *except* the
   * instant `fire` is `true`, where `state` is already reset back to
   * `INITIAL_SPACE_GESTURE_STATE` (so `state.residueLen` reads back `0`)
   * but the caller still needs to know exactly how much residue to seed
   * `GestureMenuResidueState` with — see content.ts's
   * `showCommandMenuForGesture`. Redundant with (but always equal to)
   * `state.residueLen` whenever `fire` is `false`.
   */
  residueLen: number
}

/** A state update that only ever advances `tapCount`, checking whether it just reached the trigger threshold. Shared by every branch below that increments `tapCount`. */
function advance(
  element: HTMLElement,
  tapCount: number,
  residueLen: number,
  now: number,
  justSubstitutedAt: number | null = null,
): SpaceGestureMatch {
  if (tapCount >= SPACE_GESTURE_TARGET_COUNT) {
    return { state: INITIAL_SPACE_GESTURE_STATE, fire: true, residueLen }
  }
  return {
    state: { element, tapCount, residueLen, lastTime: now, justSubstitutedAt, pendingDelete: false },
    fire: false,
    residueLen,
  }
}

// Frozen for the same reason as `INITIAL_SPACE_GESTURE_STATE` — shared
// across every "disarm" return site below.
const RESET: SpaceGestureMatch = Object.freeze({
  state: INITIAL_SPACE_GESTURE_STATE,
  fire: false,
  residueLen: 0,
})

/**
 * Pure reducer: given the gesture's current `state`, the element the input
 * event landed in (already resolved by the caller — see
 * `lib/selection.ts`'s `getActiveElement`, which drills through shadow
 * roots — `null` if there wasn't a qualifying editable element focused),
 * the qualifying `event` fields, and `now`, decides whether this keystroke
 * extends the run, starts a new one, or breaks it outright.
 *
 * Mirrors `IdleTriggerDetector`'s "arm" model's reset philosophy: anything
 * that isn't a genuine, single physical keystroke this element just
 * received — deletions (other than a possible R3 first half — see below),
 * paste, native undo/redo (`historyUndo`/`historyRedo`), drag-and-drop, IME
 * composition commits, or simply no qualifying element focused — breaks the
 * run outright rather than merely failing to extend it. A composing
 * (`isComposing: true`) event is the one exception: it's left completely
 * untouched (neither extends, breaks, nor advances any of the R1/R2/R3
 * in-progress transients) rather than either arming or resetting on it,
 * because some Chromium builds mark certain single, atomic, non-IME
 * keystrokes as `isComposing: true` — e.g. macOS's Option-modified
 * character keys (Option+T → "†"), per `lib/shortcutHandler.ts`'s identical
 * documented pitfall. Without this guard, an unrelated Option-modified
 * keystroke landing between two legitimate taps would silently wipe out an
 * otherwise-valid run.
 *
 * `pendingDelete` and `justSubstitutedAt` (see `SpaceGestureState`'s doc
 * comments) are each resolved by looking *one event ahead* of the moment
 * they're set — so this function checks them first, before anything else,
 * every time it's called. `pendingDelete` in particular can never itself
 * report `fire: true` — a `deleteContentBackward` never completes the
 * gesture on its own; only the period `insertText` that (maybe) follows it
 * can.
 */
export function reduceSpaceGesture(
  state: SpaceGestureState,
  element: HTMLElement | null,
  event: SpaceGestureInputEvent,
  now: number,
): SpaceGestureMatch {
  if (event.isComposing) {
    return { state, fire: false, residueLen: state.residueLen }
  }

  if (!element) {
    return RESET
  }

  // --- R3's second half (iOS Chinese/Japanese/Korean): resolve whatever a
  // just-seen `deleteContentBackward` turns out to have been.
  if (state.pendingDelete) {
    const sameElement = state.element === element
    const withinWindow = now - state.lastTime <= SAME_TAP_WINDOW_MS
    if (
      sameElement &&
      withinWindow &&
      event.inputType === 'insertText' &&
      event.data !== null &&
      PERIOD_CHAR_RE.test(event.data)
    ) {
      return advance(element, state.tapCount + 1, state.residueLen + event.data.length, now)
    }
    // Anything else — including the window simply elapsing — means the
    // delete wasn't R3's first half after all; it was a genuine deletion,
    // which disarms outright (same as every other deletion in this
    // reducer). This event is consumed by that disarm, not re-evaluated as
    // a fresh candidate of its own.
    return RESET
  }

  // --- R2's second half (iOS English): resolve whatever a just-seen
  // substitution's trailing-space companion turns out to be.
  if (state.justSubstitutedAt !== null) {
    const sameElement = state.element === element
    const withinWindow = now - state.justSubstitutedAt <= SAME_TAP_WINDOW_MS
    if (sameElement && withinWindow && event.inputType === 'insertText' && event.data === ' ') {
      // `tapCount` intentionally does not advance here — this space is the
      // second DOM event of the *same* physical keystroke the substitution
      // below already counted once. Advancing it again would let two iOS
      // English taps alone reach the trigger threshold of three.
      return advance(element, state.tapCount, state.residueLen + 1, now)
    }
    // Not a matching trailing space (or the window elapsed): this was a
    // standalone substitution after all (the macOS shape doesn't have a
    // separate second half), or something unrelated entirely. Clear the
    // transient and fall through to evaluate *this* event under the
    // ordinary rules below — unlike `pendingDelete` above, this is not
    // itself treated as a disarm.
    state = { ...state, justSubstitutedAt: null }
  }

  const continuesRun = state.element === element && now - state.lastTime <= SPACE_GESTURE_MAX_GAP_MS

  // --- A deletion: either the first half of an R3 candidate, or a genuine
  // backspace that disarms outright.
  if (event.inputType === 'deleteContentBackward') {
    if (continuesRun && state.tapCount >= 1) {
      // Hold off on disarming — the very next event might complete R3.
      // `lastTime` becomes *this* delete's own timestamp, which the
      // `pendingDelete` branch above measures its own follow-up window
      // against.
      return {
        state: {
          element,
          tapCount: state.tapCount,
          residueLen: state.residueLen - 1,
          lastTime: now,
          justSubstitutedAt: null,
          pendingDelete: true,
        },
        fire: false,
        residueLen: state.residueLen - 1,
      }
    }
    return RESET
  }

  // --- R1 (macOS) / R2's first half (iOS English): a substitution
  // replacing the previous trailing space with a period-like run, in a
  // single `insertText` (R1) or `insertReplacementText` (R2) event. Only
  // even considered once a real space has already armed this run
  // (`tapCount >= 1`) and within the ordinary rhythm window — a lone
  // period the user typed on purpose (nothing armed yet) must never start
  // counting toward the gesture.
  if (continuesRun && state.tapCount >= 1) {
    if (
      event.inputType === 'insertText' &&
      event.data !== null &&
      PERIOD_WITH_OPTIONAL_SPACE_RE.test(event.data)
    ) {
      return advance(element, state.tapCount + 1, state.residueLen - 1 + event.data.length, now)
    }
    if (event.inputType === 'insertReplacementText') {
      const replacementText = event.dataTransfer?.getData('text/plain') ?? ''
      if (PERIOD_CHAR_RE.test(replacementText)) {
        return advance(
          element,
          state.tapCount + 1,
          state.residueLen - 1 + replacementText.length,
          now,
          now, // seeds `justSubstitutedAt` — see R2's second half, above.
        )
      }
    }
  }

  // --- Ordinary case: a genuine, single, real space keystroke. Everything
  // else — a single non-space character, an unrecognized substitution
  // shape, paste, undo/redo, drop, ... — disarms outright, the same
  // graceful degradation this reducer already had for anything it doesn't
  // specifically recognize (e.g. an Android autocorrect variant no
  // available trace covers).
  if (event.inputType !== 'insertText' || event.data !== ' ') {
    return RESET
  }
  const tapCount = (continuesRun ? state.tapCount : 0) + 1
  const residueLen = (continuesRun ? state.residueLen : 0) + 1
  return advance(element, tapCount, residueLen, now)
}

/**
 * Strips the gesture's own trailing residue off `text` before it's used as
 * a command's prompt input — the menu-summoning gesture shouldn't itself
 * become part of what gets sent to the AI, the same way
 * `lib/commands.ts`'s `parseCommandTrigger` consumes the `/token` it
 * matched rather than passing it through.
 *
 * `residueLen` (defaults to `SPACE_GESTURE_TARGET_COUNT`, i.e. "3 plain
 * spaces", for a caller that never went through `reduceSpaceGesture`'s
 * richer R1/R2/R3 accounting) is how many trailing *characters* to strip —
 * not always 3, and not always spaces: an R1/R2/R3 substitution changes
 * what the run's trailing characters actually are (see the module
 * docstring), and a same-rhythm extra tap absorbed by the open menu (see
 * `shouldAbsorbGestureMenuInput` below) grows it by one more. The caller is
 * expected to pass the field's actual, current residue length here so this
 * strips precisely what the gesture (plus any R1/R2/R3 substitution and any
 * absorbed extra taps) really produced — never more, never less.
 *
 * Before removing anything, every one of the last `residueLen` characters
 * must individually be a literal space or one of the period-like
 * characters `reduceSpaceGesture` recognizes (`.`, `。`, `．`) — if even one
 * of them isn't, nothing is stripped at all. This is deliberately
 * all-or-nothing: if the tracked `residueLen` and the field's actual
 * content have somehow drifted out of sync, leaving a little gesture
 * residue in the prompt is a far smaller problem than silently chewing into
 * the user's real trailing content instead.
 */
export function stripTrailingGestureResidue(
  text: string,
  residueLen: number = SPACE_GESTURE_TARGET_COUNT,
): string {
  if (residueLen <= 0 || residueLen > text.length) {
    return text
  }
  const tail = text.slice(text.length - residueLen)
  for (const ch of tail) {
    if (!GESTURE_RESIDUE_CHAR_RE.test(ch)) {
      return text
    }
  }
  return text.slice(0, text.length - residueLen)
}

/**
 * Tracks how many trailing gesture residue characters are believed to
 * currently be in the field while its command menu is open (seeded from
 * `reduceSpaceGesture`'s own `residueLen` the instant the gesture fires —
 * see content.ts's `showCommandMenuForGesture`), and the timestamp of the
 * most recently counted one — what `stripTrailingGestureResidue` above
 * needs to strip precisely, and the anchor `shouldAbsorbGestureMenuInput`
 * (below) measures its rhythm window against.
 */
export interface GestureMenuResidueState {
  /** How many trailing gesture residue characters are in the field right now — seeded from `reduceSpaceGesture`'s `residueLen` the instant the menu opens, +1 per absorbed extra space tap (see `shouldAbsorbGestureMenuInput`; absorption itself only ever adds plain spaces, never another R1/R2/R3 substitution). */
  residueLen: number
  /** `Date.now()` of the most recently counted gesture character (initially, the keystroke that opened the menu). */
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
 * extending the gesture's own trailing residue and keeping the menu open —
 * rather than closing it like any other new input normally would (see
 * `CommandMenu`'s `onTargetInput` callback, which this feeds).
 *
 * Only a genuine, single, real space keystroke (`insertText`,
 * `data === ' '`, not mid-composition) landing within
 * `SPACE_GESTURE_MAX_GAP_MS` of the last counted gesture character
 * qualifies — reusing `reduceSpaceGesture`'s own rhythm-window constant
 * rather than a new one, so "3 taps summons the menu" and "one more tap
 * right after doesn't close it" share one definition of "right after". A
 * space typed *outside* that window is a deliberate boundary, not an
 * oversight: the user paused, looked at the menu, and pressed space
 * again — that's ordinary new input, not a same-rhythm mis-tap, and closes
 * the menu like anything else would. Every other input (a letter, a
 * deletion, a paste, ...) is never absorbed either, regardless of timing —
 * deliberately not R1/R2/R3-aware itself: the menu is already open and
 * showing real commands by the time this runs, so a further "double-space
 * autocorrect" mid-absorption is treated as ordinary new input like
 * anything else non-space would be, rather than chased through the same
 * substitution accounting `reduceSpaceGesture` needs before the menu even
 * exists.
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
  return { state: { residueLen: state.residueLen + 1, lastTime: now }, absorb: true }
}

/**
 * Whether the three-tap space gesture should be wired up at all — decided
 * once, at content-script init (see entrypoints/content.ts's
 * `setupSpaceGesture`). Pure so the actual gating logic (not the async
 * platform/storage lookups feeding it — `browser.runtime.getPlatformInfo`
 * and `lib/testHooks.ts`'s `getSpaceGestureTestOverride`) is independently
 * unit-testable.
 *
 * Deliberately mobile-only in production: desktop already has three other
 * ways to trigger a command (the `/token` idle pause, the right-click
 * menu, and keyboard shortcuts), none of which have this gesture's
 * false-positive risk — writing Markdown with space-indented code blocks
 * on desktop routinely types 3+ consecutive spaces, which would otherwise
 * pop the command menu open constantly while typing completely unrelated
 * content. Mobile has no keyboard shortcuts and an unreliable-to-absent
 * right-click context menu, so the gesture (alongside the toolbar-icon
 * tap) fills a real gap there instead of duplicating an already-good
 * desktop path.
 *
 * `testOverride` exists solely so Playwright's e2e harness — which only
 * ever runs desktop Chromium, never a real mobile browser — can still
 * exercise this path end-to-end; see `lib/testHooks.ts`'s doc comment for
 * the full rationale. `isMobile || testOverride ∥ import.meta.env.DEV`:
 * any one on its own is sufficient, and neither the override nor DEV ever
 * *disables* the gesture on an actually-mobile platform.
 *
 * The DEV arm is what lets a `wxt dev` build (where `import.meta.env.DEV`
 * is `true`) summon the gesture on desktop too, so the mobile-only UI work
 * (4-row command cap, header Settings gear) can be exercised in a desktop
 * dev build without having to fake a platform. It's a no-op in a production
 * build, where Vite replaces `import.meta.env.DEV` with `false` and the
 * whole arm is dead-code-eliminated.
 */
export function isSpaceGestureEnabled(isMobile: boolean, testOverride: boolean): boolean {
  return isMobile || testOverride || import.meta.env.DEV
}
