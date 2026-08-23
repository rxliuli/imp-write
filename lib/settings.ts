import { browser } from 'wxt/browser'
import { BUILTIN_COMMANDS } from './commands'

export interface Command {
  name: string
  prompt: string // may reference {{text}}
}

export interface ImpProvider {
  apiKey: string
  baseUrl: string
  model: string
}

export interface ByokProvider {
  baseUrl: string
  apiKey: string
  model: string
}

export interface ProviderSettings {
  mode: 'imp' | 'byok'
  imp?: ImpProvider // filled in automatically by the connect flow
  byok: ByokProvider
}

export interface Settings {
  provider: ProviderSettings
  // The full, authoritative command table — there's no separate "built-in"
  // concept at runtime any more. `BUILTIN_COMMANDS` (lib/commands.ts) is only
  // a seed/restore source: `migrateSettings` below prepends any of its
  // entries the user doesn't already have (by name) into this array the
  // first time a stored blob is read, and the options page's "Restore
  // default commands" button can do the same on demand. Once seeded here,
  // every entry — built-in-derived or fully custom — is freely editable and
  // deletable, and deletions stick (no revival on next read).
  commands: Command[]
  // Command name => shortcut spec string (see lib/shortcut.ts's
  // `eventToShortcut`). Kept as one flat map here rather than nested inside
  // each `Command`.
  shortcuts: Record<string, string>
  // Whether `commands` has already been seeded from `BUILTIN_COMMANDS` once
  // (see `migrateSettings`). Prevents re-seeding on every subsequent read,
  // which would otherwise resurrect a built-in command the user deleted.
  commandsSeeded: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  provider: {
    mode: 'byok',
    byok: {
      baseUrl: 'https://api.openai.com/v1',
      apiKey: '',
      model: 'gpt-5-mini',
    },
  },
  commands: [],
  shortcuts: {},
  commandsSeeded: false,
}

// Strips fields that used to be part of the stored shape but no longer
// exist on `Settings` (`triggerPrefix` — the trigger prefix is now the
// fixed `TRIGGER_PREFIX` constant in lib/commands.ts; `blacklist` — the
// site blacklist was removed), migrates `provider.byok.apiKeys` (dropped
// multi-key BYOK support — a stored blob could still have this from before
// that change) to the single `provider.byok.apiKey` string, taking the
// first non-empty key (or `''` if there were none/it was empty), and seeds
// `commands` from `BUILTIN_COMMANDS` (see `Settings.commands`'s doc comment)
// the first time a blob is read (`commandsSeeded` isn't `true` yet) —
// built-ins the user doesn't already have (by name, case-insensitive) are
// prepended ahead of whatever's already there; already-seeded blobs, and any
// built-in the user has since deleted, are left untouched. Only allocates a
// new object (and thus triggers a write-back in callers that check
// `migrated !== raw`) when one of those legacy shapes is present or seeding
// is actually needed.
function migrateSettings(raw: Partial<Settings>): Partial<Settings> {
  const rawAny = raw as Record<string, any>
  const legacyByok = rawAny.provider?.byok
  const hasLegacyApiKeys = !!legacyByok && 'apiKeys' in legacyByok
  const needsCommandSeed = rawAny.commandsSeeded !== true
  if (
    !('triggerPrefix' in raw) &&
    !('blacklist' in raw) &&
    !hasLegacyApiKeys &&
    !needsCommandSeed
  ) {
    return raw
  }
  const migrated: Record<string, any> = { ...rawAny }
  delete migrated.triggerPrefix
  delete migrated.blacklist
  if (hasLegacyApiKeys) {
    const legacyApiKeys: unknown[] = Array.isArray(legacyByok.apiKeys)
      ? legacyByok.apiKeys
      : []
    const firstNonEmpty = legacyApiKeys.find(
      (key): key is string => typeof key === 'string' && key.trim() !== '',
    )
    const byok = { ...legacyByok }
    delete byok.apiKeys
    byok.apiKey = firstNonEmpty ?? ''
    migrated.provider = { ...migrated.provider, byok }
  }
  if (needsCommandSeed) {
    const existing: Command[] = Array.isArray(migrated.commands)
      ? migrated.commands
      : []
    const existingNames = new Set(
      existing.map((c) => (c.name ?? '').toLowerCase()),
    )
    const missingBuiltins = BUILTIN_COMMANDS.filter(
      (c) => !existingNames.has(c.name.toLowerCase()),
    )
    migrated.commands = [...missingBuiltins, ...existing]
    migrated.commandsSeeded = true
  }
  return migrated as Partial<Settings>
}

/**
 * Deep-merges a Settings patch onto a base (partial) Settings object, one
 * level deeper than a plain object spread: `provider` and `provider.byok`
 * are merged field-by-field instead of replaced wholesale, so a narrow patch
 * — e.g. `{ provider: { byok: { model } } }` — never silently drops sibling
 * nested fields (`byok.apiKey`, `provider.imp`, `provider.mode`, ...).
 * Arrays (`commands`) are still replaced wholesale, not merged
 * element-wise.
 *
 * Pure, so both `mergeSettings` (base = `DEFAULT_SETTINGS`) and
 * `saveSettings` (base = whatever's already on disk) share one
 * merge behavior, and it's easy to unit test independent of
 * `browser.storage`.
 */
export function deepMergeSettingsPatch(
  base: Partial<Settings>,
  patch: Partial<Settings> | undefined,
): Partial<Settings> {
  if (!patch) return base
  const provider =
    base.provider || patch.provider
      ? // Cast: TS can't infer from a spread of two `ProviderSettings |
        // undefined` values that `mode` survives, but at least one side is
        // always fully populated at every real call site (`DEFAULT_SETTINGS`
        // for `mergeSettings`, or a complete `provider` patch for
        // `saveSettings`'s callers).
        ({
          ...base.provider,
          ...patch.provider,
          byok: {
            ...base.provider?.byok,
            ...patch.provider?.byok,
          },
        } as ProviderSettings)
      : undefined
  return {
    ...base,
    ...patch,
    ...(provider ? { provider } : {}),
  }
}

export function mergeSettings(raw: Partial<Settings> | undefined): Settings {
  const migrated = migrateSettings(raw ?? {})
  return deepMergeSettingsPatch(DEFAULT_SETTINGS, migrated) as Settings
}

export async function getSettings(): Promise<Settings> {
  const stored = await browser.storage.local.get('settings')
  const raw = (stored.settings ?? {}) as Partial<Settings>
  const migrated = migrateSettings(raw)
  if (migrated !== raw) {
    await browser.storage.local.set({ settings: migrated })
  }
  return mergeSettings(migrated)
}

async function doSaveSettings(settings: Partial<Settings>): Promise<Settings> {
  const stored = await browser.storage.local.get('settings')
  const raw = migrateSettings((stored.settings ?? {}) as Partial<Settings>)
  const merged = deepMergeSettingsPatch(raw, settings)
  await browser.storage.local.set({ settings: merged })
  return mergeSettings(merged)
}

// Serializes every `saveSettings` call behind a module-level queue. Multiple
// contexts (the options page, background's impConnect handler, ...) can call
// this concurrently; without serializing, two overlapping
// read-modify-writes would each read the same pre-update snapshot and the
// last `set()` to land would silently clobber the other's patch.
let saveQueue: Promise<void> = Promise.resolve()

export function saveSettings(settings: Partial<Settings>): Promise<Settings> {
  const run = saveQueue.then(() => doSaveSettings(settings))
  // Keep the queue alive even if this particular save rejects, so one
  // failure doesn't permanently block every save after it. The caller of
  // *this* call still observes the real rejection via the returned promise.
  saveQueue = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}
