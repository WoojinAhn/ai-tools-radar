# ai-tools-radar — Design Document

- **Date:** 2026-04-09
- **Status:** Draft (pending implementation plan)
- **Author:** WoojinAhn (brainstormed with Claude)

## 1. Purpose

Track additions and metadata changes to the Claude Code plugin marketplace (`anthropics/claude-plugins-official`) through a static catalog site and per-change digests, replacing the noisy commit-level email notifications from GitHub watch.

The system is designed to extend to additional AI coding tool ecosystems (Cursor, etc.) via a source adapter layer, without requiring a rewrite.

## 2. Scope

### In scope (v1)
- Daily polling of `anthropics/claude-plugins-official`
- Detecting added / removed plugins and metadata (`plugin.json`) changes
- Static catalog site (Astro) hosted on GitHub Pages
- Per-change digest as a markdown file under `digests/` **and** a GitHub Issue
- Source adapter abstraction ready for future tools

### Out of scope (v1)
- Cursor or other non-Claude marketplaces (infrastructure ready, implementation deferred)
- Email or Slack delivery (GitHub Issue notifications are sufficient)
- Tracking content-level changes inside each plugin (skills/commands/agents file edits)
- Authentication, user accounts, any dynamic site behavior
- Historical data backfill prior to bootstrap

## 3. Decisions Summary

| Area | Decision |
|---|---|
| Form factor | Static catalog site + per-change digest (issue + markdown file) |
| Change granularity | Plugin add/remove + `plugin.json` metadata changes |
| Runtime | GitHub Actions in dedicated repo `WoojinAhn/ai-tools-radar` |
| Poll frequency | Daily at 09:00 KST (00:00 UTC) |
| Digest cadence | Only on days with actual changes (no-change days are silent) |
| Digest delivery | `digests/YYYY-MM-DD.md` committed + GitHub Issue opened |
| Extensibility | `Source` interface with `ClaudePluginsSource` as the first implementation |
| Site stack | Astro with Tailwind |
| Poller language | TypeScript (Node), single runtime across the project |
| State storage | Git (no database); append-only `events.jsonl` is the event log |

## 4. Architecture

### 4.1 High-level flow

```
cron 09:00 KST
   │
   ▼
┌──────────────────────────────────────────┐
│ daily-poll.yml                           │
│   1. checkout                            │
│   2. npm ci (poller)                     │
│   3. npm run poll                        │
│      ├─ Source.fetch()                   │
│      ├─ diff vs snapshot.json            │
│      ├─ write state/, catalog/, digests/ │
│      └─ write poller/out/ artifacts      │
│   4. commit & push (if changed)          │
│   5. gh issue create (if changed)        │
└──────────────────────────────────────────┘
          │ git push
          ▼
┌──────────────────────────────────────────┐
│ deploy-pages.yml (paths filter triggered)│
│   1. npm ci && npm run build (site)      │
│   2. upload-pages-artifact               │
│   3. deploy-pages                        │
└──────────────────────────────────────────┘
```

The poller and site build are **completely independent workflows**. The poller writes files and the site builds from those files. Neither knows about the other.

### 4.2 Repository layout

```
ai-tools-radar/
├── .github/workflows/
│   ├── daily-poll.yml          # cron + poller
│   └── deploy-pages.yml        # on push, build + deploy site
├── poller/                      # TypeScript
│   ├── src/
│   │   ├── sources/
│   │   │   ├── types.ts
│   │   │   ├── claude-plugins.ts
│   │   │   └── index.ts
│   │   ├── differ.ts
│   │   ├── writers/
│   │   │   ├── snapshot.ts
│   │   │   ├── events.ts
│   │   │   ├── catalog.ts
│   │   │   ├── digest-md.ts
│   │   │   └── digest-issue.ts
│   │   └── main.ts
│   ├── test/
│   ├── package.json
│   └── tsconfig.json
├── site/                        # Astro
│   ├── src/
│   │   ├── content.config.ts
│   │   ├── lib/
│   │   ├── components/
│   │   ├── layouts/
│   │   └── pages/
│   ├── astro.config.mjs
│   ├── tailwind.config.mjs
│   └── package.json
├── state/                       # written by poller
│   ├── snapshot.json
│   └── events.jsonl
├── catalog/
│   └── data.json
├── digests/
│   └── YYYY-MM-DD.md
├── docs/superpowers/specs/
│   └── 2026-04-09-ai-tools-radar-design.md
├── CLAUDE.md
└── README.md
```

### 4.3 Principles

1. **Git is the database.** All state lives in tracked files. `git log` is the audit trail.
2. **Append-only event stream.** `state/events.jsonl` is the single source of truth for "what happened when". The catalog and site are derived views.
3. **Poller and site are strictly decoupled.** The poller never renders HTML; the site never mutates state.

## 5. Source Adapter Layer

### 5.1 Types

```ts
export type ToolId = 'claude-code' | 'cursor'
export type EntryKind = 'first-party' | 'third-party'

export interface CatalogEntry {
  tool: ToolId
  kind: EntryKind
  id: string                  // unique within (tool, kind)

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
    extra: Record<string, unknown>   // forward-compatible catch-all
  }

  fetched_at: string          // ISO8601
}

export interface Source {
  readonly tool: ToolId
  readonly id: string         // 'anthropics/claude-plugins-official'
  fetch(): Promise<CatalogEntry[]>
}
```

### 5.2 `ClaudePluginsSource`

- Uses Octokit authenticated with `GITHUB_TOKEN`
- Lists `plugins/` and `external_plugins/` directory contents
- For each plugin subdirectory, fetches `.claude-plugin/plugin.json` (path to confirm during implementation)
- Maps raw JSON into `CatalogEntry`, moving known fields to the top level and parking unknown fields in `metadata.extra`
- Falls back gracefully if `plugin.json` is missing or malformed (logs a warning, still returns an entry keyed on the directory name)

### 5.3 Extending to Cursor later

Adding a new source requires:
1. A new file under `poller/src/sources/` implementing `Source`
2. One line added to `registerSources()` in `sources/index.ts`

**Zero modifications** to the differ, writers, catalog, or site. `CatalogEntry` is the contract.

## 6. Data Model

### 6.1 `state/snapshot.json`

```jsonc
{
  "schema_version": 1,
  "generated_at": "2026-04-09T00:00:00Z",
  "entries": {
    "claude-code/first-party/code-review": { /* CatalogEntry */ },
    "claude-code/third-party/linear":      { /* CatalogEntry */ }
  }
}
```

Key format: `{tool}/{kind}/{id}`. Entries are sorted by key before serialization so byte-identical marketplace states produce byte-identical files.

### 6.2 `state/events.jsonl`

Append-only, one JSON object per line. Three event types:

```jsonl
{"ts":"2026-04-09T00:00:00Z","type":"added","key":"claude-code/first-party/foo","entry":{...}}
{"ts":"2026-04-09T00:00:00Z","type":"removed","key":"claude-code/first-party/bar","previous":{...}}
{"ts":"2026-04-09T00:00:00Z","type":"updated","key":"claude-code/first-party/baz","changes":[{"path":"version","before":"1.0.0","after":"1.1.0"}]}
```

**Diff rules:**
- `added`: key present in current fetch only
- `removed`: key present in prior snapshot only
- `updated`: key in both but one or more of `name`, `description`, `version`, `author`, `homepage`, or any field in `metadata` differs (compared by structural deep equality)
- `source_url` and `fetched_at` are **excluded** from comparison (meaningless churn)
- Field-level diff for `updated` events walks the top-level comparable fields plus each key under `metadata` (including `metadata.extra`), emitting one `{path, before, after}` entry per differing leaf

Updates carry a field-level `changes` array so the digest can render specific before→after messages.

### 6.3 `catalog/data.json`

```jsonc
{
  "schema_version": 1,
  "generated_at": "2026-04-09T00:00:00Z",
  "entries": [
    {
      /* CatalogEntry fields */,
      "first_seen_at": "2026-03-15T00:00:00Z",
      "last_updated_at": "2026-04-09T00:00:00Z"
    }
  ],
  "stats": {
    "total": 50,
    "by_tool": { "claude-code": 50 },
    "by_kind": { "first-party": 32, "third-party": 18 }
  }
}
```

`first_seen_at` and `last_updated_at` are **derived** by folding `events.jsonl`. The catalog is a rebuildable view; deleting it and regenerating from snapshot + events is always safe.

### 6.4 `digests/YYYY-MM-DD.md`

```markdown
---
date: 2026-04-09
added: 2
removed: 0
updated: 1
---

# ai-tools-radar — 2026-04-09

## Added (2)

- **Claude Code · first-party · [cool-plugin](...)** — description

## Updated (1)

- **Claude Code · first-party · [code-review](...)**
  - `version`: `1.0.0` → `1.1.0`
```

Frontmatter is consumed by the Astro content collection so digest list pages can display counts without parsing bodies.

## 7. Workflows

### 7.1 `daily-poll.yml`

- **Trigger:** cron `0 0 * * *` (09:00 KST) and `workflow_dispatch`
- **Permissions:** `contents: write`, `issues: write`
- **Concurrency:** serialized via `group: daily-poll`
- **Steps:**
  1. Checkout
  2. Setup Node 20 with npm cache keyed on `poller/package-lock.json`
  3. `npm ci` in `poller/`
  4. `npm run poll` — poller writes state/, catalog/, digests/ and artifacts to `poller/out/`
  5. Shell step: if `git status --porcelain` is non-empty, commit with `-F poller/out/commit-message.txt` and push. Set a step output `changed=true|false`.
  6. If `changed=true`, `gh issue create --title "$(cat poller/out/issue-title.txt)" --body-file poller/out/issue-body.md --label digest`

The poller itself has **no external side effects** — it only writes files under the repo. The workflow owns git and issue creation so the poller stays testable.

### 7.2 `deploy-pages.yml`

- **Trigger:** push to `main` with paths filter (`site/**`, `catalog/data.json`, `digests/**`, the workflow file itself), plus `workflow_dispatch`
- **Permissions:** `contents: read`, `pages: write`, `id-token: write`
- **Concurrency:** `group: pages`, `cancel-in-progress: true`
- **Jobs:**
  - `build`: `npm ci && npm run build` in `site/`, then `actions/upload-pages-artifact@v3`
  - `deploy`: depends on build, uses `actions/deploy-pages@v4`

When the daily poll commits a change, this workflow auto-chains, producing a full "poll → deploy" pipeline from a single cron tick.

## 8. Site (Astro)

### 8.1 Pages

| Route | Purpose |
|---|---|
| `/` | Catalog with search and filters |
| `/digests/` | List of all digests (newest first) |
| `/digests/[slug]/` | Single digest rendered from markdown |
| `/entries/[tool]/[kind]/[id]/` | Individual plugin detail page |
| `/about/` | Short explanation of the project |

### 8.2 Data loading

- **Catalog:** `site/src/lib/catalog.ts` imports `../../../catalog/data.json` at build time. Fully static, no runtime fetch.
- **Digests:** Astro 5 content collection with a custom `glob` loader pointing at `../digests/*.md`. No duplication of files into `site/src/content/`.

### 8.3 Interactivity budget

- All content is static HTML by default.
- Exactly two client islands: `SearchBox` and `FilterBar`, both `client:visible`.
- For ~50-100 entries, filtering toggles CSS classes on pre-rendered cards. No virtualization, no client-side data fetching.

### 8.4 "New" badge

An entry gets a `New` badge if `now - first_seen_at < 7d`. Computed at build time from `catalog/data.json`.

## 9. Error Handling

### 9.1 Fetch failures (API, network, rate limit)

- Fail the poller process with a non-zero exit code. GitHub Actions marks the run failed and notifies via the user's existing Actions notification settings.
- **No retries.** The next day's cron is the retry. Retry logic adds state-corruption risk without real value at this scale.
- **No partial writes.** If fetch fails midway, the snapshot is not updated, so the next run sees the exact same prior state and re-attempts cleanly.

### 9.2 Malformed or missing `plugin.json`

- Per-entry errors are isolated: log a warning and emit a fallback entry derived from the directory name.
- A single bad plugin never fails the whole poll.
- Once upstream fixes the file, the next run emits an `updated` event automatically.

### 9.3 Concurrent runs

- `concurrency.group: daily-poll` serializes scheduled and manual runs. Git push conflicts are structurally impossible.

### 9.4 Rate limits

- `GITHUB_TOKEN` provides 5000 requests/hour.
- Each poll makes roughly `2 directory listings + ~50 plugin.json reads ≈ 52 requests`.
- Headroom is ~100x. No throttling needed.

## 10. Edge Cases

### 10.1 First run (bootstrap mode)

**Problem:** Without a prior snapshot, every entry would be classified as `added`, producing a massive first digest.

**Solution:** If `state/snapshot.json` does not exist:
1. Fetch the current marketplace
2. Write `snapshot.json` and `catalog/data.json`
3. Do not append to `events.jsonl`
4. Do not emit a digest
5. Commit with message `chore: bootstrap initial snapshot (N entries)`

Normal diff behavior resumes on the second run.

### 10.2 Multiple runs on the same day

Idempotency falls out of the design: the snapshot is the SSOT, and fetching the same upstream twice against the same snapshot yields an empty diff. The second run performs no writes and exits quietly.

### 10.3 API response ordering churn

Entries are sorted by key before serialization. Stable output regardless of API ordering.

### 10.4 Schema version changes

`schema_version` fields exist on snapshot and catalog. v1 behavior on mismatch: exit with a descriptive error so a human can run a one-off migration. Automated migrations can be added later if needed.

## 11. Testing

**Principle:** test only the parts that are easy to get wrong. The full system is small enough that a green poller + a building site is strong evidence of correctness.

### 11.1 Unit tests (Vitest, in `poller/test/`)

- `differ.test.ts` — the highest-value target
  - Empty → N entries → N `added` events
  - Identical snapshots → 0 events (**idempotency**)
  - Removed entries
  - Version bump → `updated` with correct field-level diff
  - Reordered entries → 0 events
- `digest-renderer.test.ts` — events in, markdown out
- `commit-message.test.ts` — events in, commit message out
- `sources/claude-plugins.test.ts` — mock Octokit, verify `CatalogEntry` mapping and fallback behavior

### 11.2 Site tests

None. Astro's build step is the safety net — a type or data-shape error fails the build.

### 11.3 CI integration

`daily-poll.yml` runs `npm test` in `poller/` before `npm run poll`. Test failures abort the poll.

## 12. Observability

- GitHub Actions run logs are the only observability layer.
- The poller logs milestones: `[poller] fetched 50 entries`, `[poller] 2 added, 0 removed, 1 updated`, `[poller] no changes, exiting`.
- No metrics backend, no alerting stack. A failed run produces a GitHub notification, which is enough at this scale.

## 13. Open questions for implementation

- **`.claude-plugin/plugin.json` exact path inside plugin subdirectories** — needs confirmation from the actual repo structure during the first `ClaudePluginsSource` implementation.
- **Digest issue labels** — is `digest` enough, or do we want `digest`, `digest:added`, `digest:updated` for filtering? Deferred until we've seen a few real digests.
- **Astro template selection** — start from `npm create astro -- --template minimal` or build from scratch? Minimal template recommended to avoid fighting defaults.

## 14. Future work (explicitly not in v1)

- Cursor and other tool sources
- Digest RSS feed
- Per-plugin change history page (via `events.jsonl` fold)
- Discord/Slack webhook delivery
- Search over digest content

## 15. Implementation strategy (parallelization hint)

The user has requested that implementation be broken into issues that can be worked in parallel where possible. The natural parallel streams are:

- **Stream A — Poller core:** Source interface, `ClaudePluginsSource`, Differ, Writers. Pure logic, fully unit-testable.
- **Stream B — Site scaffold:** Astro project, layout, `EntryCard`, `Stats`, routes. Can develop against a hand-written fixture `catalog/data.json`.
- **Stream C — Workflows + wiring:** `daily-poll.yml`, `deploy-pages.yml`, `poller/out/` artifact emission, bootstrap mode. Depends on Stream A being minimally runnable.
- **Stream D — Polish:** Search/filter islands, digest list page, entry detail page. Depends on Stream B.

Streams A and B can start in parallel. C follows A. D follows B. The detailed breakdown lives in the implementation plan (see `writing-plans` output).
