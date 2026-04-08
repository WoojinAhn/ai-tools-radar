// poller/src/writers/catalog.ts
import type {
  CatalogEntry,
  CatalogEntryView,
  CatalogFile,
  CatalogStats,
  Event,
} from '../sources/types.js'
import { entryKey } from '../sources/types.js'
import { writeFileAtomic } from './fs-utils.js'

export function buildCatalog(
  entries: CatalogEntry[],
  events: Event[],
  generatedAt: string,
): CatalogFile {
  const byKey = new Map<string, { firstSeen: string; lastUpdated: string }>()

  for (const event of events) {
    const existing = byKey.get(event.key)
    if (!existing) {
      byKey.set(event.key, { firstSeen: event.ts, lastUpdated: event.ts })
      continue
    }
    if (event.ts < existing.firstSeen) existing.firstSeen = event.ts
    if (event.ts > existing.lastUpdated) existing.lastUpdated = event.ts
  }

  const views: CatalogEntryView[] = entries.map((entry) => {
    const timeline = byKey.get(entryKey(entry))
    return {
      ...entry,
      first_seen_at: timeline?.firstSeen ?? generatedAt,
      last_updated_at: timeline?.lastUpdated ?? generatedAt,
    }
  })

  views.sort((a, b) => (a.first_seen_at > b.first_seen_at ? -1 : a.first_seen_at < b.first_seen_at ? 1 : 0))

  const stats: CatalogStats = {
    total: views.length,
    by_tool: {},
    by_kind: {},
  }
  for (const v of views) {
    stats.by_tool[v.tool] = (stats.by_tool[v.tool] ?? 0) + 1
    stats.by_kind[v.kind] = (stats.by_kind[v.kind] ?? 0) + 1
  }

  return { schema_version: 1, generated_at: generatedAt, entries: views, stats }
}

export async function writeCatalog(path: string, catalog: CatalogFile): Promise<void> {
  await writeFileAtomic(path, JSON.stringify(catalog, null, 2) + '\n')
}
