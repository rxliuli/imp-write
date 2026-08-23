interface Selection {
  hasSelection: () => boolean

  getSelection: () => string
  replaceSelection: (text: string) => Promise<boolean>

  getInputValue: () => string
  replaceInputValue: (text: string) => Promise<boolean>
}

export function inputOrTextareaSelection(
  element: HTMLInputElement | HTMLTextAreaElement,
): Selection {
  const replaceSelection = async (text: string): Promise<boolean> => {
    const doc = element.ownerDocument || document
    const u = element.selectionStart
    const v = element.selectionEnd
    if (u == null || v == null || u === v) {
      return false
    }

    element.focus()

    // beforeinput: insert
    const insEvt = new InputEvent('beforeinput', {
      inputType: 'insertText',
      data: text,
      bubbles: true,
      cancelable: true,
    })
    const insPrevented = !element.dispatchEvent(insEvt)
    if (!insPrevented) {
      // @deprecated
      doc.execCommand('insertText', false, text)
      // Known limitation: a backgrounded/unfocused document (e.g. the user
      // switched tabs while the AI round-trip was still in flight) can leave
      // execCommand inserting at a stale caret position instead of honoring
      // the selection above — the result lands appended rather than
      // replaced. Two later attempts to detect and correct this (a forced
      // native-setter rewrite, then deferring the whole write until refocus)
      // both caused worse regressions elsewhere — a clobbered native undo
      // stack, and (for the refocus wait) a write that could get stuck
      // forever if the user never came back to this exact tab — so both were
      // reverted; see PLAN.md §4's 2026-08-22 addendum. This is accepted
      // as-is: Esc still reverts the whole field.
      // input 事件
      const inputEvt = new Event('input', {
        bubbles: true,
        cancelable: true,
      })
      element.dispatchEvent(inputEvt)
    }
    return true
  }
  return {
    hasSelection: () => {
      const start = element.selectionStart
      const end = element.selectionEnd
      return start !== end && start !== null && end !== null
    },
    getSelection: () => {
      const start = element.selectionStart
      const end = element.selectionEnd
      if (start !== end && start !== null && end !== null) {
        return element.value.slice(start, end)
      }
      return ''
    },
    replaceSelection,
    getInputValue: () => {
      return element.value
    },
    replaceInputValue: async (text: string) => {
      element.select()
      return replaceSelection(text)
    },
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function isInputOrTextarea(
  el: Element,
): el is HTMLInputElement | HTMLTextAreaElement {
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA'
}

// A frozen picture of "what was selected" at the moment a scope='selection'
// command was triggered. The AI round-trip can take a while — the user may
// move the caret, change the selection, or focus a completely different
// editable element before the result comes back. Writing to whatever's
// selected *at write-back time* (rather than what triggered the command) is
// how a stale write silently lands on the wrong element, or a
// since-collapsed selection escalates into a whole-field overwrite via
// `tryExecCommandInsertText`'s select-all fallback. See `captureSelectionSnapshot`
// / `restoreSelectionSnapshot`.
export type SelectionSnapshot =
  | { kind: 'input'; start: number; end: number }
  | {
      kind: 'range'
      startContainer: Node
      startOffset: number
      endContainer: Node
      endOffset: number
    }

/** Captures the current selection within `element`, or `null` if there isn't one. */
export function captureSelectionSnapshot(
  element: HTMLElement,
): SelectionSnapshot | null {
  if (isInputOrTextarea(element)) {
    const start = element.selectionStart
    const end = element.selectionEnd
    if (start == null || end == null || start === end) {
      return null
    }
    return { kind: 'input', start, end }
  }
  const doc = element.ownerDocument || document
  const sel = doc.getSelection?.()
  if (!sel || sel.rangeCount === 0) {
    return null
  }
  // `cloneRange()` protects against the *Selection's own* Range object being
  // reused/mutated as the user's selection keeps changing. But a `Range`
  // (cloned or not) is itself DOM-"live": if the DOM later removes one of
  // its boundary nodes, the browser silently relocates the boundary to the
  // nearest surviving ancestor instead of leaving it "invalid" — which would
  // make a detached/re-rendered container look connected again. So pull the
  // boundary points out into plain fields right away; a plain `Node`
  // reference just goes `isConnected === false` when removed, with no
  // silent relocation, which is what `restoreSelectionSnapshot` needs to
  // reliably detect a stale snapshot.
  const range = sel.getRangeAt(0).cloneRange()
  if (range.collapsed) {
    return null
  }
  return {
    kind: 'range',
    startContainer: range.startContainer,
    startOffset: range.startOffset,
    endContainer: range.endContainer,
    endOffset: range.endOffset,
  }
}

/**
 * Re-applies a previously captured selection to `element`, right before a
 * write-back. Returns `false` (and touches nothing) if `element` or the
 * snapshot's range is no longer valid — the caller must treat that as a hard
 * failure, never fall back to selecting everything or writing to whatever
 * happens to be selected now.
 */
export function restoreSelectionSnapshot(
  element: HTMLElement,
  snapshot: SelectionSnapshot,
): boolean {
  if (!element.isConnected) {
    return false
  }
  if (snapshot.kind === 'input') {
    if (!isInputOrTextarea(element)) {
      return false
    }
    element.focus()
    element.setSelectionRange(snapshot.start, snapshot.end)
    return true
  }
  const { startContainer, startOffset, endContainer, endOffset } = snapshot
  if (
    !startContainer.isConnected ||
    !endContainer.isConnected ||
    !element.contains(startContainer) ||
    !element.contains(endContainer)
  ) {
    return false
  }
  const doc = element.ownerDocument || document
  const sel = doc.getSelection?.()
  if (!sel) {
    return false
  }
  element.focus()
  // Use setBaseAndExtent instead of removeAllRanges() + addRange() — see the
  // comment on `selectAll` below for why.
  sel.setBaseAndExtent(startContainer, startOffset, endContainer, endOffset)
  return true
}

function selectAll(el: Element) {
  const sel = el.ownerDocument.getSelection?.()
  if (!sel) return
    // Use setBaseAndExtent instead of removeAllRanges() + addRange().
  // In iOS Safari (WebKit), removeAllRanges() causes the editable element
  // to lose focus, because WebKit ties focus to selection — clearing the
  // selection clears focus. And without removeAllRanges(), addRange() is
  // silently ignored when a selection already exists.
  // setBaseAndExtent atomically replaces the selection without this issue.
  //
  // Related:
  // - https://bugs.webkit.org/show_bug.cgi?id=38696
  //   (WebKit moves focus to where selection is)
  // - https://bugzilla.mozilla.org/show_bug.cgi?id=1318312
  //   (cross-browser Selection API / focus interaction differences)
  sel.setBaseAndExtent(el, 0, el, el.childNodes.length)
}

function dispatchInput(el: Element) {
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

async function tryPaste(text: string, el: Element, stepDelayMs: number) {
  await sleep(10)
  try {
    // 合成粘贴事件（有站点/浏览器会拦截，故仅为尝试）
    const dt = new DataTransfer()
    dt.setData('text/plain', text)
    const evt = new ClipboardEvent('paste', {
      clipboardData: dt,
      bubbles: true,
      cancelable: true,
    })
    el.dispatchEvent(evt)
    await sleep(stepDelayMs)
  } catch {
    // ignore
  }
}

export async function tryExecCommandInsertText(
  text: string,
  el: Element,
  stepDelayMs: number,
  // Only the whole-field replace path (`replaceInputValue` / `all=true`)
  // may fall back to selecting everything when nothing is selected.
  // Selection-scoped replacements must never silently escalate to
  // overwriting the entire field — see `SelectionSnapshot`'s comment.
  allowSelectAllFallback = true,
) {
  const doc = el.ownerDocument || document
  try {
    const selected = getSelect()
    if (!selected && allowSelectAllFallback) {
      if (isInputOrTextarea(el) && el.value) {
        el.select()
      } else if (!isInputOrTextarea(el)) {
        selectAll(el)
      }
    }
    // 有些浏览器不再推荐 execCommand，但仍兼容
    // 插入时将 \n 替换为 \r 与原实现一致（有些输入控件依赖此行为）
    // 这里保留 \n 写入；需要完全一致可改为 text.replace(/\n/g, '\r')
    // @deprecated
    doc.execCommand('insertText', false, text)
    await sleep(stepDelayMs)
    // 兜底：对 input/textarea，直接赋值
    if (isInputOrTextarea(el)) {
      if (el.value !== text) {
        if (selected) {
          el.value = el.value.replace(selected, text)
        } else {
          el.value = text
        }
        dispatchInput(el)
      }
    }
  } catch {
    // ignore
  }
}

export function editableSelection(element: HTMLElement): Selection {
  const getInputValue = () => {
    const raw = element.innerText || element.textContent || ''
    // Normalize line breaks: Slate editor (used by Discord) inserts U+FEFF (zero-width no-break space)
    // and extra newlines for empty lines, causing "\n﻿\n\n" instead of "\n\n".
    // Remove U+FEFF and collapse 3+ consecutive newlines to 2.
    return raw.replace(/﻿/g, '').replace(/\n{3,}/g, '\n\n')
  }
  const getSelection = () => {
    const selection = window.getSelection()
    return selection?.toString() || ''
  }

  async function checkWriteSuccess(tryFn: () => Promise<void>, text: string) {
    const beforeContent = getInputValue()
    await tryFn()
    const afterContent = getInputValue()
    if (afterContent.trim().length === 0) {
      return false
    }
    if (afterContent.includes(text)) {
      return true
    }
    // Check if content has changed, likely successful despite formatting differences
    if (
      afterContent !== beforeContent &&
      afterContent.trim() !== beforeContent.trim()
    ) {
      console.debug(
        'Content changed, likely successful despite formatting differences',
      )
      return true
    }

    // normalize
    const normalizeText = (str: string) => str.replace(/\s+/g, ' ').trim()
    const normalizedAfter = normalizeText(afterContent)
    const normalizedText = normalizeText(text)

    if (normalizedAfter.includes(normalizedText)) {
      console.debug('Text found after normalization')
      return true
    }
  }

  // Known limitation: a backgrounded/unfocused document (e.g. the user
  // switched tabs while the AI round-trip was still in flight) can leave
  // paste/execCommand appending at a stale caret position instead of
  // actually replacing the field — `checkWriteSuccess` above treats
  // `afterContent.includes(text)` as success, which an append satisfies just
  // as well as a real replace does. An earlier fix detected that specific
  // shape and force-corrected it via a bare `element.innerText =` assignment
  // — which on a real rich-text editor (e.g. Slate) can stomp the editor's
  // own internal state and leave the field no longer editable. That
  // correction was reverted; see PLAN.md §4's 2026-08-22 addendum. This is
  // accepted as-is: Esc still reverts the whole field.
  const replaceSelection = async (
    text: string,
    all = false,
  ): Promise<boolean> => {
    // contentEditable 的删除尝试（可选）
    // try {
    //   if (!isInputOrTextarea(element) && getInputValue().trim() !== '') {
    //     // @deprecated
    //     document.execCommand('delete')
    //     await sleep(10)
    //   }
    // } catch {
    //   /* ignore */
    // }

    // try paste
    if (all) {
      selectAll(element)
    }
    if (await checkWriteSuccess(() => tryPaste(text, element, 100), text)) {
      return true
    }
    // try command
    if (
      await checkWriteSuccess(
        () => tryExecCommandInsertText(text, element, 100, all),
        text,
      )
    ) {
      return true
    }
    return false
  }
  return {
    hasSelection: () => !!getSelection(),
    getSelection,
    replaceSelection,
    getInputValue,
    replaceInputValue: (text: string) => replaceSelection(text, true),
  }
}

export function isInputElement(
  element: Element | null,
): element is HTMLElement {
  if (!element) {
    return false
  }

  // Security boundary: rewrite only makes sense for plain text fields.
  // Sensitive fields (password/email/number/tel/url/date, etc.) must never
  // enter the AI pipeline, so only allow the text-like input types here.
  // Note: `element.type` defaults to 'text' when the `type` attribute is
  // unset, so there is no need to special-case the missing attribute.
  if (element instanceof HTMLInputElement) {
    return element.type === 'text' || element.type === 'search'
  }

  return (
    element instanceof HTMLTextAreaElement ||
    element.getAttribute('contenteditable') === 'true' ||
    element.getAttribute('role') === 'textbox'
  )
}

export function getEditSelection(element: HTMLElement): Selection {
  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement
  ) {
    return inputOrTextareaSelection(element)
  }
  return editableSelection(element)
}

export function getSelect(): string | null {
  const selection = getSelection()
  if (!selection || selection.type === 'None') {
    return null
  }
  return selection.toString()
}

export async function writeClipboard(text: string) {
  await navigator.clipboard.writeText(text)
}

export function getActiveElement(
  element: HTMLElement | null = document.activeElement as HTMLElement,
): HTMLElement | null {
  if (!element) {
    return null
  }
  const shadowRoot = element.shadowRoot
  if (!shadowRoot) {
    return element
  }
  const shadowElement = shadowRoot.activeElement as HTMLElement | null
  if (!shadowElement) {
    return element
  }
  return getActiveElement(shadowElement)
}
