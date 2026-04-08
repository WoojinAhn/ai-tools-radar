// poller/src/sources/types.ts

export type ToolId = 'claude-code' | 'cursor'
export type EntryKind = 'first-party' | 'third-party'

export interface CatalogEntry {
  tool: ToolId
  kind: EntryKind
  id: string

  name: string
  description?: string
  version?: string
  author?: string
  homepage?: string

  source_url: string

  metadata: EntryMetadata

  fetched_at: string
}

export interface EntryMetadata {
  categories?: string[]
  commands?: string[]
  agents?: string[]
  skills?: string[]
  mcp_servers?: string[]
  extra: Record<string, unknown>
}

export interface Source {
  readonly tool: ToolId
  readonly id: string
  fetch(): Promise<CatalogEntry[]>
}

// --- Diff event types ---

export type EntryKey = string // format: "{tool}/{kind}/{id}"

export interface AddedEvent {
  ts: string
  type: 'added'
  key: EntryKey
  entry: CatalogEntry
}

export interface RemovedEvent {
  ts: string
  type: 'removed'
  key: EntryKey
  previous: CatalogEntry
}

export interface FieldChange {
  path: string // e.g. "description", "metadata.extra.categories"
  before: unknown
  after: unknown
}

export interface UpdatedEvent {
  ts: string
  type: 'updated'
  key: EntryKey
  changes: FieldChange[]
}

export type Event = AddedEvent | RemovedEvent | UpdatedEvent

// --- Snapshot file ---

export interface SnapshotFile {
  schema_version: 1
  generated_at: string
  entries: Record<EntryKey, CatalogEntry>
}

// --- Catalog file (site-facing view) ---

export interface CatalogFile {
  schema_version: 1
  generated_at: string
  entries: CatalogEntryView[]
  stats: CatalogStats
}

export interface CatalogEntryView extends CatalogEntry {
  first_seen_at: string
  last_updated_at: string
}

export interface CatalogStats {
  total: number
  by_tool: Record<string, number>
  by_kind: Record<string, number>
}

// --- Helpers ---

export function entryKey(entry: Pick<CatalogEntry, 'tool' | 'kind' | 'id'>): EntryKey {
  return `${entry.tool}/${entry.kind}/${entry.id}`
}
