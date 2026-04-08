import {
  entryKey,
  type CatalogEntry,
  type Event,
  type FieldChange,
  type SnapshotFile,
  type UpdatedEvent,
} from './sources/types.js'

const TOP_LEVEL_FIELDS = [
  'name',
  'description',
  'version',
  'author',
  'homepage',
] as const

type ComparableKey = (typeof TOP_LEVEL_FIELDS)[number]

export function diff(prev: SnapshotFile, current: CatalogEntry[], now: string): Event[] {
  const events: Event[] = []
  const currentMap = new Map<string, CatalogEntry>()
  for (const entry of current) {
    currentMap.set(entryKey(entry), entry)
  }

  // added + updated
  for (const [key, curr] of currentMap) {
    const before = prev.entries[key]
    if (!before) {
      events.push({ ts: now, type: 'added', key, entry: curr })
      continue
    }
    const changes = compareEntry(before, curr)
    if (changes.length > 0) {
      const updated: UpdatedEvent = { ts: now, type: 'updated', key, changes }
      events.push(updated)
    }
  }

  // removed
  for (const key of Object.keys(prev.entries)) {
    if (!currentMap.has(key)) {
      events.push({ ts: now, type: 'removed', key, previous: prev.entries[key]! })
    }
  }

  return events
}

function compareEntry(before: CatalogEntry, after: CatalogEntry): FieldChange[] {
  const changes: FieldChange[] = []

  for (const field of TOP_LEVEL_FIELDS) {
    const b = before[field as ComparableKey]
    const a = after[field as ComparableKey]
    if (!deepEqual(b, a)) {
      changes.push({ path: field, before: b, after: a })
    }
  }

  // metadata comparison
  const metadataKeys = new Set([
    ...Object.keys(before.metadata ?? {}),
    ...Object.keys(after.metadata ?? {}),
  ])
  for (const key of metadataKeys) {
    if (key === 'extra') {
      const extraKeys = new Set([
        ...Object.keys(before.metadata.extra ?? {}),
        ...Object.keys(after.metadata.extra ?? {}),
      ])
      for (const k of extraKeys) {
        const b = before.metadata.extra?.[k]
        const a = after.metadata.extra?.[k]
        if (!deepEqual(b, a)) {
          changes.push({ path: `metadata.extra.${k}`, before: b, after: a })
        }
      }
      continue
    }
    const b = (before.metadata as unknown as Record<string, unknown>)[key]
    const a = (after.metadata as unknown as Record<string, unknown>)[key]
    if (!deepEqual(b, a)) {
      changes.push({ path: `metadata.${key}`, before: b, after: a })
    }
  }

  return changes.sort((a, b) => a.path.localeCompare(b.path))
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null) return false
  if (typeof a !== typeof b) return false
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false
    return a.every((v, i) => deepEqual(v, b[i]))
  }
  if (typeof a === 'object') {
    const ao = a as Record<string, unknown>
    const bo = b as Record<string, unknown>
    const keys = new Set([...Object.keys(ao), ...Object.keys(bo)])
    for (const k of keys) {
      if (!deepEqual(ao[k], bo[k])) return false
    }
    return true
  }
  return false
}
