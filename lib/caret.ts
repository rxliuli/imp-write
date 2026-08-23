// Shared caret (text cursor) position measurement for <input>/<textarea> and
// contenteditable elements. Used by both the in-flight loading indicator
// (lib/loading.ts) and the error hint (lib/hint.ts) so both can anchor near
// where the user is actually looking/typing, not just an element's edge.

export interface CaretOffset {
  /** Offset from the element's border-box left edge, in CSS pixels. */
  left: number
  /** Offset from the element's border-box top edge, in CSS pixels. */
  top: number
  /** Line height at the caret — useful for vertical placement/centering. */
  lineHeight: number
}

type TextInputElement = HTMLInputElement | HTMLTextAreaElement

function isTextInputElement(element: Element): element is TextInputElement {
  return (
    element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
  )
}

/**
 * Measures the caret position inside a <input>/<textarea> by rendering an
 * off-screen mirror <div> that copies every style affecting text layout,
 * filling it with the text before the caret, and reading the offset of a
 * marker <span> appended right after it. There's no native API for this —
 * this "shadow textarea" technique is the standard workaround.
 */
export function getInputCaretOffset(element: TextInputElement): CaretOffset {
  const div = document.createElement('div')
  const styles = window.getComputedStyle(element)

  ;(
    [
      'fontFamily',
      'fontSize',
      'fontWeight',
      'letterSpacing',
      'wordSpacing',
      'textIndent',
      'textTransform',
      'lineHeight',
      'padding',
      'border',
      'boxSizing',
    ] as const
  ).forEach((prop) => {
    div.style[prop] = styles[prop]
  })

  div.style.position = 'absolute'
  div.style.visibility = 'hidden'
  div.style.whiteSpace = 'pre-wrap'
  div.style.wordWrap = 'break-word'
  div.style.overflow = 'hidden'
  div.style.width = `${element.offsetWidth}px`

  const selectionStart = element.selectionStart ?? element.value.length
  const textBeforeCaret = element.value.substring(0, selectionStart)
  div.textContent = textBeforeCaret

  const span = document.createElement('span')
  span.textContent = '|'
  div.appendChild(span)

  document.body.appendChild(div)

  const fontSize = parseFloat(styles.fontSize) || 16
  let lineHeight = parseFloat(styles.lineHeight)
  if (Number.isNaN(lineHeight)) {
    lineHeight = fontSize * 1.2
  }

  const offset: CaretOffset = {
    left: span.offsetLeft,
    top: span.offsetTop,
    lineHeight,
  }

  div.remove()

  return offset
}

/**
 * Measures the caret position inside a contenteditable element using the
 * current DOM selection's Range. `Range.getBoundingClientRect()` returns an
 * empty (0x0) rect for a collapsed range in some positions (e.g. an empty
 * line), so as a fallback a temporary zero-width character is inserted right
 * at the caret, measured, and immediately removed again — the selection
 * itself is never touched, so this doesn't disturb what the user is doing.
 * Returns `null` if there's no active selection inside the document at all.
 */
export function getContentEditableCaretOffset(
  element: HTMLElement,
): CaretOffset | null {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) {
    return null
  }

  const range = selection.getRangeAt(0)
  let rect = range.getBoundingClientRect()

  if (rect.width === 0 && rect.height === 0) {
    const clonedRange = range.cloneRange()
    const startContainer = range.startContainer
    const startOffset = range.startOffset

    try {
      const zeroWidthNode = document.createTextNode('​')

      if (startContainer.nodeType === Node.TEXT_NODE) {
        const afterNode = (startContainer as Text).splitText(startOffset)
        startContainer.parentNode?.insertBefore(zeroWidthNode, afterNode)
      } else if (startOffset < startContainer.childNodes.length) {
        startContainer.insertBefore(
          zeroWidthNode,
          startContainer.childNodes[startOffset],
        )
      } else {
        startContainer.appendChild(zeroWidthNode)
      }

      clonedRange.selectNode(zeroWidthNode)
      rect = clonedRange.getBoundingClientRect()

      zeroWidthNode.remove()

      // If the text node had to be split above, merge it back together so
      // the DOM (and any listeners watching it) sees no lasting change.
      if (
        startContainer.nodeType === Node.TEXT_NODE &&
        startContainer.nextSibling?.nodeType === Node.TEXT_NODE
      ) {
        ;(startContainer as Text).appendData(
          startContainer.nextSibling.textContent ?? '',
        )
        startContainer.nextSibling.remove()
      }
    } catch {
      rect = element.getBoundingClientRect()
    }
  }

  const elementRect = element.getBoundingClientRect()
  const styles = window.getComputedStyle(element)
  const fontSize = parseFloat(styles.fontSize) || 16
  let lineHeight = parseFloat(styles.lineHeight)
  if (Number.isNaN(lineHeight)) {
    lineHeight = fontSize * 1.2
  }

  return {
    left: rect.left - elementRect.left,
    top: rect.top - elementRect.top,
    lineHeight,
  }
}

/**
 * Measures the caret position for whichever kind of editable `element` is —
 * <input>/<textarea>, or contenteditable. Returns `null` when it can't be
 * determined (e.g. neither shape, or no live selection), so callers can fall
 * back to anchoring off the element itself instead.
 */
export function getCaretOffset(element: HTMLElement): CaretOffset | null {
  if (element.isContentEditable) {
    return getContentEditableCaretOffset(element)
  }
  if (isTextInputElement(element)) {
    return getInputCaretOffset(element)
  }
  return null
}
