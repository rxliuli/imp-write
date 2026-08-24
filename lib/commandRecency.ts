import { browser } from 'wxt/browser'
import type { Command } from './settings'

/**
 * "Most recently used" ordering for the floating command menu
 * (`lib/commandMenu.ts`) — most-recent-first, everything else falling back
 * to `settings.commands`'s own order. Deliberately its own
 * `browser.storage.local` key rather than a field on `Settings`
 * (`lib/settings.ts`): `Settings` already has two independent writers (the
 * options page and background's `impConnect` flow) coordinated only by
 * `saveSettings`'s serializing queue — a third writer racing on every single
 * command execution (far more frequent than either of those) would either
 * need to join that same queue (slowing down every settings save for
 * something settings has nothing to do with) or risk clobbering a
 * concurrent settings write. A separate key sidesteps the question
 * entirely. Read fresh (`getSortedCommands`) every time the menu is about
 * to show, not cached — so a command used from one path (say, the
 * right-click menu) is reflected the next time any menu opens, including in
 * another frame.
 *
 * Uses `browser.storage.local` directly (matching `lib/settings.ts`'s own
 * convention) rather than `wxt/utils/storage`'s `storage.getItem`/`setItem`
 * helpers, which nothing else in this codebase uses yet.
 */
const RECENCY_STORAGE_KEY = 'commandRecency'

// Caps how long the recency list can grow over a long browsing session —
// nothing reasonable ever needs more than this many "most recent" entries
// tracked; the rest fall back to `settings.commands`'s own order anyway.
const MAX_RECENCY_ENTRIES = 20

/**
 * Pure: reorders `commands` so any name that appears in `recency`
 * (most-recently-used first) sorts ahead of everything else, preserving
 * `commands`' own relative order both within "the rest" and as the
 * tie-breaker for recency names that no longer resolve to a real command
 * (renamed or deleted since). Matching is case-insensitive against
 * `Command.name`, like every other command lookup in this codebase
 * (`findCommand` in content.ts, `matchShortcut`, ...).
 *
 * Deliberately does not mutate or reorder `commands` itself — callers that
 * must *not* be affected by recency (the right-click context menu's build
 * order in background.ts, the options page's list) simply never call this,
 * rather than this function needing an opt-out flag.
 */
export function sortCommandsByRecency(
  commands: Command[],
  recency: string[],
): Command[] {
  const byLowerName = new Map(commands.map((c) => [c.name.toLowerCase(), c]))
  const seen = new Set<string>()
  const recent: Command[] = []
  for (const name of recency) {
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    const command = byLowerName.get(key)
    if (!command) continue
    seen.add(key)
    recent.push(command)
  }
  const rest = commands.filter((c) => !seen.has(c.name.toLowerCase()))
  return [...recent, ...rest]
}

/**
 * Pure: returns the next recency list after `name` was just used —
 * moved (or newly inserted) to the front, de-duplicated case-insensitively,
 * and capped at `MAX_RECENCY_ENTRIES`.
 */
export function recordCommandUse(recency: string[], name: string): string[] {
  const key = name.toLowerCase()
  const withoutExisting = recency.filter((n) => n.toLowerCase() !== key)
  return [name, ...withoutExisting].slice(0, MAX_RECENCY_ENTRIES)
}

/** Reads the current recency list from storage, defaulting to empty (never-used-anything) if there's nothing stored yet or the stored shape is unexpected. */
export async function getCommandRecency(): Promise<string[]> {
  const stored = await browser.storage.local.get(RECENCY_STORAGE_KEY)
  const value = stored[RECENCY_STORAGE_KEY]
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === 'string')
    : []
}

/**
 * Records that `commandName` was just successfully run — called from
 * content.ts's `executeCommand`, the one execution path every trigger
 * surface (idle pause, right-click menu, keyboard shortcut, floating
 * command menu) shares, so every surface updates recency for free. Fire-
 * and-forget from the caller's perspective (bookkeeping, not
 * correctness-critical to the command that already succeeded) — errors are
 * the caller's responsibility to catch/log, this doesn't swallow them
 * itself.
 */
export async function recordCommandUsed(commandName: string): Promise<void> {
  const current = await getCommandRecency()
  const next = recordCommandUse(current, commandName)
  await browser.storage.local.set({ [RECENCY_STORAGE_KEY]: next })
}

/** Convenience wrapper for the command menu's `show()` call sites: reads recency fresh and returns `commands` reordered by it. */
export async function getSortedCommands(commands: Command[]): Promise<Command[]> {
  const recency = await getCommandRecency()
  return sortCommandsByRecency(commands, recency)
}
