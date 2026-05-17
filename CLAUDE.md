# CLAUDE.md

Repository-specific guidance for `ai-tools-radar`.

## Overview

`ai-tools-radar` polls AI coding tool ecosystems, detects additions and metadata changes, and surfaces them through a static catalog site and per-change digests. Four source adapters are active:

| Source | Tool | Method |
|---|---|---|
| `ClaudePluginsSource` | Claude Code | GitHub API → `anthropics/claude-plugins-official` `marketplace.json` |
| `ClaudeBuiltinSkillsSource` | Claude Code | npm registry → `cli.js` bundle parsing |
| `CursorMarketplaceSource` | Cursor | `cursor.com/marketplace` → RSC payload parsing |
| `CursorBuiltinCommandsSource` | Cursor | `cursor.com/changelog` → RSC payload parsing |

Full design: `docs/superpowers/specs/2026-04-09-ai-tools-radar-design.md` (original) and `docs/superpowers/specs/2026-04-11-cursor-support-design.md` (Cursor extension). Start there before making non-trivial changes.

## Tech stack

- **Runtime:** Node 20, TypeScript everywhere. Single runtime for both the poller and the site.
- **Poller:** plain TypeScript + Octokit + npm registry API + `cursor.com` HTML parsing + Vitest.
- **Site:** Astro 5 with Tailwind. Content collection for digests via `glob` loader pointing at `../digests/`.
- **State:** Git. No database. `state/snapshot.json` is the current mirror; `state/events.jsonl` is the append-only event log; `catalog/data.json` is a rebuildable view for the site.
- **CI:** GitHub Actions. Three workflows: `daily-poll.yml` (cron poll + conditional commit), `deploy-pages.yml` (build + deploy on push to main), and `ci.yml` (poller typecheck + tests + site build on PRs and push to main).

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
- `ClaudePluginsSource` reads `marketplace.json` via Octokit (single API call for all plugins — local + external). `ClaudeBuiltinSkillsSource` fetches the platform-specific native binary (`@anthropic-ai/claude-code-linux-x64`) from the npm registry — since claude-code 2.1.116 the wrapper no longer ships `cli.js`, but the JS source is embedded verbatim in the Bun-compiled binary. Both Cursor sources use `fetchHtml()` from `src/sources/http.ts` to parse `cursor.com` HTML pages.
- Claude Code built-in skill extraction matches BOTH registration forms in the bundle: function-call (`fn({name:"..."`) and object-literal (`={type:"prompt",...,name:"..."}`). Each candidate is validated by `getPromptForCommand` proximity. Description extraction is bounded to the enclosing object literal via brace-balanced scanning (skipping string contents) so adjacent skill objects can't cross-contaminate. Skills whose description is an identifier reference (not statically resolvable) are filled via a small `BUILTIN_DESCRIPTION_FALLBACK` map.
- Cursor built-in commands parser decodes `__next_f.push([1, "..."])` chunks → walks the RSC tree → picks each command's innermost enclosing `<p>`/`<li>`. Scans up to 20 changelog pages with an early stop after two consecutive empty/404 pages. Commands whose description self-declares removal (e.g. `"/X removed."`, `"/X is deprecated"`) are dropped; the check inspects ALL occurrences of a name, not just the first.
- Cursor marketplace extraction parses `initialPlugins` from Next.js RSC payload. First-party detection: `repositoryUrl === github.com/cursor/plugins`.
- Tests live under `poller/test/` and mirror the `src/` tree.
- Site components prefer static `.astro` over client islands. Add islands only for the two interactive pieces (search, filter).
- The site's canonical Claude Code catalog lives at `/`; `/claude-code/` is a meta-refresh redirect kept for bookmark continuity. Cursor lives at `/cursor/`. `ToolTabs.astro` links Claude Code → `/` (no extra hop) and Cursor → `/cursor/`.
- Built-in entries are identified by `metadata.extra.builtin === true`.
- Entry detail routes use `[...id]` (rest param) because built-in IDs contain slashes (e.g. `builtin/simplify`).

### Data invariants
- `state/snapshot.json` entries are sorted by key before serialization so byte-identical states produce byte-identical files.
- `state/events.jsonl` is append-only. Never rewrite prior lines.
- Diffing ignores `source_url` (noise). `fetched_at` is preserved on `state/snapshot.json` but no longer serialized into `catalog/data.json` so data-only commits don't churn every entry on every poll.
- Differ has a transient-failure guard: if a tool returns zero entries but previously had entries, removals for that tool are skipped (prevents false removal events when `cursor.com` is unreachable).
- First run is special: bootstrap mode writes the snapshot without emitting events or a digest.

## Idempotency

The same fetch against the same snapshot must produce zero writes. Test this explicitly in the differ tests. If you find yourself adding "have I already processed this?" checks, the snapshot design is likely being bypassed — revisit the design doc before proceeding.

## When in doubt

- Re-read `docs/superpowers/specs/2026-04-09-ai-tools-radar-design.md` (original design).
- Re-read `docs/superpowers/specs/2026-04-11-cursor-support-design.md` (Cursor extension).
- The original design's Section 9 (Error Handling) and Section 10 (Edge Cases) cover most decisions you'd otherwise have to reinvent.
- If the design is wrong, update it before writing code. Do not let the code and the spec drift.
