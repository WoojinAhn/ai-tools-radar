# Cursor Support — Design Document

- **Date:** 2026-04-11
- **Status:** Draft
- **Author:** WoojinAhn (brainstormed with Claude)
- **Depends on:** Research issue #11

## 1. Purpose

Add Cursor as a second tracked tool alongside Claude Code. The site becomes a multi-tool radar with a consistent UI per tool: Marketplace Plugins + Built-in Commands/Skills.

## 2. Scope

### In scope
- Two new poller source adapters: `CursorMarketplaceSource`, `CursorBuiltinCommandsSource`
- Site restructure: GNB tab bar (`Claude Code | Cursor`), tool-specific pages at `/claude-code/` and `/cursor/`
- First-party / third-party distinction for Cursor plugins
- Graceful failure handling for `cursor.com` fetch

### Out of scope
- MCP servers (`cursor/mcp-servers`) — separate concern, deferred
- Cross-tool comparison view (e.g., "which vendors are on both") — future enhancement
- New Badge on tool tabs — future enhancement

## 3. Decisions

| Area | Decision |
|---|---|
| GNB | Tab bar below header: `Claude Code \| Cursor`. Shown on catalog pages only. |
| Routing | `/` redirects to `/claude-code/`. Each tool gets its own page. |
| Cursor marketplace source | `cursor.com/marketplace` HTML fetch → RSC payload `initialPlugins` parse |
| Cursor built-in source | `cursor.com/changelog` pages → `{"children":"/command"}` pattern extraction |
| First-party detection | Claude Code: `kind` field from repo directory. Cursor: `repositoryUrl === github.com/cursor/plugins` |
| Failure handling | If `cursor.com` fetch fails, log warning and return empty (don't block Claude Code polling) |
| Differ guard | Skip removal detection for a tool when it returned zero entries but previously had entries (transient failure protection) |
| Site components | Reuse existing Stats, SearchBox, FilterBar, EntryCard — no new components except ToolTabs |

## 4. Poller Architecture

### 4.1 New source adapters

```
poller/src/sources/
  ├── claude-plugins.ts           # existing
  ├── claude-builtin-skills.ts    # existing
  ├── cursor-marketplace.ts       # NEW
  ├── cursor-builtin-commands.ts  # NEW
  └── index.ts                    # register all 4
```

**`CursorMarketplaceSource`** (`tool: 'cursor'`)
- HTTP GET `https://cursor.com/marketplace`
- Extract RSC payload: `grep initialPlugins` → unescape → regex parse
- For each plugin: extract `name`, `displayName`, `description`, `repositoryUrl`, `tags`, `logoUrl`, `createdAt`
- `kind` determination: `repositoryUrl` contains `github.com/cursor/plugins` → `first-party`, else `third-party`
- Return `CatalogEntry[]`

**`CursorBuiltinCommandsSource`** (`tool: 'cursor'`)
- HTTP GET `cursor.com/changelog`, `/page/2`, `/page/3`, `/page/4`, `/page/5`
- Stop when page returns no commands
- Extract: `{"children":"/command-name"}` pattern from RSC payload
- Attempt description extraction from surrounding text
- Deduplicate across pages
- `id: 'builtin/worktree'` etc., `kind: 'first-party'`
- Return `CatalogEntry[]`

### 4.2 Registration

```typescript
export function registerSources(octokit: Octokit): Source[] {
  return [
    new ClaudePluginsSource(octokit),
    new ClaudeBuiltinSkillsSource(),
    new CursorMarketplaceSource(),
    new CursorBuiltinCommandsSource(),
  ]
}
```

### 4.3 Error handling

Both Cursor sources wrap fetch in try/catch. On failure:
- Log `[cursor-marketplace] fetch failed: <error>, skipping`
- Return empty array (not throw)
- Existing Claude Code sources unaffected

This means a `cursor.com` outage produces zero Cursor entries for that poll cycle, which the differ treats as "all removed". To avoid false removal events on transient failures, the differ should skip removal detection for a tool when that tool returned zero entries AND the previous snapshot had entries for it. This is a targeted guard, not a general mechanism.

### 4.4 No new dependencies

Both sources use Node.js built-in `https` module, same as `ClaudeBuiltinSkillsSource`. No npm packages added.

## 5. Site Architecture

### 5.1 Routing

| Route | Content |
|---|---|
| `/` | Static redirect → `/claude-code/` |
| `/claude-code/` | Claude Code catalog (Marketplace + Built-in Skills) |
| `/cursor/` | Cursor catalog (Marketplace + Built-in Commands) |
| `/entries/[tool]/[kind]/[...id]` | Entry detail (unchanged) |
| `/digests/` | All-tool digest archive (unchanged) |
| `/about/` | About page (unchanged) |

### 5.2 New component: ToolTabs.astro

```astro
---
interface Props { activeTool: 'claude-code' | 'cursor' }
const { activeTool } = Astro.props
---
<nav class="flex gap-0 border-b border-neutral-800 mb-8">
  <a href="/claude-code/" class:list={[activeTool === 'claude-code' && 'active']}>
    Claude Code
  </a>
  <a href="/cursor/" class:list={[activeTool === 'cursor' && 'active']}>
    Cursor
  </a>
</nav>
```

Active tab gets bottom border accent. Rendered only on `/claude-code/` and `/cursor/` pages.

### 5.3 Page structure

Both `/claude-code/index.astro` and `/cursor/index.astro` follow the same template:

```
ToolTabs (activeTool)
h1: "Marketplace Plugins"
p: "{count} plugins across {tool}'s marketplace."
Stats (entries filtered by tool, non-builtin)
SearchBox + FilterBar
EntryCard grid (marketplace entries)

--- separator ---

h2: "Built-in Skills" / "Built-in Commands"
p: "{count} {skills|commands} ..."
EntryCard grid (builtin entries)
```

### 5.4 Data layer changes

`site/src/lib/catalog.ts`:
```typescript
export function entriesForTool(tool: ToolId) {
  const all = catalog.entries.filter(e => e.tool === tool)
  return {
    plugins: all.filter(e => !isBuiltin(e)),
    builtins: all.filter(e => isBuiltin(e)),
  }
}
```

### 5.5 Layout changes

`BaseLayout.astro`:
- Remove "Catalog" from GNB nav (tab bar replaces it)
- Update footer data source text to mention both tools

### 5.6 Built-in section labels

| Tool | Section title | Subtitle |
|---|---|---|
| Claude Code | Built-in Skills | {n} skills embedded in the Claude Code CLI binary. |
| Cursor | Built-in Commands | {n} commands from Cursor changelog. |

## 6. Data Model

No changes to `CatalogEntry` or `SnapshotFile` types. Cursor entries use existing fields:

```typescript
{
  tool: 'cursor',
  kind: 'first-party' | 'third-party',  // based on repositoryUrl
  id: 'stripe' | 'builtin/worktree',
  name: 'Stripe' | '/worktree',
  description: '...',
  version: undefined,  // not available from RSC payload
  author: undefined,   // publisher name could go here
  source_url: 'https://github.com/stripe/ai',
  metadata: {
    extra: {
      builtin: true,        // for built-in commands
      displayName: 'Stripe', // from RSC payload
      tags: ['payments'],    // from RSC payload
    }
  },
  fetched_at: '...'
}
```

## 7. Testing

### Poller tests
- `cursor-marketplace.test.ts`: mock HTML with RSC payload, verify parsing + first-party detection
- `cursor-builtin-commands.test.ts`: mock changelog HTML, verify command extraction + dedup
- Existing differ tests already cover multi-tool scenarios (entries keyed by `tool/kind/id`)

### Site verification
- `npm run build` succeeds with 0 Cursor entries (conditional render)
- After poll: both `/claude-code/` and `/cursor/` render correctly
- Tab bar navigation works
- `/` redirects to `/claude-code/`

## 8. Risks

| Risk | Mitigation |
|---|---|
| RSC payload format changes | Regex-based extraction; monitor for parse failures in CI logs |
| `cursor.com` bot blocking in CI | GitHub Actions uses clean IPs; add User-Agent header; graceful skip on failure |
| Changelog doesn't list all commands | Documented limitation; label section as "from changelog" |
| Removed commands still appear | Future: cross-reference with latest changelog to detect removals |
