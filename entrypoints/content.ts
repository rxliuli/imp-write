import { parseCommandTrigger, TRIGGER_PREFIX } from '@/lib/commands'
import { showHint } from '@/lib/hint'
import { IdleTriggerDetector, type CandidateMatch } from '@/lib/IdleTriggerDetector'
import { InputLoader } from '@/lib/loading'
import { messager } from '@/lib/message'
import { matchShortcut } from '@/lib/shortcutHandler'
import {
  captureSelectionSnapshot,
  getActiveElement,
  getEditSelection,
  isInputElement,
  restoreSelectionSnapshot,
  type SelectionSnapshot,
} from '@/lib/selection'
import { DEFAULT_SETTINGS, getSettings, type Command, type Settings } from '@/lib/settings'

// Created lazily, on first actual use, so pages that never trigger a command
// don't get an `InputLoader` instance injecting its <style> tag into
// document.head for nothing.
let loader: InputLoader | null = null

// How stale a `contextmenu` sighting is allowed to be before a `menuCommand`
// message is ignored. Generous on purpose — the user has to traverse a
// native context menu (which can idle indefinitely if they hover a submenu)
// between the right-click and the actual click.
const CONTEXT_MENU_MAX_AGE_MS = 15_000

export default defineContentScript({
  matches: ['<all_urls>'],
  allFrames: true,
  main: () => {
    // Start from safe, in-memory defaults and wire up the detector
    // immediately — don't wait on `getSettings()`. `browser.storage` can
    // reject (e.g. "Extension context invalidated" on an orphaned page after
    // a dev-mode reload), and if that await never resolved the detector would
    // never enable itself, silently. Settings loaded below upgrade `settings`
    // in place; a failure there just means we keep running on defaults
    // instead of going dark.
    let settings: Settings = DEFAULT_SETTINGS

    // Most recent replacement, kept in memory so Esc can revert it. Never
    // persisted — this is intentionally lightweight, not a real undo stack.
    // Always the *whole field's* prior value, even for a selection-scoped
    // replacement — there's no selection-level undo, Esc always reverts the
    // entire field back to what it held right before the write.
    let undoRecord: { element: HTMLElement; originalText: string } | null =
      null

    // The value most recently written back into each element by a successful
    // replacement. Without this, if the AI's own output happens to end with
    // a command token (or the user leaves it untouched), the idle detector
    // would immediately re-arm and re-trigger on the same content the moment
    // the idle window elapses again. One more keystroke naturally clears the
    // suppression, since the value no longer matches.
    const lastWrittenValue = new WeakMap<HTMLElement, string>()

    // Most recent element the user right-clicked on (or inside — see
    // `resolveEditableTarget`), so the `menuCommand` message handler knows
    // what to act on. `contextmenu` fires in every frame the event
    // traverses, but only the frame that actually contains the target
    // records a *fresh* sighting here — see the allFrames note below.
    let lastContextMenuTarget: { element: HTMLElement; time: number } | null =
      null

    function isBusy(): boolean {
      return !!loader?.visible
    }

    async function restoreUndo() {
      if (!undoRecord) return
      const { element, originalText } = undoRecord
      undoRecord = null
      const selection = getEditSelection(element)
      await selection.replaceInputValue(originalText)
      // Record this like any other replacement write-back. `originalText`
      // still ends with the command token (that's why it triggered in the
      // first place) — without this, the `input` event this write fires
      // would let the idle detector re-arm on it and silently redo the very
      // thing the user just undid once the idle window elapses again.
      // Read back the *actual* value rather than trusting `originalText`
      // verbatim: contenteditable hosts (e.g. Slate-based editors) can
      // normalize what was written, so `isCandidate`'s later comparison
      // against `selection.getInputValue()` must be against that same
      // normalized value, or the suppression silently fails to match.
      lastWrittenValue.set(element, selection.getInputValue())
    }

    function isCandidate(element: HTMLElement): CandidateMatch | null {
      if (isBusy()) {
        // A request is already in flight; don't schedule another.
        return null
      }
      const selection = getEditSelection(element)
      const fullText = selection.getInputValue()
      if (lastWrittenValue.get(element) === fullText) {
        return null
      }
      const parsed = parseCommandTrigger(fullText, TRIGGER_PREFIX, settings.commands)
      return parsed ? { token: parsed.token } : null
    }

    /**
     * The one core execution path shared by all three trigger surfaces (idle
     * pause, right-click menu, keyboard shortcut): call the AI, write the
     * result back, and record undo/anti-reentry bookkeeping. `scope`
     * controls *where* the result is written — `'selection'` replaces just
     * the current selection, `'all'` replaces the whole field — but undo
     * always captures the whole field's prior value (see `undoRecord`'s
     * comment), and `lastWrittenValue` always records the whole field's
     * actual post-write value.
     */
    async function executeCommand(
      element: HTMLElement,
      command: Command,
      text: string,
      scope: 'selection' | 'all',
      // Only meaningful for scope='selection' — a snapshot of the selection
      // taken the instant the command was triggered, *not* whatever's
      // selected once the AI call resolves. See `SelectionSnapshot`.
      selectionSnapshot: SelectionSnapshot | null = null,
    ) {
      if (isBusy()) {
        // Already mid-flight; ignore re-entrant triggers.
        return
      }

      const selection = getEditSelection(element)
      const originalText = selection.getInputValue()

      loader ??= new InputLoader()
      loader.show(element)
      try {
        const result = await messager.sendMessage('runCommand', {
          prompt: command.prompt,
          text,
        })
        if (!result.ok) {
          showHint(element, result.error)
          return
        }
        // Write back immediately — no waiting for the document to be
        // focused. An earlier attempt gated this write on the document
        // genuinely refocusing (to sidestep a backgrounded-tab quirk where
        // execCommand/paste can append instead of replace — see
        // `lib/selection.ts`), but that could leave the write stuck forever
        // if the user never came back to this exact tab. Reverted; see
        // PLAN.md §4's 2026-08-22 addendum. A backgrounded write may still
        // append rather than replace as a known, accepted limitation — Esc
        // reverts the whole field either way.
        if (scope === 'selection') {
          // The user may have moved the caret, changed the selection, or
          // focused an entirely different editable element while the AI
          // call was in flight (or during the wait above). Re-apply the
          // exact selection captured at trigger time right before writing
          // back; if that's no longer possible (element gone, range detached
          // from a re-render, etc.) bail out hard rather than writing to
          // whatever's selected now — that's how a stale write lands on the
          // wrong element, or a collapsed selection silently escalates into
          // a whole-field overwrite.
          if (
            !selectionSnapshot ||
            !restoreSelectionSnapshot(element, selectionSnapshot)
          ) {
            showHint(element, 'Selection changed — nothing was replaced')
            return
          }
        }
        const written =
          scope === 'selection'
            ? await selection.replaceSelection(result.text)
            : await selection.replaceInputValue(result.text)
        if (!written) {
          showHint(element, 'Failed to write the result back')
          return
        }
        // Read back the actual (possibly normalized) value rather than
        // `result.text` — contenteditable hosts can reshape what was
        // written, and `isCandidate` compares against
        // `selection.getInputValue()`, so the recorded value must match
        // that same normalization or the anti-reentry guard silently fails.
        lastWrittenValue.set(element, selection.getInputValue())
        undoRecord = { element, originalText }
      } catch (err) {
        const detail =
          err instanceof Error && err.message ? `: ${err.message}` : ''
        showHint(element, `Something went wrong${detail}`)
      } finally {
        loader.hide()
      }
    }

    async function triggerCommand(activeElement: HTMLElement) {
      if (isBusy()) {
        // Already mid-flight; ignore re-entrant triggers.
        return
      }

      const selection = getEditSelection(activeElement)
      const fullText = selection.getInputValue()

      const parsed = parseCommandTrigger(fullText, TRIGGER_PREFIX, settings.commands)
      if (!parsed) {
        // isCandidate re-checks this right before scheduling and again right
        // before firing, so this should be unreachable in practice — but
        // stay quiet rather than throw if content changed underneath us.
        return
      }

      await executeCommand(activeElement, parsed.command, parsed.text, 'all')
    }

    /** Looks up a command by name in the current command table (settings.commands). */
    function findCommand(name: string): Command | null {
      return (
        settings.commands.find(
          (c) => c.name.toLowerCase() === name.toLowerCase(),
        ) ?? null
      )
    }

    /**
     * Runs a command against whatever's currently selected in `element`, or
     * the whole field if nothing's selected. Shared by the context-menu and
     * keyboard-shortcut trigger paths — neither one parses a `/token` out of
     * the text; the command is already known from the click/keypress itself.
     */
    async function executeOnEditTarget(element: HTMLElement, command: Command) {
      const selection = getEditSelection(element)
      // Snapshot the selection right here, at the moment it's decided
      // whether this is a selection- or whole-field-scoped run — not later,
      // once the AI call has already resolved. `hasSelection` is derived
      // from the same snapshot so the two can never disagree.
      const selectionSnapshot = captureSelectionSnapshot(element)
      const hasSelection = selectionSnapshot !== null
      const text = hasSelection ? selection.getSelection() : selection.getInputValue()
      if (!text.trim()) {
        showHint(element, 'Nothing to run this command on')
        return
      }
      await executeCommand(
        element,
        command,
        text,
        hasSelection ? 'selection' : 'all',
        selectionSnapshot,
      )
    }

    const idleDetector = new IdleTriggerDetector({
      isCandidate,
      onTrigger: (element) => {
        void triggerCommand(element)
      },
    })
    // No site blacklist any more — the detector is unconditionally enabled.
    idleDetector.enable()

    getSettings()
      .then((next) => {
        settings = next
      })
      .catch((err) => {
        // Storage failed to load — keep running on DEFAULT_SETTINGS rather
        // than leaving `settings` in whatever state it happened to start in.
        console.warn('[imp-write] failed to load settings, using defaults', err)
      })

    document.addEventListener(
      'keydown',
      (e) => {
        if (e.key !== 'Escape' || !undoRecord) return
        // Undo only responds to a bare Esc — a modified Esc (Ctrl/Alt/Meta/
        // Shift) is some site's or the browser's own shortcut, not the
        // user asking to revert the last replacement.
        if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return
        // CJK IME composition uses Esc to close the candidate window; don't
        // hijack that keystroke as an undo trigger.
        if (e.isComposing) return
        // A request is still in flight: reverting now would just get
        // clobbered when that request resolves and writes its result back.
        if (isBusy()) return
        const activeElement = getActiveElement()
        if (activeElement !== undoRecord.element) return
        e.preventDefault()
        // Consume this Esc outright — no other same-phase, same-node
        // listener (e.g. a site's own Esc shortcut) should still see an
        // event we've already acted on.
        e.stopImmediatePropagation()
        void restoreUndo()
      },
      true,
    )

    // Command keyboard shortcuts (per-command, recorded in settings.shortcuts
    // via the options page's ShortcutInput). Listened for at the document
    // level in the capture phase so it fires before any site-level handler
    // could swallow it. The actual matching logic lives in
    // `matchShortcut` (lib/shortcutHandler.ts) — kept out of this inline
    // handler so it's independently testable; see that module's docstring
    // for why it deliberately doesn't check `e.isComposing`.
    document.addEventListener(
      'keydown',
      (e) => {
        const match = matchShortcut(e, settings.shortcuts, settings.commands, {
          isBusy,
          getActiveElement,
        })
        if (!match) return

        e.preventDefault()
        e.stopPropagation()
        void executeOnEditTarget(match.element, match.command)
      },
      true,
    )

    // Right-click (context menu) trigger path. `resolveEditableTarget` walks
    // up from the actual click target (or, inside a Shadow DOM, the first
    // entry of `composedPath()`) to find the nearest element
    // `isInputElement` accepts.
    function resolveEditableTarget(e: MouseEvent): HTMLElement | null {
      const path = e.composedPath()
      const start = (path[0] as Element | undefined) ?? (e.target as Element | null)
      let el: Element | null = start
      while (el) {
        if (isInputElement(el)) return el as HTMLElement
        el = el.parentElement
      }
      return null
    }

    document.addEventListener(
      'contextmenu',
      (e) => {
        const target = resolveEditableTarget(e)
        if (!target) return
        lastContextMenuTarget = { element: target, time: Date.now() }
      },
      true,
    )

    // background.ts addresses this message at the exact frame that reported
    // `info.frameId` on the native contextmenu event, when available. As a
    // defense in depth (e.g. a browser/edge case where `frameId` wasn't
    // available and background fell back to broadcasting to every frame),
    // consume `lastContextMenuTarget` immediately — before any of the
    // validity checks below, and regardless of whether this message ends up
    // acting on it — so a single `contextmenu` sighting can never be used to
    // service more than one `menuCommand`. That closes the "right-click
    // frame A, cancel, then right-click frame B and pick a command" path,
    // which would otherwise let frame A's still-fresh, still-connected
    // record fire a second time.
    messager.onMessage('menuCommand', (message) => {
      const record = lastContextMenuTarget
      lastContextMenuTarget = null
      if (!record) return
      if (Date.now() - record.time > CONTEXT_MENU_MAX_AGE_MS) return
      if (!record.element.isConnected) return
      if (isBusy()) return

      const command = findCommand(message.data)
      if (!command) return

      void executeOnEditTarget(record.element, command)
    })

    // The command table is just `settings.commands` — needs to hot-reload
    // when settings change elsewhere (e.g. the options page, or the connect
    // flow's own write).
    browser.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local' || !('settings' in changes)) return
      getSettings()
        .then((next: Settings) => {
          settings = next
        })
        .catch((err) => {
          console.warn(
            '[imp-write] failed to reload settings after change, keeping previous settings',
            err,
          )
        })
    })
  },
})
