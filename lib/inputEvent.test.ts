import { describe, expect, it } from 'vitest'
import { isInformativeInputEvent } from './inputEvent'

describe('isInformativeInputEvent', () => {
  it('accepts a native-style input event with an inputType', () => {
    expect(
      isInformativeInputEvent(
        new InputEvent('input', { inputType: 'insertText', data: 'x' }),
      ),
    ).toBe(true)
    expect(
      isInformativeInputEvent(
        new InputEvent('input', { inputType: 'deleteContentBackward' }),
      ),
    ).toBe(true)
  })

  it("rejects a page's synthetic re-dispatch with no inputType (Reddit composer shape)", () => {
    // Exactly what <shreddit-composer> dispatches after every real keystroke.
    expect(isInformativeInputEvent(new InputEvent('input'))).toBe(false)
  })

  it('rejects a plain Event("input") dispatch (Slate/React-editor shape)', () => {
    expect(isInformativeInputEvent(new Event('input', { bubbles: true }))).toBe(
      false,
    )
  })
})
