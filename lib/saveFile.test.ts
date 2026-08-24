import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  detectIOS,
  REVOKE_DELAY_MS,
  resolveSaveMethod,
  saveBlob,
} from './saveFile'

describe('detectIOS', () => {
  it('detects iPhone / iPad / iPod user agents', () => {
    expect(
      detectIOS({
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
      }),
    ).toBe(true)
    expect(
      detectIOS({ userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)' }),
    ).toBe(true)
    expect(
      detectIOS({ userAgent: 'Mozilla/5.0 (iPod touch; CPU iPhone OS 17_0)' }),
    ).toBe(true)
  })

  it('detects iPadOS that spoofs a desktop Mac UA but has touch points', () => {
    expect(
      detectIOS({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        platform: 'MacIntel',
        maxTouchPoints: 5,
      }),
    ).toBe(true)
  })

  it('detects iPadOS via the MacIntel platform even without a Macintosh UA', () => {
    expect(
      detectIOS({
        userAgent: 'Mozilla/5.0 (X11; Linux x86_64)',
        platform: 'MacIntel',
        maxTouchPoints: 5,
      }),
    ).toBe(true)
  })

  it('does not flag a desktop Mac or desktop browser', () => {
    expect(
      detectIOS({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        platform: 'MacIntel',
        maxTouchPoints: 0,
      }),
    ).toBe(false)
    expect(
      detectIOS({
        userAgent: 'Mozilla/5.0 (X11; Linux x86_64)',
        platform: 'Linux x86_64',
        maxTouchPoints: 0,
      }),
    ).toBe(false)
  })
})

describe('resolveSaveMethod', () => {
  it('auto shares only on iOS with file-sharing support', () => {
    expect(
      resolveSaveMethod({ mode: 'auto', isIOS: true, canShareFiles: true }),
    ).toBe('share')
    expect(
      resolveSaveMethod({ mode: 'auto', isIOS: true, canShareFiles: false }),
    ).toBe('download')
    expect(
      resolveSaveMethod({ mode: 'auto', isIOS: false, canShareFiles: true }),
    ).toBe('download')
    expect(
      resolveSaveMethod({ mode: 'auto', isIOS: false, canShareFiles: false }),
    ).toBe('download')
  })

  it('respects an explicit mode regardless of support', () => {
    expect(
      resolveSaveMethod({ mode: 'share', isIOS: false, canShareFiles: false }),
    ).toBe('share')
    expect(
      resolveSaveMethod({ mode: 'download', isIOS: true, canShareFiles: true }),
    ).toBe('download')
  })
})

/** Minimal Web Share stub so the real `navigator` is untouched between tests. */
function stubWebShare(options: {
  share?: (...args: any[]) => Promise<void>
  canShare?: (...args: any[]) => boolean
}) {
  Object.defineProperty(navigator, 'share', {
    value: options.share,
    configurable: true,
  })
  Object.defineProperty(navigator, 'canShare', {
    value: options.canShare,
    configurable: true,
  })
}

describe('saveBlob (download path)', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('downloads via an anchor and delays revoking the object URL', async () => {
    vi.useFakeTimers()
    const blob = new Blob(['{}'], { type: 'application/json' })
    const createObjectURL = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:mock')
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL')
    let anchor: HTMLAnchorElement | null = null
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      anchor = this
    })

    const result = await saveBlob(blob, 'commands.json', { mode: 'download' })

    expect(createObjectURL).toHaveBeenCalledWith(blob)
    expect(anchor).not.toBeNull()
    expect(anchor!.download).toBe('commands.json')
    expect(anchor!.getAttribute('href')).toBe('blob:mock')
    // Not revoked synchronously — the URL is kept alive for a grace period.
    expect(revokeObjectURL).not.toHaveBeenCalled()
    expect(result).toEqual({ ok: true, method: 'download' })

    vi.advanceTimersByTime(REVOKE_DELAY_MS + 1)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock')
  })

  it('auto mode downloads when not on iOS (desktop chromium)', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock')
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    const result = await saveBlob(
      new Blob(['{}'], { type: 'application/json' }),
      'a.json',
    )

    expect(result).toEqual({ ok: true, method: 'download' })
  })

  it('uses the blob’s content type as-is', async () => {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue(
      'blob:mock',
    )
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    await saveBlob(new Blob(['{}'], { type: 'text/plain' }), 'c.json', {
      mode: 'download',
    })

    const blob = createObjectURL.mock.calls[0]![0] as Blob
    expect(blob.type).toBe('text/plain')
  })
})

describe('saveBlob (share path)', () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, 'share')
    Reflect.deleteProperty(navigator, 'canShare')
    vi.restoreAllMocks()
  })

  it('shares a correctly named File via the Web Share API', async () => {
    const shareMock = vi.fn().mockResolvedValue(undefined)
    const canShareMock = vi.fn().mockReturnValue(true)
    stubWebShare({ share: shareMock, canShare: canShareMock })

    const result = await saveBlob(
      new Blob(['{}'], { type: 'application/json' }),
      'commands.json',
      { mode: 'share', title: 'Imp Write commands' },
    )

    expect(canShareMock).toHaveBeenCalledTimes(1)
    expect(shareMock).toHaveBeenCalledTimes(1)
    const shared = shareMock.mock.calls[0]![0]
    expect(shared.files[0]).toBeInstanceOf(File)
    expect(shared.files[0].name).toBe('commands.json')
    expect(shared.files[0].type).toBe('application/json')
    expect(shared.title).toBe('Imp Write commands')
    expect(result).toEqual({ ok: true, method: 'share' })
  })

  it('treats a user cancel (AbortError) as a success', async () => {
    const shareMock = vi
      .fn()
      .mockRejectedValue(new DOMException('canceled', 'AbortError'))
    stubWebShare({ share: shareMock, canShare: () => true })

    const result = await saveBlob(new Blob(['{}']), 'c.json', {
      mode: 'share',
    })

    expect(result).toEqual({ ok: true, method: 'share' })
  })

  it('surfaces a real share failure', async () => {
    const shareMock = vi.fn().mockRejectedValue(new Error('failed'))
    stubWebShare({ share: shareMock, canShare: () => true })

    const result = await saveBlob(new Blob(['{}']), 'c.json', {
      mode: 'share',
    })

    expect(result.ok).toBe(false)
    expect(result.method).toBe('share')
    expect(result.error).toBeInstanceOf(Error)
  })

  it('falls back to download when file sharing is unsupported', async () => {
    const shareMock = vi.fn()
    stubWebShare({ share: shareMock, canShare: () => false })
    const createObjectURL = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:mock')
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    const result = await saveBlob(new Blob(['{}']), 'c.json', {
      mode: 'share',
    })

    expect(shareMock).not.toHaveBeenCalled()
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ ok: true, method: 'download' })
  })

  it('falls back to download when the Web Share API is absent', async () => {
    // Ensure both APIs are undefined regardless of the host browser.
    stubWebShare({ share: undefined, canShare: undefined })
    const createObjectURL = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:mock')
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    const result = await saveBlob(new Blob(['{}']), 'c.json', {
      mode: 'share',
    })

    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ ok: true, method: 'download' })
  })
})
