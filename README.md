# ai-tools-radar

Tracks additions and metadata changes in official AI coding tool marketplaces and surfaces them through a [static catalog](https://woojinahn.github.io/ai-tools-radar/) and per-change digests.

Currently tracking **50 marketplace plugins** from [`anthropics/claude-plugins-official`](https://github.com/anthropics/claude-plugins-official) (33 first-party + 17 third-party) and **10 built-in skills** extracted from the Claude Code npm bundle. Designed to extend to Cursor and other tools via a source adapter layer.

## How it works

```
cron 09:00 KST (daily)
  │
  ├─ Fetch marketplace via GitHub API
  ├─ Fetch built-in skills via npm registry (parse cli.js bundle)
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

- Catalog with search and filter (first-party / third-party)
- Per-plugin detail pages
- Digest archive (one entry per change day)

## Repository structure

```
poller/          TypeScript — fetches, diffs, writes state
  src/sources/     Source adapters (ClaudePluginsSource, ClaudeBuiltinSkillsSource)
  src/writers/     Snapshot, events, catalog, digest, artifacts
  src/differ.ts    Pure diff engine (field-level changes)
  src/main.ts      Orchestrator with bootstrap mode
  test/            26 unit tests (Vitest)

site/            Astro 5 + Tailwind 4 — static catalog site
  src/pages/       Catalog index, digest archive, entry detail, about
  src/components/  EntryCard, Stats, NewBadge, SearchBox, FilterBar

state/           Poller-written (committed to git)
  snapshot.json    Current marketplace mirror
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
- **Poller:** Octokit, Vitest, npm registry API
- **Site:** Astro 5 (static), Tailwind 4, React (two client islands only)
- **CI/CD:** GitHub Actions, GitHub Pages
- **Database:** None — git is the database

## Running locally

```bash
# Poller
cd poller
npm ci
npm test                                          # 26 tests
GITHUB_TOKEN=$(gh auth token) npm run poll        # fetches real data

# Site
cd site
npm ci
npm run dev                                       # http://localhost:4321
npm run build                                     # produces site/dist/
```

## Adding a new source (e.g., Cursor)

1. Create `poller/src/sources/cursor-*.ts` implementing the `Source` interface
2. Add one line to `poller/src/sources/index.ts` → `registerSources()`
3. Zero changes to the differ, writers, catalog, or site

The `CatalogEntry` interface is the universal contract. Everything downstream works with any `Source` that returns `CatalogEntry[]`.

## Design docs

- **Spec:** [`docs/superpowers/specs/2026-04-09-ai-tools-radar-design.md`](docs/superpowers/specs/2026-04-09-ai-tools-radar-design.md)
- **Plan:** [`docs/superpowers/plans/2026-04-09-ai-tools-radar.md`](docs/superpowers/plans/2026-04-09-ai-tools-radar.md)
