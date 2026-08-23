import { getActiveElement, isInputElement } from './selection'

export interface CandidateMatch {
  /**
   * The trailing command token that was matched (e.g. `"/fix"`), preserving
   * whatever case/prefix the user actually typed. Used to check whether the
   * keystroke that produced the current content is the one that actually
   * typed the token's last character — see the class docstring's "arm"
   * model.
   */
  token: string
}

export interface IdleTriggerDetectorOptions {
  /** Whether `element`'s current content is worth scheduling a trigger for;
   * returns the matched trailing token, or `null` if there isn't one. */
  isCandidate: (element: HTMLElement) => CandidateMatch | null
  /** Fired once the idle window elapses on an element that's still a candidate. */
  onTrigger: (element: HTMLElement) => void
  /** How long to wait, in ms, after the last input before triggering. */
  idleMs?: number
}

/**
 * Fires `onTrigger` once the user stops typing for `idleMs` inside an
 * `isCandidate` element — replacing the old "three spaces in a row" gesture
 * with "type the command token, then pause".
 *
 * Desktop and mobile share a single code path: a document-level, capturing
 * `input` listener. Unlike the old keydown/beforeinput split this needs no
 * per-platform branching — `input` fires consistently for both.
 *
 * ## The "arm" model
 *
 * A pause is only worth scheduling if the content ending in a candidate
 * token was actually *typed there just now* — not merely "the field happens
 * to currently hold text that ends with a token", which is also true right
 * after the browser's native undo (Cmd/Ctrl+Z) restores pre-replacement text
 * (see the historyUndo case below), or after deleting characters back down
 * to a token that was already typed earlier as part of a longer word.
 *
 * So instead of asking "is the current content a candidate?" on every input
 * event, the detector tracks an `armed` bit:
 *
 * - An `insertText` input event (or an IME composition's committed result,
 *   evaluated at `compositionend`) **arms** the detector if the content is a
 *   candidate *and* the text just inserted ends with the candidate token's
 *   last character — i.e. this keystroke is the one that completed the
 *   token.
 * - While already armed, a *pure whitespace* `insertText` (the user typing a
 *   trailing space/newline out of habit right after the token) **keeps**
 *   it armed, as long as the content is still a candidate for the same
 *   token.
 * - Everything else — deletions, paste/drop, native undo/redo, composition
 *   starting, focus changing, or an insertion that doesn't complete a
 *   candidate token — **disarms** the detector and cancels any pending
 *   timer outright. A disarmed detector schedules nothing, no matter what
 *   the content looks like.
 *
 * The pending timer's fire-time revalidation (element still focused,
 * content still a candidate) additionally requires still being armed.
 */
export class IdleTriggerDetector {
  private readonly isCandidate: (element: HTMLElement) => CandidateMatch | null
  private readonly onTrigger: (element: HTMLElement) => void
  private readonly idleMs: number
  private timer: ReturnType<typeof setTimeout> | null = null
  private _enabled = false
  private armed = false

  constructor(options: IdleTriggerDetectorOptions) {
    this.isCandidate = options.isCandidate
    this.onTrigger = options.onTrigger
    this.idleMs = options.idleMs ?? 300
  }

  get enabled() {
    return this._enabled
  }

  enable() {
    if (this._enabled) return
    this._enabled = true
    document.addEventListener('input', this.handleInput, true)
    // IME composition (CJK, etc.): some browsers don't fire a plain `input`
    // event once composition finishes, so re-evaluate here too.
    document.addEventListener('compositionstart', this.handleCompositionStart, true)
    document.addEventListener('compositionend', this.handleCompositionEnd, true)
  }

  disable() {
    if (!this._enabled) return
    this._enabled = false
    document.removeEventListener('input', this.handleInput, true)
    document.removeEventListener('compositionstart', this.handleCompositionStart, true)
    document.removeEventListener('compositionend', this.handleCompositionEnd, true)
    this.disarm()
  }

  private clearTimer() {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  /** Clears the armed bit and drops any pending trigger. */
  private disarm() {
    this.armed = false
    this.clearTimer()
  }

  private handleInput = (e: Event) => {
    // Any new input unconditionally resets the pending wait window — a fresh
    // keystroke means the user isn't idle yet. Whether it re-schedules is
    // decided below.
    this.clearTimer()

    if (!(e instanceof InputEvent)) {
      // Can't classify a non-InputEvent `input` event (some non-browser
      // dispatch) — disarm conservatively rather than risk arming on
      // something that wasn't actually a typed insertion.
      this.disarm()
      return
    }

    // Composition-internal input events (e.g. picking a candidate while
    // typing Chinese/Japanese/Korean) aren't a real "keystroke" to evaluate
    // arming against — `compositionend` covers the real "composition just
    // finished" moment. Leave `armed` untouched here; `compositionstart`
    // (below) is what actually disarms when a composition begins.
    if (e.isComposing) return

    if (e.inputType !== 'insertText') {
      // Everything that isn't a single, genuine "the user typed this"
      // insertion — deletions, native undo/redo (`historyUndo`/
      // `historyRedo`), paste, drop, formatting commands, etc. — disarms
      // outright. Not just "doesn't (re)arm": if an earlier keystroke had
      // armed the detector, none of these should be able to ride that
      // arming through to a trigger.
      this.disarm()
      return
    }

    this.evaluateInsertion(e.data)
  }

  private handleCompositionStart = () => {
    this.disarm()
  }

  private handleCompositionEnd = (e: Event) => {
    this.clearTimer()
    const data = e instanceof CompositionEvent ? e.data : null
    this.evaluateInsertion(data)
  }

  /**
   * Shared by the `insertText` input-event path and the composition-commit
   * path: decides whether `data` (the text that was just inserted) arms,
   * keeps armed, or disarms the detector, then schedules a trigger if still
   * armed.
   */
  private evaluateInsertion(data: string | null) {
    const element = getActiveElement()
    if (!element || !isInputElement(element)) {
      this.disarm()
      return
    }

    const match = this.isCandidate(element)
    if (!match) {
      this.disarm()
      return
    }

    const isWhitespaceOnly = !!data && /^\s+$/.test(data)
    if (isWhitespaceOnly && this.armed) {
      // Already armed, and this insertion is just trailing whitespace after
      // the token (a common habit right after typing a command) — stay
      // armed rather than requiring the whitespace itself to "complete" the
      // token, which it never could.
    } else if (data && data[data.length - 1] === match.token.slice(-1)) {
      // This keystroke's last inserted character is the token's last
      // character — this is the keystroke that completed the token.
      this.armed = true
    } else {
      this.disarm()
      return
    }

    this.schedule(element, match.token)
  }

  private schedule(element: HTMLElement, token: string) {
    this.timer = setTimeout(() => {
      this.timer = null
      // Re-validate at fire time: focus, content, and arming may have
      // changed during the idle window.
      const current = getActiveElement()
      if (!this.armed || current !== element || !isInputElement(current)) {
        return
      }
      const match = this.isCandidate(current)
      if (!match || match.token !== token) {
        return
      }
      this.onTrigger(current)
    }, this.idleMs)
  }
}
