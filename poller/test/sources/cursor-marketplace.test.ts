// poller/test/sources/cursor-marketplace.test.ts
import { describe, it, expect } from 'vitest'
import { parseMarketplace } from '../../src/sources/cursor-marketplace.js'

/**
 * Build a mock RSC HTML page with the given plugin JSON fragments
 * embedded inside an initialPlugins array.
 */
function mockRscHtml(plugins: string[]): string {
  const joined = plugins.join(',')
  return `<!DOCTYPE html><html><body><script>self.__next_f.push([1,"6:[\\"$\\",\\"$L3c\\",null,{\\"initialPlugins\\":[${joined}]}]"]) more html</script></body></html>`
}

const THIRD_PARTY_PLUGIN = `{\\"id\\":\\"123\\",\\"name\\":\\"stripe\\",\\"displayName\\":\\"Stripe\\",\\"description\\":\\"Payment processing.\\",\\"status\\":\\"PLUGIN_STATUS_APPROVED\\",\\"repositoryUrl\\":\\"https://github.com/stripe/ai\\",\\"tags\\":[\\"payments\\"],\\"logoUrl\\":\\"https://example.com/logo.png\\",\\"isPublished\\":true,\\"createdAt\\":\\"1700000000\\",\\"updatedAt\\":\\"1700000001\\",\\"publisherId\\":\\"6\\",\\"publisher\\":{\\"id\\":\\"6\\",\\"name\\":\\"stripe\\"}}`

const FIRST_PARTY_PLUGIN = `{\\"id\\":\\"456\\",\\"name\\":\\"cursor-tab\\",\\"displayName\\":\\"Cursor Tab\\",\\"description\\":\\"Smart autocomplete.\\",\\"status\\":\\"PLUGIN_STATUS_APPROVED\\",\\"repositoryUrl\\":\\"https://github.com/cursor/plugins\\",\\"tags\\":[\\"editor\\",\\"ai\\"],\\"logoUrl\\":\\"https://example.com/logo2.png\\",\\"isPublished\\":true,\\"createdAt\\":\\"1700000000\\",\\"updatedAt\\":\\"1700000001\\",\\"publisherId\\":\\"1\\",\\"publisher\\":{\\"id\\":\\"1\\",\\"name\\":\\"cursor\\"}}`

describe('parseMarketplace', () => {
  it('extracts plugin from RSC payload', () => {
    const html = mockRscHtml([THIRD_PARTY_PLUGIN])
    const entries = parseMarketplace(html)

    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      tool: 'cursor',
      kind: 'third-party',
      id: 'stripe',
      name: 'Stripe',
      description: 'Payment processing.',
      source_url: 'https://github.com/stripe/ai',
    })
  })

  it('detects first-party by repositoryUrl containing cursor/plugins', () => {
    const html = mockRscHtml([FIRST_PARTY_PLUGIN])
    const entries = parseMarketplace(html)

    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      tool: 'cursor',
      kind: 'first-party',
      id: 'cursor-tab',
      name: 'Cursor Tab',
    })
  })

  it('returns empty array when no initialPlugins found', () => {
    const html = '<html><body>No plugins here</body></html>'
    const entries = parseMarketplace(html)
    expect(entries).toEqual([])
  })

  it('stores displayName and tags in metadata.extra', () => {
    const html = mockRscHtml([THIRD_PARTY_PLUGIN])
    const entries = parseMarketplace(html)

    expect(entries[0]!.metadata.extra).toEqual({
      displayName: 'Stripe',
      tags: ['payments'],
    })
  })

  it('stores multiple tags when present', () => {
    const html = mockRscHtml([FIRST_PARTY_PLUGIN])
    const entries = parseMarketplace(html)

    expect(entries[0]!.metadata.extra).toEqual({
      displayName: 'Cursor Tab',
      tags: ['editor', 'ai'],
    })
  })

  it('deduplicates plugins by name', () => {
    const html = mockRscHtml([THIRD_PARTY_PLUGIN, THIRD_PARTY_PLUGIN])
    const entries = parseMarketplace(html)
    expect(entries).toHaveLength(1)
  })

  it('handles multiple different plugins', () => {
    const html = mockRscHtml([THIRD_PARTY_PLUGIN, FIRST_PARTY_PLUGIN])
    const entries = parseMarketplace(html)

    expect(entries).toHaveLength(2)
    expect(entries.map((e) => e.id).sort()).toEqual(['cursor-tab', 'stripe'])
  })
})
