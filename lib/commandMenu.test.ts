import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getCaretOffset } from './caret'
import {
  CANCEL_EMPTY_STATE_MESSAGE,
  CommandMenu,
  COMMAND_MENU_TARGET_MAX_AGE_MS,
  computeMenuPosition,
  hideNoTargetToast,
  isFreshTarget,
  isRectVisible,
  showNoTargetToast,
  type CommandMenuCallbacks,
  type CommandMenuTarget,
} from './commandMenu'
import type { Command } from './settings'

// Mirrors these modules' own internal ids rather than importing them —
// same convention lib/hint.test.ts uses for `HINT_ID`.
const MENU_HOST_ID = 'imp-write-command-menu-host'
const TOAST_ID = 'imp-write-command-menu-toast'

function getMenuHost(): HTMLElement | null {
  return document.getElementById(MENU_HOST_ID)
}

function getMenuButtons(): HTMLButtonElement[] {
  const host = getMenuHost()
  if (!host?.shadowRoot) return []
  return Array.from(host.shadowRoot.querySelectorAll('button'))
}

function getMenuListEl(): HTMLElement | null {
  const host = getMenuHost()
  if (!host?.shadowRoot) return null
  return host.shadowRoot.querySelector('.imp-write-menu-list')
}

function getCommandButtons(): HTMLButtonElement[] {
  const host = getMenuHost()
  if (!host?.shadowRoot) return []
  return Array.from(host.shadowRoot.querySelectorAll<HTMLButtonElement>('.imp-write-menu-item'))
}

function getSettingsButton(): HTMLButtonElement | null {
  const host = getMenuHost()
  if (!host?.shadowRoot) return null
  return host.shadowRoot.querySelector<HTMLButtonElement>('.imp-write-menu-gear')
}

function makeCommands(count: number): Command[] {
  return Array.from({ length: count }, (_, i) => ({
    name: `cmd${i}`,
    prompt: `Do something {{text}} ${i}`,
  }))
}

describe('isFreshTarget', () => {
  let element: HTMLElement

  beforeEach(() => {
    element = document.createElement('textarea')
    document.body.append(element)
  })

  afterEach(() => {
    element.remove()
  })

  it('returns false for a null record', () => {
    expect(isFreshTarget(null, Date.now())).toBe(false)
  })

  it('returns true for a record within the TTL on a still-connected element', () => {
    const record: CommandMenuTarget = { element, time: 1_000 }
    expect(isFreshTarget(record, 1_000 + COMMAND_MENU_TARGET_MAX_AGE_MS)).toBe(true)
  })

  it('returns false once the sighting is older than the TTL', () => {
    const record: CommandMenuTarget = { element, time: 1_000 }
    expect(
      isFreshTarget(record, 1_000 + COMMAND_MENU_TARGET_MAX_AGE_MS + 1),
    ).toBe(false)
  })

  it('returns false once the element has been removed from the document, even if still recent', () => {
    const record: CommandMenuTarget = { element, time: 1_000 }
    element.remove()
    expect(isFreshTarget(record, 1_000)).toBe(false)
  })

  it('honors a custom maxAgeMs override', () => {
    const record: CommandMenuTarget = { element, time: 1_000 }
    expect(isFreshTarget(record, 1_500, 400)).toBe(false)
    expect(isFreshTarget(record, 1_300, 400)).toBe(true)
  })
})

describe('isRectVisible', () => {
  const viewport = { width: 400, height: 800 }

  it('is true for a rect on-screen', () => {
    expect(
      isRectVisible(
        { top: 10, left: 10, right: 100, bottom: 40, width: 90, height: 30 },
        viewport,
      ),
    ).toBe(true)
  })

  it('is false for a zero-size rect (e.g. a display:none element)', () => {
    expect(
      isRectVisible(
        { top: 10, left: 10, right: 10, bottom: 10, width: 0, height: 0 },
        viewport,
      ),
    ).toBe(false)
  })

  it('is false once scrolled fully above the viewport', () => {
    expect(
      isRectVisible(
        { top: -100, left: 10, right: 100, bottom: -10, width: 90, height: 90 },
        viewport,
      ),
    ).toBe(false)
  })

  it('is false once fully below the viewport', () => {
    expect(
      isRectVisible(
        { top: 900, left: 10, right: 100, bottom: 990, width: 90, height: 90 },
        viewport,
      ),
    ).toBe(false)
  })
})

describe('computeMenuPosition', () => {
  const viewport = { left: 0, top: 0, width: 400, height: 800 }
  const menuSize = { width: 200, height: 150 }

  it('centers near the bottom of the viewport when there is no anchor rect', () => {
    const { top, left } = computeMenuPosition(null, menuSize, viewport)
    expect(left).toBeCloseTo((viewport.width - menuSize.width) / 2)
    expect(top).toBe(viewport.height - 8 - menuSize.height)
  })

  it('prefers placing the menu just above the anchor when there is room', () => {
    const anchor = {
      top: 400,
      left: 50,
      right: 150,
      bottom: 430,
      width: 100,
      height: 30,
    }
    const { top, left } = computeMenuPosition(anchor, menuSize, viewport)
    expect(top).toBe(anchor.top - 8 - menuSize.height)
    expect(left).toBe(anchor.left)
  })

  it('falls back to below the anchor when there is not enough room above', () => {
    const anchor = {
      top: 20,
      left: 50,
      right: 150,
      bottom: 50,
      width: 100,
      height: 30,
    }
    const { top } = computeMenuPosition(anchor, menuSize, viewport)
    expect(top).toBe(anchor.bottom + 8)
  })

  it('clamps left so the menu never runs off the right edge', () => {
    const anchor = {
      top: 400,
      left: 350,
      right: 380,
      bottom: 430,
      width: 30,
      height: 30,
    }
    const { left } = computeMenuPosition(anchor, menuSize, viewport)
    expect(left).toBe(viewport.width - 8 - menuSize.width)
  })

  it('clamps left so the menu never runs off the left edge', () => {
    const anchor = {
      top: 400,
      left: -50,
      right: -20,
      bottom: 430,
      width: 30,
      height: 30,
    }
    const { left } = computeMenuPosition(anchor, menuSize, viewport)
    expect(left).toBe(8)
  })

  it('clamps top against the bottom edge when the menu has no room above or below', () => {
    const tallMenu = { width: 200, height: 700 }
    const anchor = {
      top: 400,
      left: 50,
      right: 150,
      bottom: 430,
      width: 100,
      height: 30,
    }
    const { top } = computeMenuPosition(anchor, tallMenu, viewport)
    expect(top).toBe(viewport.height - 8 - tallMenu.height)
  })

  // `preferAbove: false` — the caret-anchored desktop mode's placement rule.
  it('prefers placing the menu just below the anchor when preferAbove is false and there is room', () => {
    const anchor = {
      top: 400,
      left: 50,
      right: 150,
      bottom: 430,
      width: 100,
      height: 30,
    }
    const { top } = computeMenuPosition(anchor, menuSize, viewport, { preferAbove: false })
    expect(top).toBe(anchor.bottom + 8)
  })

  it('falls back to above the anchor when preferAbove is false and there is no room below', () => {
    const anchor = {
      top: 500,
      left: 50,
      right: 150,
      bottom: 750,
      width: 100,
      height: 250,
    }
    const { top } = computeMenuPosition(anchor, menuSize, viewport, { preferAbove: false })
    expect(top).toBe(anchor.top - 8 - menuSize.height)
  })

  // `viewport.left`/`viewport.top` non-zero — e.g. `window.visualViewport`'s
  // own box once pinch-zoom/an on-screen keyboard has panned it away from
  // `(0, 0)` (see `getViewportBox`). Every clamp and fallback below is
  // relative to that offset, not hard-coded to the document's own origin.
  it('offsets the no-anchor fallback placement by a non-zero viewport box origin', () => {
    const offsetViewport = { left: 40, top: 60, width: 400, height: 800 }
    const { top, left } = computeMenuPosition(null, menuSize, offsetViewport)
    expect(left).toBeCloseTo(offsetViewport.left + (offsetViewport.width - menuSize.width) / 2)
    expect(top).toBe(offsetViewport.top + offsetViewport.height - 8 - menuSize.height)
  })

  it('clamps left against a non-zero viewport box origin\'s own right edge', () => {
    const offsetViewport = { left: 40, top: 60, width: 400, height: 800 }
    const anchor = {
      top: offsetViewport.top + 400,
      left: offsetViewport.left + 350,
      right: offsetViewport.left + 380,
      bottom: offsetViewport.top + 430,
      width: 30,
      height: 30,
    }
    const { left } = computeMenuPosition(anchor, menuSize, offsetViewport)
    expect(left).toBe(offsetViewport.left + offsetViewport.width - 8 - menuSize.width)
  })

  it('clamps top against a non-zero viewport box origin\'s own bottom edge', () => {
    const offsetViewport = { left: 0, top: 100, width: 400, height: 400 }
    const tallMenu = { width: 200, height: 350 }
    const anchor = {
      top: offsetViewport.top + 200,
      left: 50,
      right: 150,
      bottom: offsetViewport.top + 230,
      width: 100,
      height: 30,
    }
    const { top } = computeMenuPosition(anchor, tallMenu, offsetViewport)
    expect(top).toBe(offsetViewport.top + offsetViewport.height - 8 - tallMenu.height)
  })
})

describe('CommandMenu', () => {
  const commands: Command[] = [
    { name: 'fix', prompt: 'Fix {{text}}' },
    { name: 'tl', prompt: 'Translate {{text}}' },
  ]

  let target: HTMLTextAreaElement
  let menu: CommandMenu
  let onSelect: ReturnType<typeof vi.fn<CommandMenuCallbacks['onSelect']>>
  let onOpenSettings: ReturnType<typeof vi.fn<CommandMenuCallbacks['onOpenSettings']>>

  beforeEach(() => {
    target = document.createElement('textarea')
    document.body.append(target)
    onSelect = vi.fn<CommandMenuCallbacks['onSelect']>()
    onOpenSettings = vi.fn<CommandMenuCallbacks['onOpenSettings']>()
    menu = new CommandMenu({ onSelect, onOpenSettings })
  })

  afterEach(() => {
    menu.destroy()
    target.remove()
  })

  it('destroy() is a safe no-op when nothing is open', () => {
    expect(menu.isOpen).toBe(false)
    expect(() => menu.destroy()).not.toThrow()
  })

  it('renders one touch-friendly button per command, plus a Settings gear in the header', () => {
    menu.show(target, commands)
    expect(menu.isOpen).toBe(true)

    expect(getCommandButtons().map((b) => b.textContent)).toEqual(['/fix', '/tl'])
    // The Settings entry no longer takes its own footer row — it's a gear in
    // the header, so the command list is full-width and the menu stays short.
    const settings = getSettingsButton()
    expect(settings).not.toBeNull()
    expect(settings!.textContent).toBe('⚙')
    expect(settings!.getAttribute('aria-label')).toBe('Settings')
    // "touch friendly: row height >= 44px" — computed from the CSS rule
    // rather than asserted against the stylesheet text, so this actually
    // exercises the rendered layout.
    for (const button of getMenuButtons()) {
      expect(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
    }
  })

  it('shows an empty-state message (and still a header Settings gear) when there are no commands', () => {
    menu.show(target, [])
    const host = getMenuHost()!
    expect(host.shadowRoot!.textContent).toContain('No commands configured yet.')
    expect(getCommandButtons()).toHaveLength(0)
    expect(getSettingsButton()?.textContent).toBe('⚙')
  })

  it('tapping a command closes the menu and invokes onSelect with the target element and that command', () => {
    menu.show(target, commands)
    getCommandButtons()[0]!.click()

    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith(target, commands[0])
    expect(onOpenSettings).not.toHaveBeenCalled()
    expect(getMenuHost()).toBeNull()
    expect(menu.isOpen).toBe(false)
  })

  it('tapping Settings closes the menu and invokes onOpenSettings', () => {
    menu.show(target, commands)
    getSettingsButton()!.click()

    expect(onOpenSettings).toHaveBeenCalledTimes(1)
    expect(onSelect).not.toHaveBeenCalled()
    expect(getMenuHost()).toBeNull()
  })

  it('closes when a pointerdown lands outside the menu, without invoking either callback', () => {
    menu.show(target, commands)
    expect(getMenuHost()).not.toBeNull()

    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }))

    expect(getMenuHost()).toBeNull()
    expect(onSelect).not.toHaveBeenCalled()
    expect(onOpenSettings).not.toHaveBeenCalled()
  })

  it('closes on a bare Escape keydown', () => {
    menu.show(target, commands)
    expect(getMenuHost()).not.toBeNull()

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

    expect(getMenuHost()).toBeNull()
  })

  // Regression guard for the fix that made this `stopImmediatePropagation`
  // rather than `stopPropagation`: a same-phase, same-target listener
  // registered *after* the menu's own (e.g. some other feature's document
  // keydown handler) must not still see an Escape the menu already acted
  // on. Note this only covers listeners registered after the menu opens —
  // content.ts's own undo-Esc handler is registered once at content-script
  // init, *before* any menu ever opens, so it's guarded separately there
  // (`if (commandMenu.isOpen) return`), not by this propagation-stopping
  // alone; registration order means a same-phase listener can never be
  // un-run retroactively by a later listener's `stopImmediatePropagation`.
  it('stops Escape from reaching a keydown listener registered after the menu opened', () => {
    menu.show(target, commands)

    const laterListener = vi.fn()
    document.addEventListener('keydown', laterListener, true)
    try {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      expect(laterListener).not.toHaveBeenCalled()
      expect(getMenuHost()).toBeNull()
    } finally {
      document.removeEventListener('keydown', laterListener, true)
    }
  })

  it('closes on scroll — a one-shot placement rather than tracking the anchor', () => {
    menu.show(target, commands)
    expect(getMenuHost()).not.toBeNull()

    window.dispatchEvent(new Event('scroll'))

    expect(getMenuHost()).toBeNull()
  })

  // A scroll dispatched directly on `window`/`document` (rather than on
  // something inside the menu's own shadow tree) is exactly what a real
  // page scroll looks like — `composedPath()` never includes the menu host
  // for this, so it must still close the menu even while the command list
  // is scrollable (regression guard against the composedPath check in
  // `dismissHandler` swallowing more than just its own internal scrolls).
  it('closes on scroll even with a long, scrollable command list open', () => {
    menu.show(target, makeCommands(30))
    expect(getMenuHost()).not.toBeNull()

    window.dispatchEvent(new Event('scroll'))

    expect(getMenuHost()).toBeNull()
  })

  // Regression: scrolling `.imp-write-menu-list` itself must not be treated
  // like a page scroll — `dismissHandler` checks `composedPath()` for the
  // menu host specifically to distinguish the two. `composed: true` here
  // stands in for however a given engine's own scroll events propagate
  // (native scroll events don't bubble and aren't composed in the engine
  // this suite runs under — see `.imp-write-menu-list`'s CSS comment for
  // why `overscroll-behavior: contain` is still needed to keep a real page
  // scroll from ever happening in the first place); this asserts the
  // listener-side guard holds regardless.
  it('scrolling inside the menu list does not close it', () => {
    menu.show(target, makeCommands(30))
    const list = getMenuListEl()!

    list.dispatchEvent(new Event('scroll', { bubbles: false, composed: true }))

    expect(getMenuHost()).not.toBeNull()
    expect(menu.isOpen).toBe(true)
  })

  it('with many commands, the menu stays within the viewport height and the list scrolls internally', () => {
    menu.show(target, makeCommands(30))

    const viewportHeight = window.visualViewport?.height ?? window.innerHeight
    const hostRect = getMenuHost()!.getBoundingClientRect()
    expect(hostRect.height).toBeLessThanOrEqual(viewportHeight)

    const list = getMenuListEl()!
    expect(list.scrollHeight).toBeGreaterThan(list.clientHeight)
  })

  it('with many commands, the Settings gear stays visible in the header and the list scrolls internally', () => {
    menu.show(target, makeCommands(30))

    const viewportHeight = window.visualViewport?.height ?? window.innerHeight
    const settingsRect = getSettingsButton()!.getBoundingClientRect()
    expect(settingsRect.top).toBeGreaterThanOrEqual(0)
    expect(settingsRect.bottom).toBeLessThanOrEqual(viewportHeight)

    // The gear lives in the header (never scrolls with the list), and the
    // command list itself scrolls internally to fit the fixed max-height.
    const list = getMenuListEl()!
    expect(list.scrollHeight).toBeGreaterThan(list.clientHeight)
  })

  it('with only a few commands, the list has no scrollbar — layout is unchanged from before', () => {
    menu.show(target, makeCommands(3))

    const list = getMenuListEl()!
    expect(list.scrollHeight).toBeLessThanOrEqual(list.clientHeight)
  })

  it('a second show() tears down the first — never stacks two menus', () => {
    menu.show(target, commands)
    const firstHost = getMenuHost()

    menu.show(target, commands)

    expect(document.querySelectorAll(`#${MENU_HOST_ID}`).length).toBe(1)
    expect(getMenuHost()).not.toBe(firstHost)
  })

  it('positions itself just above the target when there is room there (default element anchor mode)', () => {
    target.style.position = 'fixed'
    target.style.top = '400px'
    target.style.left = '40px'
    target.style.width = '200px'
    target.style.height = '40px'

    menu.show(target, commands)

    const host = getMenuHost()!
    expect(host.style.position).toBe('fixed')

    const targetRect = target.getBoundingClientRect()
    const hostRect = host.getBoundingClientRect()
    expect(hostRect.bottom).toBeLessThanOrEqual(targetRect.top)
  })

  it('anchorMode: "caret" positions the menu below the text cursor instead of above the whole element', () => {
    target.style.position = 'fixed'
    target.style.top = '100px'
    target.style.left = '40px'
    target.style.width = '300px'
    target.style.height = '120px'
    target.value = 'hello world'
    document.body.appendChild(target)
    target.focus()
    // Collapsed caret at the very start of the field's text — puts the
    // measured caret position near the element's own top edge, so "below
    // the caret" and "below the whole element" would coincide if this
    // fell back to element-anchoring by mistake, but genuinely differ from
    // "above the whole element" (this mode's whole point).
    target.setSelectionRange(0, 0)

    menu.show(target, commands, { anchorMode: 'caret' })

    const host = getMenuHost()!
    const targetRect = target.getBoundingClientRect()
    const hostRect = host.getBoundingClientRect()
    // Below the caret (near the element's top edge), not above the whole
    // element — the opposite side from the default element-anchor mode's
    // placement in the test above.
    expect(hostRect.top).toBeGreaterThanOrEqual(targetRect.top)
  })

  // Regression: `getContentEditableCaretOffset` (lib/caret.ts) measures a
  // live Range's `getBoundingClientRect()`, which is already a post-scroll,
  // on-screen position — unlike the input/textarea mirror-`<div>`
  // measurement, which genuinely needs `scrollTop`/`scrollLeft` subtracted.
  // Subtracting the scroll offset a second time for a contenteditable
  // target pushes the computed anchor further off-screen the more it's
  // scrolled — badly enough, in this scenario, that `isRectVisible` used to
  // reject it outright and the menu fell back to being centered near the
  // *bottom of the whole viewport* instead of anywhere near the actual
  // element.
  it('anchorMode: "caret" does not double-subtract the scroll offset for a scrolled contenteditable', () => {
    const ce = document.createElement('div')
    ce.contentEditable = 'true'
    Object.assign(ce.style, {
      position: 'fixed',
      top: '100px',
      left: '40px',
      width: '300px',
      height: '100px',
      overflow: 'auto',
      font: '16px/20px monospace',
      whiteSpace: 'pre-wrap',
      padding: '0',
      border: '0',
      margin: '0',
      boxSizing: 'border-box',
    })
    // Far taller than the 100px viewport — genuinely scrollable.
    ce.textContent = Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n')
    document.body.appendChild(ce)

    try {
      ce.focus()
      const range = document.createRange()
      range.selectNodeContents(ce)
      range.collapse(false) // caret at the very end (last line)
      const sel = window.getSelection()!
      sel.removeAllRanges()
      sel.addRange(range)
      ce.scrollTop = ce.scrollHeight // scroll all the way to the bottom

      // Sanity: this scenario is actually scrolled, and the caret itself
      // (measured directly, independent of `CommandMenu`) lands within the
      // element's own visible box — confirming `getCaretOffset` itself is
      // correctly post-scroll, so the regression below is specifically
      // about `computeAnchorRect`'s extra subtraction, not the underlying
      // measurement.
      expect(ce.scrollTop).toBeGreaterThan(0)
      const caret = getCaretOffset(ce)!
      expect(caret).not.toBeNull()
      expect(caret.top).toBeGreaterThanOrEqual(0)
      expect(caret.top).toBeLessThan(ce.clientHeight)

      menu.show(ce, commands, { anchorMode: 'caret' })

      const ceRect = ce.getBoundingClientRect()
      const hostRect = getMenuHost()!.getBoundingClientRect()
      // Lands near the element, not centered near the bottom of the whole
      // (much taller, jsdom-less real browser viewport) test viewport.
      expect(hostRect.top).toBeGreaterThan(ceRect.top - 50)
      expect(hostRect.top).toBeLessThan(ceRect.bottom + 300)
    } finally {
      ce.remove()
    }
  })

  it('continuing to type in the target element closes the menu (beforeinput)', () => {
    menu.show(target, commands)
    expect(getMenuHost()).not.toBeNull()

    target.dispatchEvent(
      new InputEvent('beforeinput', { inputType: 'insertText', data: 'x', bubbles: true }),
    )

    expect(getMenuHost()).toBeNull()
    expect(menu.isOpen).toBe(false)
  })

  it('typing in a different element does not close the menu', () => {
    const other = document.createElement('textarea')
    document.body.append(other)
    try {
      menu.show(target, commands)
      expect(getMenuHost()).not.toBeNull()

      other.dispatchEvent(
        new InputEvent('beforeinput', { inputType: 'insertText', data: 'x', bubbles: true }),
      )

      expect(getMenuHost()).not.toBeNull()
    } finally {
      other.remove()
    }
  })

  it('the beforeinput close listener is torn down on destroy — a later beforeinput on the same element is a no-op', () => {
    menu.show(target, commands)
    menu.destroy()

    expect(() =>
      target.dispatchEvent(
        new InputEvent('beforeinput', { inputType: 'insertText', data: 'x', bubbles: true }),
      ),
    ).not.toThrow()
  })

  it('onTargetInput returning false keeps the menu open instead of closing it', () => {
    const onTargetInput = vi.fn().mockReturnValue(false)
    const absorbingMenu = new CommandMenu({ onSelect, onOpenSettings, onTargetInput })
    try {
      absorbingMenu.show(target, commands)

      target.dispatchEvent(
        new InputEvent('beforeinput', { inputType: 'insertText', data: ' ', bubbles: true }),
      )

      expect(onTargetInput).toHaveBeenCalledTimes(1)
      expect(getMenuHost()).not.toBeNull()
      expect(absorbingMenu.isOpen).toBe(true)
    } finally {
      absorbingMenu.destroy()
    }
  })

  it('onTargetInput returning true closes the menu, same as the default (no callback) behavior', () => {
    const onTargetInput = vi.fn().mockReturnValue(true)
    const closingMenu = new CommandMenu({ onSelect, onOpenSettings, onTargetInput })
    try {
      closingMenu.show(target, commands)

      target.dispatchEvent(
        new InputEvent('beforeinput', { inputType: 'insertText', data: 'x', bubbles: true }),
      )

      expect(onTargetInput).toHaveBeenCalledTimes(1)
      expect(getMenuHost()).toBeNull()
      expect(closingMenu.isOpen).toBe(false)
    } finally {
      closingMenu.destroy()
    }
  })

  it('never calls preventDefault on the target input — the event still lands in the field regardless of onTargetInput\'s decision', () => {
    const onTargetInput = vi.fn().mockReturnValue(false)
    const absorbingMenu = new CommandMenu({ onSelect, onOpenSettings, onTargetInput })
    try {
      absorbingMenu.show(target, commands)

      const event = new InputEvent('beforeinput', {
        inputType: 'insertText',
        data: ' ',
        bubbles: true,
        cancelable: true,
      })
      target.dispatchEvent(event)

      expect(event.defaultPrevented).toBe(false)
    } finally {
      absorbingMenu.destroy()
    }
  })
})

describe('showNoTargetToast / hideNoTargetToast', () => {
  afterEach(() => {
    hideNoTargetToast()
  })

  it('renders the empty-state toast text', () => {
    showNoTargetToast()
    const toast = document.getElementById(TOAST_ID)
    expect(toast).not.toBeNull()
    expect(toast!.textContent).toBe('Focus a text field first')
  })

  it('hideNoTargetToast removes it immediately, without waiting for the auto-dismiss timer', () => {
    showNoTargetToast()
    hideNoTargetToast()
    expect(document.getElementById(TOAST_ID)).toBeNull()
  })

  it('hideNoTargetToast is a safe no-op when nothing is shown', () => {
    expect(() => hideNoTargetToast()).not.toThrow()
  })

  it('does not stack when called twice in a row — the old one is replaced', () => {
    showNoTargetToast()
    showNoTargetToast()
    expect(document.querySelectorAll(`#${TOAST_ID}`).length).toBe(1)
  })
})

describe('CANCEL_EMPTY_STATE_MESSAGE', () => {
  // content.ts relies on this being a stable, exact-match string it can
  // compare `postMessage`'s `event.data` against — see its doc comment.
  it('is a non-empty string constant', () => {
    expect(typeof CANCEL_EMPTY_STATE_MESSAGE).toBe('string')
    expect(CANCEL_EMPTY_STATE_MESSAGE.length).toBeGreaterThan(0)
  })
})
