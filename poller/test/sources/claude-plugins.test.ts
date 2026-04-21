// poller/test/sources/claude-plugins.test.ts
import { describe, it, expect, vi } from 'vitest'
import { ClaudePluginsSource } from '../../src/sources/claude-plugins.js'
import type { Octokit } from '@octokit/rest'

function mockOctokit(marketplaceJson: unknown, dirs?: { plugins?: string[]; external_plugins?: string[] }): Octokit {
  const plugins = dirs?.plugins ?? []
  const external = dirs?.external_plugins ?? []
  const getContent = vi.fn(async (args: { path: string }) => {
    if (args.path === '.claude-plugin/marketplace.json') {
      return {
        data: {
          type: 'file',
          content: Buffer.from(JSON.stringify(marketplaceJson)).toString('base64'),
          encoding: 'base64',
        },
      }
    }
    if (args.path === 'plugins') {
      return { data: plugins.map((name) => ({ type: 'dir', name })) }
    }
    if (args.path === 'external_plugins') {
      return { data: external.map((name) => ({ type: 'dir', name })) }
    }
    throw Object.assign(new Error(`unexpected path ${args.path}`), { status: 404 })
  })
  return { rest: { repos: { getContent } } } as unknown as Octokit
}

const NOW = '2026-04-11T00:00:00.000Z'

describe('ClaudePluginsSource', () => {
  it('reads marketplace.json and returns all plugins', async () => {
    const octokit = mockOctokit(
      {
        plugins: [
          { name: 'code-review', description: 'Automated code review', author: { name: 'Anthropic', email: 'support@anthropic.com' }, source: './plugins/code-review', category: 'development' },
          { name: 'superpowers', description: 'Core skills library', source: { source: 'url', url: 'https://github.com/obra/superpowers.git' }, homepage: 'https://github.com/obra/superpowers' },
        ],
      },
      { plugins: ['code-review'] },
    )
    const src = new ClaudePluginsSource(octokit, () => NOW)
    const entries = await src.fetch()

    expect(entries).toHaveLength(2)
  })

  it('maps local plugin as first-party', async () => {
    const octokit = mockOctokit(
      {
        plugins: [
          { name: 'code-review', description: 'Review', author: { name: 'Anthropic' }, source: './plugins/code-review' },
        ],
      },
      { plugins: ['code-review'] },
    )
    const src = new ClaudePluginsSource(octokit, () => NOW)
    const entries = await src.fetch()

    expect(entries[0]!.kind).toBe('first-party')
    expect(entries[0]!.source_url).toContain('plugins/code-review')
  })

  it('maps external plugin as third-party', async () => {
    const octokit = mockOctokit({
      plugins: [
        { name: 'superpowers', description: 'Skills', source: { source: 'url', url: 'https://github.com/obra/superpowers.git' } },
      ],
    })
    const src = new ClaudePluginsSource(octokit, () => NOW)
    const entries = await src.fetch()

    expect(entries[0]!.kind).toBe('third-party')
    expect(entries[0]!.source_url).toBe('https://github.com/obra/superpowers')
  })

  it('maps external_plugins/ path as third-party', async () => {
    const octokit = mockOctokit(
      {
        plugins: [
          { name: 'context7', description: 'Docs', source: './external_plugins/context7' },
        ],
      },
      { external_plugins: ['context7'] },
    )
    const src = new ClaudePluginsSource(octokit, () => NOW)
    const entries = await src.fetch()
    expect(entries[0]!.kind).toBe('third-party')
  })

  it('handles author as string', async () => {
    const octokit = mockOctokit(
      {
        plugins: [
          { name: 'p', description: 'desc', author: 'Someone', source: './plugins/p' },
        ],
      },
      { plugins: ['p'] },
    )
    const src = new ClaudePluginsSource(octokit, () => NOW)
    const entries = await src.fetch()
    expect(entries[0]!.author).toBe('Someone')
  })

  it('extracts source_url from git-subdir source', async () => {
    const octokit = mockOctokit({
      plugins: [
        { name: 'stripe', description: 'Payments', source: { source: 'git-subdir', url: 'stripe/ai', path: 'providers/claude/plugin', ref: 'main' } },
      ],
    })
    const src = new ClaudePluginsSource(octokit, () => NOW)
    const entries = await src.fetch()
    expect(entries[0]!.source_url).toBe('https://github.com/stripe/ai')
  })

  it('extracts source_url from github source', async () => {
    const octokit = mockOctokit({
      plugins: [
        { name: 'stagehand', description: 'Browser', source: { source: 'github', repo: 'browserbase/agent-browse' } },
      ],
    })
    const src = new ClaudePluginsSource(octokit, () => NOW)
    const entries = await src.fetch()
    expect(entries[0]!.source_url).toBe('https://github.com/browserbase/agent-browse')
  })

  it('stores category in metadata.extra', async () => {
    const octokit = mockOctokit(
      {
        plugins: [
          { name: 'p', description: 'desc', source: './plugins/p', category: 'development' },
        ],
      },
      { plugins: ['p'] },
    )
    const src = new ClaudePluginsSource(octokit, () => NOW)
    const entries = await src.fetch()
    expect(entries[0]!.metadata.extra).toMatchObject({ category: 'development' })
  })

  it('drops entries whose local source directory is missing upstream', async () => {
    const octokit = mockOctokit(
      {
        plugins: [
          { name: 'autofix-bot', description: 'Stale', source: './external_plugins/autofix-bot' },
          { name: 'context7', description: 'Docs', source: './external_plugins/context7' },
          { name: 'code-review', description: 'Review', source: './plugins/code-review' },
        ],
      },
      { plugins: ['code-review'], external_plugins: ['context7'] },
    )
    const src = new ClaudePluginsSource(octokit, () => NOW)
    const entries = await src.fetch()
    const ids = entries.map((e) => e.id).sort()
    expect(ids).toEqual(['code-review', 'context7'])
  })

  it('fails open when directory listing fails (no filtering)', async () => {
    const getContent = vi.fn(async (args: { path: string }) => {
      if (args.path === '.claude-plugin/marketplace.json') {
        return {
          data: {
            type: 'file',
            content: Buffer.from(JSON.stringify({
              plugins: [
                { name: 'autofix-bot', description: 'Stale', source: './external_plugins/autofix-bot' },
                { name: 'context7', description: 'Docs', source: './external_plugins/context7' },
              ],
            })).toString('base64'),
            encoding: 'base64',
          },
        }
      }
      throw Object.assign(new Error('rate limited'), { status: 403 })
    })
    const octokit = { rest: { repos: { getContent } } } as unknown as Octokit
    const src = new ClaudePluginsSource(octokit, () => NOW)
    const entries = await src.fetch()
    expect(entries).toHaveLength(2)
  })

  it('returns empty array when marketplace.json is missing', async () => {
    const getContent = vi.fn(async () => { throw Object.assign(new Error('not found'), { status: 404 }) })
    const octokit = { rest: { repos: { getContent } } } as unknown as Octokit
    const src = new ClaudePluginsSource(octokit, () => NOW)
    const entries = await src.fetch()
    expect(entries).toEqual([])
  })
})
