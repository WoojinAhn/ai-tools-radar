// site/src/lib/types.ts
export type ToolId = 'claude-code' | 'cursor'
export type EntryKind = 'first-party' | 'third-party'

export interface CatalogEntryView {
  tool: ToolId
  kind: EntryKind
  id: string
  name: string
  description?: string
  version?: string
  author?: string
  homepage?: string
  source_url: string
  metadata: {
    categories?: string[]
    commands?: string[]
    agents?: string[]
    skills?: string[]
    mcp_servers?: string[]
    extra: Record<string, unknown>
  }
  fetched_at: string
  first_seen_at: string
  last_updated_at: string
}

export interface CatalogFile {
  schema_version: 1
  generated_at: string
  entries: CatalogEntryView[]
  stats: {
    total: number
    by_tool: Record<string, number>
    by_kind: Record<string, number>
    latest_first_seen_at: string
  }
}
