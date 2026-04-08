# CLAUDE.md

Repository-specific guidance for `ai-tools-radar`.

## Overview

`ai-tools-radar` polls official AI coding tool marketplaces, detects additions and metadata changes, and surfaces them through a static catalog site and per-change digests. First source is `anthropics/claude-plugins-official`; the source adapter layer is designed so Cursor and other tools can be added without touching the core.

Full design: `docs/superpowers/specs/2026-04-09-ai-tools-radar-design.md`. Start there before making non-trivial changes.

## Tech stack

- **Runtime:** Node 20, TypeScript everywhere. Single runtime for both the poller and the site.
- **Poller:** plain TypeScript + Octokit + Vitest.
- **Site:** Astro 5 with Tailwind. Content collection for digests via `glob` loader pointing at `../digests/`.
- **State:** Git. No database. `state/snapshot.json` is the current mirror; `state/events.jsonl` is the append-only event log; `catalog/data.json` is a rebuildable view for the site.
- **CI:** GitHub Actions. Two workflows: `daily-poll.yml` (cron) and `deploy-pages.yml` (on push).

## Repository layout

```
poller/    TypeScript poller (sources, differ, writers, tests)
site/      Astro static site
state/     Poller-written: snapshot.json, events.jsonl
catalog/   Poller-written: data.json (site reads this at build time)
digests/   Poller-written: one markdown file per change day
docs/      Design docs under docs/superpowers/specs/
```

The poller **writes** to `state/`, `catalog/`, `digests/`. The site **reads** from `catalog/` and `digests/`. Never the other direction.

## Running locally

```bash
# Poller
cd poller
npm ci
GITHUB_TOKEN=<your_pat_with_public_repo_read> npm run poll
npm test

# Site
cd site
npm ci
npm run dev       # local preview at http://localhost:4321
npm run build     # produces site/dist
```

A local poll writes real files under `state/`, `catalog/`, `digests/`. Review the diff before committing. To experiment without touching tracked state, use `git stash` or a throwaway branch.

## Conventions

### Commits
- Bug fix, feature, and any code-changing work **must be preceded by a GitHub issue**. This is the issue-first workflow from the global CLAUDE.md.
- Commit format: Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`).
- Prefer atomic commits. Group poller and site changes separately when possible.
- The poll workflow uses a generated commit message (`poller/out/commit-message.txt`) with a subject like `data: +2 plugins, ~1 metadata (2026-04-09)`.

### Code style
- TypeScript strict mode. No `any` unless justified in a comment.
- Poller modules are pure functions where possible. `Source.fetch()` takes no arguments; all IO is via an injected Octokit.
- Tests live under `poller/test/` and mirror the `src/` tree.
- Site components prefer static `.astro` over client islands. Add islands only for the two interactive pieces (search, filter).

### Data invariants
- `state/snapshot.json` entries are sorted by key before serialization so byte-identical states produce byte-identical files.
- `state/events.jsonl` is append-only. Never rewrite prior lines.
- Diffing ignores `source_url` and `fetched_at` — both are noise.
- First run is special: bootstrap mode writes the snapshot without emitting events or a digest.

## Idempotency

The same fetch against the same snapshot must produce zero writes. Test this explicitly in the differ tests. If you find yourself adding "have I already processed this?" checks, the snapshot design is likely being bypassed — revisit the design doc before proceeding.

## When in doubt

- Re-read `docs/superpowers/specs/2026-04-09-ai-tools-radar-design.md`.
- The design's Section 9 (Error Handling) and Section 10 (Edge Cases) cover most decisions you'd otherwise have to reinvent.
- If the design is wrong, update it before writing code. Do not let the code and the spec drift.
