// poller/src/writers/snapshot.ts
import { readFile } from 'node:fs/promises'
import type { CatalogEntry, SnapshotFile } from '../sources/types.js'
import { entryKey } from '../sources/types.js'
import { writeFileAtomic } from './fs-utils.js'

export async function readSnapshot(path: string): Promise<SnapshotFile | null> {
  try {
    const raw = await readFile(path, 'utf8')
    return JSON.parse(raw) as SnapshotFile
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

export async function writeSnapshot(path: string, entries: CatalogEntry[], generatedAt: string): Promise<void> {
  const sorted = [...entries].sort((a, b) => entryKey(a).localeCompare(entryKey(b)))
  const map: Record<string, CatalogEntry> = {}
  for (const e of sorted) {
    map[entryKey(e)] = e
  }
  const snapshot: SnapshotFile = {
    schema_version: 1,
    generated_at: generatedAt,
    entries: map,
  }
  await writeFileAtomic(path, JSON.stringify(snapshot, null, 2) + '\n')
}
