# Cursor Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Cursor as a second tracked tool with marketplace plugins (91) and built-in commands (19), served on a separate `/cursor/` page with a GNB tab bar for tool switching.

**Architecture:** Two new poller source adapters fetch from `cursor.com` HTML pages (RSC payload parsing). Site restructured from single-page to tool-specific pages (`/claude-code/`, `/cursor/`) with shared components. Differ gets a transient-failure guard to prevent false removals.

**Tech Stack:** TypeScript, Node.js built-in `https`, Astro 5, Tailwind, Vitest

**Spec:** `docs/superpowers/specs/2026-04-11-cursor-support-design.md`

---

## File Structure

### Poller — new files
- `poller/src/sources/http.ts` — shared HTTP fetch utility (reusable across Cursor sources)
- `poller/src/sources/cursor-marketplace.ts` — `CursorMarketplaceSource`
- `poller/src/sources/cursor-builtin-commands.ts` — `CursorBuiltinCommandsSource`
- `poller/test/sources/cursor-marketplace.test.ts`
- `poller/test/sources/cursor-builtin-commands.test.ts`

### Poller — modified files
- `poller/src/sources/index.ts` — register 2 new sources
- `poller/src/differ.ts` — add transient-failure guard
- `poller/test/differ.test.ts` — test the guard

### Site — new files
- `site/src/components/ToolTabs.astro` — tab bar component
- `site/src/pages/claude-code/index.astro` — Claude Code catalog page
- `site/src/pages/cursor/index.astro` — Cursor catalog page

### Site — modified files
- `site/src/pages/index.astro` — replace with redirect
- `site/src/layouts/BaseLayout.astro` — remove "Catalog" from GNB, update footer
- `site/src/lib/catalog.ts` — add `entriesForTool()` helper

---

## Task 1: Shared HTTP fetch utility

Extract `fetchHtml(url): Promise<string>` using Node.js `https` — shared by both Cursor sources.

**Files:**
- Create: `poller/src/sources/http.ts`

- [ ] **Step 1: Create http.ts with fetchHtml function**

```typescript
// poller/src/sources/http.ts
import { get as httpsGet } from 'node:https'

export async function fetchHtml(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const makeRequest = (reqUrl: string): void => {
      httpsGet(reqUrl, { headers: { 'User-Agent': 'ai-tools-radar/1.0' } }, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          makeRequest(res.headers.location)
          return
        }
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode} for ${reqUrl}`))
          return
        }
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
        res.on('error', reject)
      }).on('error', reject)
    }
    makeRequest(url)
  })
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `cd poller && npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 3: Commit**

```
git add poller/src/sources/http.ts
git commit -m "refactor(poller): extract shared HTTP fetch utility"
```

---

## Task 2: CursorMarketplaceSource + tests

**Files:**
- Create: `poller/src/sources/cursor-marketplace.ts`
- Create: `poller/test/sources/cursor-marketplace.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// poller/test/sources/cursor-marketplace.test.ts
import { describe, it, expect } from 'vitest'
import { CursorMarketplaceSource } from '../../src/sources/cursor-marketplace.js'

function makeSource(): CursorMarketplaceSource {
  return new CursorMarketplaceSource(() => '2026-04-11T00:00:00.000Z')
}

const MOCK_RSC = `some html self.__next_f.push([1,"6:[\\"$\\",\\"$L3c\\",null,{\\"initialPlugins\\":[{\\"id\\":\\"123\\",\\"name\\":\\"stripe\\",\\"displayName\\":\\"Stripe\\",\\"description\\":\\"Payment processing.\\",\\"status\\":\\"PLUGIN_STATUS_APPROVED\\",\\"repositoryUrl\\":\\"https://github.com/stripe/ai\\",\\"tags\\":[\\"payments\\"],\\"logoUrl\\":\\"https://example.com/logo.png\\",\\"isPublished\\":true,\\"createdAt\\":\\"1700000000\\",\\"updatedAt\\":\\"1700000001\\",\\"publisherId\\":\\"6\\",\\"publisher\\":{\\"id\\":\\"6\\",\\"name\\":\\"stripe\\"}}]}"]) more html`

const MOCK_RSC_FIRST_PARTY = `self.__next_f.push([1,"6:[\\"$\\",\\"$L3c\\",null,{\\"initialPlugins\\":[{\\"id\\":\\"456\\",\\"name\\":\\"cli-for-agent\\",\\"displayName\\":\\"CLI for Agents\\",\\"description\\":\\"CLI patterns.\\",\\"status\\":\\"PLUGIN_STATUS_APPROVED\\",\\"repositoryUrl\\":\\"https://github.com/cursor/plugins\\",\\"tags\\":[],\\"logoUrl\\":\\"\\",\\"isPublished\\":true,\\"createdAt\\":\\"1700000000\\",\\"updatedAt\\":\\"1700000001\\",\\"publisherId\\":\\"212\\",\\"publisher\\":{\\"id\\":\\"212\\",\\"name\\":\\"cursor\\"}}]}"]) end`

describe('CursorMarketplaceSource', () => {
  describe('parseMarketplace', () => {
    it('extracts plugin from RSC payload', () => {
      const entries = makeSource().parseMarketplace(MOCK_RSC)
      expect(entries).toHaveLength(1)
      expect(entries[0]).toMatchObject({
        tool: 'cursor',
        kind: 'third-party',
        id: 'stripe',
        name: 'Stripe',
        description: 'Payment processing.',
        source_url: 'https://github.com/stripe/ai',
      })
    })

    it('detects first-party by repositoryUrl', () => {
      const entries = makeSource().parseMarketplace(MOCK_RSC_FIRST_PARTY)
      expect(entries).toHaveLength(1)
      expect(entries[0]!.kind).toBe('first-party')
    })

    it('returns empty array when no initialPlugins found', () => {
      const entries = makeSource().parseMarketplace('<html>no data</html>')
      expect(entries).toEqual([])
    })

    it('stores displayName and tags in metadata.extra', () => {
      const entries = makeSource().parseMarketplace(MOCK_RSC)
      expect(entries[0]!.metadata.extra).toMatchObject({
        displayName: 'Stripe',
        tags: ['payments'],
      })
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd poller && npm test 2>&1 | tail -10`
Expected: FAIL — module not found

- [ ] **Step 3: Implement CursorMarketplaceSource**

```typescript
// poller/src/sources/cursor-marketplace.ts
import { fetchHtml } from './http.js'
import type { CatalogEntry, EntryKind, Source } from './types.js'

const MARKETPLACE_URL = 'https://cursor.com/marketplace'
const CURSOR_PLUGINS_REPO = 'https://github.com/cursor/plugins'

export class CursorMarketplaceSource implements Source {
  readonly tool = 'cursor' as const
  readonly id = 'cursor-marketplace'

  constructor(
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async fetch(): Promise<CatalogEntry[]> {
    console.log('[cursor-marketplace] fetching cursor.com/marketplace')
    try {
      const html = await fetchHtml(MARKETPLACE_URL)
      const entries = this.parseMarketplace(html)
      console.log(`[cursor-marketplace] found ${entries.length} plugins`)
      return entries
    } catch (err) {
      console.warn(`[cursor-marketplace] fetch failed: ${(err as Error).message}, skipping`)
      return []
    }
  }

  parseMarketplace(html: string): CatalogEntry[] {
    const match = html.match(/initialPlugins[^<]*/)
    if (!match) return []

    const raw = match[0].replace(/\\"/g, '"')
    const entries: CatalogEntry[] = []
    const seen = new Set<string>()

    const pluginRe =
      /"name":"([^"]+)","displayName":"([^"]+)","description":"((?:[^"\\]|\\.)*)","status":"([^"]+)","repositoryUrl":"([^"]*)"/g
    let m: RegExpExecArray | null
    while ((m = pluginRe.exec(raw)) !== null) {
      const name = m[1]!
      const displayName = m[2]!
      const description = m[3]!
      const repositoryUrl = m[5]!
      if (seen.has(name)) continue
      seen.add(name)

      const tagsRe = new RegExp(
        `"name":"${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^}]*?"tags":\\[([^\\]]*)\\]`,
      )
      const tagsMatch = tagsRe.exec(raw)
      const tags = tagsMatch
        ? (tagsMatch[1]!.match(/"([^"]+)"/g) ?? []).map((t) => t.replace(/"/g, ''))
        : []

      const kind: EntryKind =
        repositoryUrl === CURSOR_PLUGINS_REPO ? 'first-party' : 'third-party'

      entries.push({
        tool: 'cursor',
        kind,
        id: name,
        name: displayName,
        description: description.replace(/\\n/g, '\n'),
        source_url: repositoryUrl || MARKETPLACE_URL,
        metadata: { extra: { displayName, tags } },
        fetched_at: this.now(),
      })
    }

    return entries
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd poller && npm test 2>&1 | tail -10`
Expected: all pass

- [ ] **Step 5: Commit**

```
git add poller/src/sources/cursor-marketplace.ts poller/test/sources/cursor-marketplace.test.ts
git commit -m "feat(poller): CursorMarketplaceSource — parse cursor.com/marketplace RSC payload"
```

---

## Task 3: CursorBuiltinCommandsSource + tests

**Files:**
- Create: `poller/src/sources/cursor-builtin-commands.ts`
- Create: `poller/test/sources/cursor-builtin-commands.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// poller/test/sources/cursor-builtin-commands.test.ts
import { describe, it, expect } from 'vitest'
import { CursorBuiltinCommandsSource } from '../../src/sources/cursor-builtin-commands.js'

function makeSource(): CursorBuiltinCommandsSource {
  return new CursorBuiltinCommandsSource(() => '2026-04-11T00:00:00.000Z')
}

describe('CursorBuiltinCommandsSource', () => {
  describe('parseCommands', () => {
    it('extracts command from RSC payload pattern', () => {
      const html = `stuff{"children":"/worktree"}more stuff`
      const entries = makeSource().parseCommands(html)
      expect(entries).toHaveLength(1)
      expect(entries[0]).toMatchObject({
        tool: 'cursor',
        kind: 'first-party',
        id: 'builtin/worktree',
        name: '/worktree',
        metadata: { extra: { builtin: true } },
      })
    })

    it('deduplicates commands', () => {
      const html = `{"children":"/plan"}stuff{"children":"/plan"}`
      const entries = makeSource().parseCommands(html)
      expect(entries).toHaveLength(1)
    })

    it('extracts description from surrounding text', () => {
      const html = `{"children":"/worktree"}]," that creates a separate git worktree so changes happen in isolation."`
      const entries = makeSource().parseCommands(html)
      expect(entries[0]!.description).toContain('creates a separate git worktree')
    })

    it('returns empty array for no matches', () => {
      const entries = makeSource().parseCommands('<html>nothing</html>')
      expect(entries).toEqual([])
    })

    it('handles missing description gracefully', () => {
      const html = `{"children":"/vim"}`
      const entries = makeSource().parseCommands(html)
      expect(entries[0]!.description).toBeUndefined()
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd poller && npm test 2>&1 | tail -10`
Expected: FAIL — module not found

- [ ] **Step 3: Implement CursorBuiltinCommandsSource**

```typescript
// poller/src/sources/cursor-builtin-commands.ts
import { fetchHtml } from './http.js'
import type { CatalogEntry, Source } from './types.js'

const CHANGELOG_BASE = 'https://cursor.com/changelog'
const MAX_PAGES = 5
const COMMAND_RE = /\{"children":"(\/[a-z][\w-]*)"\}/g

export class CursorBuiltinCommandsSource implements Source {
  readonly tool = 'cursor' as const
  readonly id = 'cursor-builtin-commands'

  constructor(
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async fetch(): Promise<CatalogEntry[]> {
    console.log('[cursor-commands] fetching cursor.com/changelog pages')
    try {
      const pages: string[] = []
      for (let i = 0; i <= MAX_PAGES; i++) {
        const url = i === 0 ? CHANGELOG_BASE : `${CHANGELOG_BASE}/page/${i}`
        const html = await fetchHtml(url)
        pages.push(html)
      }
      const combined = pages.join('\n')
      const entries = this.parseCommands(combined)
      console.log(`[cursor-commands] found ${entries.length} built-in commands`)
      return entries
    } catch (err) {
      console.warn(`[cursor-commands] fetch failed: ${(err as Error).message}, skipping`)
      return []
    }
  }

  parseCommands(html: string): CatalogEntry[] {
    const unescaped = html.replace(/\\\\"/g, '"').replace(/\\"/g, '"')
    const seen = new Set<string>()
    const entries: CatalogEntry[] = []

    const re = new RegExp(COMMAND_RE.source, 'g')
    let m: RegExpExecArray | null
    while ((m = re.exec(unescaped)) !== null) {
      const name = m[1]!
      if (seen.has(name)) continue
      seen.add(name)

      const descRe = new RegExp(
        `\\{"children":"${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\}\\],"([^"]{10,})"`,
      )
      const descMatch = descRe.exec(unescaped)
      const description = descMatch
        ? descMatch[1]!.replace(/^ /, '').replace(/\\n/g, '\n')
        : undefined

      entries.push({
        tool: 'cursor',
        kind: 'first-party',
        id: `builtin/${name.slice(1)}`,
        name,
        description,
        source_url: 'https://cursor.com/changelog',
        metadata: { extra: { builtin: true } },
        fetched_at: this.now(),
      })
    }

    return entries
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd poller && npm test 2>&1 | tail -10`
Expected: all pass

- [ ] **Step 5: Commit**

```
git add poller/src/sources/cursor-builtin-commands.ts poller/test/sources/cursor-builtin-commands.test.ts
git commit -m "feat(poller): CursorBuiltinCommandsSource — parse changelog for slash commands"
```

---

## Task 4: Register sources + differ guard

**Files:**
- Modify: `poller/src/sources/index.ts`
- Modify: `poller/src/differ.ts`
- Modify: `poller/test/differ.test.ts`

- [ ] **Step 1: Write failing differ guard test**

Add to `poller/test/differ.test.ts`:

```typescript
it('skips removals for a tool when current fetch returned zero entries', () => {
  const prev = snapshot([
    entry({ id: 'a' }),
    { ...entry({ id: 'x' }), tool: 'cursor' as const },
  ])
  // Cursor returned nothing (transient failure), Claude Code returned its entry
  const curr = [entry({ id: 'a' })]
  const events = diff(prev, curr, FROZEN_TS)
  // Should NOT emit 'removed' for cursor entry
  expect(events).toEqual([])
})
```

Note: the `snapshot()` helper builds keys from `tool/kind/id`, so the cursor entry becomes `cursor/first-party/x`. The current `diff` would emit a removal for it. After the guard, it should not.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd poller && npm test 2>&1 | grep "skips removals"`
Expected: FAIL

- [ ] **Step 3: Implement differ guard in differ.ts**

In the `diff` function, after building `currentMap`, add:

```typescript
const currentTools = new Set<string>()
for (const e of current) {
  currentTools.add(e.tool)
}
```

Then in the "removed" loop, wrap the push:

```typescript
for (const key of Object.keys(prev.entries)) {
  if (!currentMap.has(key)) {
    const prevEntry = prev.entries[key]!
    // Guard: skip removal if this tool returned zero entries (transient failure)
    if (!currentTools.has(prevEntry.tool)) continue
    events.push({ ts: now, type: 'removed', key, previous: prevEntry })
  }
}
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `cd poller && npm test`
Expected: all pass

- [ ] **Step 5: Update index.ts to register all 4 sources**

```typescript
// poller/src/sources/index.ts
import { Octokit } from '@octokit/rest'
import { ClaudeBuiltinSkillsSource } from './claude-builtin-skills.js'
import { ClaudePluginsSource } from './claude-plugins.js'
import { CursorBuiltinCommandsSource } from './cursor-builtin-commands.js'
import { CursorMarketplaceSource } from './cursor-marketplace.js'
import type { Source } from './types.js'

export function registerSources(octokit: Octokit): Source[] {
  return [
    new ClaudePluginsSource(octokit),
    new ClaudeBuiltinSkillsSource(),
    new CursorMarketplaceSource(),
    new CursorBuiltinCommandsSource(),
  ]
}

export * from './types.js'
```

- [ ] **Step 6: Run full test suite + typecheck**

Run: `cd poller && npm test && npx tsc --noEmit`
Expected: all pass, exit 0

- [ ] **Step 7: Commit**

```
git add poller/src/sources/index.ts poller/src/differ.ts poller/test/differ.test.ts
git commit -m "feat(poller): register Cursor sources + differ transient-failure guard"
```

---

## Task 5: Site — ToolTabs + catalog helper

**Files:**
- Create: `site/src/components/ToolTabs.astro`
- Modify: `site/src/lib/catalog.ts`

- [ ] **Step 1: Create ToolTabs.astro**

```astro
---
// site/src/components/ToolTabs.astro
import type { ToolId } from '../lib/types.ts'

interface Props {
  activeTool: ToolId
}

const { activeTool } = Astro.props
const tabs: { tool: ToolId; label: string }[] = [
  { tool: 'claude-code', label: 'Claude Code' },
  { tool: 'cursor', label: 'Cursor' },
]
---

<nav class="flex gap-0 border-b border-neutral-800 mb-8">
  {tabs.map((tab) => (
    <a
      href={`${import.meta.env.BASE_URL}/${tab.tool}/`}
      class:list={[
        'px-5 py-3 text-sm transition-colors',
        activeTool === tab.tool
          ? 'text-white border-b-2 border-white font-medium'
          : 'text-neutral-500 hover:text-neutral-300',
      ]}
    >
      {tab.label}
    </a>
  ))}
</nav>
```

- [ ] **Step 2: Add entriesForTool to catalog.ts**

Add to `site/src/lib/catalog.ts`:

```typescript
import type { ToolId } from './types.ts'

export function entriesForTool(tool: ToolId) {
  const all = catalog.entries.filter((e) => e.tool === tool)
  return {
    plugins: all.filter((e) => !isBuiltin(e)),
    builtins: all.filter(isBuiltin),
  }
}
```

- [ ] **Step 3: Commit**

```
git add site/src/components/ToolTabs.astro site/src/lib/catalog.ts
git commit -m "feat(site): ToolTabs component + entriesForTool helper"
```

---

## Task 6: Site — tool-specific pages + redirect + layout

**Files:**
- Create: `site/src/pages/claude-code/index.astro`
- Create: `site/src/pages/cursor/index.astro`
- Modify: `site/src/pages/index.astro`
- Modify: `site/src/layouts/BaseLayout.astro`

- [ ] **Step 1: Create /claude-code/index.astro**

```astro
---
// site/src/pages/claude-code/index.astro
import BaseLayout from '../../layouts/BaseLayout.astro'
import EntryCard from '../../components/EntryCard.astro'
import Stats from '../../components/Stats.astro'
import ToolTabs from '../../components/ToolTabs.astro'
import SearchBox from '../../components/SearchBox.tsx'
import FilterBar from '../../components/FilterBar.tsx'
import { catalog, entriesForTool } from '../../lib/catalog.ts'

const { plugins, builtins } = entriesForTool('claude-code')
---

<BaseLayout title="Claude Code — ai-tools-radar">
  <ToolTabs activeTool="claude-code" />

  <h1 class="text-3xl font-semibold tracking-tight mb-2">Marketplace Plugins</h1>
  <p class="text-neutral-400 mb-8">
    {plugins.length} plugins across Claude Code's official marketplace.
    Last updated {catalog.generated_at.slice(0, 10)}.
  </p>

  <Stats entries={plugins} />

  <div class="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center mb-6">
    <div class="flex-1"><SearchBox client:visible /></div>
    <FilterBar client:visible />
  </div>

  <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" id="entry-grid">
    {plugins.map((entry) => <EntryCard entry={entry} />)}
  </div>

  {builtins.length > 0 && (
    <section id="builtin-skills" class="mt-16 pt-12 border-t border-neutral-800">
      <h2 class="text-2xl font-semibold tracking-tight mb-2">Built-in Skills</h2>
      <p class="text-neutral-400 mb-8">
        {builtins.length} skills embedded in the Claude Code CLI binary.
      </p>
      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" id="builtin-grid">
        {builtins.map((entry) => <EntryCard entry={entry} />)}
      </div>
    </section>
  )}
</BaseLayout>
```

- [ ] **Step 2: Create /cursor/index.astro**

Same structure, different data and labels:

```astro
---
// site/src/pages/cursor/index.astro
import BaseLayout from '../../layouts/BaseLayout.astro'
import EntryCard from '../../components/EntryCard.astro'
import Stats from '../../components/Stats.astro'
import ToolTabs from '../../components/ToolTabs.astro'
import SearchBox from '../../components/SearchBox.tsx'
import FilterBar from '../../components/FilterBar.tsx'
import { catalog, entriesForTool } from '../../lib/catalog.ts'

const { plugins, builtins } = entriesForTool('cursor')
---

<BaseLayout title="Cursor — ai-tools-radar">
  <ToolTabs activeTool="cursor" />

  <h1 class="text-3xl font-semibold tracking-tight mb-2">Marketplace Plugins</h1>
  <p class="text-neutral-400 mb-8">
    {plugins.length} plugins across Cursor's official marketplace.
    Last updated {catalog.generated_at.slice(0, 10)}.
  </p>

  <Stats entries={plugins} />

  <div class="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center mb-6">
    <div class="flex-1"><SearchBox client:visible /></div>
    <FilterBar client:visible />
  </div>

  <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" id="entry-grid">
    {plugins.map((entry) => <EntryCard entry={entry} />)}
  </div>

  {builtins.length > 0 && (
    <section id="builtin-commands" class="mt-16 pt-12 border-t border-neutral-800">
      <h2 class="text-2xl font-semibold tracking-tight mb-2">Built-in Commands</h2>
      <p class="text-neutral-400 mb-8">
        {builtins.length} commands from Cursor changelog.
      </p>
      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" id="builtin-grid">
        {builtins.map((entry) => <EntryCard entry={entry} />)}
      </div>
    </section>
  )}
</BaseLayout>
```

- [ ] **Step 3: Replace index.astro with redirect**

```astro
---
// site/src/pages/index.astro
return Astro.redirect(`${import.meta.env.BASE_URL}/claude-code/`)
---
```

- [ ] **Step 4: Update BaseLayout.astro**

Remove "Catalog" link from GNB nav. Update footer data source text.

GNB nav becomes:
```html
<nav class="flex gap-5 text-sm text-neutral-400">
  <a href={`${import.meta.env.BASE_URL}/digests/`} class="hover:text-white">Digests</a>
  <a href={`${import.meta.env.BASE_URL}/about/`} class="hover:text-white">About</a>
</nav>
```

Footer becomes:
```html
Data from
<a href="https://github.com/anthropics/claude-plugins-official" class="underline">anthropics/claude-plugins-official</a>
and <a href="https://cursor.com/marketplace" class="underline">cursor.com/marketplace</a>.
Source: <a href="https://github.com/WoojinAhn/ai-tools-radar" class="underline">WoojinAhn/ai-tools-radar</a>.
```

- [ ] **Step 5: Build site to verify**

Run: `cd site && npm run build 2>&1 | tail -10`
Expected: Build succeeds with pages for `/claude-code/`, `/cursor/`, redirect at `/`

- [ ] **Step 6: Commit**

```
git add site/src/pages/ site/src/layouts/BaseLayout.astro
git commit -m "feat(site): tool-specific pages with ToolTabs + redirect"
```

---

## Task 7: Update detail page back-links

**Files:**
- Modify: `site/src/pages/entries/[tool]/[kind]/[...id].astro`

- [ ] **Step 1: Update back-link logic**

Replace current `backHref`/`backLabel` with:

```typescript
const backHref = isBuiltin(entry)
  ? `${import.meta.env.BASE_URL}/${entry.tool}/#builtin-${entry.tool === 'cursor' ? 'commands' : 'skills'}`
  : `${import.meta.env.BASE_URL}/${entry.tool}/`
const backLabel = isBuiltin(entry)
  ? `\u2190 Back to built-in ${entry.tool === 'cursor' ? 'commands' : 'skills'}`
  : `\u2190 Back to ${displayTool(entry.tool)} catalog`
```

- [ ] **Step 2: Build site to verify**

Run: `cd site && npm run build 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```
git add site/src/pages/entries/
git commit -m "fix(site): update detail page back-links for tool-specific pages"
```

---

## Task 8: End-to-end verification

- [ ] **Step 1: Run full poller test suite**

Run: `cd poller && npm test`
Expected: all tests pass (35+ tests)

- [ ] **Step 2: Typecheck poller**

Run: `cd poller && npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 3: Build site**

Run: `cd site && npm run build 2>&1 | tail -10`
Expected: Build succeeds with `/claude-code/`, `/cursor/`, redirect

- [ ] **Step 4: Local dev preview**

Run: `cd site && npm run dev`
- Visit `http://localhost:4321` → redirects to `/claude-code/`
- Tab bar shows Claude Code active
- Click Cursor tab → `/cursor/` with empty marketplace (no data yet)
- Playwright screenshot both pages for visual verification

- [ ] **Step 5: Push**

```
git push origin main
```
