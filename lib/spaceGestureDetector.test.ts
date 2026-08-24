import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  INITIAL_SPACE_GESTURE_STATE,
  isSpaceGestureEnabled,
  reduceSpaceGesture,
  SAME_TAP_WINDOW_MS,
  shouldAbsorbGestureMenuInput,
  SPACE_GESTURE_MAX_GAP_MS,
  SPACE_GESTURE_TARGET_COUNT,
  stripTrailingGestureResidue,
  type GestureMenuResidueState,
  type SpaceGestureInputEvent,
  type SpaceGestureState,
} from './spaceGestureDetector'

let input: HTMLInputElement
let other: HTMLInputElement

beforeEach(() => {
  input = document.createElement('input')
  input.type = 'text'
  document.body.append(input)
  other = document.createElement('input')
  other.type = 'text'
  document.body.append(other)
})

afterEach(() => {
  input.remove()
  other.remove()
})

/** A real `insertText` `InputEvent` — matches what a genuine space keystroke fires. */
function spaceInputEvent(overrides: Partial<InputEventInit> = {}): InputEvent {
  return new InputEvent('input', {
    inputType: 'insertText',
    data: ' ',
    bubbles: true,
    cancelable: true,
    ...overrides,
  })
}

/** A real `insertReplacementText` `InputEvent` carrying `text` in `dataTransfer['text/plain']` — matches iOS's shape for a "double-space → period" autocorrect substitution (its own `data` is always `null`). */
function replacementInputEvent(text: string): InputEvent {
  const dataTransfer = new DataTransfer()
  dataTransfer.setData('text/plain', text)
  return new InputEvent('input', {
    inputType: 'insertReplacementText',
    data: null,
    dataTransfer,
    bubbles: true,
    cancelable: true,
  })
}

describe('reduceSpaceGesture', () => {
  it('does not fire on the first or second space keystroke, fires on the third', () => {
    let state = INITIAL_SPACE_GESTURE_STATE
    const now = 1_000

    let result = reduceSpaceGesture(state, input, spaceInputEvent(), now)
    expect(result.fire).toBe(false)
    expect(result.state.tapCount).toBe(1)
    expect(result.state.residueLen).toBe(1)
    state = result.state

    result = reduceSpaceGesture(state, input, spaceInputEvent(), now + 50)
    expect(result.fire).toBe(false)
    expect(result.state.tapCount).toBe(2)
    expect(result.state.residueLen).toBe(2)
    state = result.state

    result = reduceSpaceGesture(state, input, spaceInputEvent(), now + 100)
    expect(result.fire).toBe(true)
    expect(result.residueLen).toBe(3)
    // Reset back to a fresh run once fired, so the caller never needs to
    // reset anything itself.
    expect(result.state).toEqual(INITIAL_SPACE_GESTURE_STATE)
  })

  // Regression for the Safari/macOS CJK input case: some keyboards (and
  // full-width input modes) emit the ideographic space U+3000 instead of the
  // plain ASCII space U+0020, and French locales U+00A0. input-translator's
  // prior UniversalSpaceDetector recognized all three; imp-write's original
  // `data === ' '` only matched U+0020, so the gesture never fired on Safari.
  it('recognizes the ideographic (U+3000) and non-breaking (U+00A0) spaces (Safari CJK / French)', () => {
    for (const data of ['\u3000', '\u00A0']) {
      let state = INITIAL_SPACE_GESTURE_STATE
      const now = 1_000
      for (let i = 0; i < SPACE_GESTURE_TARGET_COUNT; i++) {
        const result = reduceSpaceGesture(
          state,
          input,
          spaceInputEvent({ data }),
          now + i * 10,
        )
        expect(result.fire).toBe(i === SPACE_GESTURE_TARGET_COUNT - 1)
        state = result.state
      }
    }
  })

  it('a 4th space keystroke right after firing starts a brand new run rather than re-firing immediately', () => {
    let state = INITIAL_SPACE_GESTURE_STATE
    const now = 1_000
    for (let i = 0; i < SPACE_GESTURE_TARGET_COUNT; i++) {
      state = reduceSpaceGesture(state, input, spaceInputEvent(), now + i * 10).state
    }
    const fourth = reduceSpaceGesture(state, input, spaceInputEvent(), now + 1000)
    expect(fourth.fire).toBe(false)
    expect(fourth.state.tapCount).toBe(1)
    expect(fourth.state.residueLen).toBe(1)
  })

  it('resets the run when a non-space character is typed in between', () => {
    let state = INITIAL_SPACE_GESTURE_STATE
    const now = 1_000
    state = reduceSpaceGesture(state, input, spaceInputEvent(), now).state
    state = reduceSpaceGesture(state, input, spaceInputEvent(), now + 10).state
    expect(state.tapCount).toBe(2)

    state = reduceSpaceGesture(
      state,
      input,
      spaceInputEvent({ data: 'k' }),
      now + 20,
    ).state
    expect(state).toEqual(INITIAL_SPACE_GESTURE_STATE)

    const result = reduceSpaceGesture(state, input, spaceInputEvent(), now + 30)
    expect(result.fire).toBe(false)
    expect(result.state.tapCount).toBe(1)
  })

  it('resets on a deletion (deleteContentBackward) mid-run', () => {
    let state = INITIAL_SPACE_GESTURE_STATE
    state = reduceSpaceGesture(state, input, spaceInputEvent(), 1_000).state
    state = reduceSpaceGesture(state, input, spaceInputEvent(), 1_010).state
    expect(state.tapCount).toBe(2)

    const result = reduceSpaceGesture(
      state,
      input,
      spaceInputEvent({ inputType: 'deleteContentBackward', data: null }),
      1_020,
    )
    expect(result.fire).toBe(false)
    // Not reset yet — this exact deletion is *also* a valid R3 first-half
    // candidate (see the R3 describe block below); a real backspace and
    // R3's opening delete are indistinguishable until the following event
    // resolves it, so it enters `pendingDelete` here rather than disarming
    // outright.
    expect(result.state.pendingDelete).toBe(true)
    // The follow-up below (10ms later, still well within
    // SAME_TAP_WINDOW_MS) *does* disarm — but because of its *content*
    // (`data: 'k'`, not a period-like character), not its timing: a
    // pendingDelete only ever resolves into R3 on a matching period
    // `insertText`; anything else — even comfortably inside the window —
    // means the delete really was a genuine, unrelated backspace.
    const after = reduceSpaceGesture(result.state, input, spaceInputEvent({ data: 'k' }), 1_030)
    expect(after.state).toEqual(INITIAL_SPACE_GESTURE_STATE)
  })

  it('resets on native undo (historyUndo)', () => {
    let state = INITIAL_SPACE_GESTURE_STATE
    state = reduceSpaceGesture(state, input, spaceInputEvent(), 1_000).state
    state = reduceSpaceGesture(
      state,
      input,
      spaceInputEvent({ inputType: 'historyUndo', data: null }),
      1_010,
    ).state
    expect(state).toEqual(INITIAL_SPACE_GESTURE_STATE)
  })

  it('resets on native redo (historyRedo)', () => {
    let state = INITIAL_SPACE_GESTURE_STATE
    state = reduceSpaceGesture(state, input, spaceInputEvent(), 1_000).state
    state = reduceSpaceGesture(
      state,
      input,
      spaceInputEvent({ inputType: 'historyRedo', data: null }),
      1_010,
    ).state
    expect(state).toEqual(INITIAL_SPACE_GESTURE_STATE)
  })

  it('resets on paste (insertFromPaste)', () => {
    let state = INITIAL_SPACE_GESTURE_STATE
    state = reduceSpaceGesture(state, input, spaceInputEvent(), 1_000).state
    state = reduceSpaceGesture(
      state,
      input,
      spaceInputEvent({ inputType: 'insertFromPaste', data: 'hi' }),
      1_010,
    ).state
    expect(state).toEqual(INITIAL_SPACE_GESTURE_STATE)
  })

  it('resets on drop (insertFromDrop)', () => {
    let state = INITIAL_SPACE_GESTURE_STATE
    state = reduceSpaceGesture(state, input, spaceInputEvent(), 1_000).state
    state = reduceSpaceGesture(
      state,
      input,
      spaceInputEvent({ inputType: 'insertFromDrop', data: 'hi' }),
      1_010,
    ).state
    expect(state).toEqual(INITIAL_SPACE_GESTURE_STATE)
  })

  it('resets once the gap between two space keystrokes exceeds SPACE_GESTURE_MAX_GAP_MS', () => {
    let state = INITIAL_SPACE_GESTURE_STATE
    state = reduceSpaceGesture(state, input, spaceInputEvent(), 1_000).state
    expect(state.tapCount).toBe(1)

    const result = reduceSpaceGesture(
      state,
      input,
      spaceInputEvent(),
      1_000 + SPACE_GESTURE_MAX_GAP_MS + 1,
    )
    // Too slow to be "the same run" — starts a fresh run at count 1, not 2.
    expect(result.fire).toBe(false)
    expect(result.state.tapCount).toBe(1)
  })

  it('resets when the focused element changes mid-run', () => {
    let state = INITIAL_SPACE_GESTURE_STATE
    state = reduceSpaceGesture(state, input, spaceInputEvent(), 1_000).state
    state = reduceSpaceGesture(state, input, spaceInputEvent(), 1_010).state
    expect(state.tapCount).toBe(2)

    // The 3rd space lands in a different element — starts fresh there,
    // it does not inherit `input`'s count.
    const result = reduceSpaceGesture(state, other, spaceInputEvent(), 1_020)
    expect(result.fire).toBe(false)
    expect(result.state.tapCount).toBe(1)
    expect(result.state.element).toBe(other)
  })

  it('resets when there is no qualifying active element', () => {
    let state = INITIAL_SPACE_GESTURE_STATE
    state = reduceSpaceGesture(state, input, spaceInputEvent(), 1_000).state
    expect(state.tapCount).toBe(1)

    const result = reduceSpaceGesture(state, null, spaceInputEvent(), 1_010)
    expect(result.fire).toBe(false)
    expect(result.state).toEqual(INITIAL_SPACE_GESTURE_STATE)
  })

  // Regression guard for the macOS Option-modified-key pitfall documented in
  // lib/shortcutHandler.ts: an event marked `isComposing: true` must not
  // wipe out an in-progress run, even though it isn't itself a real space
  // keystroke.
  it('leaves an in-progress run untouched on a composing event, rather than resetting it', () => {
    let state = INITIAL_SPACE_GESTURE_STATE
    state = reduceSpaceGesture(state, input, spaceInputEvent(), 1_000).state
    expect(state.tapCount).toBe(1)

    const composing = reduceSpaceGesture(
      state,
      input,
      spaceInputEvent({ data: '†', isComposing: true }),
      1_010,
    )
    expect(composing.fire).toBe(false)
    expect(composing.state).toBe(state) // untouched, not just equal

    // The run can still complete normally afterwards.
    const second = reduceSpaceGesture(composing.state, input, spaceInputEvent(), 1_020)
    expect(second.state.tapCount).toBe(2)
    const third = reduceSpaceGesture(second.state, input, spaceInputEvent(), 1_030)
    expect(third.fire).toBe(true)
  })

  it('a composing event never fires or arms a run on its own', () => {
    const result = reduceSpaceGesture(
      INITIAL_SPACE_GESTURE_STATE,
      input,
      spaceInputEvent({ isComposing: true }),
      1_000,
    )
    expect(result.fire).toBe(false)
    expect(result.state).toEqual(INITIAL_SPACE_GESTURE_STATE)
  })

  it('a full-width (CJK) space does count as a real space (Safari/macOS CJK), advancing the run', () => {
    const result = reduceSpaceGesture(
      INITIAL_SPACE_GESTURE_STATE,
      input,
      spaceInputEvent({ data: '　' }),
      1_000,
    )
    expect(result.fire).toBe(false)
    expect(result.state.tapCount).toBe(1)
    expect(result.state.residueLen).toBe(1)
    expect(result.state.element).toBe(input)
  })
})

// R1: macOS's own "double-space → period" autocorrect, observed on-device
// as a single `insertText` event replacing the previous trailing space —
// `data === ". "` in an English input-locale, `data === "。"` (no trailing
// space baked in) in a Chinese/Japanese/Korean one. See the module
// docstring for the full trace-derived writeup.
describe('reduceSpaceGesture — R1 (macOS autocorrect)', () => {
  it('English: ". " counts as one tap, replacing the prior space with a 2-char residue', () => {
    let state = reduceSpaceGesture(INITIAL_SPACE_GESTURE_STATE, input, spaceInputEvent(), 1_000).state
    expect(state).toMatchObject({ tapCount: 1, residueLen: 1 })

    const result = reduceSpaceGesture(state, input, spaceInputEvent({ data: '. ' }), 1_170)
    expect(result.fire).toBe(false)
    expect(result.state.tapCount).toBe(2)
    expect(result.state.residueLen).toBe(2) // 1 - 1 + ". ".length

    const third = reduceSpaceGesture(result.state, input, spaceInputEvent(), 1_320)
    expect(third.fire).toBe(true)
    expect(third.residueLen).toBe(3)
  })

  it('Chinese: "。" counts as one tap, replacing the prior space with a 1-char residue', () => {
    let state = reduceSpaceGesture(INITIAL_SPACE_GESTURE_STATE, input, spaceInputEvent(), 1_000).state
    const result = reduceSpaceGesture(state, input, spaceInputEvent({ data: '。' }), 1_167)
    expect(result.fire).toBe(false)
    expect(result.state.tapCount).toBe(2)
    expect(result.state.residueLen).toBe(1) // 1 - 1 + "。".length

    const third = reduceSpaceGesture(result.state, input, spaceInputEvent(), 1_306)
    expect(third.fire).toBe(true)
    expect(third.residueLen).toBe(2)
  })

  // Decision point #5: a lone period the user typed on purpose (nothing
  // armed yet) must never be mistaken for the gesture.
  it('does not start counting when tapCount is 0 (a real, deliberate period)', () => {
    const result = reduceSpaceGesture(INITIAL_SPACE_GESTURE_STATE, input, spaceInputEvent({ data: '. ' }), 1_000)
    expect(result.fire).toBe(false)
    expect(result.state).toEqual(INITIAL_SPACE_GESTURE_STATE)
  })

  it('does not apply once the rhythm window (600ms) has elapsed since the last tap', () => {
    const armed = reduceSpaceGesture(INITIAL_SPACE_GESTURE_STATE, input, spaceInputEvent(), 1_000).state
    const result = reduceSpaceGesture(
      armed,
      input,
      spaceInputEvent({ data: '. ' }),
      1_000 + SPACE_GESTURE_MAX_GAP_MS + 1,
    )
    // Falls through to the ordinary rules: ". " isn't a plain space, so it
    // disarms outright rather than being treated as R1.
    expect(result.fire).toBe(false)
    expect(result.state).toEqual(INITIAL_SPACE_GESTURE_STATE)
  })
})

// R2: iOS's English-locale "double-space → period" autocorrect — an
// `insertReplacementText` event (its own `data` is always `null`; the
// actual text lives in `dataTransfer`) immediately followed by a *separate*
// `insertText`/`data === ' '` event for the same physical tap.
describe('reduceSpaceGesture — R2 (iOS English autocorrect)', () => {
  it('the replacement alone counts as one tap; the immediately-following space extends residue without a second tap', () => {
    let state = reduceSpaceGesture(INITIAL_SPACE_GESTURE_STATE, input, spaceInputEvent(), 1_000).state
    expect(state).toMatchObject({ tapCount: 1, residueLen: 1 })

    const replaced = reduceSpaceGesture(state, input, replacementInputEvent('.'), 1_168)
    expect(replaced.fire).toBe(false)
    expect(replaced.state.tapCount).toBe(2)
    expect(replaced.state.residueLen).toBe(1) // 1 - 1 + ".".length
    expect(replaced.state.justSubstitutedAt).toBe(1_168)

    // The attached space, well within SAME_TAP_WINDOW_MS of the replacement.
    const attached = reduceSpaceGesture(replaced.state, input, spaceInputEvent(), 1_168 + 11)
    expect(attached.fire).toBe(false)
    // tapCount unchanged — this space is the *same* physical keystroke as
    // the replacement, not a new one (otherwise two iOS taps alone would
    // reach the threshold of three).
    expect(attached.state.tapCount).toBe(2)
    expect(attached.state.residueLen).toBe(2)
    expect(attached.state.justSubstitutedAt).toBeNull()

    const third = reduceSpaceGesture(attached.state, input, spaceInputEvent(), 1_317)
    expect(third.fire).toBe(true)
    expect(third.residueLen).toBe(3)
  })

  it('does not start counting when tapCount is 0', () => {
    const result = reduceSpaceGesture(INITIAL_SPACE_GESTURE_STATE, input, replacementInputEvent('.'), 1_000)
    expect(result.fire).toBe(false)
    expect(result.state).toEqual(INITIAL_SPACE_GESTURE_STATE)
  })

  it('a replacement text other than a lone period is not treated as R1/R2 at all', () => {
    const armed = reduceSpaceGesture(INITIAL_SPACE_GESTURE_STATE, input, spaceInputEvent(), 1_000).state
    const result = reduceSpaceGesture(armed, input, replacementInputEvent('teh->the'), 1_100)
    // Falls through to the ordinary rules — an unrecognized
    // `insertReplacementText` (e.g. spell-check) disarms, same as any other
    // non-qualifying input.
    expect(result.fire).toBe(false)
    expect(result.state).toEqual(INITIAL_SPACE_GESTURE_STATE)
  })

  // A non-space character arriving *within* SAME_TAP_WINDOW_MS of the
  // replacement (e.g. the user kept typing normal text right after the
  // autocorrect fired, rather than the expected attached space) is not the
  // R2 companion event — `justSubstitutedAt` only ever matches a plain
  // space. It's cleared and this event falls through to the ordinary
  // rules, which disarm on any non-qualifying insertText.
  it('a non-space character within SAME_TAP_WINDOW_MS of the replacement clears justSubstitutedAt and resets as ordinary input', () => {
    const armed = reduceSpaceGesture(INITIAL_SPACE_GESTURE_STATE, input, spaceInputEvent(), 1_000).state
    const replaced = reduceSpaceGesture(armed, input, replacementInputEvent('.'), 1_168).state
    expect(replaced.justSubstitutedAt).toBe(1_168)

    const result = reduceSpaceGesture(
      replaced,
      input,
      spaceInputEvent({ data: 'k' }),
      1_168 + 10, // well within SAME_TAP_WINDOW_MS
    )
    expect(result.fire).toBe(false)
    expect(result.state).toEqual(INITIAL_SPACE_GESTURE_STATE)
  })

  // Decision point #3 in the task write-up: a space outside
  // SAME_TAP_WINDOW_MS of the replacement is a *separate*, ordinary tap —
  // not "the same keystroke" — so it *does* advance tapCount normally
  // (rather than being coalesced into the replacement like the "attached"
  // case above). Concretely, that means it can itself complete the
  // gesture — tapCount was already 2 after the replacement, so this one
  // ordinary tap reaches the threshold of 3, the same as the macOS shape
  // (which never has a separate attached-space event at all) does from the
  // same tapCount.
  it('a space arriving after SAME_TAP_WINDOW_MS (but still within the rhythm window) counts as an ordinary new tap, not an attached one', () => {
    const armed = reduceSpaceGesture(INITIAL_SPACE_GESTURE_STATE, input, spaceInputEvent(), 1_000).state
    const replaced = reduceSpaceGesture(armed, input, replacementInputEvent('.'), 1_168).state
    expect(replaced.tapCount).toBe(2)

    const late = reduceSpaceGesture(
      replaced,
      input,
      spaceInputEvent(),
      1_168 + SAME_TAP_WINDOW_MS + 1,
    )
    expect(late.fire).toBe(true)
    expect(late.residueLen).toBe(2) // (1 - 1 + 1) + 1
  })
})

// R3: iOS's Chinese/Japanese/Korean-locale "double-space → period"
// autocorrect — a `deleteContentBackward` (removing the old trailing
// space) immediately followed by a *separate* `insertText`/period event,
// both for the same physical tap.
describe('reduceSpaceGesture — R3 (iOS Chinese/Japanese/Korean autocorrect)', () => {
  it('delete + immediately-following period together count as one tap', () => {
    let state = reduceSpaceGesture(INITIAL_SPACE_GESTURE_STATE, input, spaceInputEvent(), 1_000).state
    expect(state).toMatchObject({ tapCount: 1, residueLen: 1 })

    const deleted = reduceSpaceGesture(
      state,
      input,
      spaceInputEvent({ inputType: 'deleteContentBackward', data: null }),
      1_158,
    )
    expect(deleted.fire).toBe(false)
    expect(deleted.state.tapCount).toBe(1) // unchanged — not yet counted
    expect(deleted.state.residueLen).toBe(0) // 1 - 1
    expect(deleted.state.pendingDelete).toBe(true)

    const period = reduceSpaceGesture(
      deleted.state,
      input,
      spaceInputEvent({ data: '。' }),
      1_158 + 15,
    )
    expect(period.fire).toBe(false)
    expect(period.state.tapCount).toBe(2)
    expect(period.state.residueLen).toBe(1) // 0 + "。".length
    expect(period.state.pendingDelete).toBe(false)

    const third = reduceSpaceGesture(period.state, input, spaceInputEvent(), 1_313)
    expect(third.fire).toBe(true)
    expect(third.residueLen).toBe(2)
  })

  it('a pendingDelete never fires the menu by itself, no matter tapCount', () => {
    // Two real taps, then a delete right after — still can't fire on the
    // delete alone even though this would be tap 3 if it were a plain space.
    let state = reduceSpaceGesture(INITIAL_SPACE_GESTURE_STATE, input, spaceInputEvent(), 1_000).state
    state = reduceSpaceGesture(state, input, spaceInputEvent(), 1_010).state
    expect(state.tapCount).toBe(2)

    const deleted = reduceSpaceGesture(
      state,
      input,
      spaceInputEvent({ inputType: 'deleteContentBackward', data: null }),
      1_020,
    )
    expect(deleted.fire).toBe(false)
    expect(deleted.state.pendingDelete).toBe(true)
  })

  it('does not start counting when tapCount is 0 (a lone, real backspace)', () => {
    const result = reduceSpaceGesture(
      INITIAL_SPACE_GESTURE_STATE,
      input,
      spaceInputEvent({ inputType: 'deleteContentBackward', data: null }),
      1_000,
    )
    expect(result.fire).toBe(false)
    expect(result.state).toEqual(INITIAL_SPACE_GESTURE_STATE)
  })

  // Negative case explicitly called out in the task write-up: whatever
  // follows a pendingDelete that *isn't* a matching period insertText —
  // this is a genuine, unrelated backspace, so the whole run disarms.
  it('a non-period event right after the delete resets the whole run (real backspace)', () => {
    const state = reduceSpaceGesture(INITIAL_SPACE_GESTURE_STATE, input, spaceInputEvent(), 1_000).state
    const deleted = reduceSpaceGesture(
      state,
      input,
      spaceInputEvent({ inputType: 'deleteContentBackward', data: null }),
      1_158,
    ).state
    expect(deleted.pendingDelete).toBe(true)

    const result = reduceSpaceGesture(deleted, input, spaceInputEvent({ data: 'k' }), 1_158 + 10)
    expect(result.fire).toBe(false)
    expect(result.state).toEqual(INITIAL_SPACE_GESTURE_STATE)
  })

  it('a period insertText arriving after SAME_TAP_WINDOW_MS resets instead of completing R3', () => {
    const state = reduceSpaceGesture(INITIAL_SPACE_GESTURE_STATE, input, spaceInputEvent(), 1_000).state
    const deleted = reduceSpaceGesture(
      state,
      input,
      spaceInputEvent({ inputType: 'deleteContentBackward', data: null }),
      1_158,
    ).state

    const result = reduceSpaceGesture(
      deleted,
      input,
      spaceInputEvent({ data: '。' }),
      1_158 + SAME_TAP_WINDOW_MS + 1,
    )
    expect(result.fire).toBe(false)
    expect(result.state).toEqual(INITIAL_SPACE_GESTURE_STATE)
  })
})

// Real on-device event traces (captured with an input-inspector devtools
// recorder against a live macOS Chrome / macOS Safari-engine iOS build, one
// per platform × input-locale combination), reduced to the handful of
// `input` events that matter here — `inputType`, `data`/`dataTransfer`
// text, and *relative* timestamps (ms since the first tap) preserving the
// real gaps observed between events. Field text is a stand-in for the
// traces' own "测试"/"test" (all four were captured typing that word, then
// summoning the gesture).
describe('reduceSpaceGesture, real on-device trace replays', () => {
  interface TraceStep {
    t: number
    inputType: string
    data?: string | null
    replacementText?: string
  }

  function replay(steps: TraceStep[]) {
    let state = INITIAL_SPACE_GESTURE_STATE
    let last: ReturnType<typeof reduceSpaceGesture> | null = null
    for (const step of steps) {
      const event: SpaceGestureInputEvent =
        step.replacementText !== undefined
          ? (() => {
              const dataTransfer = new DataTransfer()
              dataTransfer.setData('text/plain', step.replacementText!)
              return { inputType: step.inputType, data: null, isComposing: false, dataTransfer }
            })()
          : { inputType: step.inputType, data: step.data ?? null, isComposing: false }
      last = reduceSpaceGesture(state, input, event, step.t)
      state = last.state
    }
    return last!
  }

  it('macOS, English input locale: 3 taps fire with a clean strip back to "test"', () => {
    const result = replay([
      { t: 0, inputType: 'insertText', data: ' ' }, // tap 1
      { t: 173, inputType: 'insertText', data: '. ' }, // tap 2: OS substitution
      { t: 319, inputType: 'insertText', data: ' ' }, // tap 3
    ])
    expect(result.fire).toBe(true)
    expect(result.residueLen).toBe(3)
    expect(stripTrailingGestureResidue('test' + '.  ', result.residueLen)).toBe('test')
  })

  it('macOS, Chinese input locale: 3 taps fire with a clean strip back to "测试"', () => {
    const result = replay([
      { t: 0, inputType: 'insertText', data: ' ' },
      { t: 167, inputType: 'insertText', data: '。' },
      { t: 306, inputType: 'insertText', data: ' ' },
    ])
    expect(result.fire).toBe(true)
    expect(result.residueLen).toBe(2)
    expect(stripTrailingGestureResidue('测试' + '。 ', result.residueLen)).toBe('测试')
  })

  it('iOS, English input locale: 3 taps (with a coalesced attached-space) fire with a clean strip back to "test"', () => {
    const result = replay([
      { t: 0, inputType: 'insertText', data: ' ' }, // tap 1
      { t: 168, inputType: 'insertReplacementText', replacementText: '.' }, // tap 2, first half
      { t: 179, inputType: 'insertText', data: ' ' }, // tap 2, attached second half (11ms later)
      { t: 317, inputType: 'insertText', data: ' ' }, // tap 3
    ])
    expect(result.fire).toBe(true)
    expect(result.residueLen).toBe(3)
    expect(stripTrailingGestureResidue('test' + '.  ', result.residueLen)).toBe('test')
  })

  it('iOS, Chinese input locale: 3 taps (with a coalesced delete+period) fire with a clean strip back to "测试"', () => {
    const result = replay([
      { t: 0, inputType: 'insertText', data: ' ' }, // tap 1
      { t: 158, inputType: 'deleteContentBackward' }, // tap 2, first half
      { t: 173, inputType: 'insertText', data: '。' }, // tap 2, second half (15ms later)
      { t: 313, inputType: 'insertText', data: ' ' }, // tap 3
    ])
    expect(result.fire).toBe(true)
    expect(result.residueLen).toBe(2)
    expect(stripTrailingGestureResidue('测试' + '。 ', result.residueLen)).toBe('测试')
  })
})

describe('reduceSpaceGesture, wired like content.ts', () => {
  /**
   * Wires a document-level capturing `input` listener exactly like
   * `entrypoints/content.ts` does — same convention as
   * `shortcutHandler.test.ts`'s `wireContentScriptListener` — so this
   * exercises the real dispatched-event shape (`InputEvent`, `isComposing`)
   * rather than calling `reduceSpaceGesture` directly with hand-built
   * objects. Also wires the identical `compositionend` reset listener
   * content.ts adds alongside it — see that listener's doc comment there
   * for why: some browsers don't reliably fire a post-composition `input`
   * event, which could otherwise let a run mid-count when composition
   * started survive across the entire (non-space) composed insertion.
   */
  function wireContentScriptListener(onFire: (element: HTMLElement) => void) {
    let state: SpaceGestureState = INITIAL_SPACE_GESTURE_STATE
    const inputListener = (e: Event) => {
      if (!(e instanceof InputEvent)) return
      const target = e.target as HTMLElement
      const result = reduceSpaceGesture(state, target, e, Date.now())
      state = result.state
      if (result.fire) onFire(target)
    }
    const compositionEndListener = () => {
      state = INITIAL_SPACE_GESTURE_STATE
    }
    document.addEventListener('input', inputListener, true)
    document.addEventListener('compositionend', compositionEndListener, true)
    return () => {
      document.removeEventListener('input', inputListener, true)
      document.removeEventListener('compositionend', compositionEndListener, true)
    }
  }

  it('fires once after three real dispatched space keystrokes', () => {
    const onFire = vi.fn()
    const unwire = wireContentScriptListener(onFire)
    try {
      input.dispatchEvent(spaceInputEvent())
      input.dispatchEvent(spaceInputEvent())
      expect(onFire).not.toHaveBeenCalled()
      input.dispatchEvent(spaceInputEvent())
      expect(onFire).toHaveBeenCalledTimes(1)
      expect(onFire).toHaveBeenCalledWith(input)
    } finally {
      unwire()
    }
  })

  // Regression: without the `compositionend` listener, a run that was
  // mid-count (2 real spaces) when a CJK/IME composition session began
  // could survive the entire composed-text insertion untouched (the
  // composing guard deliberately leaves it alone — see
  // `reduceSpaceGesture`'s doc comment), letting a single genuine space
  // typed right after wrongly complete a stale run instead of starting a
  // fresh one.
  it('a composition session ending resets a mid-count run — one more space afterwards does not fire', () => {
    const onFire = vi.fn()
    const unwire = wireContentScriptListener(onFire)
    try {
      input.dispatchEvent(spaceInputEvent())
      input.dispatchEvent(spaceInputEvent())

      // Simulate a CJK IME composition session: composing input events are
      // left untouched by the reducer itself (see the composing-guard
      // tests above), then `compositionend` commits the result — here
      // standing in for the case where the corresponding post-composition
      // `input` event never arrives (the cross-browser quirk this fix
      // targets).
      input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
      input.dispatchEvent(
        spaceInputEvent({ inputType: 'insertCompositionText', data: '你好', isComposing: true }),
      )
      input.dispatchEvent(
        new CompositionEvent('compositionend', { data: '你好', bubbles: true }),
      )

      // A single genuine space right after must not complete a stale
      // count-2 run — it should only bring a fresh run to count 1.
      input.dispatchEvent(spaceInputEvent())
      expect(onFire).not.toHaveBeenCalled()

      // A full fresh run of three still works normally afterwards.
      input.dispatchEvent(spaceInputEvent())
      input.dispatchEvent(spaceInputEvent())
      expect(onFire).toHaveBeenCalledTimes(1)
    } finally {
      unwire()
    }
  })

  // The macOS Option-modified-key pitfall the composing guard exists for
  // never fires an actual `compositionstart`/`compositionend` pair (a
  // single atomic keystroke misflagged `isComposing: true`, not a real
  // composition session) — so this fix must not affect it: a run should
  // still survive a lone composing-flagged event with no accompanying
  // composition events at all.
  it('a composing event with no compositionend pairing still leaves the run intact', () => {
    const onFire = vi.fn()
    const unwire = wireContentScriptListener(onFire)
    try {
      input.dispatchEvent(spaceInputEvent())
      input.dispatchEvent(spaceInputEvent({ data: '†', isComposing: true }))
      input.dispatchEvent(spaceInputEvent())
      expect(onFire).not.toHaveBeenCalled()
      input.dispatchEvent(spaceInputEvent())
      expect(onFire).toHaveBeenCalledTimes(1)
    } finally {
      unwire()
    }
  })
})

describe('stripTrailingGestureResidue', () => {
  it('strips exactly the 3 trailing gesture spaces (default residueLen)', () => {
    expect(stripTrailingGestureResidue('hello world   ')).toBe('hello world')
  })

  it('leaves text unchanged when it does not end with the gesture run', () => {
    expect(stripTrailingGestureResidue('hello world')).toBe('hello world')
    expect(stripTrailingGestureResidue('hello world ')).toBe('hello world ')
    expect(stripTrailingGestureResidue('hello world  ')).toBe('hello world  ')
  })

  it('only consumes the run itself, leaving any pre-existing trailing spaces untouched', () => {
    // Two pre-existing trailing spaces, then the 3-space gesture typed after.
    expect(stripTrailingGestureResidue('hello world     ')).toBe('hello world  ')
  })

  it('is a no-op on a field that is only the gesture spaces (no real content)', () => {
    expect(stripTrailingGestureResidue('   ')).toBe('')
  })

  // `residueLen` — how many trailing characters an R1/R2/R3 substitution
  // (or same-rhythm extra taps `shouldAbsorbGestureMenuInput` absorbed)
  // actually deposited.
  it('strips exactly `residueLen` trailing characters when given an explicit count', () => {
    expect(stripTrailingGestureResidue('hello world     ', 5)).toBe('hello world')
  })

  it('does not strip if fewer trailing characters are present than `residueLen` calls for', () => {
    expect(stripTrailingGestureResidue('hello world   ', 5)).toBe('hello world   ')
  })

  it('with an explicit count, still only consumes exactly that many, leaving any further pre-existing trailing spaces untouched', () => {
    // 2 pre-existing trailing spaces, then a 4-character run (3 + 1 absorbed tap).
    expect(stripTrailingGestureResidue('hello world  ' + ' '.repeat(4), 4)).toBe(
      'hello world  ',
    )
  })

  it('a residueLen of 0 (or negative) is a no-op, not an empty-string bug', () => {
    // `text.slice(0, -0)` is a classic JS footgun — `-0 === 0`, so a naive
    // `text.slice(0, -residueLen)` without this guard would wipe the whole
    // string instead of leaving it untouched.
    expect(stripTrailingGestureResidue('hello world', 0)).toBe('hello world')
    expect(stripTrailingGestureResidue('hello world', -1)).toBe('hello world')
  })

  it('strips a period-like residue (R1/R3 macOS/iOS Chinese shape), not just spaces', () => {
    expect(stripTrailingGestureResidue('测试。 ', 2)).toBe('测试')
    expect(stripTrailingGestureResidue('test.  ', 3)).toBe('test')
  })

  // Decision point #6 in the task write-up: the defensive, all-or-nothing
  // check. If the tracked `residueLen` and the field's actual trailing
  // content have drifted out of sync, better to leave a little residue
  // than to eat real content.
  describe('defensive check: every trailing character must match the residue class, or nothing is stripped', () => {
    it('does not strip when one of the trailing characters is not a space or period-like character', () => {
      // "residueLen: 3" claims the last 3 characters are gesture residue,
      // but the middle one ("x") plainly isn't.
      expect(stripTrailingGestureResidue('hello wor x ', 3)).toBe('hello wor x ')
    })

    it('does not strip when residueLen is larger than the text itself', () => {
      expect(stripTrailingGestureResidue('. ', 5)).toBe('. ')
    })

    it('still strips normally once every trailing character does match', () => {
      expect(stripTrailingGestureResidue('hello world. ', 2)).toBe('hello world')
    })
  })
})

describe('shouldAbsorbGestureMenuInput', () => {
  const baseState: GestureMenuResidueState = { residueLen: SPACE_GESTURE_TARGET_COUNT, lastTime: 1_000 }

  function spaceEvent(overrides: Partial<{ inputType: string; data: string | null; isComposing: boolean }> = {}) {
    return { inputType: 'insertText', data: ' ', isComposing: false, ...overrides }
  }

  it('absorbs a real space keystroke landing within the rhythm window', () => {
    const result = shouldAbsorbGestureMenuInput(baseState, spaceEvent(), 1_000 + 100)
    expect(result.absorb).toBe(true)
    expect(result.state).toEqual({ residueLen: SPACE_GESTURE_TARGET_COUNT + 1, lastTime: 1_100 })
  })

  it('absorbs right up to the exact edge of the window (<=), and refreshes the timestamp from it', () => {
    const result = shouldAbsorbGestureMenuInput(
      baseState,
      spaceEvent(),
      1_000 + SPACE_GESTURE_MAX_GAP_MS,
    )
    expect(result.absorb).toBe(true)
    expect(result.state.lastTime).toBe(1_000 + SPACE_GESTURE_MAX_GAP_MS)
  })

  it('does not absorb a space keystroke landing outside the rhythm window — this is the deliberate boundary, not all spaces forever', () => {
    const result = shouldAbsorbGestureMenuInput(
      baseState,
      spaceEvent(),
      1_000 + SPACE_GESTURE_MAX_GAP_MS + 1,
    )
    expect(result.absorb).toBe(false)
    // State is returned unchanged (by reference) when not absorbed.
    expect(result.state).toBe(baseState)
  })

  it('does not absorb a non-space insertText (e.g. a letter)', () => {
    const result = shouldAbsorbGestureMenuInput(baseState, spaceEvent({ data: 'x' }), 1_050)
    expect(result.absorb).toBe(false)
  })

  it('does not absorb a deletion', () => {
    const result = shouldAbsorbGestureMenuInput(
      baseState,
      spaceEvent({ inputType: 'deleteContentBackward', data: null }),
      1_050,
    )
    expect(result.absorb).toBe(false)
  })

  it('does not absorb a paste', () => {
    const result = shouldAbsorbGestureMenuInput(
      baseState,
      spaceEvent({ inputType: 'insertFromPaste', data: '  ' }),
      1_050,
    )
    expect(result.absorb).toBe(false)
  })

  it('does not absorb a composing event, even if data is a lone space', () => {
    const result = shouldAbsorbGestureMenuInput(
      baseState,
      spaceEvent({ isComposing: true }),
      1_050,
    )
    expect(result.absorb).toBe(false)
  })

  it('chains multiple absorptions in a row, each extending the window from its own timestamp', () => {
    let state = baseState
    for (let i = 1; i <= 5; i++) {
      const now = 1_000 + i * 100 // well within the window each time
      const result = shouldAbsorbGestureMenuInput(state, spaceEvent(), now)
      expect(result.absorb).toBe(true)
      expect(result.state.residueLen).toBe(SPACE_GESTURE_TARGET_COUNT + i)
      expect(result.state.lastTime).toBe(now)
      state = result.state
    }
  })

  it('a late tap after a chain of fast ones is still measured from the last counted one, not the original', () => {
    // Two quick absorptions...
    let result = shouldAbsorbGestureMenuInput(baseState, spaceEvent(), 1_000 + 500)
    expect(result.absorb).toBe(true) // 500ms after the original — within window
    result = shouldAbsorbGestureMenuInput(result.state, spaceEvent(), 1_000 + 900)
    expect(result.absorb).toBe(true) // 400ms after the *previous* tap — within window
    // ...then one more, timed as if measured from the *original* base
    // timestamp it would be out of window (1000 + 1000 + 50, way past
    // 1000 + 600) — but measured from the last absorbed tap (1000 + 900)
    // it's still comfortably inside the window.
    result = shouldAbsorbGestureMenuInput(result.state, spaceEvent(), 1_000 + 900 + 100)
    expect(result.absorb).toBe(true)
  })
})

describe('isSpaceGestureEnabled', () => {
  // The gesture is no longer mobile-only — it's enabled on desktop and
  // mobile alike, with no platform gate (see the function's doc comment).
  // This guards against anyone re-introducing a gate.
  it('is always enabled (no platform gate anymore)', () => {
    expect(isSpaceGestureEnabled()).toBe(true)
  })
})
