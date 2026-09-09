import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { IdleTriggerDetector, type CandidateMatch } from './IdleTriggerDetector'

const IDLE_MS = 100
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// A minimal stand-in for imp-write's real `isCandidate` (which parses a
// command token via `parseCommandTrigger`): the detector itself doesn't care
// how candidacy is determined beyond getting the matched token back, so a
// simple "ends with /fix" check keeps these tests decoupled from the
// command-parsing logic.
function isFixCandidate(element: HTMLElement): CandidateMatch | null {
  const value = (element as HTMLInputElement).value ?? ''
  return value.trimEnd().endsWith('/fix') ? { token: '/fix' } : null
}

let input: HTMLInputElement

beforeEach(() => {
  input = document.createElement('input')
  input.type = 'text'
  input.dataset.testid = 'test-input'
  input.value = ''
  document.body.append(input)
})

afterEach(() => {
  input.remove()
})

/** Dispatches a real `insertText` input event, as a single keystroke would. */
function dispatchInsertText(el: HTMLInputElement, value: string, data: string) {
  el.value = value
  el.dispatchEvent(
    new InputEvent('input', {
      inputType: 'insertText',
      data,
      bubbles: true,
      cancelable: true,
    }),
  )
}

/** Dispatches a delete-family input event (never arms/keeps armed). */
function dispatchDelete(
  el: HTMLInputElement,
  value: string,
  inputType: string = 'deleteContentBackward',
) {
  el.value = value
  el.dispatchEvent(
    new InputEvent('input', {
      inputType,
      data: null,
      bubbles: true,
      cancelable: true,
    }),
  )
}

/** Dispatches a native undo/redo input event. */
function dispatchHistory(
  el: HTMLInputElement,
  value: string,
  inputType: 'historyUndo' | 'historyRedo' = 'historyUndo',
) {
  el.value = value
  el.dispatchEvent(
    new InputEvent('input', {
      inputType,
      bubbles: true,
      cancelable: true,
    }),
  )
}

/** Dispatches a paste input event. */
function dispatchPaste(el: HTMLInputElement, value: string, data: string) {
  el.value = value
  el.dispatchEvent(
    new InputEvent('input', {
      inputType: 'insertFromPaste',
      data,
      bubbles: true,
      cancelable: true,
    }),
  )
}

describe('IdleTriggerDetector', () => {
  it('triggers exactly once after typing a candidate token key-by-key and pausing', async () => {
    const onTrigger = vi.fn()
    const detector = new IdleTriggerDetector({
      isCandidate: isFixCandidate,
      onTrigger,
      idleMs: IDLE_MS,
    })
    detector.enable()

    await userEvent.type(input, 'hello /fix')
    expect(onTrigger).not.toHaveBeenCalled()

    await sleep(IDLE_MS + 150)
    expect(onTrigger).toHaveBeenCalledTimes(1)
    expect(onTrigger).toHaveBeenCalledWith(input)

    // Nothing else should fire it again just because more time passed.
    await sleep(IDLE_MS + 150)
    expect(onTrigger).toHaveBeenCalledTimes(1)

    detector.disable()
  })

  it('stays armed through a trailing whitespace keystroke after the token, and still triggers', async () => {
    const onTrigger = vi.fn()
    const detector = new IdleTriggerDetector({
      isCandidate: isFixCandidate,
      onTrigger,
      idleMs: IDLE_MS,
    })
    detector.enable()

    input.focus()
    dispatchInsertText(input, 'hello /fix', 'x') // completes the token
    // A habitual trailing space right after the token.
    dispatchInsertText(input, 'hello /fix ', ' ')
    await sleep(IDLE_MS + 150)

    expect(onTrigger).toHaveBeenCalledTimes(1)
    detector.disable()
  })

  it('does not trigger when typing continues without a pause, ending on a non-candidate value', async () => {
    const onTrigger = vi.fn()
    const detector = new IdleTriggerDetector({
      isCandidate: isFixCandidate,
      onTrigger,
      idleMs: IDLE_MS,
    })
    detector.enable()

    await userEvent.type(input, 'hello /fix')
    // Keep typing before the idle window elapses — the final value
    // ("hello /fixing") is no longer a candidate.
    await userEvent.type(input, 'ing')
    await sleep(IDLE_MS + 150)

    expect(onTrigger).not.toHaveBeenCalled()
    detector.disable()
  })

  it('does not trigger for non-candidate text after a pause', async () => {
    const onTrigger = vi.fn()
    const detector = new IdleTriggerDetector({
      isCandidate: isFixCandidate,
      onTrigger,
      idleMs: IDLE_MS,
    })
    detector.enable()

    await userEvent.type(input, 'just some regular text')
    await sleep(IDLE_MS + 150)

    expect(onTrigger).not.toHaveBeenCalled()
    detector.disable()
  })

  it('does not schedule for an input event fired while composing', async () => {
    const onTrigger = vi.fn()
    const detector = new IdleTriggerDetector({
      isCandidate: isFixCandidate,
      onTrigger,
      idleMs: IDLE_MS,
    })
    detector.enable()

    input.focus()
    input.value = 'hello /fix'
    input.dispatchEvent(
      new InputEvent('input', {
        inputType: 'insertText',
        data: 'x',
        isComposing: true,
        bubbles: true,
        cancelable: true,
      }),
    )
    await sleep(IDLE_MS + 150)

    expect(onTrigger).not.toHaveBeenCalled()
    detector.disable()
  })

  it('evaluates on compositionend even when the composing input events were suppressed', async () => {
    const onTrigger = vi.fn()
    const detector = new IdleTriggerDetector({
      isCandidate: isFixCandidate,
      onTrigger,
      idleMs: IDLE_MS,
    })
    detector.enable()

    input.focus()
    input.dispatchEvent(
      new CompositionEvent('compositionstart', { bubbles: true }),
    )
    input.value = 'hello /fix'
    input.dispatchEvent(
      new InputEvent('input', {
        inputType: 'insertCompositionText',
        data: 'hello /fix',
        isComposing: true,
        bubbles: true,
        cancelable: true,
      }),
    )
    // The composing input event above must not have scheduled anything.
    await sleep(IDLE_MS + 150)
    expect(onTrigger).not.toHaveBeenCalled()

    input.dispatchEvent(
      new CompositionEvent('compositionend', {
        bubbles: true,
        data: '/fix',
      }),
    )
    await sleep(IDLE_MS + 150)
    expect(onTrigger).toHaveBeenCalledTimes(1)

    detector.disable()
  })

  it('does not trigger if the element loses focus during the idle window', async () => {
    const onTrigger = vi.fn()
    const detector = new IdleTriggerDetector({
      isCandidate: isFixCandidate,
      onTrigger,
      idleMs: IDLE_MS,
    })
    detector.enable()

    await userEvent.type(input, 'hello /fix')
    input.blur()
    await sleep(IDLE_MS + 150)

    expect(onTrigger).not.toHaveBeenCalled()
    detector.disable()
  })

  it('does not trigger while disabled, and resumes after re-enabling', async () => {
    const onTrigger = vi.fn()
    const detector = new IdleTriggerDetector({
      isCandidate: isFixCandidate,
      onTrigger,
      idleMs: IDLE_MS,
    })

    // Never enabled yet — typing a candidate token does nothing.
    await userEvent.type(input, 'hello /fix')
    await sleep(IDLE_MS + 150)
    expect(onTrigger).not.toHaveBeenCalled()
    await userEvent.clear(input)

    // Enabling schedules a trigger, but disabling before it fires must
    // discard the pending timer entirely, not just suppress the callback.
    detector.enable()
    await userEvent.type(input, 'hello /fix')
    detector.disable()
    await sleep(IDLE_MS + 150)
    expect(onTrigger).not.toHaveBeenCalled()

    // Re-enabling restores normal behavior.
    detector.enable()
    await userEvent.clear(input)
    await userEvent.type(input, 'hello /fix')
    await sleep(IDLE_MS + 150)
    expect(onTrigger).toHaveBeenCalledTimes(1)

    detector.disable()
  })

  it('re-validates isCandidate at fire time and skips if it has since become false', async () => {
    let candidateAllowed = true
    const onTrigger = vi.fn()
    const detector = new IdleTriggerDetector({
      isCandidate: (el) => (candidateAllowed ? isFixCandidate(el) : null),
      onTrigger,
      idleMs: IDLE_MS,
    })
    detector.enable()

    await userEvent.type(input, 'hello /fix')
    // Flip candidacy off after scheduling but before the idle window fires —
    // the timer callback must re-check `isCandidate`, not just fire blindly.
    candidateAllowed = false
    await sleep(IDLE_MS + 150)

    expect(onTrigger).not.toHaveBeenCalled()
    detector.disable()
  })

  // --- Bug: page-synthetic `input` re-dispatch (Reddit composer) ---
  //
  // Reddit's <shreddit-composer> mirrors every real keystroke by dispatching
  // a bare `new InputEvent('input')` (inputType "", data null) on its
  // wrapper element, which bubbles to the document-level listener *after*
  // the genuine event. Before `isInformativeInputEvent`, that second event
  // was classified as a non-insertText edit and disarmed the detector,
  // cancelling the trigger the real keystroke had just armed — so a command
  // token typed in a Reddit comment box never fired.
  describe('synthetic input re-dispatch (Reddit composer)', () => {
    /** Mirrors <shreddit-composer>: a bare `input` event on an ancestor, right after the real one. */
    function dispatchMirror(el: HTMLElement) {
      el.dispatchEvent(
        new InputEvent('input', { bubbles: true, composed: true }),
      )
    }

    it('still triggers when an ancestor re-dispatches a bare input event after the keystroke', async () => {
      const onTrigger = vi.fn()
      const detector = new IdleTriggerDetector({
        isCandidate: isFixCandidate,
        onTrigger,
        idleMs: IDLE_MS,
      })
      detector.enable()

      input.focus()
      dispatchInsertText(input, 'hello /fix', 'x')
      dispatchMirror(input.parentElement!)
      await sleep(IDLE_MS + 150)

      expect(onTrigger).toHaveBeenCalledTimes(1)
      detector.disable()
    })

    it('ignores a plain Event("input") re-dispatch too', async () => {
      const onTrigger = vi.fn()
      const detector = new IdleTriggerDetector({
        isCandidate: isFixCandidate,
        onTrigger,
        idleMs: IDLE_MS,
      })
      detector.enable()

      input.focus()
      dispatchInsertText(input, 'hello /fix', 'x')
      input.parentElement!.dispatchEvent(
        new Event('input', { bubbles: true }),
      )
      await sleep(IDLE_MS + 150)

      expect(onTrigger).toHaveBeenCalledTimes(1)
      detector.disable()
    })

    it('a lone synthetic re-dispatch never arms a trigger by itself', async () => {
      const onTrigger = vi.fn()
      const detector = new IdleTriggerDetector({
        isCandidate: isFixCandidate,
        onTrigger,
        idleMs: IDLE_MS,
      })
      detector.enable()

      input.focus()
      input.value = 'hello /fix'
      dispatchMirror(input.parentElement!)
      await sleep(IDLE_MS + 150)

      expect(onTrigger).not.toHaveBeenCalled()
      detector.disable()
    })
  })

  // --- Bug 2026-08-22: browser-native undo (Cmd/Ctrl+Z) re-triggering ---
  //
  // A replacement's write-back leaves the original, token-ending text on the
  // browser's native undo stack. Undoing it fires an `input` event whose
  // `inputType` is `historyUndo` — restoring content that ends with the
  // token, but *not* because the user typed it just now. The "arm" model
  // (this whole describe block) exists specifically so events like this
  // can't ride a stale arming — or any arming at all — through to a
  // trigger.
  describe('native undo/redo and other non-typed content changes', () => {
    it('does not trigger for a native undo (historyUndo) restoring token-ending text', async () => {
      const onTrigger = vi.fn()
      const detector = new IdleTriggerDetector({
        isCandidate: isFixCandidate,
        onTrigger,
        idleMs: IDLE_MS,
      })
      detector.enable()

      input.focus()
      dispatchHistory(input, 'hello /fix')
      await sleep(IDLE_MS + 150)

      expect(onTrigger).not.toHaveBeenCalled()
      detector.disable()
    })

    it('cancels an already-armed trigger if a historyUndo input event arrives inside the idle window', async () => {
      const onTrigger = vi.fn()
      const detector = new IdleTriggerDetector({
        isCandidate: isFixCandidate,
        onTrigger,
        idleMs: IDLE_MS,
      })
      detector.enable()

      await userEvent.type(input, 'hello /fix')
      dispatchHistory(input, 'hello /fix')
      await sleep(IDLE_MS + 150)

      expect(onTrigger).not.toHaveBeenCalled()
      detector.disable()
    })

    it('the full user repro: undo, then a typed space, then a backspace back to the token — never triggers', async () => {
      const onTrigger = vi.fn()
      const detector = new IdleTriggerDetector({
        isCandidate: isFixCandidate,
        onTrigger,
        idleMs: IDLE_MS,
      })
      detector.enable()
      input.focus()

      // Native undo restores "hello /fix".
      dispatchHistory(input, 'hello /fix')
      // A real keystroke: typing a space. Since the detector wasn't armed,
      // a whitespace-only insertion cannot arm it either.
      dispatchInsertText(input, 'hello /fix ', ' ')
      // A real keystroke: backspacing the space back off, landing right
      // back on token-ending content. Deletions always disarm.
      dispatchDelete(input, 'hello /fix')
      await sleep(IDLE_MS + 150)

      expect(onTrigger).not.toHaveBeenCalled()
      detector.disable()
    })

    it('does not arm on a delete that happens to land back on a candidate token', async () => {
      const onTrigger = vi.fn()
      const detector = new IdleTriggerDetector({
        isCandidate: isFixCandidate,
        onTrigger,
        idleMs: IDLE_MS,
      })
      detector.enable()
      input.focus()

      // Type "hello /fixx" — armed briefly on "/fix" partway through, then
      // disarmed once "x" makes it a non-candidate.
      dispatchInsertText(input, 'hello /fix', 'x')
      dispatchInsertText(input, 'hello /fixx', 'x')
      // Backspacing the extra "x" back off lands on "/fix" again, but
      // deletion never (re-)arms.
      dispatchDelete(input, 'hello /fix')
      await sleep(IDLE_MS + 150)

      expect(onTrigger).not.toHaveBeenCalled()
      detector.disable()
    })

    it('does not trigger for a paste that ends with a candidate token', async () => {
      const onTrigger = vi.fn()
      const detector = new IdleTriggerDetector({
        isCandidate: isFixCandidate,
        onTrigger,
        idleMs: IDLE_MS,
      })
      detector.enable()
      input.focus()

      dispatchPaste(input, 'hello /fix', 'hello /fix')
      await sleep(IDLE_MS + 150)

      expect(onTrigger).not.toHaveBeenCalled()
      detector.disable()
    })

    it('disarms on a non-completing keystroke within the idle window, even if content ends up a non-candidate', async () => {
      const onTrigger = vi.fn()
      const detector = new IdleTriggerDetector({
        isCandidate: isFixCandidate,
        onTrigger,
        idleMs: IDLE_MS,
      })
      detector.enable()
      input.focus()

      dispatchInsertText(input, 'hello /fix', 'x') // arms
      dispatchInsertText(input, 'hello /fixy', 'y') // disarms — "/fixy" isn't a candidate
      await sleep(IDLE_MS + 150)

      expect(onTrigger).not.toHaveBeenCalled()
      detector.disable()
    })

    it('control group: the same resulting text, reached via normal typed insertText events, does trigger', async () => {
      const onTrigger = vi.fn()
      const detector = new IdleTriggerDetector({
        isCandidate: isFixCandidate,
        onTrigger,
        idleMs: IDLE_MS,
      })
      detector.enable()

      await userEvent.clear(input)
      await userEvent.type(input, 'hello /fix')
      await sleep(IDLE_MS + 150)
      expect(onTrigger).toHaveBeenCalledTimes(1)
      detector.disable()
    })
  })
})
