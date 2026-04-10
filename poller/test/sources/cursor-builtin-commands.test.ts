// poller/test/sources/cursor-builtin-commands.test.ts
import { describe, it, expect } from 'vitest'
import { parseCommands } from '../../src/sources/cursor-builtin-commands.js'

describe('parseCommands', () => {
  it('extracts command from RSC payload pattern', () => {
    const html = `some stuff {"children":"/worktree"} more stuff`
    const entries = parseCommands(html)

    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      tool: 'cursor',
      kind: 'first-party',
      id: 'builtin/worktree',
      name: '/worktree',
      metadata: { extra: { builtin: true } },
    })
  })

  it('deduplicates commands', () => {
    const html = `{"children":"/chat"} and then {"children":"/chat"} again`
    const entries = parseCommands(html)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.name).toBe('/chat')
  })

  it('extracts description from surrounding text', () => {
    const html = `[{"children":"/worktree"}]," that creates a separate git worktree so changes happen in isolation."`
    const entries = parseCommands(html)

    expect(entries).toHaveLength(1)
    expect(entries[0]!.description).toContain('creates a separate git worktree')
  })

  it('returns empty array for no matches', () => {
    const entries = parseCommands('just some random html with no commands')
    expect(entries).toEqual([])
  })

  it('handles missing description gracefully when no text follows pattern', () => {
    const html = `{"children":"/edit"}`
    const entries = parseCommands(html)

    expect(entries).toHaveLength(1)
    expect(entries[0]!.name).toBe('/edit')
    expect(entries[0]!.description).toBeUndefined()
  })

  it('handles short text after pattern (below 10 char threshold)', () => {
    const html = `[{"children":"/run"}],"short"`
    const entries = parseCommands(html)

    expect(entries).toHaveLength(1)
    expect(entries[0]!.name).toBe('/run')
    expect(entries[0]!.description).toBeUndefined()
  })

  it('extracts multiple commands', () => {
    const html = `{"children":"/chat"} blah {"children":"/edit"} blah {"children":"/worktree"}`
    const entries = parseCommands(html)

    expect(entries).toHaveLength(3)
    expect(entries.map((e) => e.name).sort()).toEqual(['/chat', '/edit', '/worktree'])
  })

  it('handles escaped quotes in html', () => {
    const html = `some \\"{\\\"children\\\":\\\"/review\\\"}\\"`
    const entries = parseCommands(html)

    expect(entries).toHaveLength(1)
    expect(entries[0]!.name).toBe('/review')
  })

  it('sets source_url to changelog URL', () => {
    const html = `{"children":"/debug"}`
    const entries = parseCommands(html)

    expect(entries[0]!.source_url).toBe('https://cursor.com/changelog')
  })
})
