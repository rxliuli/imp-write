import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import { BUILTIN_COMMANDS } from './commands'
import {
  DEFAULT_SETTINGS,
  deepMergeSettingsPatch,
  getSettings,
  mergeSettings,
  saveSettings,
} from './settings'

// `lib/settings.ts` talks to `browser.storage.local` (via `wxt/browser`),
// which doesn't exist outside a real extension context. `wxt/testing`'s
// `fakeBrowser` is an in-memory implementation of the same API surface —
// swap it in so `getSettings`/`saveSettings` are testable without a browser.
vi.mock('wxt/browser', () => ({ browser: fakeBrowser }))

describe('mergeSettings', () => {
  // `mergeSettings` runs a blob through `migrateSettings` first (see that
  // function's doc comment), which now also seeds `BUILTIN_COMMANDS` into
  // `commands` on an unseeded blob — so an undefined/empty input no longer
  // round-trips to `DEFAULT_SETTINGS` verbatim. See the dedicated "built-in
  // command seeding" describe block below for the seeding behavior itself.
  it('seeds the built-in commands (and everything else defaults) when given undefined', () => {
    const merged = mergeSettings(undefined)
    expect(merged.provider).toEqual(DEFAULT_SETTINGS.provider)
    expect(merged.shortcuts).toEqual(DEFAULT_SETTINGS.shortcuts)
    expect(merged.commands).toEqual(BUILTIN_COMMANDS)
    expect(merged.commandsSeeded).toBe(true)
  })

  it('seeds the built-in commands when given an empty object', () => {
    const merged = mergeSettings({})
    expect(merged.commands).toEqual(BUILTIN_COMMANDS)
    expect(merged.commandsSeeded).toBe(true)
  })

  it('strips a legacy triggerPrefix field from a stored blob', () => {
    const merged = mergeSettings({ triggerPrefix: '!' } as any)
    expect(merged).toEqual({
      ...DEFAULT_SETTINGS,
      commands: BUILTIN_COMMANDS,
      commandsSeeded: true,
    })
    expect(merged).not.toHaveProperty('triggerPrefix')
  })

  it('strips a legacy blacklist field from a stored blob', () => {
    const merged = mergeSettings({ blacklist: ['x.com'] } as any)
    expect(merged).toEqual({
      ...DEFAULT_SETTINGS,
      commands: BUILTIN_COMMANDS,
      commandsSeeded: true,
    })
    expect(merged).not.toHaveProperty('blacklist')
  })

  it('deep-merges provider.byok without dropping unspecified byok fields', () => {
    const merged = mergeSettings({
      provider: { mode: 'byok', byok: { model: 'gpt-4o-mini' } as any },
    })
    expect(merged.provider.byok.model).toBe('gpt-4o-mini')
    expect(merged.provider.byok.baseUrl).toBe(
      DEFAULT_SETTINGS.provider.byok.baseUrl,
    )
    expect(merged.provider.byok.apiKey).toEqual(
      DEFAULT_SETTINGS.provider.byok.apiKey,
    )
  })

  it('migrates a legacy provider.byok.apiKeys array to a single apiKey (first non-empty element)', () => {
    const merged = mergeSettings({
      provider: {
        mode: 'byok',
        byok: { apiKeys: ['', 'a', 'b'] } as any,
      },
    } as any)
    expect(merged.provider.byok.apiKey).toBe('a')
    expect(merged.provider.byok).not.toHaveProperty('apiKeys')
  })

  it('migrates an empty legacy apiKeys array to an empty apiKey', () => {
    const merged = mergeSettings({
      provider: { mode: 'byok', byok: { apiKeys: [] } as any },
    } as any)
    expect(merged.provider.byok.apiKey).toBe('')
  })

  it('keeps a custom commands array intact, with built-ins seeded ahead of it', () => {
    const commands = [{ name: 'custom', prompt: '{{text}}' }]
    const merged = mergeSettings({ commands })
    expect(merged.commands).toEqual([...BUILTIN_COMMANDS, ...commands])
  })

  it('does not seed a built-in the blob already marks as seeded', () => {
    const commands = [{ name: 'custom', prompt: '{{text}}' }]
    const merged = mergeSettings({ commands, commandsSeeded: true })
    expect(merged.commands).toEqual(commands)
  })

  it('defaults shortcuts to an empty map', () => {
    expect(mergeSettings(undefined).shortcuts).toEqual({})
  })

  it('keeps a shortcuts map intact', () => {
    const shortcuts = { fix: 'Ctrl+Alt+F' }
    const merged = mergeSettings({ shortcuts })
    expect(merged.shortcuts).toEqual(shortcuts)
  })

  it('preserves the imp provider config when in imp mode', () => {
    const merged = mergeSettings({
      provider: {
        mode: 'imp',
        imp: { apiKey: 'k', baseUrl: 'https://imp.example.com', model: 'm' },
        byok: DEFAULT_SETTINGS.provider.byok,
      },
    })
    expect(merged.provider.mode).toBe('imp')
    expect(merged.provider.imp).toEqual({
      apiKey: 'k',
      baseUrl: 'https://imp.example.com',
      model: 'm',
    })
  })
})

describe('deepMergeSettingsPatch', () => {
  it('returns the base unchanged when patch is undefined', () => {
    expect(deepMergeSettingsPatch(DEFAULT_SETTINGS, undefined)).toEqual(
      DEFAULT_SETTINGS,
    )
  })

  it('an incomplete provider patch does not drop the base byok fields', () => {
    const base = {
      provider: {
        mode: 'byok' as const,
        byok: {
          baseUrl: 'https://api.example.com/v1',
          apiKey: 'key-a',
          model: 'gpt-existing',
        },
      },
      commands: [],
    }
    // Patch only touches `mode`, saying nothing about `byok` at all.
    const merged = deepMergeSettingsPatch(base, { provider: { mode: 'byok' } as any })
    expect(merged.provider?.byok).toEqual(base.provider.byok)
  })

  it('a partial byok patch does not drop the rest of the byok fields', () => {
    const base = {
      provider: {
        mode: 'byok' as const,
        byok: {
          baseUrl: 'https://api.example.com/v1',
          apiKey: 'key-a',
          model: 'gpt-existing',
        },
      },
    }
    // Only `model` is specified in the patch's byok object.
    const merged = deepMergeSettingsPatch(base, {
      provider: { byok: { model: 'gpt-new' } } as any,
    })
    expect(merged.provider?.byok).toEqual({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'key-a',
      model: 'gpt-new',
    })
  })

  it('does not drop provider.imp when only byok is patched', () => {
    const base = {
      provider: {
        mode: 'imp' as const,
        imp: { apiKey: 'k', baseUrl: 'https://imp.example.com', model: 'm' },
        byok: DEFAULT_SETTINGS.provider.byok,
      },
    }
    const merged = deepMergeSettingsPatch(base, {
      provider: { byok: { model: 'gpt-new' } } as any,
    })
    expect(merged.provider?.imp).toEqual(base.provider.imp)
    expect(merged.provider?.byok.model).toBe('gpt-new')
  })

  it('replaces arrays wholesale rather than merging them element-wise', () => {
    const base = { commands: [{ name: 'a', prompt: 'A' }] }
    const merged = deepMergeSettingsPatch(base, {
      commands: [{ name: 'b', prompt: 'B' }],
    })
    expect(merged.commands).toEqual([{ name: 'b', prompt: 'B' }])
  })

  it('keeps top-level fields from the base that the patch does not mention', () => {
    const base = { commands: [{ name: 'a', prompt: 'A' }] }
    const merged = deepMergeSettingsPatch(base, {
      provider: DEFAULT_SETTINGS.provider,
    })
    expect(merged.commands).toEqual(base.commands)
  })

  it('replaces the shortcuts map wholesale rather than merging keys', () => {
    const base = { shortcuts: { fix: 'Ctrl+Alt+F', improve: 'Ctrl+Alt+I' } }
    const merged = deepMergeSettingsPatch(base, {
      shortcuts: { formal: 'Ctrl+Alt+O' },
    })
    expect(merged.shortcuts).toEqual({ formal: 'Ctrl+Alt+O' })
  })
})

describe('saveSettings', () => {
  beforeEach(() => {
    fakeBrowser.reset()
  })

  it('persists a patch and returns the merged settings', async () => {
    const commands = [{ name: 'custom', prompt: '{{text}}' }]
    const result = await saveSettings({ commands })
    expect(result.commands).toEqual(commands)
    expect(await getSettings()).toEqual(result)
  })

  it('a narrow byok patch does not clobber sibling byok fields already on disk', async () => {
    await saveSettings({
      provider: {
        mode: 'byok',
        byok: { baseUrl: 'https://api.example.com/v1', apiKey: 'key-a', model: 'gpt-1' },
      },
    })
    await saveSettings({
      provider: { mode: 'byok', byok: { model: 'gpt-2' } as any },
    })
    const settings = await getSettings()
    expect(settings.provider.byok).toEqual({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'key-a',
      model: 'gpt-2',
    })
  })

  // Regression test for the read-modify-write race: two overlapping savers
  // (e.g. the options page and background's impConnect handler) touching
  // unrelated top-level fields must both survive, not have the slower one
  // clobber the faster one's write.
  it('serializes concurrent saves so unrelated fields from both survive', async () => {
    await Promise.all([
      saveSettings({ commands: [{ name: 'custom', prompt: '{{text}}' }] }),
      saveSettings({
        provider: {
          mode: 'byok',
          byok: { baseUrl: 'https://api.example.com/v1', apiKey: 'x', model: 'm' },
        },
      }),
    ])
    const settings = await getSettings()
    expect(settings.commands).toEqual([{ name: 'custom', prompt: '{{text}}' }])
    expect(settings.provider.byok.apiKey).toEqual('x')
  })

  it('a rejected save does not block subsequent saves from completing', async () => {
    // Only the first `set()` call fails; vitest's `spyOn` falls back to the
    // real implementation for every call after the "once" override runs out.
    vi.spyOn(fakeBrowser.storage.local, 'set').mockImplementationOnce(() =>
      Promise.reject(new Error('boom')),
    )

    await expect(
      saveSettings({ commands: [{ name: 'custom', prompt: '{{text}}' }] }),
    ).rejects.toThrow('boom')

    await saveSettings({
      commands: [{ name: 'other', prompt: '{{text}}' }],
    })
    const settings = await getSettings()
    expect(settings.commands).toEqual([{ name: 'other', prompt: '{{text}}' }])
  })

  it('migrates a stored blob with a legacy triggerPrefix and writes the migrated shape back', async () => {
    await fakeBrowser.storage.local.set({
      settings: { triggerPrefix: '!', commands: [{ name: 'a', prompt: 'A' }] },
    })
    const settings = await getSettings()
    expect(settings).not.toHaveProperty('triggerPrefix')
    // The blob wasn't marked `commandsSeeded`, so built-ins get seeded ahead
    // of the pre-existing custom "a" command in the same pass.
    expect(settings.commands).toEqual([
      ...BUILTIN_COMMANDS,
      { name: 'a', prompt: 'A' },
    ])

    const stored = await fakeBrowser.storage.local.get('settings')
    expect(stored.settings).not.toHaveProperty('triggerPrefix')
    expect((stored.settings as any).commands).toEqual([
      ...BUILTIN_COMMANDS,
      { name: 'a', prompt: 'A' },
    ])
  })

  it('migrates a stored blob with a legacy blacklist and writes the migrated shape back', async () => {
    await fakeBrowser.storage.local.set({
      settings: { blacklist: ['x.com'], commands: [{ name: 'a', prompt: 'A' }] },
    })
    const settings = await getSettings()
    expect(settings).not.toHaveProperty('blacklist')
    expect(settings.commands).toEqual([
      ...BUILTIN_COMMANDS,
      { name: 'a', prompt: 'A' },
    ])

    const stored = await fakeBrowser.storage.local.get('settings')
    expect(stored.settings).not.toHaveProperty('blacklist')
  })

  it('migrates a stored blob with a legacy provider.byok.apiKeys and writes the migrated shape back', async () => {
    await fakeBrowser.storage.local.set({
      settings: {
        provider: {
          mode: 'byok',
          byok: {
            baseUrl: 'https://api.example.com/v1',
            apiKeys: ['key-a', 'key-b'],
            model: 'gpt-1',
          },
        },
      },
    })
    const settings = await getSettings()
    expect(settings.provider.byok.apiKey).toBe('key-a')
    expect(settings.provider.byok).not.toHaveProperty('apiKeys')

    const stored = await fakeBrowser.storage.local.get('settings')
    const storedByok = (stored.settings as any).provider.byok
    expect(storedByok).not.toHaveProperty('apiKeys')
    expect(storedByok.apiKey).toBe('key-a')
  })

  it('leaves an already-seeded blob without legacy fields untouched (no extra write-back)', async () => {
    await fakeBrowser.storage.local.set({
      settings: { commands: [{ name: 'a', prompt: 'A' }], commandsSeeded: true },
    })
    const setSpy = vi.spyOn(fakeBrowser.storage.local, 'set')
    setSpy.mockClear()
    await getSettings()
    expect(setSpy).not.toHaveBeenCalled()
  })
})

// Dedicated coverage for the "no more read-only built-ins" model: the
// runtime command table is just `settings.commands`, and `BUILTIN_COMMANDS`
// is only ever consulted as a seed/restore source by `migrateSettings`
// (here) or the options page's "Restore default commands" button.
describe('built-in command seeding (commandsSeeded)', () => {
  beforeEach(() => {
    fakeBrowser.reset()
  })

  it('seeds BUILTIN_COMMANDS into a brand-new blob and marks commandsSeeded', async () => {
    const settings = await getSettings()
    expect(settings.commands).toEqual(BUILTIN_COMMANDS)
    expect(settings.commandsSeeded).toBe(true)

    const stored = await fakeBrowser.storage.local.get('settings')
    expect((stored.settings as any).commands).toEqual(BUILTIN_COMMANDS)
    expect((stored.settings as any).commandsSeeded).toBe(true)
  })

  it('seeds missing built-ins ahead of an existing custom command without duplicating or overwriting it', async () => {
    await fakeBrowser.storage.local.set({
      settings: { commands: [{ name: 'custom', prompt: 'do X' }] },
    })
    const settings = await getSettings()
    expect(settings.commands).toEqual([
      ...BUILTIN_COMMANDS,
      { name: 'custom', prompt: 'do X' },
    ])
    expect(settings.commandsSeeded).toBe(true)
  })

  it('does not duplicate or overwrite a built-in the user already has under the same name (case-insensitive)', async () => {
    await fakeBrowser.storage.local.set({
      settings: { commands: [{ name: 'FIX', prompt: 'my own fix prompt' }] },
    })
    const settings = await getSettings()
    const fixEntries = settings.commands.filter(
      (c) => c.name.toLowerCase() === 'fix',
    )
    expect(fixEntries).toHaveLength(1)
    expect(fixEntries[0]!.prompt).toBe('my own fix prompt')
  })

  it('does not re-seed once commandsSeeded is already true', async () => {
    await fakeBrowser.storage.local.set({
      settings: { commands: [{ name: 'custom', prompt: 'X' }], commandsSeeded: true },
    })
    const settings = await getSettings()
    expect(settings.commands).toEqual([{ name: 'custom', prompt: 'X' }])
  })

  it('does not revive a built-in command the user deleted, once already seeded', async () => {
    const withoutFix = BUILTIN_COMMANDS.filter((c) => c.name !== 'fix')
    await fakeBrowser.storage.local.set({
      settings: { commands: withoutFix, commandsSeeded: true },
    })
    const settings = await getSettings()
    expect(settings.commands).toEqual(withoutFix)
    expect(settings.commands.some((c) => c.name === 'fix')).toBe(false)
  })
})
