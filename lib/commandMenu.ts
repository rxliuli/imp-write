import { getCaretOffset } from './caret'
import { TRIGGER_PREFIX } from './commands'
import type { Command } from './settings'

/**
 * The mobile "tap the toolbar icon" entry point (see background.ts's
 * `action.onClicked`) has no popup UI to fall back on, so it injects this
 * floating menu into the page instead — anchored to whatever editable
 * element the user most recently focused. Everything here is vanilla DOM
 * (no React/Tailwind) rendered into a `attachShadow({ mode: 'open' })` root,
 * matching the rest of `entrypoints/content.ts`'s injected UI style
 * (`lib/hint.ts`, `lib/loading.ts`) but shadow-isolated because this one is
 * interactive (buttons) and needs to survive arbitrary host-page CSS.
 */

// How stale a `focusin` sighting is allowed to be before `showCommandMenu`
// treats it as "nothing focused". Generous on purpose — unlike the
// right-click path's `CONTEXT_MENU_MAX_AGE_MS` (15s), the user has to leave
// the page entirely, open the browser's own menu, and tap the extension
// icon, which on mobile can take a while longer than traversing a native
// context menu.
export const COMMAND_MENU_TARGET_MAX_AGE_MS = 60_000

export interface CommandMenuTarget {
  element: HTMLElement
  time: number
}

/**
 * Whether `record` is still usable as the command menu's anchor: recorded
 * within `maxAgeMs` and still attached to the document. Pure so it's
 * unit-testable independent of the real `focusin` wiring in content.ts.
 */
export function isFreshTarget(
  record: CommandMenuTarget | null,
  now: number,
  maxAgeMs: number = COMMAND_MENU_TARGET_MAX_AGE_MS,
): record is CommandMenuTarget {
  if (!record) return false
  if (now - record.time > maxAgeMs) return false
  if (!record.element.isConnected) return false
  return true
}

export interface SimpleRect {
  top: number
  left: number
  right: number
  bottom: number
  width: number
  height: number
}

export interface Size {
  width: number
  height: number
}

/**
 * The visible viewport `computeMenuPosition` positions and clamps against —
 * `left`/`top` are that viewport's own origin, in the same coordinate space
 * `getBoundingClientRect()` (and therefore `anchorRect`) already uses. Lets
 * callers pass `window.visualViewport`'s box (`offsetLeft`/`offsetTop` are
 * non-zero once an on-screen keyboard has shifted or pinch-zoom has panned
 * it) instead of always assuming the viewport starts at `(0, 0)` — see
 * `CommandMenu.position`'s call site.
 */
export interface ViewportBox {
  left: number
  top: number
  width: number
  height: number
}

/** Whether `rect` has any on-screen extent within `viewport` — used to fall back to a centered placement when the anchor is scrolled out of view. */
export function isRectVisible(rect: SimpleRect, viewport: Size): boolean {
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    rect.bottom > 0 &&
    rect.right > 0 &&
    rect.top < viewport.height &&
    rect.left < viewport.width
  )
}

// Shared with `CommandMenu.position`'s max-height calc (`viewport.height -
// DEFAULT_MENU_MARGIN * 2`) so the menu's height cap and its position
// clamping agree on the same edge margin.
const DEFAULT_MENU_MARGIN = 8

/**
 * Picks a `position: fixed` top/left for the menu, clamped so it never
 * renders off-screen. `anchorRect` being `null` (the target isn't visible —
 * see `isRectVisible`) centers the menu near the bottom of the viewport
 * instead, regardless of `preferAbove`.
 *
 * `options.preferAbove` (default `true`) picks which side of `anchorRect` is
 * tried first, falling back to the other side (and finally clamping against
 * whichever viewport edge is left) if there isn't room:
 * - `true` — just above the anchor, then below. Used for the
 *   element-anchored mobile menu (`anchorRect` is the whole focused
 *   element), where "above the keyboard-obscured element" is usually the
 *   only place with room.
 * - `false` — just below the anchor, then above. Used for the
 *   caret-anchored desktop menu (`anchorRect` is a thin rect at the text
 *   cursor), matching the decided UX: the menu drops down from the cursor
 *   like a native autocomplete popup.
 *
 * `viewport` is a box, not just a size — both the placement math and the
 * edge clamping are relative to its `left`/`top`, not hard-coded to `(0,
 * 0)`. This lets the caller pass `window.visualViewport`'s own box (see
 * `ViewportBox`'s doc comment) so the menu still lands somewhere visible
 * once an on-screen keyboard has shifted it away from `(0, 0)`.
 */
export function computeMenuPosition(
  anchorRect: SimpleRect | null,
  menuSize: Size,
  viewport: ViewportBox,
  options: { margin?: number; gap?: number; preferAbove?: boolean } = {},
): { top: number; left: number } {
  const margin = options.margin ?? DEFAULT_MENU_MARGIN
  const gap = options.gap ?? 8
  const preferAbove = options.preferAbove ?? true

  const viewportLeft = viewport.left + margin
  const viewportRight = viewport.left + viewport.width - margin
  const viewportTop = viewport.top + margin
  const viewportBottom = viewport.top + viewport.height - margin

  if (!anchorRect) {
    return {
      left: Math.max(viewportLeft, viewport.left + (viewport.width - menuSize.width) / 2),
      top: Math.max(viewportTop, viewportBottom - menuSize.height),
    }
  }

  let left = anchorRect.left
  left = Math.min(left, viewportRight - menuSize.width)
  left = Math.max(left, viewportLeft)

  const above = anchorRect.top - gap - menuSize.height
  const below = anchorRect.bottom + gap
  const belowFits = below + menuSize.height <= viewportBottom
  const clampedToBottom = Math.max(viewportTop, viewportBottom - menuSize.height)

  let top: number
  if (preferAbove) {
    top = above >= viewportTop ? above : belowFits ? below : clampedToBottom
  } else {
    top = belowFits ? below : above >= viewportTop ? above : clampedToBottom
  }

  return { top, left }
}

const MENU_HOST_ID = 'imp-write-command-menu-host'
// Matches lib/hint.ts's z-index — the max signed 32-bit int, guaranteed to
// sit above anything a host page could set.
const MENU_Z_INDEX = 2147483647

// How many command rows the menu shows before the list scrolls, and the
// height of each `.imp-write-menu-item` row. Named constants (not bare
// literals) because they jointly cap `.imp-write-menu-list`'s max-height in
// `buildMenuElement`, so "N commands visible without scrolling" is defined
// in exactly one place instead of being sprinkled across CSS and JS.
const MAX_VISIBLE_COMMANDS = 4
const MENU_ROW_HEIGHT = 44

// Colors are CSS custom properties (light values as the default, overridden
// under `@media (prefers-color-scheme: dark)`) rather than a shadcn/Tailwind
// token system — this stylesheet is injected standalone into an isolated
// shadow root, so it follows the *system* color scheme directly instead of
// the host page's own light/dark state (which content.ts has no visibility
// into anyway). In dark mode the menu's separation from the page comes from
// a light 1px border/ring rather than `box-shadow` — a dark shadow is
// invisible against a page that's likely already near-black in dark mode.
const MENU_STYLES = `
  :host {
    all: initial;
    display: block;
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    --imp-menu-bg: #ffffff;
    --imp-menu-fg: #111827;
    --imp-menu-muted-fg: #6b7280;
    --imp-menu-border: rgba(0, 0, 0, 0.08);
    --imp-menu-divider: rgba(0, 0, 0, 0.06);
    --imp-menu-hover-bg: #f3f4f6;
    --imp-menu-shadow: 0 8px 24px rgba(0, 0, 0, 0.2), 0 2px 6px rgba(0, 0, 0, 0.15);
  }
  @media (prefers-color-scheme: dark) {
    :host {
      --imp-menu-bg: #27272a;
      --imp-menu-fg: #f4f4f5;
      --imp-menu-muted-fg: #a1a1aa;
      --imp-menu-border: rgba(255, 255, 255, 0.16);
      --imp-menu-divider: rgba(255, 255, 255, 0.1);
      --imp-menu-hover-bg: #3f3f46;
      --imp-menu-shadow: 0 0 0 1px rgba(255, 255, 255, 0.08), 0 8px 24px rgba(0, 0, 0, 0.55);
    }
  }
  .imp-write-menu {
    box-sizing: border-box;
    min-width: 220px;
    max-width: min(320px, calc(100vw - 16px));
    background: var(--imp-menu-bg);
    color: var(--imp-menu-fg);
    border-radius: 12px;
    border: 1px solid var(--imp-menu-border);
    box-shadow: var(--imp-menu-shadow);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  /* The header row: title on the left, a Settings gear button on the right.
     A flex row so the gear never needs its own footer row — saves vertical
     space and keeps the command list full-width. min-height: 44px matches
     .imp-write-menu-item's row height so the header control and the
     command rows agree on the same touch-target height. */
  .imp-write-menu-title {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-height: 44px;
    padding: 0 10px 0 14px;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    color: var(--imp-menu-muted-fg);
    border-bottom: 1px solid var(--imp-menu-divider);
  }
  .imp-write-menu-title-text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* The gear itself. all: unset (like the items) so no UA button chrome
     leaks in; 44x44 keeps it a comfortable tap target on iOS. */
  .imp-write-menu-gear {
    all: unset;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    border-radius: 8px;
    color: var(--imp-menu-muted-fg);
    cursor: pointer;
  }
  .imp-write-menu-gear:hover,
  .imp-write-menu-gear:active {
    background: var(--imp-menu-hover-bg);
    color: var(--imp-menu-fg);
  }
  /* The scrollable command list. min-height: 0 overrides flexbox's default
     min-height: auto, which would otherwise keep this item at its content
     height and stop .imp-write-menu-list's own inline max-height (set to
     MAX_VISIBLE_COMMANDS rows in buildMenuElement, then further clamped by
     .imp-write-menu's max-height inline set in CommandMenu.position) from
     ever forcing it to actually scroll.
     overscroll-behavior: contain stops an overscroll at the top/bottom
     edge from chaining into a scroll of the host page — which would
     otherwise immediately close the menu via the window scroll listener
     below. */
  .imp-write-menu-list {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    touch-action: pan-y;
  }
  .imp-write-menu-empty {
    padding: 14px;
    font-size: 13px;
    line-height: 1.4;
    color: var(--imp-menu-muted-fg);
  }
  .imp-write-menu-item {
    all: unset;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    /* Fill the row regardless of UA (iOS Safari buttons don't always stretch
       like Chrome does — this is what makes the hover/active highlight cover
       the whole row instead of just the text). */
    width: 100%;
    min-height: 44px;
    padding: 0 14px;
    font-size: 15px;
    color: var(--imp-menu-fg);
    cursor: pointer;
  }
  .imp-write-menu-item:hover,
  .imp-write-menu-item:active {
    background: var(--imp-menu-hover-bg);
  }

`

export interface CommandMenuCallbacks {
  /** Fired when the user taps a command — the menu is already closed by this point. */
  onSelect: (element: HTMLElement, command: Command) => void
  /** Fired when the user taps the "Settings" entry — the menu is already closed by this point. */
  onOpenSettings: () => void
  /**
   * Fired for every `beforeinput` the target element receives while the
   * menu is open, before this class decides whether to close it. Return
   * `true` to close as usual, `false` to keep the menu open instead (the
   * event itself is never touched here — `CommandMenu` doesn't call
   * `preventDefault`, so whatever the event represents still lands in the
   * field either way; this only controls the *menu's* fate).
   *
   * Optional — omitting it (or always returning `true`) preserves the
   * original "any new input closes the menu" behavior. `CommandMenu`
   * deliberately has no opinion of its own on when `false` is warranted
   * (e.g. content.ts's three-space-gesture "same-rhythm extra tap" case) —
   * that's entirely a caller-side policy decision this class stays
   * unaware of, kept out of this presentation-only class the same way
   * content.ts's own gesture-specific bookkeeping already lives there, not
   * here.
   */
  onTargetInput?: (event: Event) => boolean
}

/**
 * The floating command menu itself. One instance is created per content
 * script (per frame) and reused across `showCommandMenu` messages — `show`
 * always tears down and rebuilds from scratch (see the class docstring in
 * content.ts's usage), so there's never more than one open at a time.
 */
export interface ShowCommandMenuOptions {
  /**
   * Which rule `position()` anchors against:
   * - `'element'` (default) — the whole `target` element's bounding rect,
   *   preferring just above it. Used on mobile (element-anchored, matching
   *   the existing toolbar-icon-tap behavior) — see content.ts's cached
   *   `getPlatformInfo` check.
   * - `'caret'` — a thin rect at the live text-cursor position (via
   *   `lib/caret.ts`), preferring just below it. Used on desktop for both
   *   the icon-tap and three-space-gesture trigger paths.
   */
  anchorMode?: 'caret' | 'element'
}

/**
 * The box `CommandMenu.position` sizes and positions itself against.
 * `window.visualViewport` (unlike `window.innerWidth`/`innerHeight`, and
 * unlike `100vh` in CSS) tracks the actually-visible area once an on-screen
 * keyboard has shrunk it — the layout viewport those alternatives measure
 * stays the page's full, unobscured size, which is exactly what makes a
 * `position: fixed` element sized/placed against it end up rendered behind
 * the keyboard. Falls back to `innerWidth`/`innerHeight` at `(0, 0)` on
 * engines without `visualViewport` support.
 */
function getViewportBox(): ViewportBox {
  const vv = window.visualViewport
  if (vv) {
    return { left: vv.offsetLeft, top: vv.offsetTop, width: vv.width, height: vv.height }
  }
  return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight }
}

export class CommandMenu {
  private host: HTMLElement | null = null
  private shadow: ShadowRoot | null = null
  private outsideClickHandler: ((e: Event) => void) | null = null
  private keydownHandler: ((e: KeyboardEvent) => void) | null = null
  private dismissHandler: ((e: Event) => void) | null = null
  private target: HTMLElement | null = null
  private targetInputHandler: ((e: Event) => void) | null = null

  constructor(private readonly callbacks: CommandMenuCallbacks) {}

  get isOpen(): boolean {
    return this.host !== null
  }

  /** Builds and shows the menu anchored near `target`, listing `commands`. Tears down any menu already open first. */
  show(target: HTMLElement, commands: Command[], options: ShowCommandMenuOptions = {}): void {
    this.destroy()

    const anchorMode = options.anchorMode ?? 'element'

    const host = document.createElement('div')
    host.id = MENU_HOST_ID
    Object.assign(host.style, {
      position: 'fixed',
      top: '0px',
      left: '0px',
      zIndex: String(MENU_Z_INDEX),
    })

    const shadow = host.attachShadow({ mode: 'open' })
    const style = document.createElement('style')
    style.textContent = MENU_STYLES
    shadow.appendChild(style)
    shadow.appendChild(this.buildMenuElement(target, commands))

    document.body.appendChild(host)
    this.host = host
    this.shadow = shadow
    this.target = target

    this.position(target, anchorMode)

    this.outsideClickHandler = (e: Event) => {
      const path = e.composedPath()
      if (path.includes(host)) return
      this.destroy()
    }
    document.addEventListener('pointerdown', this.outsideClickHandler, true)

    this.keydownHandler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // Consume this Esc outright — matches the undo handler's existing
      // convention in content.ts (`stopImmediatePropagation`, not just
      // `stopPropagation`), so no other same-phase, same-node listener
      // (e.g. a site's own Esc shortcut) still sees an event we've already
      // acted on.
      e.stopImmediatePropagation()
      this.destroy()
    }
    document.addEventListener('keydown', this.keydownHandler, true)

    // The menu is a one-shot placement (like lib/hint.ts's toast) — rather
    // than tracking the anchor's position through a scroll of the page, just
    // close it; native context menus behave the same way. Scrolling inside
    // the menu's own `.imp-write-menu-list` must not count as "the page
    // scrolled" though — `composedPath()` distinguishes the two by checking
    // whether the scroll originated somewhere inside `host`.
    this.dismissHandler = (e: Event) => {
      if (e.composedPath().includes(host)) return
      this.destroy()
    }
    window.addEventListener('scroll', this.dismissHandler, true)
    window.addEventListener('resize', this.dismissHandler)

    // Continuing to type in the target element closes the menu immediately
    // — a stale menu still open over content the user is actively editing
    // is confusing, and it's no longer anchored to anything meaningful once
    // the caret it was shown at has moved. `beforeinput` (rather than
    // `keydown`) is the reliable signal here: it fires uniformly for real
    // text edits on both desktop and mobile virtual keyboards (which often
    // don't dispatch `keydown` for composed/IME input at all), and — unlike
    // `keydown` — it doesn't fire for pure navigation (arrow keys, Tab)
    // that isn't actually "new input". Attached directly to `target` (not
    // `document`) so typing anywhere else on the page never closes a menu
    // anchored to a different element. Applies to both the icon-tap and
    // three-space-gesture trigger paths, since both call this same `show`.
    //
    // `onTargetInput` (see its doc comment) gets first say on whether this
    // particular input should actually close the menu — defaults to always
    // closing when the callback isn't provided, or doesn't exist at all.
    this.targetInputHandler = (e: Event) => {
      const shouldClose = this.callbacks.onTargetInput?.(e) ?? true
      if (shouldClose) this.destroy()
    }
    target.addEventListener('beforeinput', this.targetInputHandler)
  }

  /** Removes the menu (if any) and its listeners. Safe to call when already closed. */
  destroy(): void {
    if (this.outsideClickHandler) {
      document.removeEventListener('pointerdown', this.outsideClickHandler, true)
      this.outsideClickHandler = null
    }
    if (this.keydownHandler) {
      document.removeEventListener('keydown', this.keydownHandler, true)
      this.keydownHandler = null
    }
    if (this.dismissHandler) {
      window.removeEventListener('scroll', this.dismissHandler, true)
      window.removeEventListener('resize', this.dismissHandler)
      this.dismissHandler = null
    }
    if (this.targetInputHandler && this.target) {
      this.target.removeEventListener('beforeinput', this.targetInputHandler)
      this.targetInputHandler = null
    }
    this.target = null
    this.host?.remove()
    this.host = null
    this.shadow = null
  }

  private buildMenuElement(target: HTMLElement, commands: Command[]): HTMLElement {
    const menu = document.createElement('div')
    menu.className = 'imp-write-menu'

    // Header: title on the left, Settings gear on the right. The gear lives
    // in the header (not a footer row) so the command list below it is
    // full-width and the menu stays as short as possible — the Settings entry
    // never scrolls away or competes with commands for vertical space.
    const header = document.createElement('div')
    header.className = 'imp-write-menu-title'

    const title = document.createElement('span')
    title.className = 'imp-write-menu-title-text'
    title.textContent = 'Imp Write'
    header.appendChild(title)

    const settings = document.createElement('button')
    settings.type = 'button'
    settings.className = 'imp-write-menu-gear'
    settings.textContent = '⚙'
    settings.setAttribute('aria-label', 'Settings')
    settings.title = 'Settings'
    settings.addEventListener('click', () => {
      this.destroy()
      this.callbacks.onOpenSettings()
    })
    header.appendChild(settings)

    menu.appendChild(header)

    // The only part of the menu that scrolls. `max-height` is set to show
    // `MAX_VISIBLE_COMMANDS` rows before scrolling — see
    // `.imp-write-menu-list`'s CSS comment for why this needs `min-height: 0`
    // to actually scroll instead of being pinned to its content height.
    const list = document.createElement('div')
    list.className = 'imp-write-menu-list'
    list.style.maxHeight = `${MAX_VISIBLE_COMMANDS * MENU_ROW_HEIGHT}px`
    if (commands.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'imp-write-menu-empty'
      empty.textContent = 'No commands configured yet.'
      list.appendChild(empty)
    } else {
      for (const command of commands) {
        const item = document.createElement('button')
        item.type = 'button'
        item.className = 'imp-write-menu-item'
        item.textContent = `${TRIGGER_PREFIX}${command.name}`
        item.addEventListener('click', () => {
          this.destroy()
          this.callbacks.onSelect(target, command)
        })
        list.appendChild(item)
      }
    }
    menu.appendChild(list)

    return menu
  }

  private position(target: HTMLElement, anchorMode: 'caret' | 'element'): void {
    if (!this.host) return
    const viewport = getViewportBox()

    // Capped to the *visible* viewport (see `getViewportBox`'s doc comment),
    // not the menu's natural content height — set before measuring
    // `menuRect` below so a long command list is already clamped (and thus
    // scrollable — see `.imp-write-menu-list`'s CSS) by the time its
    // on-screen size is read for positioning.
    const menuEl = this.shadow?.querySelector<HTMLElement>('.imp-write-menu')
    if (menuEl) {
      menuEl.style.maxHeight = `${Math.max(0, viewport.height - DEFAULT_MENU_MARGIN * 2)}px`
    }

    const rect = this.computeAnchorRect(target, anchorMode)
    const anchor = isRectVisible(rect, { width: viewport.width, height: viewport.height })
      ? rect
      : null
    const menuRect = this.host.getBoundingClientRect()
    const { top, left } = computeMenuPosition(
      anchor,
      { width: menuRect.width, height: menuRect.height },
      viewport,
      // Caret-anchored: drop down from the cursor, like a native
      // autocomplete popup. Element-anchored (mobile): prefer sitting just
      // above the focused element, unchanged from before this mode existed.
      { preferAbove: anchorMode !== 'caret' },
    )
    this.host.style.top = `${top}px`
    this.host.style.left = `${left}px`
  }

  /**
   * `'element'` anchors against the whole target's bounding rect, same as
   * before caret-anchoring existed. `'caret'` measures the live text-cursor
   * position via `lib/caret.ts` (already shared with `lib/hint.ts` and
   * `lib/loading.ts` — not re-implemented here) and returns a thin rect
   * there instead, offset from the element's border box the same way
   * `lib/hint.ts`'s `positionHint` does. Falls back to the element's own
   * rect if the caret can't be measured (e.g. no live selection) — same
   * graceful fallback `positionHint` uses.
   */
  private computeAnchorRect(target: HTMLElement, anchorMode: 'caret' | 'element'): SimpleRect {
    const targetRect = target.getBoundingClientRect()
    if (anchorMode !== 'caret') {
      return targetRect
    }
    const caret = getCaretOffset(target)
    if (!caret) {
      return targetRect
    }
    // `getContentEditableCaretOffset` (lib/caret.ts) measures a live DOM
    // Range's `getBoundingClientRect()` directly — an already-on-screen,
    // post-scroll position, exactly like `targetRect` itself — so no
    // further scroll correction applies for a contenteditable target.
    // `getInputCaretOffset` (input/textarea), by contrast, measures an
    // off-screen *mirror* `<div>` that never scrolls along with the real
    // field, so that offset is relative to the field's full, unscrolled
    // content and genuinely needs `scrollLeft`/`scrollTop` subtracted to
    // land on the field's visible (scrolled) position — same as
    // `lib/loading.ts`'s `updatePosition` does for that case. Applying that
    // same subtraction to a contenteditable target double-counts the
    // scroll offset, pushing the computed anchor further off-screen the
    // more the field is scrolled.
    const scrollLeft = target.isContentEditable
      ? 0
      : ((target as HTMLElement & { scrollLeft?: number }).scrollLeft ?? 0)
    const scrollTop = target.isContentEditable
      ? 0
      : ((target as HTMLElement & { scrollTop?: number }).scrollTop ?? 0)
    const left = targetRect.left + caret.left - scrollLeft
    const top = targetRect.top + caret.top - scrollTop
    const bottom = top + caret.lineHeight
    // A real caret has some (if thin) visual width — a literal 0 would fail
    // `isRectVisible`'s `width > 0` check and always fall back to the
    // centered "not visible" placement instead.
    const width = 1
    return { left, top, right: left + width, bottom, width, height: caret.lineHeight }
  }
}

const TOAST_ID = 'imp-write-command-menu-toast'
const TOAST_STYLE_ID = 'imp-write-command-menu-toast-styles'
const TOAST_VISIBLE_CLASS = 'imp-write-command-menu-toast-visible'
const TOAST_DURATION_MS = 2500
const TOAST_FADE_MS = 150

let toastHideTimer: ReturnType<typeof setTimeout> | null = null
let toastFadeTimer: ReturnType<typeof setTimeout> | null = null

/** Removes the empty-state toast (if shown) and cancels its pending timers. Safe to call when there is none. */
export function hideNoTargetToast(): void {
  document.getElementById(TOAST_ID)?.remove()
  if (toastHideTimer !== null) {
    clearTimeout(toastHideTimer)
    toastHideTimer = null
  }
  if (toastFadeTimer !== null) {
    clearTimeout(toastFadeTimer)
    toastFadeTimer = null
  }
}

function ensureToastStyles(): void {
  if (document.getElementById(TOAST_STYLE_ID)) return
  const style = document.createElement('style')
  style.id = TOAST_STYLE_ID
  // Same custom-property-with-dark-media-override approach as
  // `MENU_STYLES` above — this toast isn't shadow-hosted (it's static text,
  // not interactive; see its doc comment), but it should still follow the
  // system color scheme rather than staying hard-coded, and a light-mode
  // shadow alone would similarly vanish against an already-dark page.
  style.textContent = `
    #${TOAST_ID} {
      position: fixed;
      left: 50%;
      bottom: max(24px, env(safe-area-inset-bottom, 0px));
      transform: translateX(-50%);
      z-index: ${MENU_Z_INDEX};
      padding: 10px 16px;
      border-radius: 999px;
      font-size: 13px;
      font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
      pointer-events: none;
      opacity: 0;
      transition: opacity ${TOAST_FADE_MS}ms ease;
      --imp-toast-bg: #1f2937;
      --imp-toast-fg: #ffffff;
      --imp-toast-border: transparent;
      --imp-toast-shadow: 0 4px 12px rgba(0, 0, 0, 0.25), 0 1px 2px rgba(0, 0, 0, 0.3);
      background: var(--imp-toast-bg);
      color: var(--imp-toast-fg);
      border: 1px solid var(--imp-toast-border);
      box-shadow: var(--imp-toast-shadow);
    }
    @media (prefers-color-scheme: dark) {
      #${TOAST_ID} {
        --imp-toast-bg: #3f3f46;
        --imp-toast-fg: #f4f4f5;
        --imp-toast-border: rgba(255, 255, 255, 0.14);
        --imp-toast-shadow: 0 0 0 1px rgba(255, 255, 255, 0.06), 0 4px 12px rgba(0, 0, 0, 0.55);
      }
    }
    #${TOAST_ID}.${TOAST_VISIBLE_CLASS} {
      opacity: 1;
    }
  `
  document.head.appendChild(style)
}

/**
 * The top frame's empty-state fallback (see content.ts's `showCommandMenu`
 * handler): no frame had a fresh focus target to anchor the real menu to.
 * Deliberately plain DOM + a `<style>` in `document.head` (like
 * `lib/hint.ts`), not shadow-hosted — it's static text, not interactive, so
 * the CSS-isolation `CommandMenu` needs doesn't apply here.
 */
export function showNoTargetToast(): void {
  hideNoTargetToast()

  ensureToastStyles()

  const toast = document.createElement('div')
  toast.id = TOAST_ID
  toast.textContent = 'Focus a text field first'
  document.body.appendChild(toast)

  // Force a style flush before flipping the opacity class — see lib/hint.ts's
  // identical comment for why.
  void toast.offsetHeight
  toast.classList.add(TOAST_VISIBLE_CLASS)

  toastHideTimer = setTimeout(() => {
    toastHideTimer = null
    toast.classList.remove(TOAST_VISIBLE_CLASS)
    toastFadeTimer = setTimeout(() => {
      toastFadeTimer = null
      toast.remove()
    }, TOAST_FADE_MS)
  }, TOAST_DURATION_MS)
}

/**
 * `window.postMessage` type used by a subframe to tell the top frame "I'm
 * showing the real menu, cancel your empty-state toast". This is the only
 * thing this message carries — no execution semantics ride along with it.
 * A plain string constant (not namespaced further) is unique enough: it's
 * checked against `event.data` by exact equality, and any accidental
 * collision with a same-named message from an unrelated script on the page
 * would, at worst, cancel a toast that hadn't fired yet.
 */
export const CANCEL_EMPTY_STATE_MESSAGE = '__imp-write-command-menu-cancel-empty-state__'
