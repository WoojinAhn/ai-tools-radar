// poller/test/sources/claude-plugins.test.ts
import { describe, it, expect, vi } from 'vitest'
import { ClaudePluginsSource } from '../../src/sources/claude-plugins.js'
import type { Octokit } from '@octokit/rest'

function mockOctokit(responses: Record<string, unknown>): Octokit {
  const getContent = vi.fn(async ({ path }: { path: string }) => {
    const data = responses[path]
    if (data === undefined) {
      const err = new Error(`not found: ${path}`) as Error & { status: number }
      err.status = 404
      throw err
    }
    return { data }
  })
  return { rest: { repos: { getContent } } } as unknown as Octokit
}

describe('ClaudePluginsSource', () => {
  it('maps plugin.json into CatalogEntry', async () => {
    const octokit = mockOctokit({
      plugins: [{ name: 'code-review', type: 'dir', html_url: 'https://github.com/anthropics/claude-plugins-official/tree/main/plugins/code-review' }],
      external_plugins: [],
      'plugins/code-review/.claude-plugin/plugin.json': {
        type: 'file',
        content: Buffer.from(
          JSON.stringify({
            name: 'code-review',
            description: 'Automated code review',
            author: { name: 'Anthropic', email: 'support@anthropic.com' },
          }),
        ).toString('base64'),
        encoding: 'base64',
      },
    })

    const src = new ClaudePluginsSource(octokit, () => '2026-04-09T00:00:00.000Z')
    const entries = await src.fetch()

    expect(entries).toHaveLength(1)
    const entry = entries[0]!
    expect(entry.tool).toBe('claude-code')
    expect(entry.kind).toBe('first-party')
    expect(entry.id).toBe('code-review')
    expect(entry.name).toBe('code-review')
    expect(entry.description).toBe('Automated code review')
    expect(entry.author).toBe('Anthropic')
    expect(entry.source_url).toContain('code-review')
    expect(entry.metadata.extra).toMatchObject({ author_email: 'support@anthropic.com' })
  })

  it('falls back to directory name when plugin.json is missing', async () => {
    const octokit = mockOctokit({
      plugins: [{ name: 'broken', type: 'dir', html_url: 'https://example.com/broken' }],
      external_plugins: [],
      // plugin.json omitted → 404
    })
    const src = new ClaudePluginsSource(octokit, () => '2026-04-09T00:00:00.000Z')
    const entries = await src.fetch()
    expect(entries).toHaveLength(1)
    expect(entries[0]!.id).toBe('broken')
    expect(entries[0]!.name).toBe('broken')
  })

  it('handles author as a string (not object)', async () => {
    const octokit = mockOctokit({
      plugins: [{ name: 'p', type: 'dir', html_url: 'https://x' }],
      external_plugins: [],
      'plugins/p/.claude-plugin/plugin.json': {
        type: 'file',
        content: Buffer.from(JSON.stringify({ name: 'p', author: 'Someone' })).toString('base64'),
        encoding: 'base64',
      },
    })
    const src = new ClaudePluginsSource(octokit, () => '2026-04-09T00:00:00.000Z')
    const entries = await src.fetch()
    expect(entries[0]!.author).toBe('Someone')
  })

  it('separates first-party and third-party', async () => {
    const octokit = mockOctokit({
      plugins: [{ name: 'a', type: 'dir', html_url: 'https://x/a' }],
      external_plugins: [{ name: 'b', type: 'dir', html_url: 'https://x/b' }],
      'plugins/a/.claude-plugin/plugin.json': {
        type: 'file',
        content: Buffer.from(JSON.stringify({ name: 'a' })).toString('base64'),
        encoding: 'base64',
      },
      'external_plugins/b/.claude-plugin/plugin.json': {
        type: 'file',
        content: Buffer.from(JSON.stringify({ name: 'b' })).toString('base64'),
        encoding: 'base64',
      },
    })
    const src = new ClaudePluginsSource(octokit, () => '2026-04-09T00:00:00.000Z')
    const entries = await src.fetch()
    const aEntry = entries.find((e) => e.id === 'a')!
    const bEntry = entries.find((e) => e.id === 'b')!
    expect(aEntry.kind).toBe('first-party')
    expect(bEntry.kind).toBe('third-party')
  })
})
