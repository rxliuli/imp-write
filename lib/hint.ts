import { getCaretOffset } from './caret'

const HINT_ID = 'imp-write-hint'
const HINT_STYLE_ID = 'imp-write-hint-styles'
const HINT_VISIBLE_CLASS = 'imp-write-hint-visible'

// Long enough to read something with actionable content (e.g. a billing/
// top-up link in an API error) without the reader having to hurry — bumped
// up from an earlier, terser 2.5s.
const HINT_DURATION_MS = 4000
// Must match the CSS transition-duration below.
const HINT_FADE_MS = 150

// How far below (or, when flipped, above) the caret the hint sits, and how
// much clearance it keeps from the viewport edges when clamped.
const CARET_GAP = 8
const VIEWPORT_MARGIN = 8

let hideTimer: ReturnType<typeof setTimeout> | null = null
let fadeOutTimer: ReturnType<typeof setTimeout> | null = null

function ensureStyles(): void {
  if (document.getElementById(HINT_STYLE_ID)) return

  const style = document.createElement('style')
  style.id = HINT_STYLE_ID
  style.textContent = `
    #${HINT_ID} {
      position: fixed;
      z-index: 2147483647;
      max-width: 280px;
      padding: 8px 12px;
      border-radius: 8px;
      background: #1f2937;
      color: #fff;
      font-size: 13px;
      line-height: 1.4;
      font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-left: 3px solid #ef4444;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25), 0 1px 2px rgba(0, 0, 0, 0.3);
      pointer-events: none;
      opacity: 0;
      transition: opacity ${HINT_FADE_MS}ms ease;
      word-wrap: break-word;
      overflow-wrap: break-word;
    }
    #${HINT_ID}.${HINT_VISIBLE_CLASS} {
      opacity: 1;
    }
  `
  document.head.appendChild(style)
}

/**
 * Picks where the hint should sit: right below the caret inside `element`
 * (falling back to the element's bottom-left corner — closer to where
 * reading naturally starts than the bottom-right corner this used to use —
 * when the caret position can't be measured), then clamps that against the
 * viewport so a hint on a very wide or edge-hugging field never renders
 * off-screen or gets flipped above the anchor when there's no room below.
 * This is a one-shot placement — the hint is a transient toast, not
 * something that needs to keep tracking the caret while it's shown.
 */
function positionHint(hint: HTMLElement, element: HTMLElement): void {
  const elementRect = element.getBoundingClientRect()
  const caret = getCaretOffset(element)

  let left: number
  let anchorTop: number
  let anchorBottom: number

  if (caret) {
    const scrollLeft = (element as HTMLElement & { scrollLeft?: number })
      .scrollLeft ?? 0
    const scrollTop = (element as HTMLElement & { scrollTop?: number })
      .scrollTop ?? 0
    left = elementRect.left + caret.left - scrollLeft
    anchorTop = elementRect.top + caret.top - scrollTop
    anchorBottom = anchorTop + caret.lineHeight
  } else {
    left = elementRect.left
    anchorTop = elementRect.top
    anchorBottom = elementRect.bottom
  }

  // Measure after the text is in place (and before it's positioned/visible)
  // so wrapping against `max-width` is already accounted for.
  const { width, height } = hint.getBoundingClientRect()

  let top = anchorBottom + CARET_GAP
  if (top + height > window.innerHeight - VIEWPORT_MARGIN) {
    const above = anchorTop - CARET_GAP - height
    top =
      above >= VIEWPORT_MARGIN
        ? above
        : Math.max(VIEWPORT_MARGIN, window.innerHeight - VIEWPORT_MARGIN - height)
  }

  left = Math.min(left, window.innerWidth - VIEWPORT_MARGIN - width)
  left = Math.max(left, VIEWPORT_MARGIN)

  hint.style.left = `${left}px`
  hint.style.top = `${top}px`
}

/**
 * Shows a small, self-dismissing error hint anchored near the caret inside
 * `element`. Deliberately not an alert() — those block the page and are
 * jarring for something that fires on every failed AI call.
 */
export function showHint(element: HTMLElement, message: string): void {
  // Never stack: drop whatever hint (and its pending timers) is currently
  // showing before creating a new one.
  document.getElementById(HINT_ID)?.remove()
  if (hideTimer !== null) {
    clearTimeout(hideTimer)
    hideTimer = null
  }
  if (fadeOutTimer !== null) {
    clearTimeout(fadeOutTimer)
    fadeOutTimer = null
  }

  ensureStyles()

  const hint = document.createElement('div')
  hint.id = HINT_ID
  hint.textContent = message
  document.body.appendChild(hint)

  positionHint(hint, element)

  // Force a style flush before flipping the opacity class, so the
  // opacity:0 -> opacity:1 change is a genuine transition rather than
  // collapsing into a single computed style with no animation to run.
  void hint.offsetHeight
  hint.classList.add(HINT_VISIBLE_CLASS)

  hideTimer = setTimeout(() => {
    hideTimer = null
    hint.classList.remove(HINT_VISIBLE_CLASS)
    fadeOutTimer = setTimeout(() => {
      fadeOutTimer = null
      hint.remove()
    }, HINT_FADE_MS)
  }, HINT_DURATION_MS)
}
