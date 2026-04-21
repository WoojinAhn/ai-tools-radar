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

    const existingLocalDirs = await this.listLocalPluginDirs()
    const filtered = marketplace.plugins.filter((p) => this.hasValidLocalSource(p, existingLocalDirs))
    const dropped = marketplace.plugins.length - filtered.length
    if (dropped > 0) {
      console.warn(`[claude-plugins] dropped ${dropped} entries with missing local source directory`)
    }
    return filtered.map((p) => this.normalize(p))
  }

  private async listLocalPluginDirs(): Promise<Set<string> | null> {
    const dirs = await Promise.all([
      this.listDir('plugins'),
      this.listDir('external_plugins'),
    ])
    // Fail open: if either listing failed, skip filtering to avoid false removals from transient errors.
    if (dirs.some((d) => d === null)) return null
    const set = new Set<string>()
    for (const [parent, names] of [['plugins', dirs[0]!], ['external_plugins', dirs[1]!]] as const) {
      for (const n of names) set.add(`${parent}/${n}`)
    }
    return set
  }

  private async listDir(path: string): Promise<string[] | null> {
    try {
      const { data } = await this.octokit.rest.repos.getContent({ owner: OWNER, repo: REPO, path })
      if (!Array.isArray(data)) return null
      return data.filter((x) => x.type === 'dir').map((x) => x.name)
    } catch (err) {
      console.warn(`[claude-plugins] listDir ${path}: ${(err as Error).message}`)
      return null
    }
  }

  private hasValidLocalSource(p: MarketplacePlugin, existing: Set<string> | null): boolean {
    if (existing === null) return true
    if (typeof p.source !== 'string') return true
    const rel = p.source.replace(/^\.\//, '').replace(/\/$/, '')
    if (!rel.startsWith('plugins/') && !rel.startsWith('external_plugins/')) return true
    if (existing.has(rel)) return true
    console.warn(`[claude-plugins] dropping "${p.name}": source directory ${rel} does not exist`)
    return false
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
