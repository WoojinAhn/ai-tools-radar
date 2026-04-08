// poller/test/writers/catalog.test.ts
import { describe, it, expect } from 'vitest'
import { buildCatalog } from '../../src/writers/catalog.js'
import type { CatalogEntry, Event } from '../../src/sources/types.js'

function entry(id: string, overrides: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    tool: 'claude-code',
    kind: 'first-party',
    id,
    name: id,
    source_url: `https://example.com/${id}`,
    metadata: { extra: {} },
    fetched_at: '2026-04-09T00:00:00.000Z',
    ...overrides,
  }
}

describe('buildCatalog', () => {
  it('derives first_seen_at from earliest added event and last_updated_at from most recent change', () => {
    const entries = [entry('a'), entry('b')]
    const events: Event[] = [
      {
        ts: '2026-03-15T00:00:00.000Z',
        type: 'added',
        key: 'claude-code/first-party/a',
        entry: entry('a'),
      },
      {
        ts: '2026-03-20T00:00:00.000Z',
        type: 'added',
        key: 'claude-code/first-party/b',
        entry: entry('b'),
      },
      {
        ts: '2026-04-01T00:00:00.000Z',
        type: 'updated',
        key: 'claude-code/first-party/a',
        changes: [{ path: 'description', before: 'old', after: 'new' }],
      },
    ]
    const catalog = buildCatalog(entries, events, '2026-04-09T00:00:00.000Z')

    expect(catalog.stats.total).toBe(2)
    expect(catalog.stats.by_tool).toEqual({ 'claude-code': 2 })
    expect(catalog.stats.by_kind).toEqual({ 'first-party': 2 })

    const viewA = catalog.entries.find((e) => e.id === 'a')!
    expect(viewA.first_seen_at).toBe('2026-03-15T00:00:00.000Z')
    expect(viewA.last_updated_at).toBe('2026-04-01T00:00:00.000Z')

    const viewB = catalog.entries.find((e) => e.id === 'b')!
    expect(viewB.first_seen_at).toBe('2026-03-20T00:00:00.000Z')
    expect(viewB.last_updated_at).toBe('2026-03-20T00:00:00.000Z')
  })

  it('falls back to generated_at when no events reference an entry', () => {
    const catalog = buildCatalog([entry('orphan')], [], '2026-04-09T00:00:00.000Z')
    const view = catalog.entries[0]!
    expect(view.first_seen_at).toBe('2026-04-09T00:00:00.000Z')
    expect(view.last_updated_at).toBe('2026-04-09T00:00:00.000Z')
  })

  it('sorts entries by first_seen_at descending (newest first)', () => {
    const events: Event[] = [
      { ts: '2026-01-01T00:00:00.000Z', type: 'added', key: 'claude-code/first-party/old', entry: entry('old') },
      { ts: '2026-04-01T00:00:00.000Z', type: 'added', key: 'claude-code/first-party/new', entry: entry('new') },
    ]
    const catalog = buildCatalog([entry('old'), entry('new')], events, '2026-04-09T00:00:00.000Z')
    expect(catalog.entries.map((e) => e.id)).toEqual(['new', 'old'])
  })
})
