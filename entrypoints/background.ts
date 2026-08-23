import { humanizeError, runPrompt } from '@/lib/ai-client'
import { applyTemplate, TRIGGER_PREFIX } from '@/lib/commands'
import { IMP_ORIGIN } from '@/lib/imp'
import { messager, type RunCommandResult } from '@/lib/message'
import { getSettings, saveSettings } from '@/lib/settings'

const MENU_PARENT_ID = 'imp-write'
const MENU_ITEM_PREFIX = 'imp-write-cmd:'

// Serializes context-menu rebuilds behind a queue, the same way
// `lib/settings.ts`'s `saveSettings` serializes writes. `storage.onChanged`
// can fire several times in quick succession (e.g. adding a custom command
// triggers one write, but so can unrelated settings changes); without this,
// two overlapping `removeAll()` + `create()` sequences could interleave and
// `create()` would throw a "duplicate id" error for a menu item the other,
// still-in-flight rebuild already added.
let rebuildQueue: Promise<void> = Promise.resolve()

function doRebuildContextMenus(): Promise<void> {
  return getSettings().then(async (settings) => {
    await browser.contextMenus.removeAll()
    browser.contextMenus.create({
      id: MENU_PARENT_ID,
      title: 'Imp Write',
      contexts: ['editable'],
    })
    for (const command of settings.commands) {
      browser.contextMenus.create({
        id: `${MENU_ITEM_PREFIX}${command.name}`,
        parentId: MENU_PARENT_ID,
        title: `${TRIGGER_PREFIX}${command.name}`,
        contexts: ['editable'],
      })
    }
  })
}

function rebuildContextMenus(): Promise<void> {
  const run = rebuildQueue.then(doRebuildContextMenus)
  // Keep the queue alive even on failure, same rationale as
  // `saveSettings`'s queue: one failed rebuild shouldn't permanently wedge
  // every rebuild after it.
  rebuildQueue = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

export default defineBackground(() => {
  console.log('Hello background!', { id: browser.runtime.id })

  browser.action.onClicked.addListener(async () => {
    await browser.runtime.openOptionsPage()
  })

  // Build the right-click menu on install/update and on every browser
  // startup, then keep it in sync as commands are added/renamed/removed.
  browser.runtime.onInstalled.addListener(() => {
    void rebuildContextMenus()
  })
  browser.runtime.onStartup.addListener(() => {
    void rebuildContextMenus()
  })
  // Also build it unconditionally on the service worker's own module init —
  // `onInstalled`/`onStartup` only fire for the specific event that woke
  // this worker up, and a worker can also be spun back up later (e.g. after
  // being killed for being idle) without either firing again.
  void rebuildContextMenus()

  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !('settings' in changes)) return
    void rebuildContextMenus()
  })

  browser.contextMenus.onClicked.addListener((info, tab) => {
    const id = info.menuItemId
    if (typeof id !== 'string' || !id.startsWith(MENU_ITEM_PREFIX)) return
    if (!tab?.id) return
    const commandName = id.slice(MENU_ITEM_PREFIX.length)
    // Address the exact frame the user right-clicked in — `info.frameId`
    // comes straight off the native contextMenus click event, so this
    // reaches only the frame that showed the menu, not every frame in the
    // tab. When `frameId` isn't available, `SendMessageOptions.frameId` is
    // simply omitted and `@webext-core/messaging` falls back to its
    // previous behavior of broadcasting to every frame; content.ts's
    // `menuCommand` handler still guards against that (see its comment).
    void messager.sendMessage('menuCommand', commandName, {
      tabId: tab.id,
      frameId: info.frameId,
    })
  })

  // AI requests run here (not in the content script) so keys never enter the
  // page world and page CSPs can't block the request.
  messager.onMessage('runCommand', async (message): Promise<RunCommandResult> => {
    const settings = await getSettings()
    try {
      const finalPrompt = applyTemplate(message.data.prompt, message.data.text)
      const text = await runPrompt(settings.provider, finalPrompt)
      return { ok: true, text }
    } catch (err) {
      // Log only the message — never the request itself (it carries the
      // Authorization header / api key).
      console.error(
        '[imp-write] runCommand failed:',
        err instanceof Error ? err.message : err,
      )
      return { ok: false, error: humanizeError(err, settings.provider.mode) }
    }
  })

  // Lets the options page's "Test connection" button exercise whatever
  // provider config is currently saved, without needing a real input box to
  // run a command against.
  messager.onMessage('testConnection', async () => {
    const settings = await getSettings()
    try {
      await runPrompt(settings.provider, 'Reply with only the word OK')
      return { ok: true } as const
    } catch (err) {
      console.error(
        '[imp-write] testConnection failed:',
        err instanceof Error ? err.message : err,
      )
      return { ok: false, error: humanizeError(err, settings.provider.mode) } as const
    }
  })

  // Exchanges the one-time code the imp-connect content script read off the
  // success page's meta tag for a persistent Imp Credits API key. See
  // PLAN.md §6 for the full contract.
  messager.onMessage('impConnect', async (message) => {
    const code = message.data
    try {
      const res = await fetch(`${IMP_ORIGIN}/connect/exchange`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        const error =
          (body as { error?: string } | null)?.error ??
          `Connect failed with status ${res.status}`
        return { ok: false, error }
      }
      const { apiKey, baseUrl, model } = body as {
        apiKey: string
        baseUrl: string
        model: string
      }
      const current = await getSettings()
      await saveSettings({
        provider: {
          ...current.provider,
          mode: 'imp',
          imp: { apiKey, baseUrl, model },
        },
      })
      return { ok: true }
    } catch (err) {
      console.error(
        '[imp-write] impConnect failed:',
        err instanceof Error ? err.message : err,
      )
      return {
        ok: false,
        error: 'Could not reach the Imp Credits service — please retry.',
      }
    }
  })
})
