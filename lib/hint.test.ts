import { afterEach, describe, expect, it } from 'vitest'
import { showHint } from './hint'

const HINT_ID = 'imp-write-hint'

function getHint(): HTMLElement | null {
  return document.getElementById(HINT_ID)
}

describe('showHint', () => {
  afterEach(() => {
    getHint()?.remove()
  })

  it('renders the hint element with the given message', () => {
    const input = document.createElement('input')
    document.body.append(input)

    showHint(input, 'Something went wrong')

    const hint = getHint()
    expect(hint).not.toBeNull()
    expect(hint!.textContent).toBe('Something went wrong')

    input.remove()
  })

  // Regression: this used to anchor off the element's bottom-right corner,
  // which on a wide field (e.g. a real site's search box) lands the hint far
  // from where the user is actually looking/typing, and can cover the
  // site's own buttons.
  it('anchors near the caret rather than the element right edge, in a wide textarea', () => {
    const textarea = document.createElement('textarea')
    textarea.style.width = '800px'
    textarea.style.height = '100px'
    document.body.append(textarea)
    textarea.focus()
    textarea.value = 'hi'
    textarea.setSelectionRange(2, 2)

    showHint(textarea, 'Failed to write the result back')

    const hint = getHint()!
    const hintRect = hint.getBoundingClientRect()
    const textareaRect = textarea.getBoundingClientRect()

    // The caret sits right after "hi", near the textarea's left edge — the
    // hint should land close to that, nowhere near the box's right edge.
    expect(hintRect.left).toBeLessThan(textareaRect.left + 100)
    expect(hintRect.left).toBeLessThan(textareaRect.right - 400)

    textarea.remove()
  })

  it('falls back to the element bottom-left corner when the caret position cannot be determined', () => {
    // Not an input/textarea/contenteditable — getCaretOffset has nothing to
    // measure, so this exercises the fallback path.
    const div = document.createElement('div')
    div.style.width = '300px'
    div.style.height = '50px'
    document.body.append(div)

    showHint(div, 'fallback error')

    const hint = getHint()!
    const hintRect = hint.getBoundingClientRect()
    const divRect = div.getBoundingClientRect()

    // Close to the element's left edge — allowing for the viewport-edge
    // clamp margin when the element itself sits flush against the edge.
    expect(Math.abs(hintRect.left - divRect.left)).toBeLessThanOrEqual(10)
    expect(hintRect.top).toBeGreaterThanOrEqual(divRect.bottom)

    div.remove()
  })

  it('does not stack hints when called twice in a row — the old one is removed first', () => {
    const input = document.createElement('input')
    document.body.append(input)

    showHint(input, 'first error')
    expect(getHint()).not.toBeNull()

    showHint(input, 'second error')
    const hints = document.querySelectorAll(`#${HINT_ID}`)
    expect(hints.length).toBe(1)
    expect(getHint()!.textContent).toBe('second error')

    input.remove()
  })

  it(
    'auto-removes itself after the display duration elapses',
    async () => {
      const input = document.createElement('input')
      document.body.append(input)

      showHint(input, 'temporary error')
      expect(getHint()).not.toBeNull()

      // Duration (4s) + fade-out (150ms) + margin.
      await new Promise((resolve) => setTimeout(resolve, 4400))
      expect(getHint()).toBeNull()

      input.remove()
    },
    6000,
  )
})
