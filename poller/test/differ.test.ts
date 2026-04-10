import { describe, it, expect } from 'vitest'
import { diff } from '../src/differ.js'
import type { CatalogEntry, SnapshotFile } from '../src/sources/types.js'

const FROZEN_TS = '2026-04-09T00:00:00.000Z'

function entry(overrides: Partial<CatalogEntry> & Pick<CatalogEntry, 'id'>): CatalogEntry {
  return {
    tool: 'claude-code',
    kind: 'first-party',
    name: overrides.name ?? overrides.id,
    description: overrides.description,
    version: overrides.version,
    author: overrides.author,
    homepage: overrides.homepage,
    source_url: overrides.source_url ?? `https://example.com/${overrides.id}`,
    metadata: overrides.metadata ?? { extra: {} },
    fetched_at: overrides.fetched_at ?? FROZEN_TS,
    ...overrides,
  }
}

function snapshot(entries: CatalogEntry[]): SnapshotFile {
  const map: Record<string, CatalogEntry> = {}
  for (const e of entries) {
    map[`${e.tool}/${e.kind}/${e.id}`] = e
  }
  return { schema_version: 1, generated_at: FROZEN_TS, entries: map }
}

describe('diff', () => {
  it('returns N added events when prior snapshot is empty', () => {
    const prev = snapshot([])
    const curr = [entry({ id: 'a' }), entry({ id: 'b' })]
    const events = diff(prev, curr, FROZEN_TS)
    expect(events).toHaveLength(2)
    expect(events.every((e) => e.type === 'added')).toBe(true)
  })

  it('returns empty array when snapshots are identical', () => {
    const entries = [entry({ id: 'a' }), entry({ id: 'b' })]
    const prev = snapshot(entries)
    const events = diff(prev, entries, FROZEN_TS)
    expect(events).toEqual([])
  })

  it('returns empty array when only order differs', () => {
    const prev = snapshot([entry({ id: 'a' }), entry({ id: 'b' })])
    const curr = [entry({ id: 'b' }), entry({ id: 'a' })]
    expect(diff(prev, curr, FROZEN_TS)).toEqual([])
  })

  it('detects removed entries', () => {
    const prev = snapshot([entry({ id: 'a' }), entry({ id: 'b' })])
    const curr = [entry({ id: 'a' })]
    const events = diff(prev, curr, FROZEN_TS)
    expect(events).toHaveLength(1)
    expect(events[0]!.type).toBe('removed')
    expect(events[0]!.key).toBe('claude-code/first-party/b')
  })

  it('detects updated entries with field-level diff', () => {
    const prev = snapshot([entry({ id: 'a', description: 'old', version: '1.0.0' })])
    const curr = [entry({ id: 'a', description: 'new', version: '1.1.0' })]
    const events = diff(prev, curr, FROZEN_TS)
    expect(events).toHaveLength(1)
    const updated = events[0]!
    expect(updated.type).toBe('updated')
    if (updated.type !== 'updated') throw new Error('guard')
    const paths = updated.changes.map((c) => c.path).sort()
    expect(paths).toEqual(['description', 'version'])
    const descChange = updated.changes.find((c) => c.path === 'description')!
    expect(descChange.before).toBe('old')
    expect(descChange.after).toBe('new')
  })

  it('ignores source_url and fetched_at changes', () => {
    const prev = snapshot([entry({ id: 'a', source_url: 'https://old' })])
    const curr = [entry({ id: 'a', source_url: 'https://new', fetched_at: '2099-01-01T00:00:00.000Z' })]
    expect(diff(prev, curr, FROZEN_TS)).toEqual([])
  })

  it('detects metadata.extra field changes', () => {
    const prev = snapshot([entry({ id: 'a', metadata: { extra: { author_email: 'a@x.com' } } })])
    const curr = [entry({ id: 'a', metadata: { extra: { author_email: 'b@x.com' } } })]
    const events = diff(prev, curr, FROZEN_TS)
    expect(events).toHaveLength(1)
    expect(events[0]!.type).toBe('updated')
    if (events[0]!.type !== 'updated') throw new Error('guard')
    expect(events[0]!.changes.map((c) => c.path)).toEqual(['metadata.extra.author_email'])
  })

  it('handles builtin/ prefixed IDs (slash in id)', () => {
    const builtinEntry = entry({ id: 'builtin/simplify', metadata: { extra: { builtin: true } } })
    const prev = snapshot([])
    const events = diff(prev, [builtinEntry], FROZEN_TS)
    expect(events).toHaveLength(1)
    expect(events[0]!.type).toBe('added')
    expect(events[0]!.key).toBe('claude-code/first-party/builtin/simplify')
  })

  it('detects removal of builtin/ prefixed entries', () => {
    const builtinEntry = entry({ id: 'builtin/loop', metadata: { extra: { builtin: true } } })
    const prev = snapshot([entry({ id: 'a' }), builtinEntry])
    // claude-code tool is still present (entry 'a'), but builtin/loop was removed
    const curr = [entry({ id: 'a' })]
    const events = diff(prev, curr, FROZEN_TS)
    expect(events).toHaveLength(1)
    expect(events[0]!.type).toBe('removed')
    expect(events[0]!.key).toBe('claude-code/first-party/builtin/loop')
  })

  it('skips removals for a tool when current fetch returned zero entries', () => {
    const prev = snapshot([
      entry({ id: 'a' }),
      { ...entry({ id: 'x' }), tool: 'cursor' as const },
    ])
    // Cursor returned nothing (transient failure), Claude Code returned its entry
    const curr = [entry({ id: 'a' })]
    const events = diff(prev, curr, FROZEN_TS)
    // Should NOT emit 'removed' for cursor entry
    expect(events).toEqual([])
  })
})
