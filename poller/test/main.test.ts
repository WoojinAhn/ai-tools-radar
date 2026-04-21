// poller/test/main.test.ts
import { describe, it, expect, vi } from 'vitest'
import { fetchAllSources, ownerSourceId, preserveFromFailedSources } from '../src/main.js'
import type { CatalogEntry, EntryKind, Source, ToolId } from '../src/sources/types.js'

const NOW = '2026-04-22T00:00:00.000Z'

function entry(tool: ToolId, id: string, opts: { kind?: EntryKind; builtin?: boolean } = {}): CatalogEntry {
  const extra: Record<string, unknown> = {}
  if (opts.builtin) extra.builtin = true
  return {
    tool,
    kind: opts.kind ?? 'first-party',
    id,
    name: id,
    source_url: `https://example.invalid/${id}`,
    metadata: { extra },
    fetched_at: NOW,
  }
}

function ok(id: string, entries: CatalogEntry[], tool: ToolId = 'claude-code'): Source {
  return { tool, id, fetch: async () => entries }
}

function fail(id: string, tool: ToolId = 'claude-code', message = 'boom'): Source {
  return { tool, id, fetch: async () => { throw new Error(message) } }
}

describe('fetchAllSources', () => {
  it('isolates a failing source and continues with others', async () => {
    const sources: Source[] = [
      ok('source-a', [entry('claude-code', 'a1'), entry('claude-code', 'a2')]),
      fail('source-b'),
      ok('source-c', [entry('cursor', 'c1')], 'cursor'),
    ]
    const { entries, failedSourceIds } = await fetchAllSources(sources)
    expect(entries.map((e) => e.id).sort()).toEqual(['a1', 'a2', 'c1'])
    expect([...failedSourceIds]).toEqual(['source-b'])
  })

  it('throws when every source fails', async () => {
    const sources: Source[] = [fail('source-a'), fail('source-b')]
    await expect(fetchAllSources(sources)).rejects.toThrow(/all 2 sources failed/)
  })

  it('returns empty result when there are no sources', async () => {
    const { entries, failedSourceIds } = await fetchAllSources([])
    expect(entries).toEqual([])
    expect(failedSourceIds.size).toBe(0)
  })

  it('does not short-circuit — every source is tried even after one fails', async () => {
    const cFetch = vi.fn(async () => [entry('cursor', 'c1')])
    const sources: Source[] = [fail('source-a'), { tool: 'cursor', id: 'source-c', fetch: cFetch }]
    await fetchAllSources(sources)
    expect(cFetch).toHaveBeenCalledOnce()
  })
})

describe('ownerSourceId', () => {
  it('attributes claude-code built-in skills to claude-code-builtin', () => {
    expect(ownerSourceId(entry('claude-code', 'debug', { builtin: true }))).toBe('claude-code-builtin')
  })

  it('attributes claude-code non-builtin to claude-plugins-official', () => {
    expect(ownerSourceId(entry('claude-code', 'autofix-bot', { kind: 'third-party' }))).toBe(
      'anthropics/claude-plugins-official',
    )
  })

  it('attributes cursor first-party to cursor-builtin-commands', () => {
    expect(ownerSourceId(entry('cursor', '/debug', { kind: 'first-party' }))).toBe('cursor-builtin-commands')
  })

  it('attributes cursor third-party to cursor-marketplace', () => {
    expect(ownerSourceId(entry('cursor', 'shadcn/ui', { kind: 'third-party' }))).toBe('cursor-marketplace')
  })
})

describe('preserveFromFailedSources', () => {
  const builtinDebug = entry('claude-code', 'debug', { builtin: true })
  const pluginAutofix = entry('claude-code', 'autofix-bot', { kind: 'third-party' })
  const prev = {
    [`claude-code/first-party/debug`]: builtinDebug,
    [`claude-code/third-party/autofix-bot`]: pluginAutofix,
  }

  it('preserves only entries owned by the failed source, not all entries of the same tool', () => {
    // claude-code-builtin failed; claude-plugins-official succeeded with ZERO autofix-bot (dropped upstream).
    const result = preserveFromFailedSources([], prev, new Set(['claude-code-builtin']))
    const ids = result.map((e) => e.id).sort()
    expect(ids).toEqual(['debug']) // autofix-bot must NOT be preserved
  })

  it('does not duplicate entries that the current fetch already produced', () => {
    const refreshed = entry('claude-code', 'debug', { builtin: true })
    const result = preserveFromFailedSources([refreshed], prev, new Set(['claude-code-builtin']))
    const debugs = result.filter((e) => e.id === 'debug')
    expect(debugs).toHaveLength(1)
  })

  it('returns fetched unchanged when no sources failed', () => {
    const fetched = [pluginAutofix]
    expect(preserveFromFailedSources(fetched, prev, new Set())).toBe(fetched)
  })
})
