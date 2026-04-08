// poller/src/sources/claude-plugins.ts
import type { Octokit } from '@octokit/rest'
import type { CatalogEntry, EntryKind, Source } from './types.js'

const OWNER = 'anthropics'
const REPO = 'claude-plugins-official'

interface RawPluginJson {
  name?: string
  description?: string
  version?: string
  author?: string | { name?: string; email?: string }
  homepage?: string
  [key: string]: unknown
}

type ContentItem = { name: string; type: string; html_url?: string | null }

export class ClaudePluginsSource implements Source {
  readonly tool = 'claude-code' as const
  readonly id = 'anthropics/claude-plugins-official'

  constructor(
    private readonly octokit: Octokit,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async fetch(): Promise<CatalogEntry[]> {
    const [firstParty, thirdParty] = await Promise.all([
      this.listDir('plugins', 'first-party'),
      this.listDir('external_plugins', 'third-party'),
    ])
    return [...firstParty, ...thirdParty]
  }

  private async listDir(path: string, kind: EntryKind): Promise<CatalogEntry[]> {
    const { data } = await this.octokit.rest.repos.getContent({ owner: OWNER, repo: REPO, path })
    if (!Array.isArray(data)) {
      throw new Error(`expected array for ${path}, got ${typeof data}`)
    }
    const dirs = (data as ContentItem[]).filter((item) => item.type === 'dir')
    const entries: CatalogEntry[] = []
    for (const dir of dirs) {
      entries.push(await this.loadEntry(path, kind, dir))
    }
    return entries
  }

  private async loadEntry(basePath: string, kind: EntryKind, dir: ContentItem): Promise<CatalogEntry> {
    const pluginJsonPath = `${basePath}/${dir.name}/.claude-plugin/plugin.json`
    const raw = await this.tryReadPluginJson(pluginJsonPath)
    const sourceUrl = dir.html_url ?? `https://github.com/${OWNER}/${REPO}/tree/main/${basePath}/${dir.name}`

    if (!raw) {
      console.warn(`[claude-plugins] ${pluginJsonPath}: missing or malformed, using fallback`)
      return {
        tool: 'claude-code',
        kind,
        id: dir.name,
        name: dir.name,
        source_url: sourceUrl,
        metadata: { extra: {} },
        fetched_at: this.now(),
      }
    }

    return this.normalize(raw, kind, dir.name, sourceUrl)
  }

  private async tryReadPluginJson(path: string): Promise<RawPluginJson | null> {
    try {
      const { data } = await this.octokit.rest.repos.getContent({ owner: OWNER, repo: REPO, path })
      // data may be array (dir listing) or a file object — guard accordingly
      if (Array.isArray(data)) return null
      // Narrow to file-like shape; Octokit union types include blob/tree without content
      const file = data as { type?: string; content?: string; encoding?: string }
      if (file.type !== 'file' || typeof file.content !== 'string') return null
      const decoded = Buffer.from(file.content, (file.encoding ?? 'base64') as BufferEncoding).toString('utf8')
      return JSON.parse(decoded) as RawPluginJson
    } catch (err) {
      const status = (err as { status?: number }).status
      if (status === 404) return null
      console.warn(`[claude-plugins] ${path}: ${(err as Error).message}`)
      return null
    }
  }

  private normalize(raw: RawPluginJson, kind: EntryKind, id: string, sourceUrl: string): CatalogEntry {
    const KNOWN_KEYS = new Set(['name', 'description', 'version', 'author', 'homepage'])
    const extra: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(raw)) {
      if (!KNOWN_KEYS.has(k)) extra[k] = v
    }

    let author: string | undefined
    let authorEmail: string | undefined
    if (typeof raw.author === 'string') {
      author = raw.author
    } else if (raw.author && typeof raw.author === 'object') {
      author = raw.author.name
      authorEmail = raw.author.email
    }
    if (authorEmail) extra.author_email = authorEmail

    return {
      tool: 'claude-code',
      kind,
      id,
      name: raw.name ?? id,
      description: raw.description,
      version: raw.version,
      author,
      homepage: raw.homepage,
      source_url: sourceUrl,
      metadata: { extra },
      fetched_at: this.now(),
    }
  }
}
