import { describe, expect, it } from 'vitest'
import {
  mergeImportedCommands,
  parseCommandsFile,
  serializeCommands,
} from './commandsTransfer'
import type { Command } from './settings'

const sample: Command[] = [
  { name: 'fix', prompt: 'Fix: {{text}}' },
  { name: 'custom', prompt: 'Do a thing with {{text}}' },
]

describe('serializeCommands / parseCommandsFile round-trip', () => {
  it('round-trips a command list through serialize -> parse', () => {
    const json = serializeCommands(sample)
    const result = parseCommandsFile(json)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.commands).toEqual(sample)
    }
  })

  it('serializes with version 1 and pretty-printed 2-space indentation', () => {
    const json = serializeCommands(sample)
    expect(json).toContain('"version": 1')
    expect(json.startsWith('{\n  "version": 1')).toBe(true)
  })

  it('only exports name/prompt, dropping any extra fields on the input objects', () => {
    const withExtra = [
      { name: 'fix', prompt: 'Fix: {{text}}', extra: 'nope' } as unknown as Command,
    ]
    const json = serializeCommands(withExtra)
    const parsed = JSON.parse(json)
    expect(parsed.commands).toEqual([{ name: 'fix', prompt: 'Fix: {{text}}' }])
  })

  it('round-trips an empty commands array', () => {
    const json = serializeCommands([])
    const result = parseCommandsFile(json)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.commands).toEqual([])
    }
  })
})

describe('parseCommandsFile', () => {
  it('rejects invalid JSON', () => {
    const result = parseCommandsFile('{not json')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/json/i)
    }
  })

  it('rejects a JSON array at the top level', () => {
    const result = parseCommandsFile('[]')
    expect(result.ok).toBe(false)
  })

  it('rejects a JSON primitive at the top level', () => {
    const result = parseCommandsFile('"hello"')
    expect(result.ok).toBe(false)
  })

  it('rejects a missing version field', () => {
    const result = parseCommandsFile(JSON.stringify({ commands: [] }))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/version/i)
    }
  })

  it('rejects a wrong version number', () => {
    const result = parseCommandsFile(
      JSON.stringify({ version: 2, commands: [] }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/version/i)
    }
  })

  it('rejects a non-array "commands" field', () => {
    const result = parseCommandsFile(
      JSON.stringify({ version: 1, commands: 'nope' }),
    )
    expect(result.ok).toBe(false)
  })

  it('ignores unknown top-level fields for forward compatibility', () => {
    const result = parseCommandsFile(
      JSON.stringify({ version: 1, commands: sample, exportedBy: 'imp-write' }),
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.commands).toEqual(sample)
    }
  })
})

describe('mergeImportedCommands', () => {
  it('adds every imported command when there is no overlap', () => {
    const result = mergeImportedCommands(
      [{ name: 'fix', prompt: 'Fix: {{text}}' }],
      [{ name: 'improve', prompt: 'Improve: {{text}}' }],
    )
    expect(result.added).toBe(1)
    expect(result.skippedDuplicates).toBe(0)
    expect(result.skippedInvalid).toBe(0)
    expect(result.merged).toEqual([
      { name: 'fix', prompt: 'Fix: {{text}}' },
      { name: 'improve', prompt: 'Improve: {{text}}' },
    ])
  })

  it('skips an imported command whose name matches an existing one, case-insensitively', () => {
    const result = mergeImportedCommands(
      [{ name: 'Fix', prompt: 'Existing fix prompt' }],
      [{ name: 'FIX', prompt: 'Different prompt' }],
    )
    expect(result.added).toBe(0)
    expect(result.skippedDuplicates).toBe(1)
    expect(result.merged).toEqual([
      { name: 'Fix', prompt: 'Existing fix prompt' },
    ])
  })

  it('skips duplicates within the same import batch too, case-insensitively', () => {
    const result = mergeImportedCommands(
      [],
      [
        { name: 'improve', prompt: 'First' },
        { name: 'IMPROVE', prompt: 'Second' },
      ],
    )
    expect(result.added).toBe(1)
    expect(result.skippedDuplicates).toBe(1)
    expect(result.merged).toEqual([{ name: 'improve', prompt: 'First' }])
  })

  it('skips entries missing required fields, counting them as invalid', () => {
    const result = mergeImportedCommands(
      [],
      [{ name: 'onlyname' } as unknown as Command, { prompt: 'onlyprompt' } as unknown as Command],
    )
    expect(result.added).toBe(0)
    expect(result.skippedInvalid).toBe(2)
    expect(result.merged).toEqual([])
  })

  it('skips entries whose name/prompt are the wrong type', () => {
    const result = mergeImportedCommands(
      [],
      [{ name: 123, prompt: 'x' } as unknown as Command],
    )
    expect(result.skippedInvalid).toBe(1)
    expect(result.added).toBe(0)
  })

  it('skips entries whose name contains whitespace', () => {
    const result = mergeImportedCommands(
      [],
      [{ name: 'has space', prompt: 'x' }],
    )
    expect(result.skippedInvalid).toBe(1)
    expect(result.added).toBe(0)
  })

  it('skips entries with an empty/whitespace-only prompt', () => {
    const result = mergeImportedCommands([], [{ name: 'ok', prompt: '   ' }])
    expect(result.skippedInvalid).toBe(1)
    expect(result.added).toBe(0)
  })

  it('trims name and prompt on the merged entry', () => {
    const result = mergeImportedCommands(
      [],
      [{ name: '  spaced  '.trim(), prompt: '  padded  ' }],
    )
    expect(result.added).toBe(1)
    expect(result.merged).toEqual([{ name: 'spaced', prompt: 'padded' }])
  })

  it('handles an empty imported array as a no-op', () => {
    const existing: Command[] = [{ name: 'fix', prompt: 'x' }]
    const result = mergeImportedCommands(existing, [])
    expect(result).toEqual({
      merged: existing,
      added: 0,
      skippedDuplicates: 0,
      skippedInvalid: 0,
    })
  })

  it('never mutates the existing array', () => {
    const existing: Command[] = [{ name: 'fix', prompt: 'x' }]
    const existingCopy = [...existing]
    mergeImportedCommands(existing, [{ name: 'improve', prompt: 'y' }])
    expect(existing).toEqual(existingCopy)
  })
})
