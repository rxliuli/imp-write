import type { Command } from './settings'

/**
 * On-disk shape for an exported command set. Deliberately narrow — only
 * `name`/`prompt` per command, nothing else from `Settings` (no
 * provider/apiKey/imp credentials/shortcuts ever end up in here). `version`
 * lets a future format change be detected explicitly instead of silently
 * misparsed; there's only one shape today.
 */
export interface CommandsFile {
  version: 1
  commands: Command[]
}

/**
 * Serializes the command list into the exportable JSON shape (pretty-printed
 * with 2-space indentation). Only `name`/`prompt` survive per command — this
 * is the one place that decides what's in scope for export, so a caller
 * can't accidentally widen it by passing more than `Command[]`.
 */
export function serializeCommands(commands: Command[]): string {
  const file: CommandsFile = {
    version: 1,
    commands: commands.map((c) => ({ name: c.name, prompt: c.prompt })),
  }
  return JSON.stringify(file, null, 2)
}

export type ParseCommandsResult =
  | { ok: true; commands: Command[] }
  | { ok: false; error: string }

/**
 * Validates the outer shape of an imported commands file: valid JSON, a
 * plain (non-array) object, `version === 1`, and a `commands` array.
 * Anything else — unparseable JSON, a non-object, a wrong/missing version,
 * a non-array `commands` — is a hard error with no partial import.
 *
 * Per-entry validation (name/prompt presence, type, whitespace) is
 * deliberately left to `mergeImportedCommands`: it needs to run in the same
 * pass as dedup so the caller gets one coherent tally
 * (added/skippedDuplicates/skippedInvalid) instead of two counts to
 * reconcile from separate functions. The `commands` array returned here is
 * therefore only shape-checked at the "it's an array" level, not
 * element-by-element — callers must go through `mergeImportedCommands`
 * before trusting individual entries.
 *
 * Unknown top-level fields on the parsed object are ignored, for forward
 * compatibility with a later format that adds metadata.
 */
export function parseCommandsFile(text: string): ParseCommandsResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, error: 'That file is not valid JSON.' }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      ok: false,
      error: 'Invalid commands file: expected a JSON object.',
    }
  }

  const { version, commands } = parsed as Record<string, unknown>
  if (version !== 1) {
    return { ok: false, error: 'Unsupported commands file version.' }
  }
  if (!Array.isArray(commands)) {
    return {
      ok: false,
      error: 'Invalid commands file: "commands" must be an array.',
    }
  }

  return { ok: true, commands: commands as Command[] }
}

export interface MergeImportedCommandsResult {
  merged: Command[]
  added: number
  skippedDuplicates: number
  skippedInvalid: number
}

// Same rule as the manual add/edit form's `validateCommand` in
// CommandsSection.tsx: non-empty, whitespace-free name; non-empty prompt;
// both must actually be strings (a malformed/hand-edited export file could
// have anything in these positions).
function isValidImportedCommand(entry: unknown): entry is Command {
  if (!entry || typeof entry !== 'object') return false
  const { name, prompt } = entry as Record<string, unknown>
  if (typeof name !== 'string' || typeof prompt !== 'string') return false
  const trimmedName = name.trim()
  if (!trimmedName || /\s/.test(trimmedName)) return false
  if (!prompt.trim()) return false
  return true
}

/**
 * Merges `imported` (the still entry-unvalidated array returned by
 * `parseCommandsFile`) into `existing`, additively:
 *
 * - Each entry is validated the same way the manual add/edit form does;
 *   invalid entries are skipped and counted (`skippedInvalid`), not fatal.
 * - Valid entries are skipped (and counted as `skippedDuplicates`) if a
 *   command with the same name already exists — case-insensitively —
 *   either in `existing` or earlier in this same import batch.
 * - Everything else is appended, trimmed, in order.
 *
 * Never mutates `existing` or overwrites an existing command; this is
 * strictly additive, matching the "merge, same name skipped" import
 * semantics (not a wholesale replace).
 */
export function mergeImportedCommands(
  existing: Command[],
  imported: Command[],
): MergeImportedCommandsResult {
  const merged = [...existing]
  const names = new Set(existing.map((c) => c.name.toLowerCase()))
  let added = 0
  let skippedDuplicates = 0
  let skippedInvalid = 0

  for (const entry of imported) {
    if (!isValidImportedCommand(entry)) {
      skippedInvalid++
      continue
    }
    const name = entry.name.trim()
    const lower = name.toLowerCase()
    if (names.has(lower)) {
      skippedDuplicates++
      continue
    }
    names.add(lower)
    merged.push({ name, prompt: entry.prompt.trim() })
    added++
  }

  return { merged, added, skippedDuplicates, skippedInvalid }
}
