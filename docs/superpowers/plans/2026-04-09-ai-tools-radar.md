# ai-tools-radar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a daily poller + static Astro catalog + per-change digests for the Claude Code plugin marketplace, runnable on GitHub Actions in the `ai-tools-radar` repository.

**Architecture:** Two workflows (`daily-poll.yml`, `deploy-pages.yml`) running independent TypeScript code (`poller/`) and an Astro site (`site/`). State lives in git: `state/snapshot.json`, `state/events.jsonl`, `catalog/data.json`, `digests/*.md`. Poller never touches the site; site reads generated files at build time.

**Tech Stack:** Node 20, TypeScript strict, Octokit, Vitest, Astro 5, Tailwind 4, React (islands only), GitHub Actions, `gh` CLI.

**Source of truth:** `docs/superpowers/specs/2026-04-09-ai-tools-radar-design.md`. Re-read it if any task feels unclear.

**Confirmed upstream schema (from probing):**
- Plugin metadata lives at `plugins/<dir>/.claude-plugin/plugin.json` and `external_plugins/<dir>/.claude-plugin/plugin.json`
- Current fields observed: `name` (string), `description` (string, optional), `author` (object `{name, email?}`, optional)
- No `version`, `categories`, `commands`, etc. in the wild yet — they land in `metadata.extra` if they ever appear

---

## Parallel streams (for issue decomposition)

| Stream | Tasks | Depends on |
|---|---|---|
| **A — Poller core** | 1–12 | — |
| **B — Site scaffold** | 13–20 | Task 2 (shared types may be copied) or fixture data |
| **C — Workflows** | 21–23 | Task 12 (poller must run locally) |
| **D — Polish + smoke test** | 24–25 | A + B + C |

Streams A and B can run concurrently once the fixture catalog exists (Task 6 produces a real one from the poller; Task 13 can start earlier using a hand-written fixture if needed).

---

## File structure to be created

```
poller/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── src/
│   ├── sources/
│   │   ├── types.ts             # CatalogEntry, Source, Event types
│   │   ├── claude-plugins.ts    # ClaudePluginsSource implementation
│   │   └── index.ts             # registerSources()
│   ├── differ.ts                # pure function: (prev, curr) -> Event[]
│   ├── writers/
│   │   ├── snapshot.ts          # writeSnapshot()
│   │   ├── events.ts            # appendEvents()
│   │   ├── catalog.ts           # writeCatalog() (derives first/last_seen)
│   │   ├── digest-md.ts         # renderDigest()
│   │   └── artifacts.ts         # writeArtifacts() (commit msg, issue body)
│   └── main.ts                  # orchestrator + bootstrap mode
└── test/
    ├── differ.test.ts
    ├── writers/
    │   ├── catalog.test.ts
    │   └── digest-md.test.ts
    └── sources/
        └── claude-plugins.test.ts

site/
├── package.json
├── astro.config.mjs
├── tailwind.config.mjs
├── tsconfig.json
├── src/
│   ├── content.config.ts        # digests collection via glob loader
│   ├── lib/
│   │   ├── catalog.ts           # imports ../../../catalog/data.json
│   │   ├── types.ts             # mirrored from poller types
│   │   └── format.ts            # date helpers, isNew()
│   ├── layouts/
│   │   └── BaseLayout.astro
│   ├── components/
│   │   ├── EntryCard.astro
│   │   ├── NewBadge.astro
│   │   ├── Stats.astro
│   │   ├── DigestSummary.astro
│   │   ├── SearchBox.tsx        # React island
│   │   └── FilterBar.tsx        # React island
│   └── pages/
│       ├── index.astro
│       ├── about.astro
│       ├── digests/
│       │   ├── index.astro
│       │   └── [slug].astro
│       └── entries/
│           └── [tool]/
│               └── [kind]/
│                   └── [id].astro
└── public/
    └── favicon.svg

.github/workflows/
├── daily-poll.yml
└── deploy-pages.yml
```

---

# STREAM A — POLLER CORE

## Task 1: Scaffold poller package

**Files:**
- Create: `poller/package.json`
- Create: `poller/tsconfig.json`
- Create: `poller/vitest.config.ts`
- Create: `poller/src/.gitkeep`
- Create: `poller/test/.gitkeep`

- [ ] **Step 1: Create `poller/package.json`**

```json
{
  "name": "ai-tools-radar-poller",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "poll": "tsx src/main.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@octokit/rest": "^21.0.2"
  },
  "devDependencies": {
    "@types/node": "^22.7.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create `poller/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "allowImportingTsExtensions": false,
    "verbatimModuleSyntax": true,
    "forceConsistentCasingInFileNames": true,
    "isolatedModules": true,
    "lib": ["ES2022"],
    "types": ["node"],
    "outDir": "dist",
    "rootDir": "."
  },
  "include": ["src/**/*", "test/**/*"]
}
```

- [ ] **Step 3: Create `poller/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globals: false,
    clearMocks: true,
  },
})
```

- [ ] **Step 4: Install deps and verify typecheck passes**

Run:
```bash
cd poller && npm install && npm run typecheck
```

Expected: install finishes, typecheck exits 0 (nothing to check yet but no config errors).

- [ ] **Step 5: Commit**

```bash
git add poller/package.json poller/package-lock.json poller/tsconfig.json poller/vitest.config.ts
git commit -m "feat(poller): scaffold package with tsx + vitest"
```

---

## Task 2: Define shared types

**Files:**
- Create: `poller/src/sources/types.ts`

- [ ] **Step 1: Write the type definitions**

```ts
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
```

- [ ] **Step 2: Verify typecheck**

Run: `cd poller && npm run typecheck`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add poller/src/sources/types.ts
git commit -m "feat(poller): define CatalogEntry, Source, Event types"
```

---

## Task 3: Differ (TDD)

**Files:**
- Create: `poller/test/differ.test.ts`
- Create: `poller/src/differ.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// poller/test/differ.test.ts
import { describe, it, expect } from 'vitest'
import { diff } from '../src/differ.js'
import type { CatalogEntry, SnapshotFile } from '../src/sources/types.js'

const FROZEN_TS = '2026-04-09T00:00:00.000Z'

function entry(overrides: Partial<CatalogEntry> & Pick<CatalogEntry, 'id'>): CatalogEntry {
  return {
    tool: 'claude-code',
    kind: 'first-party',
    id: overrides.id,
    name: overrides.name ?? overrides.id,
    description: overrides.description,
    version: overrides.version,
    author: overrides.author,
    homepage: overrides.homepage,
    source_url: overrides.source_url ?? `https://example.com/${overrides.id}`,
    metadata: overrides.metadata ?? { extra: {} },
    fetched_at: overrides.fetched_at ?? FROZEN_TS,
    ...overrides,
  }
}

function snapshot(entries: CatalogEntry[]): SnapshotFile {
  const map: Record<string, CatalogEntry> = {}
  for (const e of entries) {
    map[`${e.tool}/${e.kind}/${e.id}`] = e
  }
  return { schema_version: 1, generated_at: FROZEN_TS, entries: map }
}

describe('diff', () => {
  it('returns N added events when prior snapshot is empty', () => {
    const prev = snapshot([])
    const curr = [entry({ id: 'a' }), entry({ id: 'b' })]
    const events = diff(prev, curr, FROZEN_TS)
    expect(events).toHaveLength(2)
    expect(events.every((e) => e.type === 'added')).toBe(true)
  })

  it('returns empty array when snapshots are identical', () => {
    const entries = [entry({ id: 'a' }), entry({ id: 'b' })]
    const prev = snapshot(entries)
    const events = diff(prev, entries, FROZEN_TS)
    expect(events).toEqual([])
  })

  it('returns empty array when only order differs', () => {
    const prev = snapshot([entry({ id: 'a' }), entry({ id: 'b' })])
    const curr = [entry({ id: 'b' }), entry({ id: 'a' })]
    expect(diff(prev, curr, FROZEN_TS)).toEqual([])
  })

  it('detects removed entries', () => {
    const prev = snapshot([entry({ id: 'a' }), entry({ id: 'b' })])
    const curr = [entry({ id: 'a' })]
    const events = diff(prev, curr, FROZEN_TS)
    expect(events).toHaveLength(1)
    expect(events[0]!.type).toBe('removed')
    expect(events[0]!.key).toBe('claude-code/first-party/b')
  })

  it('detects updated entries with field-level diff', () => {
    const prev = snapshot([entry({ id: 'a', description: 'old', version: '1.0.0' })])
    const curr = [entry({ id: 'a', description: 'new', version: '1.1.0' })]
    const events = diff(prev, curr, FROZEN_TS)
    expect(events).toHaveLength(1)
    const updated = events[0]!
    expect(updated.type).toBe('updated')
    if (updated.type !== 'updated') throw new Error('guard')
    const paths = updated.changes.map((c) => c.path).sort()
    expect(paths).toEqual(['description', 'version'])
    const descChange = updated.changes.find((c) => c.path === 'description')!
    expect(descChange.before).toBe('old')
    expect(descChange.after).toBe('new')
  })

  it('ignores source_url and fetched_at changes', () => {
    const prev = snapshot([entry({ id: 'a', source_url: 'https://old' })])
    const curr = [entry({ id: 'a', source_url: 'https://new', fetched_at: '2099-01-01T00:00:00.000Z' })]
    expect(diff(prev, curr, FROZEN_TS)).toEqual([])
  })

  it('detects metadata.extra field changes', () => {
    const prev = snapshot([entry({ id: 'a', metadata: { extra: { author_email: 'a@x.com' } } })])
    const curr = [entry({ id: 'a', metadata: { extra: { author_email: 'b@x.com' } } })]
    const events = diff(prev, curr, FROZEN_TS)
    expect(events).toHaveLength(1)
    expect(events[0]!.type).toBe('updated')
    if (events[0]!.type !== 'updated') throw new Error('guard')
    expect(events[0]!.changes.map((c) => c.path)).toEqual(['metadata.extra.author_email'])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd poller && npm test`
Expected: FAIL with "Cannot find module '../src/differ.js'" or similar import error.

- [ ] **Step 3: Implement `differ.ts`**

```ts
// poller/src/differ.ts
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
    const b = (before.metadata as Record<string, unknown>)[key]
    const a = (after.metadata as Record<string, unknown>)[key]
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd poller && npm test`
Expected: all 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add poller/src/differ.ts poller/test/differ.test.ts
git commit -m "feat(poller): differ with field-level diff and idempotency"
```

---

## Task 4: Snapshot writer

**Files:**
- Create: `poller/src/writers/snapshot.ts`
- Create: `poller/src/writers/fs-utils.ts`

- [ ] **Step 1: Create `fs-utils.ts` (shared helper)**

```ts
// poller/src/writers/fs-utils.ts
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export async function writeFileAtomic(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content, 'utf8')
}
```

- [ ] **Step 2: Write `snapshot.ts`**

```ts
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
```

- [ ] **Step 3: Typecheck**

Run: `cd poller && npm run typecheck`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add poller/src/writers/fs-utils.ts poller/src/writers/snapshot.ts
git commit -m "feat(poller): snapshot reader/writer with stable key ordering"
```

---

## Task 5: Events writer

**Files:**
- Create: `poller/src/writers/events.ts`

- [ ] **Step 1: Write `events.ts`**

```ts
// poller/src/writers/events.ts
import { readFile } from 'node:fs/promises'
import { appendFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Event } from '../sources/types.js'

export async function appendEvents(path: string, events: Event[]): Promise<void> {
  if (events.length === 0) return
  await mkdir(dirname(path), { recursive: true })
  const lines = events.map((e) => JSON.stringify(e)).join('\n') + '\n'
  await appendFile(path, lines, 'utf8')
}

export async function readAllEvents(path: string): Promise<Event[]> {
  try {
    const raw = await readFile(path, 'utf8')
    return raw
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as Event)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `cd poller && npm run typecheck`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add poller/src/writers/events.ts
git commit -m "feat(poller): append-only events.jsonl writer"
```

---

## Task 6: Catalog writer (TDD)

**Files:**
- Create: `poller/test/writers/catalog.test.ts`
- Create: `poller/src/writers/catalog.ts`

- [ ] **Step 1: Write the failing test**

```ts
// poller/test/writers/catalog.test.ts
import { describe, it, expect } from 'vitest'
import { buildCatalog } from '../../src/writers/catalog.js'
import type { CatalogEntry, Event } from '../../src/sources/types.js'

function entry(id: string, overrides: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    tool: 'claude-code',
    kind: 'first-party',
    id,
    name: id,
    source_url: `https://example.com/${id}`,
    metadata: { extra: {} },
    fetched_at: '2026-04-09T00:00:00.000Z',
    ...overrides,
  }
}

describe('buildCatalog', () => {
  it('derives first_seen_at from earliest added event and last_updated_at from most recent change', () => {
    const entries = [entry('a'), entry('b')]
    const events: Event[] = [
      {
        ts: '2026-03-15T00:00:00.000Z',
        type: 'added',
        key: 'claude-code/first-party/a',
        entry: entry('a'),
      },
      {
        ts: '2026-03-20T00:00:00.000Z',
        type: 'added',
        key: 'claude-code/first-party/b',
        entry: entry('b'),
      },
      {
        ts: '2026-04-01T00:00:00.000Z',
        type: 'updated',
        key: 'claude-code/first-party/a',
        changes: [{ path: 'description', before: 'old', after: 'new' }],
      },
    ]
    const catalog = buildCatalog(entries, events, '2026-04-09T00:00:00.000Z')

    expect(catalog.stats.total).toBe(2)
    expect(catalog.stats.by_tool).toEqual({ 'claude-code': 2 })
    expect(catalog.stats.by_kind).toEqual({ 'first-party': 2 })

    const viewA = catalog.entries.find((e) => e.id === 'a')!
    expect(viewA.first_seen_at).toBe('2026-03-15T00:00:00.000Z')
    expect(viewA.last_updated_at).toBe('2026-04-01T00:00:00.000Z')

    const viewB = catalog.entries.find((e) => e.id === 'b')!
    expect(viewB.first_seen_at).toBe('2026-03-20T00:00:00.000Z')
    expect(viewB.last_updated_at).toBe('2026-03-20T00:00:00.000Z')
  })

  it('falls back to generated_at when no events reference an entry', () => {
    const catalog = buildCatalog([entry('orphan')], [], '2026-04-09T00:00:00.000Z')
    const view = catalog.entries[0]!
    expect(view.first_seen_at).toBe('2026-04-09T00:00:00.000Z')
    expect(view.last_updated_at).toBe('2026-04-09T00:00:00.000Z')
  })

  it('sorts entries by first_seen_at descending (newest first)', () => {
    const events: Event[] = [
      { ts: '2026-01-01T00:00:00.000Z', type: 'added', key: 'claude-code/first-party/old', entry: entry('old') },
      { ts: '2026-04-01T00:00:00.000Z', type: 'added', key: 'claude-code/first-party/new', entry: entry('new') },
    ]
    const catalog = buildCatalog([entry('old'), entry('new')], events, '2026-04-09T00:00:00.000Z')
    expect(catalog.entries.map((e) => e.id)).toEqual(['new', 'old'])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd poller && npm test`
Expected: FAIL with missing module.

- [ ] **Step 3: Implement `catalog.ts`**

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd poller && npm test`
Expected: 3 catalog tests pass, all prior tests still pass.

- [ ] **Step 5: Commit**

```bash
git add poller/src/writers/catalog.ts poller/test/writers/catalog.test.ts
git commit -m "feat(poller): catalog builder with derived first/last seen timestamps"
```

---

## Task 7: Digest markdown renderer (TDD)

**Files:**
- Create: `poller/test/writers/digest-md.test.ts`
- Create: `poller/src/writers/digest-md.ts`

- [ ] **Step 1: Write the failing test**

```ts
// poller/test/writers/digest-md.test.ts
import { describe, it, expect } from 'vitest'
import { renderDigest } from '../../src/writers/digest-md.js'
import type { CatalogEntry, Event } from '../../src/sources/types.js'

function entry(id: string, overrides: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    tool: 'claude-code',
    kind: 'first-party',
    id,
    name: overrides.name ?? id,
    description: overrides.description,
    source_url: overrides.source_url ?? `https://github.com/anthropics/claude-plugins-official/tree/main/plugins/${id}`,
    metadata: { extra: {} },
    fetched_at: '2026-04-09T00:00:00.000Z',
    ...overrides,
  }
}

describe('renderDigest', () => {
  it('produces frontmatter with correct counts', () => {
    const events: Event[] = [
      { ts: '2026-04-09T00:00:00.000Z', type: 'added', key: 'claude-code/first-party/a', entry: entry('a') },
      { ts: '2026-04-09T00:00:00.000Z', type: 'added', key: 'claude-code/first-party/b', entry: entry('b') },
      {
        ts: '2026-04-09T00:00:00.000Z',
        type: 'updated',
        key: 'claude-code/first-party/c',
        changes: [{ path: 'version', before: '1.0.0', after: '1.1.0' }],
      },
    ]
    const md = renderDigest(events, '2026-04-09')
    expect(md).toContain('---\ndate: 2026-04-09\nadded: 2\nremoved: 0\nupdated: 1\n---')
    expect(md).toContain('## Added (2)')
    expect(md).toContain('## Updated (1)')
    expect(md).toContain('`version`: `1.0.0` → `1.1.0`')
  })

  it('renders empty sections as "(none)"', () => {
    const events: Event[] = [
      { ts: '2026-04-09T00:00:00.000Z', type: 'added', key: 'claude-code/first-party/a', entry: entry('a') },
    ]
    const md = renderDigest(events, '2026-04-09')
    expect(md).toContain('## Removed (0)\n\n_(none)_')
    expect(md).toContain('## Updated (0)\n\n_(none)_')
  })

  it('links added entries with their source_url', () => {
    const events: Event[] = [
      {
        ts: '2026-04-09T00:00:00.000Z',
        type: 'added',
        key: 'claude-code/first-party/foo',
        entry: entry('foo', { name: 'Foo', description: 'A foo plugin', source_url: 'https://example.com/foo' }),
      },
    ]
    const md = renderDigest(events, '2026-04-09')
    expect(md).toContain('[Foo](https://example.com/foo)')
    expect(md).toContain('A foo plugin')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd poller && npm test -- digest-md`
Expected: FAIL with missing module.

- [ ] **Step 3: Implement `digest-md.ts`**

```ts
// poller/src/writers/digest-md.ts
import type { AddedEvent, Event, RemovedEvent, UpdatedEvent } from '../sources/types.js'
import { writeFileAtomic } from './fs-utils.js'

export function renderDigest(events: Event[], date: string): string {
  const added = events.filter((e): e is AddedEvent => e.type === 'added')
  const removed = events.filter((e): e is RemovedEvent => e.type === 'removed')
  const updated = events.filter((e): e is UpdatedEvent => e.type === 'updated')

  const frontmatter = [
    '---',
    `date: ${date}`,
    `added: ${added.length}`,
    `removed: ${removed.length}`,
    `updated: ${updated.length}`,
    '---',
    '',
  ].join('\n')

  const body: string[] = [
    `# ai-tools-radar — ${date}`,
    '',
    renderAddedSection(added),
    '',
    renderUpdatedSection(updated),
    '',
    renderRemovedSection(removed),
    '',
  ]

  return frontmatter + body.join('\n')
}

function renderAddedSection(added: AddedEvent[]): string {
  const header = `## Added (${added.length})`
  if (added.length === 0) return `${header}\n\n_(none)_`
  const lines = added.map((e) => {
    const entry = e.entry
    const label = `${displayTool(entry.tool)} · ${entry.kind} · [${entry.name}](${entry.source_url})`
    return entry.description ? `- **${label}** — ${entry.description}` : `- **${label}**`
  })
  return `${header}\n\n${lines.join('\n')}`
}

function renderUpdatedSection(updated: UpdatedEvent[]): string {
  const header = `## Updated (${updated.length})`
  if (updated.length === 0) return `${header}\n\n_(none)_`
  const blocks = updated.map((e) => {
    const [tool, kind, id] = e.key.split('/')
    const label = `${displayTool(tool!)} · ${kind} · [${id}](${sourceUrlFromKey(e.key)})`
    const changes = e.changes
      .map((c) => `  - \`${c.path}\`: \`${formatValue(c.before)}\` → \`${formatValue(c.after)}\``)
      .join('\n')
    return `- **${label}**\n${changes}`
  })
  return `${header}\n\n${blocks.join('\n')}`
}

function renderRemovedSection(removed: RemovedEvent[]): string {
  const header = `## Removed (${removed.length})`
  if (removed.length === 0) return `${header}\n\n_(none)_`
  const lines = removed.map((e) => {
    const entry = e.previous
    return `- **${displayTool(entry.tool)} · ${entry.kind} · ${entry.name}**`
  })
  return `${header}\n\n${lines.join('\n')}`
}

function displayTool(tool: string): string {
  if (tool === 'claude-code') return 'Claude Code'
  if (tool === 'cursor') return 'Cursor'
  return tool
}

function sourceUrlFromKey(key: string): string {
  const [, kind, id] = key.split('/')
  const dir = kind === 'third-party' ? 'external_plugins' : 'plugins'
  return `https://github.com/anthropics/claude-plugins-official/tree/main/${dir}/${id}`
}

function formatValue(v: unknown): string {
  if (v === undefined) return '(none)'
  if (typeof v === 'string') return v
  return JSON.stringify(v)
}

export async function writeDigest(path: string, events: Event[], date: string): Promise<void> {
  const md = renderDigest(events, date)
  await writeFileAtomic(path, md)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd poller && npm test`
Expected: all tests green.

- [ ] **Step 5: Commit**

```bash
git add poller/src/writers/digest-md.ts poller/test/writers/digest-md.test.ts
git commit -m "feat(poller): digest markdown renderer with frontmatter"
```

---

## Task 8: Artifacts writer (commit message + issue body)

**Files:**
- Create: `poller/src/writers/artifacts.ts`

- [ ] **Step 1: Write `artifacts.ts`**

```ts
// poller/src/writers/artifacts.ts
import type { Event } from '../sources/types.js'
import { writeFileAtomic } from './fs-utils.js'

export interface ArtifactPaths {
  commitMessage: string
  issueTitle: string
  issueBody: string
}

export async function writeArtifacts(
  paths: ArtifactPaths,
  events: Event[],
  date: string,
  digestMarkdown: string,
): Promise<void> {
  const counts = summarize(events)
  const summary = summaryLine(counts)

  const commitMessage =
    `data: ${summary} (${date})\n\n` +
    `Auto-generated by daily-poll.yml.\n`

  const issueTitle = `Daily Digest — ${date}`

  // Issue body is the digest markdown minus the frontmatter (frontmatter is noise inside an issue)
  const issueBody = stripFrontmatter(digestMarkdown)

  await writeFileAtomic(paths.commitMessage, commitMessage)
  await writeFileAtomic(paths.issueTitle, issueTitle + '\n')
  await writeFileAtomic(paths.issueBody, issueBody)
}

function summarize(events: Event[]): { added: number; removed: number; updated: number } {
  return {
    added: events.filter((e) => e.type === 'added').length,
    removed: events.filter((e) => e.type === 'removed').length,
    updated: events.filter((e) => e.type === 'updated').length,
  }
}

function summaryLine(c: { added: number; removed: number; updated: number }): string {
  const parts: string[] = []
  if (c.added > 0) parts.push(`+${c.added}`)
  if (c.removed > 0) parts.push(`-${c.removed}`)
  if (c.updated > 0) parts.push(`~${c.updated}`)
  if (parts.length === 0) return 'no changes'
  return `${parts.join(' / ')} plugins`
}

function stripFrontmatter(md: string): string {
  if (!md.startsWith('---\n')) return md
  const end = md.indexOf('\n---\n', 4)
  if (end === -1) return md
  return md.slice(end + 5).trimStart()
}
```

- [ ] **Step 2: Typecheck**

Run: `cd poller && npm run typecheck`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add poller/src/writers/artifacts.ts
git commit -m "feat(poller): commit message and issue body artifacts"
```

---

## Task 9: ClaudePluginsSource (TDD with mock Octokit)

**Files:**
- Create: `poller/test/sources/claude-plugins.test.ts`
- Create: `poller/src/sources/claude-plugins.ts`

- [ ] **Step 1: Write the failing test**

```ts
// poller/test/sources/claude-plugins.test.ts
import { describe, it, expect, vi } from 'vitest'
import { ClaudePluginsSource } from '../../src/sources/claude-plugins.js'
import type { Octokit } from '@octokit/rest'

function mockOctokit(responses: Record<string, unknown>): Octokit {
  const getContent = vi.fn(async ({ path }: { path: string }) => {
    const data = responses[path]
    if (data === undefined) {
      const err = new Error(`not found: ${path}`) as Error & { status: number }
      err.status = 404
      throw err
    }
    return { data }
  })
  return { rest: { repos: { getContent } } } as unknown as Octokit
}

describe('ClaudePluginsSource', () => {
  it('maps plugin.json into CatalogEntry', async () => {
    const octokit = mockOctokit({
      plugins: [{ name: 'code-review', type: 'dir', html_url: 'https://github.com/anthropics/claude-plugins-official/tree/main/plugins/code-review' }],
      external_plugins: [],
      'plugins/code-review/.claude-plugin/plugin.json': {
        type: 'file',
        content: Buffer.from(
          JSON.stringify({
            name: 'code-review',
            description: 'Automated code review',
            author: { name: 'Anthropic', email: 'support@anthropic.com' },
          }),
        ).toString('base64'),
        encoding: 'base64',
      },
    })

    const src = new ClaudePluginsSource(octokit, () => '2026-04-09T00:00:00.000Z')
    const entries = await src.fetch()

    expect(entries).toHaveLength(1)
    const entry = entries[0]!
    expect(entry.tool).toBe('claude-code')
    expect(entry.kind).toBe('first-party')
    expect(entry.id).toBe('code-review')
    expect(entry.name).toBe('code-review')
    expect(entry.description).toBe('Automated code review')
    expect(entry.author).toBe('Anthropic')
    expect(entry.source_url).toContain('code-review')
    expect(entry.metadata.extra).toMatchObject({ author_email: 'support@anthropic.com' })
  })

  it('falls back to directory name when plugin.json is missing', async () => {
    const octokit = mockOctokit({
      plugins: [{ name: 'broken', type: 'dir', html_url: 'https://example.com/broken' }],
      external_plugins: [],
      // plugin.json omitted → 404
    })
    const src = new ClaudePluginsSource(octokit, () => '2026-04-09T00:00:00.000Z')
    const entries = await src.fetch()
    expect(entries).toHaveLength(1)
    expect(entries[0]!.id).toBe('broken')
    expect(entries[0]!.name).toBe('broken')
  })

  it('handles author as a string (not object)', async () => {
    const octokit = mockOctokit({
      plugins: [{ name: 'p', type: 'dir', html_url: 'https://x' }],
      external_plugins: [],
      'plugins/p/.claude-plugin/plugin.json': {
        type: 'file',
        content: Buffer.from(JSON.stringify({ name: 'p', author: 'Someone' })).toString('base64'),
        encoding: 'base64',
      },
    })
    const src = new ClaudePluginsSource(octokit, () => '2026-04-09T00:00:00.000Z')
    const entries = await src.fetch()
    expect(entries[0]!.author).toBe('Someone')
  })

  it('separates first-party and third-party', async () => {
    const octokit = mockOctokit({
      plugins: [{ name: 'a', type: 'dir', html_url: 'https://x/a' }],
      external_plugins: [{ name: 'b', type: 'dir', html_url: 'https://x/b' }],
      'plugins/a/.claude-plugin/plugin.json': {
        type: 'file',
        content: Buffer.from(JSON.stringify({ name: 'a' })).toString('base64'),
        encoding: 'base64',
      },
      'external_plugins/b/.claude-plugin/plugin.json': {
        type: 'file',
        content: Buffer.from(JSON.stringify({ name: 'b' })).toString('base64'),
        encoding: 'base64',
      },
    })
    const src = new ClaudePluginsSource(octokit, () => '2026-04-09T00:00:00.000Z')
    const entries = await src.fetch()
    const aEntry = entries.find((e) => e.id === 'a')!
    const bEntry = entries.find((e) => e.id === 'b')!
    expect(aEntry.kind).toBe('first-party')
    expect(bEntry.kind).toBe('third-party')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd poller && npm test -- claude-plugins`
Expected: FAIL with missing module.

- [ ] **Step 3: Implement `claude-plugins.ts`**

```ts
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
      if (Array.isArray(data) || data.type !== 'file' || !('content' in data)) return null
      const decoded = Buffer.from(data.content, data.encoding as BufferEncoding).toString('utf8')
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd poller && npm test`
Expected: all tests green.

- [ ] **Step 5: Commit**

```bash
git add poller/src/sources/claude-plugins.ts poller/test/sources/claude-plugins.test.ts
git commit -m "feat(poller): ClaudePluginsSource with plugin.json parsing and fallback"
```

---

## Task 10: Source registry

**Files:**
- Create: `poller/src/sources/index.ts`

- [ ] **Step 1: Write `sources/index.ts`**

```ts
// poller/src/sources/index.ts
import { Octokit } from '@octokit/rest'
import { ClaudePluginsSource } from './claude-plugins.js'
import type { Source } from './types.js'

export function registerSources(octokit: Octokit): Source[] {
  return [new ClaudePluginsSource(octokit)]
}

export * from './types.js'
```

- [ ] **Step 2: Typecheck**

Run: `cd poller && npm run typecheck`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add poller/src/sources/index.ts
git commit -m "feat(poller): source registry"
```

---

## Task 11: Main orchestrator with bootstrap mode

**Files:**
- Create: `poller/src/main.ts`

- [ ] **Step 1: Write `main.ts`**

```ts
// poller/src/main.ts
import { Octokit } from '@octokit/rest'
import { resolve } from 'node:path'
import { diff } from './differ.js'
import { registerSources } from './sources/index.js'
import type { CatalogEntry, Event } from './sources/types.js'
import { buildCatalog, writeCatalog } from './writers/catalog.js'
import { writeDigest, renderDigest } from './writers/digest-md.js'
import { appendEvents, readAllEvents } from './writers/events.js'
import { readSnapshot, writeSnapshot } from './writers/snapshot.js'
import { writeArtifacts } from './writers/artifacts.js'
import { writeFileAtomic } from './writers/fs-utils.js'

const REPO_ROOT = resolve(process.cwd(), '..')
// `npm run poll` is invoked with cwd = poller/, so repo root is one level up.

const PATHS = {
  snapshot: `${REPO_ROOT}/state/snapshot.json`,
  events: `${REPO_ROOT}/state/events.jsonl`,
  catalog: `${REPO_ROOT}/catalog/data.json`,
  digestDir: `${REPO_ROOT}/digests`,
  artifactDir: `${resolve(process.cwd(), 'out')}`,
}

async function main(): Promise<void> {
  const now = new Date().toISOString()
  const date = now.slice(0, 10)

  const token = process.env.GITHUB_TOKEN
  if (!token) {
    console.error('[poller] GITHUB_TOKEN not set')
    process.exit(1)
  }

  const octokit = new Octokit({ auth: token })
  const sources = registerSources(octokit)

  console.log(`[poller] fetching from ${sources.length} source(s)`)
  const fetched: CatalogEntry[] = []
  for (const source of sources) {
    const entries = await source.fetch()
    console.log(`[poller] ${source.id}: ${entries.length} entries`)
    fetched.push(...entries)
  }

  const prevSnapshot = await readSnapshot(PATHS.snapshot)

  if (!prevSnapshot) {
    console.log('[poller] bootstrap mode: no prior snapshot, writing initial state')
    await writeSnapshot(PATHS.snapshot, fetched, now)
    const catalog = buildCatalog(fetched, [], now)
    await writeCatalog(PATHS.catalog, catalog)

    // Bootstrap writes only a commit message — no events, no digest, no issue.
    // The workflow gates issue creation on the existence of poller/out/issue-title.txt,
    // so not creating it is how we say "don't open an issue".
    const bootstrapCommitMsg =
      `chore: bootstrap initial snapshot (${fetched.length} entries)\n\n` +
      `Auto-generated by daily-poll.yml (bootstrap mode).\n`
    await writeFileAtomic(`${PATHS.artifactDir}/commit-message.txt`, bootstrapCommitMsg)
    console.log('[poller] bootstrap complete')
    return
  }

  const events: Event[] = diff(prevSnapshot, fetched, now)

  if (events.length === 0) {
    console.log('[poller] no changes, exiting')
    return
  }

  const addedCount = events.filter((e) => e.type === 'added').length
  const removedCount = events.filter((e) => e.type === 'removed').length
  const updatedCount = events.filter((e) => e.type === 'updated').length
  console.log(`[poller] ${addedCount} added, ${removedCount} removed, ${updatedCount} updated`)

  await writeSnapshot(PATHS.snapshot, fetched, now)
  await appendEvents(PATHS.events, events)

  const allEvents = await readAllEvents(PATHS.events)
  const catalog = buildCatalog(fetched, allEvents, now)
  await writeCatalog(PATHS.catalog, catalog)

  const digestPath = `${PATHS.digestDir}/${date}.md`
  await writeDigest(digestPath, events, date)

  const digestMd = renderDigest(events, date)
  await writeArtifacts(
    {
      commitMessage: `${PATHS.artifactDir}/commit-message.txt`,
      issueTitle: `${PATHS.artifactDir}/issue-title.txt`,
      issueBody: `${PATHS.artifactDir}/issue-body.md`,
    },
    events,
    date,
    digestMd,
  )

  console.log('[poller] done')
}

main().catch((err: unknown) => {
  console.error('[poller] fatal:', err)
  process.exit(1)
})
```

- [ ] **Step 2: Typecheck**

Run: `cd poller && npm run typecheck`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add poller/src/main.ts
git commit -m "feat(poller): main orchestrator with bootstrap mode"
```

---

## Task 12: Local smoke test (bootstrap run)

**Files:**
- Modify (automatically): `state/snapshot.json`, `catalog/data.json`
- No code to change

- [ ] **Step 1: Ensure GITHUB_TOKEN is exported**

Run:
```bash
gh auth token | head -c 20 && echo ...
```
Expected: shows first 20 chars of a token.

Export it:
```bash
export GITHUB_TOKEN=$(gh auth token)
```

- [ ] **Step 2: Run the poller**

Run:
```bash
cd poller && npm run poll
```
Expected log output:
```
[poller] fetching from 1 source(s)
[poller] anthropics/claude-plugins-official: ~50 entries
[poller] bootstrap mode: no prior snapshot, writing initial state
[poller] bootstrap complete
```

- [ ] **Step 3: Verify files landed**

Run:
```bash
cd .. && ls state/ catalog/
```
Expected: `state/snapshot.json` and `catalog/data.json` exist. No `events.jsonl` yet. No digest file. `poller/out/commit-message.txt` exists, `issue-title.txt` and `issue-body.md` do NOT exist.

- [ ] **Step 4: Inspect the snapshot quickly**

Run:
```bash
cat state/snapshot.json | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d['entries']), 'entries')"
```
Expected: prints roughly 50 (may vary as the upstream repo changes).

- [ ] **Step 5: Commit the bootstrap state**

```bash
git add state/ catalog/
git commit -F poller/out/commit-message.txt
```

---

# STREAM B — SITE SCAFFOLD

## Task 13: Scaffold Astro project with Tailwind

**Files:**
- Create: `site/package.json`
- Create: `site/astro.config.mjs`
- Create: `site/tailwind.config.mjs`
- Create: `site/tsconfig.json`
- Create: `site/src/styles/global.css`

- [ ] **Step 1: Create `site/package.json`**

```json
{
  "name": "ai-tools-radar-site",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "astro dev",
    "build": "astro build",
    "preview": "astro preview",
    "typecheck": "astro check"
  },
  "dependencies": {
    "astro": "^5.0.0",
    "@astrojs/react": "^4.0.0",
    "@astrojs/check": "^0.9.4",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "tailwindcss": "^4.0.0",
    "@tailwindcss/vite": "^4.0.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "typescript": "^5.6.0"
  }
}
```

- [ ] **Step 2: Create `site/astro.config.mjs`**

```js
import { defineConfig } from 'astro/config'
import react from '@astrojs/react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  integrations: [react()],
  vite: {
    plugins: [tailwindcss()],
  },
  site: 'https://woojinahn.github.io',
  base: '/ai-tools-radar',
})
```

- [ ] **Step 3: Create `site/tsconfig.json`**

```json
{
  "extends": "astro/tsconfigs/strict",
  "include": [".astro/types.d.ts", "**/*"],
  "exclude": ["dist"],
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "react"
  }
}
```

- [ ] **Step 4: Create `site/src/styles/global.css`**

```css
@import 'tailwindcss';

:root {
  color-scheme: light dark;
}

html, body {
  margin: 0;
}

body {
  font-family: ui-sans-serif, system-ui, sans-serif;
  background: #0a0a0a;
  color: #e5e5e5;
}
```

- [ ] **Step 5: Install**

Run:
```bash
cd site && npm install
```
Expected: install completes without errors.

- [ ] **Step 6: Commit**

```bash
git add site/package.json site/package-lock.json site/astro.config.mjs site/tsconfig.json site/src/styles/global.css
git commit -m "feat(site): scaffold Astro 5 + Tailwind 4 + React"
```

---

## Task 14: Site types and catalog loader

**Files:**
- Create: `site/src/lib/types.ts`
- Create: `site/src/lib/catalog.ts`
- Create: `site/src/lib/format.ts`

- [ ] **Step 1: Create `site/src/lib/types.ts`** (mirrors poller types — duplication is intentional to keep site/poller decoupled)

```ts
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
  }
}
```

- [ ] **Step 2: Create `site/src/lib/catalog.ts`**

```ts
// site/src/lib/catalog.ts
import catalogJson from '../../../catalog/data.json'
import type { CatalogFile } from './types.ts'

export const catalog: CatalogFile = catalogJson as CatalogFile
```

- [ ] **Step 3: Create `site/src/lib/format.ts`**

```ts
// site/src/lib/format.ts
const NEW_THRESHOLD_DAYS = 7

export function isNew(firstSeenAt: string, now: Date = new Date()): boolean {
  const seen = new Date(firstSeenAt).getTime()
  const ms = now.getTime() - seen
  return ms < NEW_THRESHOLD_DAYS * 24 * 60 * 60 * 1000
}

export function formatDate(iso: string): string {
  return iso.slice(0, 10)
}

export function displayTool(tool: string): string {
  if (tool === 'claude-code') return 'Claude Code'
  if (tool === 'cursor') return 'Cursor'
  return tool
}
```

- [ ] **Step 4: Typecheck**

Run: `cd site && npm run typecheck`
Expected: may fail if `catalog/data.json` doesn't exist yet (it should, after Task 12). If Stream B starts before Stream A finishes, create a fixture first:

```bash
# fallback fixture if catalog/data.json doesn't exist
mkdir -p ../catalog
cat > ../catalog/data.json <<'EOF'
{
  "schema_version": 1,
  "generated_at": "2026-04-09T00:00:00.000Z",
  "entries": [],
  "stats": { "total": 0, "by_tool": {}, "by_kind": {} }
}
EOF
```

- [ ] **Step 5: Commit**

```bash
git add site/src/lib/
git commit -m "feat(site): catalog loader, types, format helpers"
```

---

## Task 15: BaseLayout

**Files:**
- Create: `site/src/layouts/BaseLayout.astro`

- [ ] **Step 1: Write `BaseLayout.astro`**

```astro
---
// site/src/layouts/BaseLayout.astro
import '../styles/global.css'

interface Props {
  title: string
  description?: string
}

const { title, description = 'Radar for the AI coding tool ecosystem' } = Astro.props
---

<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content={description} />
    <title>{title}</title>
  </head>
  <body class="min-h-screen">
    <header class="border-b border-neutral-800">
      <div class="max-w-5xl mx-auto px-6 py-5 flex items-center justify-between">
        <a href={import.meta.env.BASE_URL} class="font-semibold tracking-tight text-lg">
          ai-tools-radar
        </a>
        <nav class="flex gap-5 text-sm text-neutral-400">
          <a href={import.meta.env.BASE_URL} class="hover:text-white">Catalog</a>
          <a href={`${import.meta.env.BASE_URL}/digests/`} class="hover:text-white">Digests</a>
          <a href={`${import.meta.env.BASE_URL}/about/`} class="hover:text-white">About</a>
        </nav>
      </div>
    </header>
    <main class="max-w-5xl mx-auto px-6 py-10">
      <slot />
    </main>
    <footer class="border-t border-neutral-800 mt-20">
      <div class="max-w-5xl mx-auto px-6 py-6 text-xs text-neutral-500">
        Data from <a href="https://github.com/anthropics/claude-plugins-official" class="underline">anthropics/claude-plugins-official</a>.
        Source: <a href="https://github.com/WoojinAhn/ai-tools-radar" class="underline">WoojinAhn/ai-tools-radar</a>.
      </div>
    </footer>
  </body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add site/src/layouts/BaseLayout.astro
git commit -m "feat(site): BaseLayout with header/footer"
```

---

## Task 16: Static display components

**Files:**
- Create: `site/src/components/NewBadge.astro`
- Create: `site/src/components/EntryCard.astro`
- Create: `site/src/components/Stats.astro`

- [ ] **Step 1: Write `NewBadge.astro`**

```astro
---
// site/src/components/NewBadge.astro
import { isNew } from '../lib/format.ts'

interface Props {
  firstSeenAt: string
}

const { firstSeenAt } = Astro.props
const show = isNew(firstSeenAt)
---

{show && (
  <span class="inline-block text-[10px] uppercase tracking-wider font-semibold text-emerald-400 border border-emerald-500/40 rounded px-1.5 py-0.5">
    New
  </span>
)}
```

- [ ] **Step 2: Write `EntryCard.astro`**

```astro
---
// site/src/components/EntryCard.astro
import type { CatalogEntryView } from '../lib/types.ts'
import { displayTool } from '../lib/format.ts'
import NewBadge from './NewBadge.astro'

interface Props {
  entry: CatalogEntryView
}

const { entry } = Astro.props
const detailHref = `${import.meta.env.BASE_URL}/entries/${entry.tool}/${entry.kind}/${entry.id}/`
---

<article
  class="border border-neutral-800 rounded-lg p-5 hover:border-neutral-600 transition-colors"
  data-tool={entry.tool}
  data-kind={entry.kind}
  data-search={`${entry.name} ${entry.description ?? ''}`.toLowerCase()}
>
  <div class="flex items-start justify-between gap-3">
    <a href={detailHref} class="font-medium text-white hover:underline">
      {entry.name}
    </a>
    <NewBadge firstSeenAt={entry.first_seen_at} />
  </div>
  <div class="mt-1 text-xs text-neutral-500">
    {displayTool(entry.tool)} · {entry.kind}
    {entry.author && <> · {entry.author}</>}
  </div>
  {entry.description && (
    <p class="mt-3 text-sm text-neutral-300 line-clamp-3">{entry.description}</p>
  )}
</article>
```

- [ ] **Step 3: Write `Stats.astro`**

```astro
---
// site/src/components/Stats.astro
import type { CatalogFile } from '../lib/types.ts'

interface Props {
  catalog: CatalogFile
}

const { catalog } = Astro.props
const firstParty = catalog.stats.by_kind['first-party'] ?? 0
const thirdParty = catalog.stats.by_kind['third-party'] ?? 0
---

<div class="grid grid-cols-3 gap-4 mb-8">
  <div class="border border-neutral-800 rounded-lg p-4">
    <div class="text-xs uppercase tracking-wider text-neutral-500">Total</div>
    <div class="text-2xl font-semibold mt-1">{catalog.stats.total}</div>
  </div>
  <div class="border border-neutral-800 rounded-lg p-4">
    <div class="text-xs uppercase tracking-wider text-neutral-500">First-party</div>
    <div class="text-2xl font-semibold mt-1">{firstParty}</div>
  </div>
  <div class="border border-neutral-800 rounded-lg p-4">
    <div class="text-xs uppercase tracking-wider text-neutral-500">Third-party</div>
    <div class="text-2xl font-semibold mt-1">{thirdParty}</div>
  </div>
</div>
```

- [ ] **Step 4: Commit**

```bash
git add site/src/components/EntryCard.astro site/src/components/NewBadge.astro site/src/components/Stats.astro
git commit -m "feat(site): EntryCard, NewBadge, Stats components"
```

---

## Task 17: Index page (catalog)

**Files:**
- Create: `site/src/pages/index.astro`

- [ ] **Step 1: Write `index.astro`**

```astro
---
// site/src/pages/index.astro
import BaseLayout from '../layouts/BaseLayout.astro'
import EntryCard from '../components/EntryCard.astro'
import Stats from '../components/Stats.astro'
import { catalog } from '../lib/catalog.ts'
---

<BaseLayout title="ai-tools-radar — Catalog">
  <h1 class="text-3xl font-semibold tracking-tight mb-2">Catalog</h1>
  <p class="text-neutral-400 mb-8">
    {catalog.stats.total} entries across Claude Code's official plugin marketplace.
    Last updated {catalog.generated_at.slice(0, 10)}.
  </p>

  <Stats catalog={catalog} />

  <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" id="entry-grid">
    {catalog.entries.map((entry) => <EntryCard entry={entry} />)}
  </div>
</BaseLayout>
```

- [ ] **Step 2: Build to verify**

Run: `cd site && npm run build`
Expected: build completes, `site/dist/index.html` exists.

- [ ] **Step 3: Commit**

```bash
git add site/src/pages/index.astro
git commit -m "feat(site): catalog index page"
```

---

## Task 18: Digest content collection and pages

**Files:**
- Create: `site/src/content.config.ts`
- Create: `site/src/pages/digests/index.astro`
- Create: `site/src/pages/digests/[slug].astro`

- [ ] **Step 1: Write `content.config.ts`**

```ts
// site/src/content.config.ts
import { defineCollection, z } from 'astro:content'
import { glob } from 'astro/loaders'

const digests = defineCollection({
  loader: glob({ pattern: '*.md', base: '../digests' }),
  schema: z.object({
    date: z.coerce.string(),
    added: z.number().default(0),
    removed: z.number().default(0),
    updated: z.number().default(0),
  }),
})

export const collections = { digests }
```

- [ ] **Step 2: Write `digests/index.astro`**

```astro
---
// site/src/pages/digests/index.astro
import BaseLayout from '../../layouts/BaseLayout.astro'
import { getCollection } from 'astro:content'

const digests = (await getCollection('digests')).sort((a, b) =>
  a.data.date < b.data.date ? 1 : -1,
)
---

<BaseLayout title="ai-tools-radar — Digests">
  <h1 class="text-3xl font-semibold tracking-tight mb-2">Digests</h1>
  <p class="text-neutral-400 mb-8">One entry per day on which the marketplace actually changed.</p>

  {digests.length === 0 && (
    <p class="text-neutral-500">No digests yet. The first run writes the bootstrap snapshot silently.</p>
  )}

  <ul class="divide-y divide-neutral-800">
    {digests.map((d) => (
      <li class="py-4 flex items-center justify-between">
        <a href={`${import.meta.env.BASE_URL}/digests/${d.id}/`} class="font-medium hover:underline">
          {d.data.date}
        </a>
        <div class="text-xs text-neutral-500 flex gap-3">
          {d.data.added > 0 && <span class="text-emerald-400">+{d.data.added}</span>}
          {d.data.removed > 0 && <span class="text-red-400">−{d.data.removed}</span>}
          {d.data.updated > 0 && <span class="text-amber-400">~{d.data.updated}</span>}
        </div>
      </li>
    ))}
  </ul>
</BaseLayout>
```

- [ ] **Step 3: Write `digests/[slug].astro`**

```astro
---
// site/src/pages/digests/[slug].astro
import BaseLayout from '../../layouts/BaseLayout.astro'
import { getCollection, render } from 'astro:content'

export async function getStaticPaths() {
  const digests = await getCollection('digests')
  return digests.map((d) => ({ params: { slug: d.id }, props: { digest: d } }))
}

const { digest } = Astro.props
const { Content } = await render(digest)
---

<BaseLayout title={`Digest — ${digest.data.date}`}>
  <a href={`${import.meta.env.BASE_URL}/digests/`} class="text-sm text-neutral-500 hover:text-white">
    ← All digests
  </a>
  <article class="prose prose-invert max-w-none mt-6">
    <Content />
  </article>
</BaseLayout>
```

- [ ] **Step 4: Build**

Run: `cd site && npm run build`
Expected: build completes. (If no digests exist yet, `/digests/` page renders the empty state.)

- [ ] **Step 5: Commit**

```bash
git add site/src/content.config.ts site/src/pages/digests/
git commit -m "feat(site): digest collection and pages via glob loader"
```

---

## Task 19: Entry detail page

**Files:**
- Create: `site/src/pages/entries/[tool]/[kind]/[id].astro`

- [ ] **Step 1: Write the detail page**

```astro
---
// site/src/pages/entries/[tool]/[kind]/[id].astro
import BaseLayout from '../../../../layouts/BaseLayout.astro'
import { catalog } from '../../../../lib/catalog.ts'
import { displayTool } from '../../../../lib/format.ts'

export function getStaticPaths() {
  return catalog.entries.map((entry) => ({
    params: { tool: entry.tool, kind: entry.kind, id: entry.id },
    props: { entry },
  }))
}

const { entry } = Astro.props
---

<BaseLayout title={`${entry.name} — ai-tools-radar`}>
  <a href={import.meta.env.BASE_URL} class="text-sm text-neutral-500 hover:text-white">← Back to catalog</a>

  <header class="mt-6 mb-8">
    <h1 class="text-3xl font-semibold tracking-tight">{entry.name}</h1>
    <div class="mt-2 text-sm text-neutral-500">
      {displayTool(entry.tool)} · {entry.kind}
      {entry.author && <> · {entry.author}</>}
      {entry.version && <> · v{entry.version}</>}
    </div>
  </header>

  {entry.description && (
    <p class="text-neutral-300 mb-8 text-lg leading-relaxed">{entry.description}</p>
  )}

  <dl class="grid gap-4 text-sm">
    <div>
      <dt class="text-neutral-500">First seen</dt>
      <dd class="font-mono text-neutral-200">{entry.first_seen_at.slice(0, 10)}</dd>
    </div>
    <div>
      <dt class="text-neutral-500">Last updated</dt>
      <dd class="font-mono text-neutral-200">{entry.last_updated_at.slice(0, 10)}</dd>
    </div>
    <div>
      <dt class="text-neutral-500">Source</dt>
      <dd>
        <a href={entry.source_url} class="text-blue-400 underline">{entry.source_url}</a>
      </dd>
    </div>
  </dl>

  {Object.keys(entry.metadata.extra).length > 0 && (
    <section class="mt-8">
      <h2 class="text-sm uppercase tracking-wider text-neutral-500 mb-3">Metadata</h2>
      <pre class="text-xs bg-neutral-900 border border-neutral-800 rounded p-4 overflow-x-auto">{JSON.stringify(entry.metadata.extra, null, 2)}</pre>
    </section>
  )}
</BaseLayout>
```

- [ ] **Step 2: Build**

Run: `cd site && npm run build`
Expected: one HTML file per entry under `site/dist/entries/`.

- [ ] **Step 3: Commit**

```bash
git add site/src/pages/entries/
git commit -m "feat(site): entry detail page"
```

---

## Task 20: About page

**Files:**
- Create: `site/src/pages/about.astro`

- [ ] **Step 1: Write `about.astro`**

```astro
---
// site/src/pages/about.astro
import BaseLayout from '../layouts/BaseLayout.astro'
---

<BaseLayout title="About — ai-tools-radar">
  <h1 class="text-3xl font-semibold tracking-tight mb-6">About</h1>
  <div class="prose prose-invert max-w-none">
    <p>
      <strong>ai-tools-radar</strong> tracks additions and metadata changes in official AI coding
      tool marketplaces, starting with Claude Code's plugin directory.
    </p>
    <p>
      A GitHub Actions workflow polls the upstream repository daily. On days when something
      actually changes, it writes an entry to <code>state/events.jsonl</code>, updates the
      catalog this site renders from, generates a daily digest, and opens a GitHub issue with
      the same content.
    </p>
    <p>
      The design and implementation plan live under
      <code>docs/superpowers/</code> in the
      <a href="https://github.com/WoojinAhn/ai-tools-radar">source repository</a>.
    </p>
  </div>
</BaseLayout>
```

- [ ] **Step 2: Commit**

```bash
git add site/src/pages/about.astro
git commit -m "feat(site): about page"
```

---

## Task 21: Search and filter islands

**Files:**
- Create: `site/src/components/SearchBox.tsx`
- Create: `site/src/components/FilterBar.tsx`
- Modify: `site/src/pages/index.astro`

- [ ] **Step 1: Write `SearchBox.tsx`**

```tsx
// site/src/components/SearchBox.tsx
import { useEffect, useState } from 'react'

export default function SearchBox() {
  const [q, setQ] = useState('')

  useEffect(() => {
    const cards = document.querySelectorAll<HTMLElement>('#entry-grid [data-search]')
    const needle = q.trim().toLowerCase()
    cards.forEach((card) => {
      const hay = card.dataset.search ?? ''
      const match = needle === '' || hay.includes(needle)
      card.style.display = match ? '' : 'none'
    })
  }, [q])

  return (
    <input
      type="search"
      value={q}
      onChange={(e) => setQ(e.target.value)}
      placeholder="Search catalog..."
      className="w-full bg-neutral-900 border border-neutral-800 rounded-md px-4 py-2 text-sm placeholder:text-neutral-600 focus:outline-none focus:border-neutral-600"
    />
  )
}
```

- [ ] **Step 2: Write `FilterBar.tsx`**

```tsx
// site/src/components/FilterBar.tsx
import { useEffect, useState } from 'react'

type Kind = 'all' | 'first-party' | 'third-party'

export default function FilterBar() {
  const [kind, setKind] = useState<Kind>('all')

  useEffect(() => {
    const cards = document.querySelectorAll<HTMLElement>('#entry-grid [data-kind]')
    cards.forEach((card) => {
      const cardKind = card.dataset.kind
      const match = kind === 'all' || cardKind === kind
      // Respect search hiding: only flip visibility when we're not hiding for search
      if (match) {
        if (card.dataset.searchHidden !== 'true') card.style.display = ''
      } else {
        card.style.display = 'none'
      }
    })
  }, [kind])

  const options: { value: Kind; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'first-party', label: 'First-party' },
    { value: 'third-party', label: 'Third-party' },
  ]

  return (
    <div class="flex gap-2 text-sm">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => setKind(o.value)}
          className={
            'px-3 py-1 rounded-md border ' +
            (kind === o.value
              ? 'bg-white text-black border-white'
              : 'border-neutral-800 text-neutral-400 hover:text-white')
          }
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
```

> **Note on interaction with search:** The above keeps filter simple. If both are active, search wins (hides) over filter. The tiny coupling via `data-search-hidden` is optional polish; for v1, the simpler behavior — filter applies on top of whatever search left visible — is fine.

- [ ] **Step 3: Modify `site/src/pages/index.astro` to mount the islands**

Replace the file with:

```astro
---
// site/src/pages/index.astro
import BaseLayout from '../layouts/BaseLayout.astro'
import EntryCard from '../components/EntryCard.astro'
import Stats from '../components/Stats.astro'
import SearchBox from '../components/SearchBox.tsx'
import FilterBar from '../components/FilterBar.tsx'
import { catalog } from '../lib/catalog.ts'
---

<BaseLayout title="ai-tools-radar — Catalog">
  <h1 class="text-3xl font-semibold tracking-tight mb-2">Catalog</h1>
  <p class="text-neutral-400 mb-8">
    {catalog.stats.total} entries across Claude Code's official plugin marketplace.
    Last updated {catalog.generated_at.slice(0, 10)}.
  </p>

  <Stats catalog={catalog} />

  <div class="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center mb-6">
    <div class="flex-1">
      <SearchBox client:visible />
    </div>
    <FilterBar client:visible />
  </div>

  <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" id="entry-grid">
    {catalog.entries.map((entry) => <EntryCard entry={entry} />)}
  </div>
</BaseLayout>
```

- [ ] **Step 4: Build**

Run: `cd site && npm run build`
Expected: build completes, hydration scripts included for the two islands.

- [ ] **Step 5: Commit**

```bash
git add site/src/components/SearchBox.tsx site/src/components/FilterBar.tsx site/src/pages/index.astro
git commit -m "feat(site): SearchBox and FilterBar client islands"
```

---

# STREAM C — WORKFLOWS

## Task 22: `daily-poll.yml`

**Files:**
- Create: `.github/workflows/daily-poll.yml`

- [ ] **Step 1: Write the workflow**

```yaml
# .github/workflows/daily-poll.yml
name: Daily Poll

on:
  schedule:
    - cron: '0 0 * * *'   # 09:00 KST
  workflow_dispatch:

permissions:
  contents: write
  issues: write

concurrency:
  group: daily-poll
  cancel-in-progress: false

jobs:
  poll:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: poller/package-lock.json

      - name: Install poller deps
        working-directory: poller
        run: npm ci

      - name: Test poller
        working-directory: poller
        run: npm test

      - name: Run poller
        working-directory: poller
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: npm run poll

      - name: Commit & push if changed
        id: commit
        run: |
          if [[ -z $(git status --porcelain) ]]; then
            echo "changed=false" >> "$GITHUB_OUTPUT"
            echo "No changes."
            exit 0
          fi
          git config user.name "ai-tools-radar-bot"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add state/ catalog/ digests/
          git commit -F poller/out/commit-message.txt
          git push
          echo "changed=true" >> "$GITHUB_OUTPUT"

      - name: Open digest issue
        if: steps.commit.outputs.changed == 'true' && hashFiles('poller/out/issue-title.txt') != ''
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          title=$(cat poller/out/issue-title.txt)
          gh issue create \
            --title "$title" \
            --body-file poller/out/issue-body.md \
            --label digest
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/daily-poll.yml
git commit -m "ci: daily poll workflow with conditional digest issue"
```

---

## Task 23: `deploy-pages.yml`

**Files:**
- Create: `.github/workflows/deploy-pages.yml`

- [ ] **Step 1: Write the workflow**

```yaml
# .github/workflows/deploy-pages.yml
name: Deploy Pages

on:
  push:
    branches: [main]
    paths:
      - 'site/**'
      - 'catalog/data.json'
      - 'digests/**'
      - '.github/workflows/deploy-pages.yml'
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: site/package-lock.json
      - working-directory: site
        run: |
          npm ci
          npm run build
      - uses: actions/upload-pages-artifact@v3
        with:
          path: site/dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 2: Enable GitHub Pages for the repo**

Run:
```bash
gh api -X POST repos/WoojinAhn/ai-tools-radar/pages -f build_type=workflow 2>&1 || \
gh api -X PUT repos/WoojinAhn/ai-tools-radar/pages -f build_type=workflow
```
Expected: success response with page URL, or a confirmation that Pages is already enabled.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/deploy-pages.yml
git commit -m "ci: GitHub Pages deploy workflow"
```

---

# STREAM D — POLISH AND SMOKE TEST

## Task 24: End-to-end smoke (push + manual poll + Pages verify)

**Files:** None new

- [ ] **Step 1: Push everything**

Run:
```bash
git push
```
Expected: both workflows queue. `deploy-pages.yml` starts on `site/**` path changes. `daily-poll.yml` does not run on push (cron only).

- [ ] **Step 2: Watch the Pages deploy**

Run:
```bash
gh run watch $(gh run list --workflow deploy-pages.yml --limit 1 --json databaseId -q '.[0].databaseId')
```
Expected: build and deploy jobs both succeed.

- [ ] **Step 3: Fetch the live site URL**

Run:
```bash
gh api repos/WoojinAhn/ai-tools-radar/pages -q '.html_url'
```
Expected: a URL like `https://woojinahn.github.io/ai-tools-radar/`. Open it and verify:
- Catalog page shows entries
- `/digests/` shows empty state
- `/entries/claude-code/first-party/code-review/` renders a detail page

- [ ] **Step 4: Manually trigger the daily poll**

Run:
```bash
gh workflow run daily-poll.yml
gh run watch $(gh run list --workflow daily-poll.yml --limit 1 --json databaseId -q '.[0].databaseId')
```
Expected: workflow succeeds. Because the snapshot is already bootstrapped and nothing upstream changed, the "Commit & push if changed" step should log `No changes.` and the issue step should be skipped.

- [ ] **Step 5: Verify idempotency in logs**

Inspect the job log:
```bash
gh run view --log $(gh run list --workflow daily-poll.yml --limit 1 --json databaseId -q '.[0].databaseId') | grep -E '\[poller\]|No changes'
```
Expected: `[poller] no changes, exiting` and `No changes.` both appear.

- [ ] **Step 6: No commit needed** — this task only verifies.

---

## Task 25: Decompose remaining work into parallel GitHub issues

**Files:** None new (creates issues via `gh issue create`)

This task is only needed if the plan is being executed by multiple workers simultaneously. It translates Stream A/B/C/D into concrete issues with dependency labels.

- [ ] **Step 1: Create labels**

```bash
gh label create stream-a --description "Poller core" --color "1d76db" --force
gh label create stream-b --description "Site scaffold" --color "0e8a16" --force
gh label create stream-c --description "Workflows" --color "fbca04" --force
gh label create stream-d --description "Smoke/polish" --color "d93f0b" --force
gh label create digest --description "Daily digest issue" --color "5319e7" --force
```

- [ ] **Step 2: Create one issue per Task 1–24 OR one per logical group**

For the smaller-granularity approach, a single command creates one issue per task:

```bash
gh issue create \
  --title "[A1] Scaffold poller package" \
  --label stream-a \
  --body "See \`docs/superpowers/plans/2026-04-09-ai-tools-radar.md\` → Task 1."
```

Repeat for each task, or alternatively group into 4 large issues (one per stream) referencing the plan tasks.

- [ ] **Step 3: Decide grouping**

Default recommendation: **4 stream issues**, not 24 task issues. Rationale:
- 24 issues is churn for a solo developer
- Stream-level issues still enable parallel execution across agents/workers
- Individual task tracking already lives in the plan checklist

Commands for the default grouping:
```bash
gh issue create --title "[Stream A] Poller core (Tasks 1–12)" --label stream-a \
  --body "Implements poller package, types, differ, writers, ClaudePluginsSource, main orchestrator. See \`docs/superpowers/plans/2026-04-09-ai-tools-radar.md\`. Blocks Streams C and D."

gh issue create --title "[Stream B] Astro site scaffold (Tasks 13–21)" --label stream-b \
  --body "Implements Astro project, layouts, components, pages, islands. See plan. Can start in parallel with Stream A once a fixture catalog/data.json exists."

gh issue create --title "[Stream C] GitHub Actions workflows (Tasks 22–23)" --label stream-c \
  --body "Implements daily-poll.yml and deploy-pages.yml. Blocked by Stream A Task 12 (local poller run). See plan."

gh issue create --title "[Stream D] End-to-end smoke test (Task 24)" --label stream-d \
  --body "Pushes, watches workflows, verifies Pages deployment and idempotent repeat run. Blocked by Streams A, B, C."
```

- [ ] **Step 4: No commit** — issues are external to git.

---

# Validation

After Task 24 succeeds:

- ✅ `state/snapshot.json` and `catalog/data.json` committed and visible in repo
- ✅ GitHub Pages serves the catalog at `https://woojinahn.github.io/ai-tools-radar/`
- ✅ Manual `daily-poll.yml` run reports "no changes, exiting"
- ✅ `digests/` is empty (bootstrap skipped digest correctly)
- ✅ `poller` test suite has 15+ passing tests covering differ, catalog, digest, source

When a real upstream change lands, the next scheduled run will:
1. Emit events to `state/events.jsonl`
2. Write `digests/YYYY-MM-DD.md`
3. Commit with message `data: +N / ~M plugins (YYYY-MM-DD)`
4. Deploy Pages automatically
5. Open a GitHub issue titled `Daily Digest — YYYY-MM-DD` with the digest body

At that point, the existing email watch on `anthropics/claude-plugins-official` can be safely unsubscribed (or narrowed to Issues + Discussions per the design doc's Section 2).
