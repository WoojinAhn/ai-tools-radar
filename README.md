# ai-tools-radar

Tracks additions and metadata changes in AI coding tool ecosystems and surfaces them through a [static catalog](https://woojinahn.github.io/ai-tools-radar/) and per-change digests.

Currently tracking **170 entries** across two tools:

| Tool | Marketplace Plugins | Built-in |
|---|---|---|
| **Claude Code** | 50 (33 first-party + 17 third-party) | 10 skills (npm bundle) |
| **Cursor** | 91 (5 first-party + 86 third-party) | 19 commands (changelog) |

## How it works

```
cron 09:00 KST (daily)
  │
  ├─ Claude Code: fetch marketplace via GitHub API
  ├─ Claude Code: fetch built-in skills via npm registry (parse cli.js bundle)
  ├─ Cursor: fetch marketplace via cursor.com/marketplace (RSC payload parse)
  ├─ Cursor: fetch built-in commands via cursor.com/changelog
  ├─ Diff against state/snapshot.json
  │
  ├─ No changes → exit silently
  │
  └─ Changes detected:
       ├─ Update snapshot + catalog + events log
       ├─ Generate digests/YYYY-MM-DD.md
       ├─ Commit & push → triggers Pages rebuild
       └─ Open a GitHub Issue ("Daily Digest — YYYY-MM-DD")
```

On days when nothing changes, nothing happens — no commit, no issue, no noise.

## Live site

**https://woojinahn.github.io/ai-tools-radar/**

- Tool tabs: Claude Code / Cursor (separate pages)
- Marketplace Plugins catalog with search and filter (first-party / third-party)
- Built-in Skills / Commands section per tool
- Per-entry detail pages
- Digest archive (one entry per change day)

## Repository structure

```
poller/          TypeScript — fetches, diffs, writes state
  src/sources/     4 source adapters:
                     ClaudePluginsSource (GitHub API)
                     ClaudeBuiltinSkillsSource (npm registry)
                     CursorMarketplaceSource (cursor.com HTML)
                     CursorBuiltinCommandsSource (cursor.com HTML)
  src/writers/     Snapshot, events, catalog, digest, artifacts
  src/differ.ts    Pure diff engine (field-level changes)
  src/main.ts      Orchestrator with bootstrap mode
  test/            50 unit tests (Vitest)

site/            Astro 5 + Tailwind 4 — static catalog site
  src/pages/       /claude-code/, /cursor/, digests, entries, about
  src/components/  ToolTabs, EntryCard, Stats, NewBadge, SearchBox, FilterBar

state/           Poller-written (committed to git)
  snapshot.json    Current mirror (all tools)
  events.jsonl     Append-only change log (SSOT)

catalog/
  data.json        Derived view for the site (rebuildable)

digests/
  YYYY-MM-DD.md    One file per change day (frontmatter + markdown)

.github/workflows/
  daily-poll.yml   Cron + poller + conditional commit + issue
  deploy-pages.yml On push, build Astro and deploy to Pages
```

## Tech stack

- **Runtime:** Node 20, TypeScript strict
- **Poller:** Octokit, npm registry API, cursor.com HTML parsing, Vitest
- **Site:** Astro 5 (static), Tailwind 4, React (two client islands only)
- **CI/CD:** GitHub Actions, GitHub Pages
- **Database:** None — git is the database

## Running locally

```bash
# Poller
cd poller
npm ci
npm test                                          # 50 tests
GITHUB_TOKEN=$(gh auth token) npm run poll        # fetches real data

# Site
cd site
npm ci
npm run dev                                       # http://localhost:4321
npm run build                                     # produces site/dist/
```

## Adding a new source

1. Create `poller/src/sources/<tool>-*.ts` implementing the `Source` interface
2. Add one line to `poller/src/sources/index.ts` → `registerSources()`
3. Add a tool page at `site/src/pages/<tool>/index.astro`
4. Add a tab entry in `site/src/components/ToolTabs.astro`

The `CatalogEntry` interface is the universal contract. Everything downstream (differ, writers, catalog) works with any `Source` that returns `CatalogEntry[]`.

## Design docs

- **Original spec:** [`docs/superpowers/specs/2026-04-09-ai-tools-radar-design.md`](docs/superpowers/specs/2026-04-09-ai-tools-radar-design.md)
- **Cursor support spec:** [`docs/superpowers/specs/2026-04-11-cursor-support-design.md`](docs/superpowers/specs/2026-04-11-cursor-support-design.md)
- **Cursor support plan:** [`docs/superpowers/plans/2026-04-11-cursor-support.md`](docs/superpowers/plans/2026-04-11-cursor-support.md)
