import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  INITIAL_SPACE_GESTURE_STATE,
  reduceSpaceGesture,
  shouldAbsorbGestureMenuInput,
  SPACE_GESTURE_MAX_GAP_MS,
  SPACE_GESTURE_TARGET_COUNT,
  stripTrailingGestureSpaces,
  type GestureMenuResidueState,
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

describe('reduceSpaceGesture', () => {
  it('does not fire on the first or second space keystroke, fires on the third', () => {
    let state = INITIAL_SPACE_GESTURE_STATE
    const now = 1_000

    let result = reduceSpaceGesture(state, input, spaceInputEvent(), now)
    expect(result.fire).toBe(false)
    expect(result.state.count).toBe(1)
    state = result.state

    result = reduceSpaceGesture(state, input, spaceInputEvent(), now + 50)
    expect(result.fire).toBe(false)
    expect(result.state.count).toBe(2)
    state = result.state

    result = reduceSpaceGesture(state, input, spaceInputEvent(), now + 100)
    expect(result.fire).toBe(true)
    // Reset back to a fresh run once fired, so the caller never needs to
    // reset anything itself.
    expect(result.state).toEqual(INITIAL_SPACE_GESTURE_STATE)
  })

  it('a 4th space keystroke right after firing starts a brand new run rather than re-firing immediately', () => {
    let state = INITIAL_SPACE_GESTURE_STATE
    const now = 1_000
    for (let i = 0; i < SPACE_GESTURE_TARGET_COUNT; i++) {
      state = reduceSpaceGesture(state, input, spaceInputEvent(), now + i * 10).state
    }
    const fourth = reduceSpaceGesture(state, input, spaceInputEvent(), now + 1000)
    expect(fourth.fire).toBe(false)
    expect(fourth.state.count).toBe(1)
  })

  it('resets the run when a non-space character is typed in between', () => {
    let state = INITIAL_SPACE_GESTURE_STATE
    const now = 1_000
    state = reduceSpaceGesture(state, input, spaceInputEvent(), now).state
    state = reduceSpaceGesture(state, input, spaceInputEvent(), now + 10).state
    expect(state.count).toBe(2)

    state = reduceSpaceGesture(
      state,
      input,
      spaceInputEvent({ data: 'k' }),
      now + 20,
    ).state
    expect(state).toEqual(INITIAL_SPACE_GESTURE_STATE)

    const result = reduceSpaceGesture(state, input, spaceInputEvent(), now + 30)
    expect(result.fire).toBe(false)
    expect(result.state.count).toBe(1)
  })

  it('resets on a deletion (deleteContentBackward)', () => {
    let state = INITIAL_SPACE_GESTURE_STATE
    state = reduceSpaceGesture(state, input, spaceInputEvent(), 1_000).state
    state = reduceSpaceGesture(state, input, spaceInputEvent(), 1_010).state
    expect(state.count).toBe(2)

    state = reduceSpaceGesture(
      state,
      input,
      spaceInputEvent({ inputType: 'deleteContentBackward', data: null }),
      1_020,
    ).state
    expect(state).toEqual(INITIAL_SPACE_GESTURE_STATE)
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
    expect(state.count).toBe(1)

    const result = reduceSpaceGesture(
      state,
      input,
      spaceInputEvent(),
      1_000 + SPACE_GESTURE_MAX_GAP_MS + 1,
    )
    // Too slow to be "the same run" — starts a fresh run at count 1, not 2.
    expect(result.fire).toBe(false)
    expect(result.state.count).toBe(1)
  })

  it('resets when the focused element changes mid-run', () => {
    let state = INITIAL_SPACE_GESTURE_STATE
    state = reduceSpaceGesture(state, input, spaceInputEvent(), 1_000).state
    state = reduceSpaceGesture(state, input, spaceInputEvent(), 1_010).state
    expect(state.count).toBe(2)

    // The 3rd space lands in a different element — starts fresh there,
    // it does not inherit `input`'s count.
    const result = reduceSpaceGesture(state, other, spaceInputEvent(), 1_020)
    expect(result.fire).toBe(false)
    expect(result.state.count).toBe(1)
    expect(result.state.element).toBe(other)
  })

  it('resets when there is no qualifying active element', () => {
    let state = INITIAL_SPACE_GESTURE_STATE
    state = reduceSpaceGesture(state, input, spaceInputEvent(), 1_000).state
    expect(state.count).toBe(1)

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
    expect(state.count).toBe(1)

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
    expect(second.state.count).toBe(2)
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

  it('a full-width (CJK) or other space-like character does not count as a real space', () => {
    const result = reduceSpaceGesture(
      INITIAL_SPACE_GESTURE_STATE,
      input,
      spaceInputEvent({ data: '　' }),
      1_000,
    )
    expect(result.fire).toBe(false)
    expect(result.state).toEqual(INITIAL_SPACE_GESTURE_STATE)
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

describe('stripTrailingGestureSpaces', () => {
  it('strips exactly the 3 trailing gesture spaces', () => {
    expect(stripTrailingGestureSpaces('hello world   ')).toBe('hello world')
  })

  it('leaves text unchanged when it does not end with the gesture run', () => {
    expect(stripTrailingGestureSpaces('hello world')).toBe('hello world')
    expect(stripTrailingGestureSpaces('hello world ')).toBe('hello world ')
    expect(stripTrailingGestureSpaces('hello world  ')).toBe('hello world  ')
  })

  it('only consumes the run itself, leaving any pre-existing trailing spaces untouched', () => {
    // Two pre-existing trailing spaces, then the 3-space gesture typed after.
    expect(stripTrailingGestureSpaces('hello world     ')).toBe('hello world  ')
  })

  it('is a no-op on a field that is only the gesture spaces (no real content)', () => {
    expect(stripTrailingGestureSpaces('   ')).toBe('')
  })

  // The `spaceCount` param — how many same-rhythm extra taps
  // `shouldAbsorbGestureMenuInput` absorbed beyond the base 3 also need
  // stripping.
  it('strips exactly `spaceCount` trailing spaces when given an explicit count', () => {
    expect(stripTrailingGestureSpaces('hello world     ', 5)).toBe('hello world')
  })

  it('does not strip if fewer trailing spaces are present than `spaceCount` calls for', () => {
    expect(stripTrailingGestureSpaces('hello world   ', 5)).toBe('hello world   ')
  })

  it('with an explicit count, still only consumes exactly that many, leaving any further pre-existing trailing spaces untouched', () => {
    // 2 pre-existing trailing spaces, then a 4-space run (3 + 1 absorbed tap).
    expect(stripTrailingGestureSpaces('hello world  ' + ' '.repeat(4), 4)).toBe(
      'hello world  ',
    )
  })

  it('a spaceCount of 0 (or negative) is a no-op, not an empty-string bug', () => {
    // `text.slice(0, -0)` is a classic JS footgun — `-0 === 0`, so a naive
    // `text.slice(0, -spaceCount.length)` without this guard would wipe
    // the whole string instead of leaving it untouched.
    expect(stripTrailingGestureSpaces('hello world', 0)).toBe('hello world')
    expect(stripTrailingGestureSpaces('hello world', -1)).toBe('hello world')
  })
})

describe('shouldAbsorbGestureMenuInput', () => {
  const baseState: GestureMenuResidueState = { count: SPACE_GESTURE_TARGET_COUNT, lastTime: 1_000 }

  function spaceEvent(overrides: Partial<{ inputType: string; data: string | null; isComposing: boolean }> = {}) {
    return { inputType: 'insertText', data: ' ', isComposing: false, ...overrides }
  }

  it('absorbs a real space keystroke landing within the rhythm window', () => {
    const result = shouldAbsorbGestureMenuInput(baseState, spaceEvent(), 1_000 + 100)
    expect(result.absorb).toBe(true)
    expect(result.state).toEqual({ count: SPACE_GESTURE_TARGET_COUNT + 1, lastTime: 1_100 })
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
      expect(result.state.count).toBe(SPACE_GESTURE_TARGET_COUNT + i)
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
