import { describe, expect, it } from 'vitest'
import { recordCommandUse, sortCommandsByRecency } from './commandRecency'
import type { Command } from './settings'

const commands: Command[] = [
  { name: 'fix', prompt: 'Fix {{text}}' },
  { name: 'improve', prompt: 'Improve {{text}}' },
  { name: 'shorten', prompt: 'Shorten {{text}}' },
  { name: 'tl', prompt: 'Translate {{text}}' },
]

describe('sortCommandsByRecency', () => {
  it('returns commands unchanged (settings order) when recency is empty', () => {
    expect(sortCommandsByRecency(commands, [])).toEqual(commands)
  })

  it('puts the most-recently-used command first', () => {
    const sorted = sortCommandsByRecency(commands, ['tl'])
    expect(sorted.map((c) => c.name)).toEqual(['tl', 'fix', 'improve', 'shorten'])
  })

  it('orders multiple recency entries most-recent-first', () => {
    const sorted = sortCommandsByRecency(commands, ['shorten', 'fix'])
    expect(sorted.map((c) => c.name)).toEqual(['shorten', 'fix', 'improve', 'tl'])
  })

  it('leaves the untouched commands in their original settings order', () => {
    const sorted = sortCommandsByRecency(commands, ['tl'])
    expect(sorted.slice(1).map((c) => c.name)).toEqual(['fix', 'improve', 'shorten'])
  })

  it('is case-insensitive when matching recency names against commands', () => {
    const sorted = sortCommandsByRecency(commands, ['FIX'])
    expect(sorted.map((c) => c.name)).toEqual(['fix', 'improve', 'shorten', 'tl'])
  })

  it('silently skips a recency entry for a command that no longer exists (renamed/deleted)', () => {
    const sorted = sortCommandsByRecency(commands, ['ghost', 'tl'])
    expect(sorted.map((c) => c.name)).toEqual(['tl', 'fix', 'improve', 'shorten'])
  })

  it('de-duplicates a name appearing more than once in recency, keeping only its first (most recent) occurrence', () => {
    const sorted = sortCommandsByRecency(commands, ['fix', 'tl', 'fix'])
    expect(sorted.map((c) => c.name)).toEqual(['fix', 'tl', 'improve', 'shorten'])
  })

  it('does not mutate the input commands array', () => {
    const copy = [...commands]
    sortCommandsByRecency(commands, ['tl'])
    expect(commands).toEqual(copy)
  })
})

describe('recordCommandUse', () => {
  it('inserts a first-ever use at the front', () => {
    expect(recordCommandUse([], 'fix')).toEqual(['fix'])
  })

  it('moves an already-present name to the front rather than duplicating it', () => {
    expect(recordCommandUse(['tl', 'fix', 'improve'], 'fix')).toEqual([
      'fix',
      'tl',
      'improve',
    ])
  })

  it('is case-insensitive when de-duplicating, but keeps the newly-used casing', () => {
    expect(recordCommandUse(['FIX', 'tl'], 'fix')).toEqual(['fix', 'tl'])
  })

  it('prepends a new name ahead of everything already recorded', () => {
    expect(recordCommandUse(['tl', 'improve'], 'fix')).toEqual([
      'fix',
      'tl',
      'improve',
    ])
  })

  it('caps the list length rather than growing it unboundedly', () => {
    const long = Array.from({ length: 25 }, (_, i) => `cmd-${i}`)
    const next = recordCommandUse(long, 'newest')
    expect(next.length).toBe(20)
    expect(next[0]).toBe('newest')
  })
})
