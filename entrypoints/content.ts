import {
  CANCEL_EMPTY_STATE_MESSAGE,
  CommandMenu,
  hideNoTargetToast,
  isFreshTarget,
  showNoTargetToast,
} from '@/lib/commandMenu'
import { getSortedCommands, recordCommandUsed } from '@/lib/commandRecency'
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
import {
  INITIAL_SPACE_GESTURE_STATE,
  isSpaceGestureEnabled,
  reduceSpaceGesture,
  shouldAbsorbGestureMenuInput,
  stripTrailingGestureResidue,
  type GestureMenuResidueState,
  type SpaceGestureState,
} from '@/lib/spaceGestureDetector'
import { getSpaceGestureTestOverride } from '@/lib/testHooks'

// Created lazily, on first actual use, so pages that never trigger a command
// don't get an `InputLoader` instance injecting its <style> tag into
// document.head for nothing.
let loader: InputLoader | null = null

// How stale a `contextmenu` sighting is allowed to be before a `menuCommand`
// message is ignored. Generous on purpose — the user has to traverse a
// native context menu (which can idle indefinitely if they hover a submenu)
// between the right-click and the actual click.
const CONTEXT_MENU_MAX_AGE_MS = 15_000

// Cached across this content script's lifetime — the platform doesn't
// change mid-session. Mirrors background.ts's identical `getPlatformInfo`
// caching (see its own doc comment for why a rejection isn't cached), kept
// as a separate copy here rather than shared/imported since content scripts
// and the background service worker run in entirely separate module scopes.
// Used only to decide the command menu's anchor rule (`ShowCommandMenuOptions`
// in lib/commandMenu.ts) for the three-space-gesture trigger path, which —
// unlike the toolbar-icon tap — fires on every platform; the icon-tap path
// itself never needs this, since background.ts only ever sends
// `showCommandMenu` when it has already determined the platform is mobile.
let platformInfoPromise: Promise<{ os: string }> | null = null
function getPlatformInfo(): Promise<{ os: string }> {
  platformInfoPromise ??= browser.runtime.getPlatformInfo().catch((err) => {
    platformInfoPromise = null
    throw err
  })
  return platformInfoPromise
}
async function isMobilePlatform(): Promise<boolean> {
  try {
    const info = await getPlatformInfo()
    return info.os === 'android' || info.os === 'ios'
  } catch {
    // Platform detection failing shouldn't crash the gesture handler —
    // default to "not mobile" (caret-anchored), the same fallback
    // background.ts's `action.onClicked` uses for an unresolved/failed
    // `getPlatformInfo`.
    return false
  }
}

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

    // Most recent editable element this frame saw gain focus, for the
    // mobile "tap the toolbar icon" command menu (see `showCommandMenu`
    // below and `lib/commandMenu.ts`) to anchor to. Unlike
    // `lastContextMenuTarget`, this is driven by `focusin` rather than a
    // one-off click event, and carries a much longer TTL — see
    // `COMMAND_MENU_TARGET_MAX_AGE_MS`'s doc comment.
    let lastFocusedEditable: { element: HTMLElement; time: number } | null =
      null

    // Pending timer for the top frame's "Focus a text field first"
    // empty-state fallback — see `showCommandMenu` below.
    let emptyStateTimer: ReturnType<typeof setTimeout> | null = null
    const EMPTY_STATE_DELAY_MS = 200

    function cancelEmptyStateToast() {
      if (emptyStateTimer !== null) {
        clearTimeout(emptyStateTimer)
        emptyStateTimer = null
      }
    }

    // Non-null exactly while the *currently open* menu was summoned by the
    // three-space gesture (never by the toolbar-icon tap) — set right
    // before that `commandMenu.show()` call, cleared (`null`) right before
    // the icon-tap path's own `show()` call, and consumed by `onSelect`
    // below (read once, then reset) to decide both *whether* the field's
    // trailing gesture residue needs stripping before this command's text
    // goes to the AI, and *how many characters* to strip — see
    // `lib/spaceGestureDetector.ts`'s `stripTrailingGestureResidue` doc
    // comment. Also read (and updated in place) by `onTargetInput` below,
    // every time the target gets new input while this menu is open, to
    // decide whether a same-rhythm extra space tap should be absorbed
    // rather than closing the menu — see `shouldAbsorbGestureMenuInput`.
    // Not part of `CommandMenu`'s own state: which trigger path opened a
    // given menu instance, and its gesture-specific bookkeeping, is a
    // content.ts-level concern the presentation-only `CommandMenu` class
    // stays unaware of (see its `onTargetInput` callback's doc comment).
    let gestureMenuResidue: GestureMenuResidueState | null = null

    const commandMenu = new CommandMenu({
      onSelect: (element, command) => {
        // The element may have been removed from the document in the time
        // between the menu opening and the user tapping a command (rare,
        // but the same defense-in-depth `menuCommand`'s handler applies —
        // see its comment on `lastContextMenuTarget`).
        if (!element.isConnected) return
        // Tapping a button inside the menu's shadow-hosted UI steals focus
        // away from `element` (and the toolbar-icon tap itself may already
        // have blurred it, e.g. on mobile). Re-focus before executing so
        // `captureSelectionSnapshot`/`getEditSelection` see a live
        // selection rather than one that collapsed on blur.
        //
        // For a contenteditable host, a prior text selection is frequently
        // *not* restorable across that blur/re-focus round trip (the
        // browser can collapse or drop the Range once focus leaves the
        // element) — `captureSelectionSnapshot` then sees no selection and
        // `executeOnEditTarget` falls back to the whole-field scope. This
        // mirrors the right-click (`menuCommand`) path exactly, which
        // re-focuses the same way and hits the same limitation — it's a
        // known, accepted constraint of re-focusing after a blur, not an
        // oversight here.
        element.focus()

        const residue = gestureMenuResidue
        gestureMenuResidue = null
        if (!residue) {
          void executeOnEditTarget(element, command)
          return
        }

        // Gesture path: the field still literally contains the trailing
        // residue that summoned this menu (a run of plain spaces, or —
        // see `lib/spaceGestureDetector.ts`'s module docstring — a
        // platform's own "double-space → period" autocorrect substitution
        // folded in), plus one more character for every same-rhythm extra
        // tap `onTargetInput` absorbed instead of closing the menu
        // (showing/keeping the menu open never touches the text — only
        // picking a command does). Strip exactly that many characters from
        // what's sent to the AI, the same way `triggerCommand`'s
        // `parseCommandTrigger` consumes a `/token` rather than sending it
        // along too. Always whole-field scope — typing the gesture's
        // spaces necessarily collapses/replaces any prior selection, so
        // there's never a meaningful selection left to scope to by the
        // time the menu is showing (mirrors `triggerCommand`, which is the
        // same "collapsed-caret, no selection" situation).
        const selection = getEditSelection(element)
        const text = stripTrailingGestureResidue(selection.getInputValue(), residue.residueLen)
        if (!text.trim()) {
          showHint(element, 'Nothing to run this command on')
          return
        }
        void executeCommand(element, command, text, 'all')
      },
      onOpenSettings: () => {
        void messager.sendMessage('openOptionsPage')
      },
      onTargetInput: (event) => {
        // Icon-tap-triggered menu (or no gesture bookkeeping for some
        // other reason) — always close, unchanged from before this
        // absorption behavior existed.
        if (!gestureMenuResidue) return true
        if (!(event instanceof InputEvent)) return true
        const decision = shouldAbsorbGestureMenuInput(gestureMenuResidue, event, Date.now())
        gestureMenuResidue = decision.state
        // Absorbed (same-rhythm extra space tap) => keep the menu open,
        // i.e. don't close it — `CommandMenu` never called
        // `preventDefault` on this event, so the space itself still lands
        // in the field either way; only the menu's fate is decided here.
        return !decision.absorb
      },
    })

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
      if (commandMenu.isOpen) {
        // The floating command menu (icon-tap or three-space-gesture
        // triggered) owns this moment — the user is actively choosing a
        // command from it. Without this, a token the user typed just
        // before the gesture (e.g. "hello /fix   ") can leave the idle
        // detector armed and counting down *underneath* the menu; letting
        // it fire would silently run a different, auto-parsed command and
        // overwrite the field right as the menu is shown, closing it out
        // from under the user (the write-back's own `input` event trips
        // `CommandMenu`'s beforeinput auto-close — see its doc comment —
        // so the menu visibly flashes and disappears instead of staying
        // open for the user to actually choose from it).
        //
        // This is checked here (`isCandidate`), not just at the moment the
        // gesture opens the menu, because `IdleTriggerDetector` re-invokes
        // this exact function immediately before firing
        // (`schedule()`'s timeout callback) — so even a timer that was
        // already armed/counting down *before* the menu finished opening
        // still gets re-validated, and suppressed, right at its actual
        // fire time. Returning null here also stops `IdleTriggerDetector`
        // from re-arming on every keystroke while the menu is open, not
        // just the one already-scheduled timer.
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
        // Bookkeeping only — this is the one execution path every trigger
        // surface (idle pause, right-click menu, keyboard shortcut, both
        // command-menu paths) shares, so recording here covers all of them
        // at once. Fire-and-forget: a failed/slow recency write shouldn't
        // hold up (or fail) a command that already succeeded.
        recordCommandUsed(command.name).catch((err) => {
          console.warn('[imp-write] failed to record command recency', err)
        })
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

    // Warm the platform-info cache eagerly (see its doc comment above) so
    // it's already resolved by the time either the icon-tap or the
    // three-space gesture actually needs it.
    void isMobilePlatform()

    /**
     * Fired once `reduceSpaceGesture` (below) reports a completed
     * three-real-space run. Shares the exact same `commandMenu.show()`
     * presentation the toolbar-icon path (`showCommandMenu` below) uses —
     * same MRU sort via `getSortedCommands`, same "always start from a
     * clean slate" teardown — but this path fires on every platform
     * (unlike the icon tap, mobile-only by construction), so it has to
     * decide the anchor mode itself rather than trusting the caller.
     */
    async function showCommandMenuForGesture(
      element: HTMLElement,
      gestureTime: number,
      residueLen: number,
    ) {
      // Trigger precondition: the field must have some non-whitespace
      // content — the same empty-text guard `executeOnEditTarget` already
      // applies before running a command (`!text.trim()`). A field holding
      // only the gesture's own residue (`"   ".trim() === ''`, and the
      // same holds for a `.`/`。`-only residue from an R1/R2/R3 autocorrect
      // substitution — see `lib/spaceGestureDetector.ts`'s module
      // docstring) fails this, and the menu simply isn't summoned — no
      // toast, unlike the icon-tap path's "Focus a text field first" empty
      // state, since here the user *is* already focused and typing, just
      // with nothing worth running a command on yet.
      if (!getEditSelection(element).getInputValue().trim()) return

      const [sorted, isMobile] = await Promise.all([
        getSortedCommands(settings.commands),
        isMobilePlatform(),
      ])
      // The element may have been removed/blurred while the above awaits
      // were in flight (rare, but the same defense-in-depth other
      // async-then-act paths in this file apply — see e.g. `onSelect`'s
      // `element.isConnected` check).
      if (!element.isConnected) return

      commandMenu.destroy()
      cancelEmptyStateToast()
      hideNoTargetToast()
      // Seeds the "same-rhythm extra tap" absorption window (see
      // `onTargetInput` above) from `gestureTime` (the actual 3rd
      // keystroke's own timestamp, captured synchronously in the `input`
      // listener below, not a later timestamp taken after the awaits
      // above — using a later time here would make the window measurably,
      // if only slightly, more lenient than the gesture's own rhythm
      // requirement) and `residueLen` (`reduceSpaceGesture`'s own
      // `SpaceGestureMatch.residueLen` — see its doc comment for why that,
      // not `SPACE_GESTURE_TARGET_COUNT`, is the correct seed: an R1/R2/R3
      // autocorrect substitution can make the field's actual trailing
      // residue longer, or shaped differently, than 3 plain spaces).
      gestureMenuResidue = { residueLen, lastTime: gestureTime }
      commandMenu.show(element, sorted, { anchorMode: isMobile ? 'element' : 'caret' })
    }

    // Three-real-space-in-a-row gesture: the mobile-only counterpart to the
    // toolbar-icon tap for summoning the floating command menu — see
    // `isSpaceGestureEnabled`'s doc comment for why this is gated to mobile
    // rather than every platform: desktop already has three other trigger
    // paths (idle-pause `/token`, the right-click menu, keyboard
    // shortcuts), and space-indented Markdown would otherwise pop the menu
    // open constantly while typing completely unrelated content. Wrapped in
    // its own async setup function (rather than inline in `main`) purely so
    // this platform/test-override check can gate *whether the listeners
    // below are ever attached at all* — on a disabled platform,
    // `reduceSpaceGesture` is never even called, not just "called but
    // ignored".
    async function setupSpaceGesture() {
      const [isMobile, testOverride] = await Promise.all([
        isMobilePlatform(),
        getSpaceGestureTestOverride(),
      ])
      if (!isSpaceGestureEnabled(isMobile, testOverride)) return

      // `reduceSpaceGesture` (lib/spaceGestureDetector.ts) is a pure
      // function — this is its DOM wiring, kept inline (not its own class)
      // the same way the keyboard-shortcut listener below wires
      // `matchShortcut` inline. A second, independent capture-phase
      // `input` listener alongside `idleDetector`'s own: the two coexist
      // simply by each never touching the other's state, and neither ever
      // calls `preventDefault`/`stopPropagation` on an `input` event — so
      // the idle-token trigger's own behavior is completely unaffected by
      // this listener also observing the same events.
      let spaceGestureState: SpaceGestureState = INITIAL_SPACE_GESTURE_STATE
      document.addEventListener(
        'input',
        (e) => {
          if (!(e instanceof InputEvent)) {
            spaceGestureState = INITIAL_SPACE_GESTURE_STATE
            return
          }
          const active = getActiveElement()
          const element = active && isInputElement(active) ? active : null
          const now = Date.now()
          const result = reduceSpaceGesture(spaceGestureState, element, e, now)
          spaceGestureState = result.state
          if (result.fire && element) {
            void showCommandMenuForGesture(element, now, result.residueLen)
          }
        },
        true,
      )

      // Some browsers don't reliably fire a plain post-composition `input`
      // event (`isComposing: false`) once a CJK/IME composition session
      // actually ends — the identical cross-browser quirk
      // `IdleTriggerDetector` already works around with its own
      // `compositionend` listener (see that class's `enable()`). Without
      // an equivalent guard here, a run that was mid-count when
      // composition started — deliberately left untouched by
      // `reduceSpaceGesture`'s composing guard, see its doc comment —
      // could survive across the *entire* composed-text insertion (which
      // isn't a real space at all) with no `input` event ever arriving to
      // reset it, letting a single genuine space keystroke typed right
      // after wrongly complete a stale run. Unconditionally resetting on
      // every `compositionend` is safe: a real IME's committed text is
      // never literally a single space, so this can never incorrectly
      // drop a *legitimate* space run either. Doesn't affect the macOS
      // Option-modified-key pitfall the composing guard itself exists for
      // — that never fires an actual `compositionstart`/`compositionend`
      // pair (a single atomic keystroke misflagged `isComposing: true`,
      // not a real composition session), so there's nothing here to reset
      // in that case. Gated behind the same enablement check as the
      // `input` listener above — on a disabled platform this attaches
      // nothing either, rather than merely being harmless-but-present.
      document.addEventListener(
        'compositionend',
        () => {
          spaceGestureState = INITIAL_SPACE_GESTURE_STATE
        },
        true,
      )
    }
    void setupSpaceGesture()

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
        // The command menu (if open) owns Escape — see its own capture-
        // phase keydown listener in `lib/commandMenu.ts`. This handler is
        // registered earlier (at content-script init) than the menu's,
        // which is only attached once `show()` runs, so without this guard
        // it would run first in the capture phase and, when `undoRecord` is
        // also set, consume the Esc via `stopImmediatePropagation()` below
        // before the menu's own listener ever saw it — leaving the menu
        // stuck open.
        if (commandMenu.isOpen) return
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

    // Mobile "tap the toolbar icon" trigger path: tracks the most recently
    // focused editable element in this frame, so `showCommandMenu` below
    // knows what to anchor the floating menu to. Capture phase + document
    // level, like the shortcut/contextmenu listeners here — and like
    // `getActiveElement`'s other callers, drills through shadow DOM rather
    // than trusting the (possibly retargeted) event target, since
    // `focusin` is composed and crosses shadow boundaries on its way here.
    document.addEventListener(
      'focusin',
      () => {
        const active = getActiveElement()
        if (!active || !isInputElement(active)) return
        lastFocusedEditable = { element: active, time: Date.now() }
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

    // background.ts sends this on a mobile toolbar-icon tap (no popup UI
    // there — see its `action.onClicked`), to every frame of the active
    // tab. Each frame independently checks whether it has a fresh enough
    // focus target (see `isFreshTarget`) — there's no cross-frame
    // coordinator (see `lib/commandMenu.ts`'s module docstring): the rare
    // case of two frames both having a fresh target just means two menus
    // can appear, which is harmless since nothing executes until the user
    // actually taps a command.
    messager.onMessage('showCommandMenu', async () => {
      // Always start from a clean slate — a second tap in quick succession
      // (or a race with an in-flight empty-state toast) should never stack
      // UI. See `CommandMenu.show`'s own doc comment for the same rule.
      // `cancelEmptyStateToast` only clears a *pending* timer — it doesn't
      // touch a toast that's already rendered from a previous call, hence
      // the separate `hideNoTargetToast()`.
      commandMenu.destroy()
      cancelEmptyStateToast()
      hideNoTargetToast()

      if (isFreshTarget(lastFocusedEditable, Date.now())) {
        // background.ts only ever sends this message once it has already
        // determined the platform is mobile (see its `action.onClicked`) —
        // no need to re-check `isMobilePlatform()` here, this path can just
        // hard-code the existing element-anchored behavior.
        const sorted = await getSortedCommands(settings.commands)
        // Not gesture-triggered — see `gestureMenuResidue`'s doc comment.
        // Set defensively right before `show()` (not earlier) so an
        // in-flight `showCommandMenuForGesture` call racing this one can
        // never leave it wrongly non-null for this menu instance.
        gestureMenuResidue = null
        commandMenu.show(lastFocusedEditable.element, sorted, { anchorMode: 'element' })
        if (window.self !== window.top) {
          // Tell the top frame to cancel its empty-state fallback — this
          // subframe already has a real menu open. See
          // `CANCEL_EMPTY_STATE_MESSAGE`'s doc comment: this postMessage
          // carries no execution semantics, only this one cancellation
          // signal.
          window.top?.postMessage(CANCEL_EMPTY_STATE_MESSAGE, '*')
        }
        return
      }

      // No fresh target in this frame. Only the top frame owns the
      // empty-state fallback — a subframe with nothing fresh just does
      // nothing and lets the top frame (or another subframe, via the
      // postMessage above) decide. The short delay gives a subframe's
      // cancellation message a chance to arrive first.
      if (window.self !== window.top) return
      emptyStateTimer = setTimeout(() => {
        emptyStateTimer = null
        showNoTargetToast()
      }, EMPTY_STATE_DELAY_MS)
    })

    // Cross-frame signal (see `showCommandMenu` above): a subframe just
    // showed its own command menu — cancel this frame's pending
    // empty-state toast. Only ever actually received by the true top
    // frame, since it's sent via `window.top.postMessage`; every other
    // frame's identical listener is a harmless no-op (there's never a
    // pending timer to cancel there).
    window.addEventListener('message', (e) => {
      if (e.data !== CANCEL_EMPTY_STATE_MESSAGE) return
      cancelEmptyStateToast()
      // Also hide the toast if it had already rendered by the time this
      // cancellation arrived (see the identical note in `showCommandMenu`
      // above) — a slower subframe's signal can still land after the top
      // frame's own delayed timer already fired.
      hideNoTargetToast()
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
