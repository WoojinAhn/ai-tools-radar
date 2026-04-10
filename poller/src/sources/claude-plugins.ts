// poller/src/sources/claude-plugins.ts
import type { Octokit } from '@octokit/rest'
import type { CatalogEntry, EntryKind, Source } from './types.js'

const OWNER = 'anthropics'
const REPO = 'claude-plugins-official'

interface MarketplacePlugin {
  name: string
  description?: string
  author?: string | { name?: string; email?: string }
  source: string | { source: string; url?: string; repo?: string; path?: string }
  category?: string
  homepage?: string
}

interface MarketplaceJson {
  plugins: MarketplacePlugin[]
}

export class ClaudePluginsSource implements Source {
  readonly tool = 'claude-code' as const
  readonly id = 'anthropics/claude-plugins-official'

  constructor(
    private readonly octokit: Octokit,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async fetch(): Promise<CatalogEntry[]> {
    const marketplace = await this.readMarketplaceJson()
    if (!marketplace) {
      console.warn('[claude-plugins] marketplace.json: missing or malformed')
      return []
    }
    console.log(`[claude-plugins] marketplace.json: ${marketplace.plugins.length} plugins`)
    return marketplace.plugins.map((p) => this.normalize(p))
  }

  private async readMarketplaceJson(): Promise<MarketplaceJson | null> {
    try {
      const { data } = await this.octokit.rest.repos.getContent({
        owner: OWNER,
        repo: REPO,
        path: '.claude-plugin/marketplace.json',
      })
      if (Array.isArray(data)) return null
      const file = data as { type?: string; content?: string; encoding?: string }
      if (file.type !== 'file' || typeof file.content !== 'string') return null
      const decoded = Buffer.from(file.content, (file.encoding ?? 'base64') as BufferEncoding).toString('utf8')
      return JSON.parse(decoded) as MarketplaceJson
    } catch (err) {
      console.warn(`[claude-plugins] marketplace.json: ${(err as Error).message}`)
      return null
    }
  }

  private normalize(p: MarketplacePlugin): CatalogEntry {
    const kind: EntryKind = this.detectKind(p)
    const sourceUrl = this.extractSourceUrl(p)

    let author: string | undefined
    let authorEmail: string | undefined
    if (typeof p.author === 'string') {
      author = p.author
    } else if (p.author && typeof p.author === 'object') {
      author = p.author.name
      authorEmail = p.author.email
    }

    const extra: Record<string, unknown> = {}
    if (p.category) extra.category = p.category
    if (authorEmail) extra.author_email = authorEmail

    return {
      tool: 'claude-code',
      kind,
      id: p.name,
      name: p.name,
      description: p.description,
      homepage: p.homepage,
      author,
      source_url: sourceUrl,
      metadata: { extra },
      fetched_at: this.now(),
    }
  }

  private detectKind(p: MarketplacePlugin): EntryKind {
    // Local source (string starting with ./) = first-party in the official repo
    if (typeof p.source === 'string') {
      if (p.source.startsWith('./external_plugins/')) return 'third-party'
      return 'first-party'
    }
    // External source (dict) = third-party
    return 'third-party'
  }

  private extractSourceUrl(p: MarketplacePlugin): string {
    if (typeof p.source === 'string') {
      return `https://github.com/${OWNER}/${REPO}/tree/main/${p.source.replace(/^\.\//, '')}`
    }
    const src = p.source
    if (src.url) {
      const url = src.url.replace(/\.git$/, '')
      return url.startsWith('http') ? url : `https://github.com/${url}`
    }
    if (src.repo) {
      return `https://github.com/${src.repo}`
    }
    return `https://github.com/${OWNER}/${REPO}`
  }
}
