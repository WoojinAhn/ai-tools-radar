// poller/src/sources/cursor-marketplace.ts
import { fetchHtml } from './http.js'
import type { CatalogEntry, Source } from './types.js'

const MARKETPLACE_URL = 'https://cursor.com/marketplace'
const CURSOR_FIRST_PARTY_PREFIX = 'https://github.com/cursor/plugins'

/**
 * Regex to extract individual plugin objects from the RSC payload.
 * Captures: name, displayName, description, status, repositoryUrl
 */
const PLUGIN_RE =
  /"name":"([^"]+)","displayName":"([^"]+)","description":"((?:[^"\\]|\\.)*)","status":"([^"]+)","repositoryUrl":"([^"]*)"/g

export function parseMarketplace(html: string): CatalogEntry[] {
  const payloadMatch = html.match(/initialPlugins[^<]*/)
  if (!payloadMatch) return []

  const payload = payloadMatch[0]!.replace(/\\"/g, '"')
  const entries: CatalogEntry[] = []
  const seen = new Set<string>()
  const now = new Date().toISOString()

  let match: RegExpExecArray | null
  while ((match = PLUGIN_RE.exec(payload)) !== null) {
    const name = match[1]!
    const displayName = match[2]!
    const rawDescription = match[3]!
    const repositoryUrl = match[5]!

    if (seen.has(name)) continue
    seen.add(name)

    const kind = repositoryUrl.startsWith(CURSOR_FIRST_PARTY_PREFIX)
      ? 'first-party' as const
      : 'third-party' as const

    // Try to extract tags for this plugin
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const tagsRe = new RegExp(`"name":"${escapedName}"[^}]*?"tags":\\[([^\\]]*)\\]`)
    const tagsMatch = tagsRe.exec(payload)
    const tags: string[] = tagsMatch
      ? tagsMatch[1]!.split(',').map((t) => t.replace(/"/g, '').trim()).filter(Boolean)
      : []

    const description = rawDescription.replace(/\\n/g, '\n')

    entries.push({
      tool: 'cursor',
      kind,
      id: name,
      name: displayName,
      description,
      source_url: repositoryUrl,
      metadata: {
        extra: { displayName, tags },
      },
      fetched_at: now,
    })
  }

  return entries
}

export class CursorMarketplaceSource implements Source {
  readonly tool = 'cursor' as const
  readonly id = 'cursor-marketplace'

  async fetch(): Promise<CatalogEntry[]> {
    try {
      console.log('[cursor-marketplace] fetching marketplace page')
      const html = await fetchHtml(MARKETPLACE_URL)
      const entries = parseMarketplace(html)
      console.log(`[cursor-marketplace] found ${entries.length} plugins`)
      return entries
    } catch (err) {
      console.warn('[cursor-marketplace] fetch failed, returning empty:', err)
      return []
    }
  }
}
