import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  captureSelectionSnapshot,
  editableSelection,
  inputOrTextareaSelection,
  isInputElement,
  restoreSelectionSnapshot,
  tryExecCommandInsertText,
} from './selection'
import { commands, userEvent } from 'vitest/browser'

describe('input or textarea selection', () => {
  let input: HTMLInputElement
  beforeEach(async () => {
    input = document.createElement('input')
    input.type = 'text'
    input.dataset.testid = 'test-input'
    input.value = ''
    document.body.append(input)
    await userEvent.fill(input, 'hello world')
  })
  afterEach(() => {
    input.remove()
  })
  it('no selection', async () => {
    const selection = inputOrTextareaSelection(input)
    expect(selection.getSelection()).eq('')
    expect(selection.hasSelection()).false
    expect(selection.getInputValue()).eq('hello world')

    selection.replaceInputValue('hi')
    expect(input.value).eq('hi')
    await commands.undo()
    expect(input.value).eq('hello world')
  })
  it('has selection', async () => {
    const selection = inputOrTextareaSelection(input)
    await userEvent.click(input)
    await commands.keypress('Home')
    await commands.keydown('Shift')
    Array.from({ length: 5 }).forEach(async () => {
      await commands.keydown('ArrowRight')
    })
    await commands.keyup('Shift')
    expect(selection.hasSelection()).true
    expect(selection.getSelection()).eq('hello')

    selection.replaceSelection('hi')
    expect(input.value).eq('hi world')
    expect(selection.hasSelection()).false
    await userEvent.type(input, ' javascript')
    expect(input.value).eq('hi javascript world')
    await commands.undo()
    // expect(input.value).eq('hi world')
    // await commands.undo()
    expect(input.value).eq('hello world') // TODO: why?
  })
  it('has selection and direction', async () => {
    const selection = inputOrTextareaSelection(input)
    await userEvent.click(input)
    await commands.keydown('Shift')
    Array.from({ length: 5 }).forEach(async () => {
      await commands.keydown('ArrowLeft')
    })
    await commands.keyup('Shift')
    expect(selection.hasSelection()).true
    expect(selection.getSelection()).eq('world')

    selection.replaceSelection('javascript')
    expect(input.value).eq('hello javascript')
    expect(selection.hasSelection()).false
    await commands.undo()
    expect(input.value).eq('hello world')
  })
})

describe('editable selection', () => {
  let input: HTMLElement
  beforeEach(async () => {
    input = document.createElement('div')
    input.contentEditable = 'true'
    input.dataset.testid = 'test-editable'
    document.body.append(input)
    await userEvent.fill(input, 'hello world')
  })
  afterEach(() => {
    input.remove()
  })
  it('no selection', async () => {
    const selection = editableSelection(input)
    expect(selection.hasSelection()).false
    expect(selection.getSelection()).eq('')
    expect(selection.getInputValue()).eq('hello world')

    await selection.replaceInputValue('hi')
    expect(input.innerText).eq('hi')
    expect(selection.hasSelection()).false
    await commands.undo()
    expect(input.innerText).eq('hello world')
  })
  it.skip('has selection', async () => {
    const selection = editableSelection(input)
    await userEvent.click(input)
    await commands.keypress('Home')
    await commands.keydown('Shift')
    Array.from({ length: 5 }).forEach(async () => {
      await commands.keydown('ArrowRight')
    })
    await commands.keyup('Shift')
    expect(selection.hasSelection()).true
    expect(selection.getSelection()).eq('hello')

    await selection.replaceSelection('hi')
    expect(input.innerText).eq('hi world')
    expect(selection.hasSelection()).false
    await userEvent.type(input, ' javascript')
    expect(input.innerText).eq('hi javascript world')
    await commands.undo()
    expect(input.innerText).eq('hi world')
    await commands.undo()
    expect(input.innerText).eq('hello world')
  })
  it('auto change on paste', async () => {
    const selection = editableSelection(input)
    await userEvent.click(input)
    await userEvent.fill(input, '')
    expect(input.innerText.trim()).eq('')
    input.addEventListener('paste', (ev) => {
      const str = ev.clipboardData?.getData('text/plain')
      if (!str) {
        return
      }
      ev.preventDefault()
      document.execCommand('insertText', false, str.repeat(2))
    })
    await userEvent.paste()
    await selection.replaceInputValue('hello')
    expect(input.innerText).eq('hellohello')

    await commands.keypress('Home')
    await commands.keydown('Shift')
    Array.from({ length: 5 }).forEach(async () => {
      await commands.keydown('ArrowRight')
    })
    await commands.keyup('Shift')
    await selection.replaceSelection('world')
    expect(input.innerText).eq('worldworldhello')
  })
  it('custom paste event listener', async () => {
    const selection = editableSelection(input)
    input.addEventListener('paste', (ev) => {
      if (!ev.isTrusted) {
        // example: https://gemini.google.com/app
        input.textContent = ''
      }
    })
    expect(selection.getInputValue()).eq('hello world')
    await selection.replaceInputValue('hi')
    expect(input.innerText).eq('hi')
  })
  // Regression test: contentEditable inside Shadow DOM should be writable.
  // On iOS Safari, the old selectAll implementation using removeAllRanges()+addRange()
  // caused blur, making execCommand fail. setBaseAndExtent() fixes this.
  it('contentEditable inside shadow DOM', async () => {
    input.remove()
    const host = document.createElement('div')
    document.body.append(host)
    const shadow = host.attachShadow({ mode: 'open' })
    const inner = document.createElement('div')
    inner.contentEditable = 'true'
    inner.dataset.testid = 'test-shadow-editable'
    shadow.append(inner)
    await userEvent.click(inner)
    await userEvent.fill(inner, 'hello world')

    const selection = editableSelection(inner)
    expect(selection.getInputValue()).eq('hello world')
    await selection.replaceInputValue('hi')
    expect(inner.innerText).eq('hi')

    host.remove()
  })
  // https://quilljs.com/
  it.todo('quill editor')

  // Discord uses Slate editor which inserts U+FEFF and extra newlines for empty lines
  it('Discord/Slate editor multiline with empty lines', () => {
    // Simulate Discord's Slate editor HTML structure for:
    // "first line"
    // (empty line)
    // "second line"
    input.innerHTML = `
      <div data-slate-node="element">
        <span data-slate-node="text">
          <span data-slate-leaf="true">
            <span data-slate-string="true">first line</span>
          </span>
        </span>
      </div>
      <div data-slate-node="element">
        <span data-slate-node="text">
          <span data-slate-leaf="true" class="emptyText__1464f">
            <span data-slate-zero-width="n" data-slate-length="0">﻿<br></span>
          </span>
        </span>
      </div>
      <div data-slate-node="element">
        <span data-slate-node="text">
          <span data-slate-leaf="true">
            <span data-slate-string="true">second line</span>
          </span>
        </span>
      </div>
    `

    const selection = editableSelection(input)
    const value = selection.getInputValue()

    // Should normalize to exactly one empty line (two newlines)
    // Without the fix, innerText returns "first line\n﻿\n\nsecond line" (with U+FEFF and 3 newlines)
    expect(value).eq('first line\n\nsecond line')
    expect(value).not.include('﻿')
  })
})

describe('tryExecCommandInsertText', () => {
  describe('input', () => {
    let input: HTMLInputElement
    beforeEach(async () => {
      input = document.createElement('input')
      input.type = 'text'
      input.dataset.testid = 'test-input'
      input.value = ''
      document.body.append(input)
      await userEvent.fill(input, 'hello world')
    })
    afterEach(() => {
      input.remove()
    })
    it('replace all text', async () => {
      await tryExecCommandInsertText('hi', input, 100)
      expect(input.value).eq('hi')
    })
    it('replace selected text', async () => {
      await commands.keypress('Home')
      await commands.keydown('Shift')
      for (let i = 0; i < 5; i++) {
        await commands.keydown('ArrowRight')
      }
      await commands.keyup('Shift')
      await tryExecCommandInsertText('hi', input, 100)
      expect(input.value).eq('hi world')
    })
  })
  describe('editable', () => {
    let input: HTMLElement
    beforeEach(async () => {
      input = document.createElement('div')
      input.contentEditable = 'true'
      input.dataset.testid = 'test-editable'
      document.body.append(input)
      await userEvent.fill(input, 'hello world')
    })
    afterEach(() => {
      input.remove()
    })
    it('replace all text', async () => {
      await tryExecCommandInsertText('hi', input, 100)
      expect(input.innerText).eq('hi')
    })
    it('replace selected text', async () => {
      await commands.keypress('Home')
      await commands.keydown('Shift')
      for (let i = 0; i < 5; i++) {
        await commands.keydown('ArrowRight')
      }
      await commands.keyup('Shift')
      await tryExecCommandInsertText('hi', input, 100)
      expect(input.innerText).eq('hi world')
    })
  })
})

// Regression coverage for the "selection-scoped write-back must snapshot and
// restore the selection that was active when the command was *triggered*,
// never whatever's selected when the AI result comes back" fix.
describe('selection snapshot (capture/restore)', () => {
  describe('contenteditable', () => {
    let a: HTMLElement
    let b: HTMLElement
    beforeEach(() => {
      a = document.createElement('div')
      a.contentEditable = 'true'
      a.dataset.testid = 'snapshot-a'
      document.body.append(a)

      b = document.createElement('div')
      b.contentEditable = 'true'
      b.dataset.testid = 'snapshot-b'
      document.body.append(b)
    })
    afterEach(() => {
      a.remove()
      b.remove()
    })

    function selectRange(el: HTMLElement, start: number, end: number) {
      const textNode = el.firstChild!
      const sel = window.getSelection()!
      sel.setBaseAndExtent(textNode, start, textNode, end)
    }

    it('restores a since-collapsed selection back to the captured range before replace (no whole-field overwrite)', async () => {
      a.textContent = 'hello world'
      selectRange(a, 0, 5) // "hello"
      const snapshot = captureSelectionSnapshot(a)
      expect(snapshot).not.toBeNull()

      // Selection collapses in the meantime (e.g. user clicked elsewhere in A).
      selectRange(a, 11, 11)

      expect(restoreSelectionSnapshot(a, snapshot!)).true

      const selection = editableSelection(a)
      const written = await selection.replaceSelection('hi')
      expect(written).true
      // Only the originally-selected "hello" was replaced — not the whole field.
      expect(a.innerText).eq('hi world')
    })

    it('restores the captured range in A even after the live selection moved into B, and leaves B untouched', async () => {
      a.textContent = 'hello world'
      b.textContent = 'foo bar'

      selectRange(a, 0, 5) // "hello" in A
      const snapshot = captureSelectionSnapshot(a)
      expect(snapshot).not.toBeNull()

      // User switches focus/selection to a different editable element.
      selectRange(b, 0, 3) // "foo" in B

      expect(restoreSelectionSnapshot(a, snapshot!)).true

      const selection = editableSelection(a)
      const written = await selection.replaceSelection('hi')
      expect(written).true
      expect(a.innerText).eq('hi world')
      expect(b.innerText).eq('foo bar') // untouched
    })

    it('fails to restore once the captured range is detached (e.g. an SPA re-render), leaving both elements untouched', () => {
      a.textContent = 'hello world'
      b.textContent = 'foo bar'

      selectRange(a, 0, 5) // "hello"
      const snapshot = captureSelectionSnapshot(a)
      expect(snapshot).not.toBeNull()

      // Simulate a re-render that swaps out A's whole subtree.
      a.innerHTML = '<span>replaced</span>'

      expect(restoreSelectionSnapshot(a, snapshot!)).false
      expect(a.innerText).eq('replaced')
      expect(b.innerText).eq('foo bar')
    })
  })

  describe('input/textarea', () => {
    let input: HTMLInputElement
    beforeEach(() => {
      input = document.createElement('input')
      input.type = 'text'
      input.dataset.testid = 'snapshot-input'
      input.value = 'hello world'
      document.body.append(input)
    })
    afterEach(() => {
      input.remove()
    })

    it('restores the captured range even after the live selection moved to a different range', async () => {
      input.focus()
      input.setSelectionRange(2, 5)
      const snapshot = captureSelectionSnapshot(input)
      expect(snapshot).not.toBeNull()

      // User moves the selection elsewhere in the same field.
      input.setSelectionRange(0, 2)

      expect(restoreSelectionSnapshot(input, snapshot!)).true
      expect(input.selectionStart).eq(2)
      expect(input.selectionEnd).eq(5)

      const selection = inputOrTextareaSelection(input)
      const written = await selection.replaceSelection('XXX')
      expect(written).true
      // "hello world".slice(2, 5) === "llo" was replaced, not the {0,2} range.
      expect(input.value).eq('heXXX world')
    })
  })

  it('restoreSelectionSnapshot returns false once the element itself is detached', () => {
    const el = document.createElement('div')
    el.contentEditable = 'true'
    el.textContent = 'hello world'
    document.body.append(el)
    const textNode = el.firstChild!
    window.getSelection()!.setBaseAndExtent(textNode, 0, textNode, 5)
    const snapshot = captureSelectionSnapshot(el)
    expect(snapshot).not.toBeNull()

    el.remove()

    expect(restoreSelectionSnapshot(el, snapshot!)).false
  })
})

// Regression coverage: `tryExecCommandInsertText`'s select-all fallback
// (when nothing is selected) must only ever be reachable through the
// whole-field replace path (`replaceInputValue` / `all=true`). A
// selection-scoped replace with nothing selected must fail rather than
// silently expand to the whole field.
describe('replaceSelection never escalates to select-all for scope=selection', () => {
  it('editableSelection.replaceSelection(text) [all=false] does not overwrite the field when there is no selection', async () => {
    const el = document.createElement('div')
    el.contentEditable = 'true'
    el.textContent = 'hello world'
    document.body.append(el)
    window.getSelection()?.removeAllRanges()

    const selection = editableSelection(el)
    const written = await selection.replaceSelection('X')
    expect(written).false
    expect(el.innerText).eq('hello world')

    el.remove()
  })
})

// The append-fix that used to live here (a "does not silently append when
// backgrounded" write-mechanism correction, then a `waitForDocumentFocus`
// gate deferring the write until refocus) was reverted — both caused worse
// regressions elsewhere (a clobbered native undo stack, and rich-editor
// internal state getting stomped by a raw `innerText`/native-setter
// assignment) than the backgrounded-tab append quirk they were trying to
// fix. See `lib/selection.ts`'s `replaceSelection` implementations and
// PLAN.md §4's 2026-08-22 addendum. "Switching tabs while a command is in
// flight may append instead of replace" is now an accepted, known
// limitation — see e2e/tab-switch.spec.ts for the (loosened) end-to-end
// coverage of what's still guaranteed.

describe('isInputElement', () => {
  let el: HTMLElement
  afterEach(() => {
    el.remove()
  })

  it('returns true for <input> with no type (defaults to text)', () => {
    el = document.createElement('input')
    document.body.append(el)
    expect(isInputElement(el)).true
  })

  it('returns true for <input type="text">', () => {
    el = document.createElement('input')
    ;(el as HTMLInputElement).type = 'text'
    document.body.append(el)
    expect(isInputElement(el)).true
  })

  it('returns true for <input type="search">', () => {
    el = document.createElement('input')
    ;(el as HTMLInputElement).type = 'search'
    document.body.append(el)
    expect(isInputElement(el)).true
  })

  it('returns true for <textarea>', () => {
    el = document.createElement('textarea')
    document.body.append(el)
    expect(isInputElement(el)).true
  })

  it('returns false for <input type="password"> (sensitive field)', () => {
    el = document.createElement('input')
    ;(el as HTMLInputElement).type = 'password'
    document.body.append(el)
    expect(isInputElement(el)).false
  })

  it('returns false for <input type="email"> (sensitive field)', () => {
    el = document.createElement('input')
    ;(el as HTMLInputElement).type = 'email'
    document.body.append(el)
    expect(isInputElement(el)).false
  })

  it('returns false for <input type="number">', () => {
    el = document.createElement('input')
    ;(el as HTMLInputElement).type = 'number'
    document.body.append(el)
    expect(isInputElement(el)).false
  })
})
