/**
 * Cross-platform "save a file" helper.
 *
 * The problem it solves: on iOS Safari (and iPadOS), the classic
 * `Blob + <a download> + click()` pattern doesn't work. Safari ignores the
 * anchor's `download` attribute and instead **navigates** the current tab to
 * the `blob:` URL, which then fails to render with:
 *
 *   "Safari can't open the page. ... (WebKitBlobResource error 1.)"
 *
 * The reliable path on iOS is the Web Share API (`navigator.share({files})`),
 * which opens the native share sheet so the user can "Save to Files". This
 * module picks the right strategy automatically:
 *
 *   - iOS / iPadOS + file sharing supported  -> navigator.share({files})
 *   - everything else                        -> anchor + blob download
 *
 * The input is deliberately **Blob-only**: a Blob already carries its content
 * type, and `File` extends `Blob`, so any file-like payload works. The caller
 * is responsible for building the Blob (e.g. `new Blob([json], { type:
 * 'application/json' })`), keeping this module unaware of the data format.
 *
 * It's web-only (no `browser.*`/DOM extension APIs), so it works both in an
 * extension's options page and on a plain website.
 *
 * @packageDocumentation
 */

/** How the export should behave. */
export type SaveMode = 'auto' | 'download' | 'share'

/** Which mechanism ended up being used. */
export type SaveMethod = 'download' | 'share'

export interface SaveBlobOptions {
  /**
   * `auto` picks share on iOS when file sharing is available and download
   * everywhere else. `download`/`share` force one path.
   * @default 'auto'
   */
  mode?: SaveMode
  /** Optional share-sheet title used by `navigator.share` (ignored for download). */
  title?: string
}

export interface SaveFileResult {
  ok: boolean
  method: SaveMethod
  /** Set when `ok` is false (e.g. a real share failure). */
  error?: unknown
}

/**
 * How long to wait before releasing a created object URL. Revoking
 * synchronously right after `click()` can race the download on some engines,
 * so we keep the blob alive for a generous grace period.
 */
export const REVOKE_DELAY_MS = 60_000

/**
 * Decide which mechanism to use, given the environment. Pure & unit-testable.
 *
 * - `mode: 'download'` always downloads, `mode: 'share'` always shares.
 * - `mode: 'auto'` shares only on iOS **and** when file sharing is supported.
 */
export function resolveSaveMethod(input: {
  mode: SaveMode
  isIOS: boolean
  canShareFiles: boolean
}): SaveMethod {
  if (input.mode === 'share') return 'share'
  if (input.mode === 'download') return 'download'
  return input.isIOS && input.canShareFiles ? 'share' : 'download'
}

/**
 * Detect iOS / iPadOS from the platform reports. Handles the iPadOS quirk where
 * Safari masquerades as a desktop Mac (`platform === 'MacIntel'`) but exposes
 * touch points. Pure & unit-testable.
 */
export function detectIOS(input: {
  userAgent: string
  platform?: string
  maxTouchPoints?: number
}): boolean {
  const { userAgent, platform = '', maxTouchPoints = 0 } = input
  if (/iPad|iPhone|iPod/.test(userAgent)) return true
  // iPadOS 13+ spoofs a macOS desktop UA ("Macintosh"/MacIntel) but still
  // exposes touch points. Match either the UA or the platform string.
  if (maxTouchPoints > 1) {
    if (/Macintosh|MacIntel/.test(userAgent) || platform === 'MacIntel') {
      return true
    }
  }
  return false
}

/** Whether the current environment is iOS / iPadOS. */
export function isIOS(): boolean {
  return detectIOS({
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
  })
}

/**
 * Wrap the payload into a `File` carrying the requested name and type. A `File`
 * is required for `navigator.share({ files })`.
 */
function toFile(blob: Blob, filename: string): File {
  return new File([blob], filename, { type: blob.type })
}

/**
 * Whether this environment can share a `File` (Web Share API with files).
 * Some browsers expose `navigator.share` without supporting `files`, so we
 * probe via `navigator.canShare`.
 */
function canShareFile(file: File): boolean {
  if (
    typeof navigator.canShare !== 'function' ||
    typeof navigator.share !== 'function'
  ) {
    return false
  }
  try {
    return navigator.canShare({ files: [file] })
  } catch {
    return false
  }
}

/** Download via the classic anchor + blob URL, revoking the URL on a delay. */
function downloadFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // Not immediate: give the engine time to start reading the blob. Some
  // browsers race a synchronous revoke and lose the resource.
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS)
}

/** Share via the Web Share API, translating a user cancel into a success. */
async function shareFile(
  file: File,
  title: string | undefined,
): Promise<SaveFileResult> {
  try {
    await navigator.share({ files: [file], title })
    return { ok: true, method: 'share' }
  } catch (err) {
    // AbortError = the user dismissed the share sheet. That's a normal
    // outcome, not a failure worth surfacing.
    if (isAbortError(err)) return { ok: true, method: 'share' }
    return { ok: false, method: 'share', error: err }
  }
}

function isAbortError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'name' in err &&
    (err as { name: string }).name === 'AbortError'
  )
}

/**
 * Save `blob` to a file named `filename`. Picks share vs. download
 * automatically (see the module docs); force a path with `opts.mode`.
 */
export async function saveBlob(
  blob: Blob,
  filename: string,
  opts: SaveBlobOptions = {},
): Promise<SaveFileResult> {
  const { mode = 'auto', title } = opts

  const file = toFile(blob, filename)
  const canShare = canShareFile(file)
  const wantShare =
    resolveSaveMethod({ mode, isIOS: isIOS(), canShareFiles: canShare }) ===
    'share'

  // Share only when it's both wanted and supported; otherwise download.
  if (wantShare && canShare) {
    return shareFile(file, title)
  }
  downloadFile(blob, filename)
  return { ok: true, method: 'download' }
}
