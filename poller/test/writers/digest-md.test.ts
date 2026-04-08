// poller/test/writers/digest-md.test.ts
import { describe, it, expect } from 'vitest'
import { renderDigest } from '../../src/writers/digest-md.js'
import type { CatalogEntry, Event } from '../../src/sources/types.js'

function entry(id: string, overrides: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    tool: 'claude-code',
    kind: 'first-party',
    id,
    name: overrides.name ?? id,
    description: overrides.description,
    source_url: overrides.source_url ?? `https://github.com/anthropics/claude-plugins-official/tree/main/plugins/${id}`,
    metadata: { extra: {} },
    fetched_at: '2026-04-09T00:00:00.000Z',
    ...overrides,
  }
}

describe('renderDigest', () => {
  it('produces frontmatter with correct counts', () => {
    const events: Event[] = [
      { ts: '2026-04-09T00:00:00.000Z', type: 'added', key: 'claude-code/first-party/a', entry: entry('a') },
      { ts: '2026-04-09T00:00:00.000Z', type: 'added', key: 'claude-code/first-party/b', entry: entry('b') },
      {
        ts: '2026-04-09T00:00:00.000Z',
        type: 'updated',
        key: 'claude-code/first-party/c',
        changes: [{ path: 'version', before: '1.0.0', after: '1.1.0' }],
      },
    ]
    const md = renderDigest(events, '2026-04-09')
    expect(md).toContain('---\ndate: 2026-04-09\nadded: 2\nremoved: 0\nupdated: 1\n---')
    expect(md).toContain('## Added (2)')
    expect(md).toContain('## Updated (1)')
    expect(md).toContain('`version`: `1.0.0` → `1.1.0`')
  })

  it('renders empty sections as "(none)"', () => {
    const events: Event[] = [
      { ts: '2026-04-09T00:00:00.000Z', type: 'added', key: 'claude-code/first-party/a', entry: entry('a') },
    ]
    const md = renderDigest(events, '2026-04-09')
    expect(md).toContain('## Removed (0)\n\n_(none)_')
    expect(md).toContain('## Updated (0)\n\n_(none)_')
  })

  it('links added entries with their source_url', () => {
    const events: Event[] = [
      {
        ts: '2026-04-09T00:00:00.000Z',
        type: 'added',
        key: 'claude-code/first-party/foo',
        entry: entry('foo', { name: 'Foo', description: 'A foo plugin', source_url: 'https://example.com/foo' }),
      },
    ]
    const md = renderDigest(events, '2026-04-09')
    expect(md).toContain('[Foo](https://example.com/foo)')
    expect(md).toContain('A foo plugin')
  })
})
