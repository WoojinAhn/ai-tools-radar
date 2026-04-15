// poller/src/enrich-stars.ts
import type { Octokit } from '@octokit/rest'
import type { CatalogEntry } from './sources/types.js'

const GITHUB_REPO_RE = /github\.com\/([^/]+)\/([^/?#]+)/

function parseGitHubRepo(url: string): { owner: string; repo: string } | null {
  const m = url.match(GITHUB_REPO_RE)
  if (!m) return null
  return { owner: m[1]!, repo: m[2]!.replace(/\.git$/, '') }
}

// Known shared registry repos — stars reflect the registry, not individual plugins
const SHARED_REPOS = new Set([
  'anthropics/claude-plugins-official',
  'anthropics/claude-plugins-public',
  'cursor/plugins',
])

function isSharedRepo(url: string): boolean {
  const m = url.match(GITHUB_REPO_RE)
  if (!m) return false
  const repo = `${m[1]}/${m[2]!.replace(/\.git$/, '')}`
  return SHARED_REPOS.has(repo)
}

function pickRepoUrl(entry: CatalogEntry): string | undefined {
  // Skip first-party — stars reflect the shared registry repo, not the plugin
  if (entry.kind === 'first-party') return undefined
  // Prefer homepage if it's a non-shared GitHub URL
  if (entry.homepage && GITHUB_REPO_RE.test(entry.homepage) && !isSharedRepo(entry.homepage)) {
    return entry.homepage
  }
  // Fall back to source_url if it's not a shared repo
  if (!isSharedRepo(entry.source_url)) return entry.source_url
  return undefined
}

export async function enrichStars(
  entries: CatalogEntry[],
  octokit: Octokit,
): Promise<void> {
  const toEnrich = entries
    .map((entry) => ({ entry, parsed: parseGitHubRepo(pickRepoUrl(entry) ?? '') }))
    .filter((x): x is { entry: CatalogEntry; parsed: { owner: string; repo: string } } => x.parsed !== null)

  // Clear stars from entries that won't be enriched (e.g. first-party with stale data)
  for (const entry of entries) {
    if (!toEnrich.some((x) => x.entry === entry)) {
      delete entry.metadata.extra.stars
    }
  }

  console.log(`[stars] enriching ${toEnrich.length}/${entries.length} entries`)

  let fetched = 0
  let failed = 0

  for (const { entry, parsed } of toEnrich) {
    try {
      const { data } = await octokit.repos.get({ owner: parsed.owner, repo: parsed.repo })
      entry.metadata.extra.stars = data.stargazers_count
      fetched++
    } catch {
      // Repo may be private, deleted, or rate-limited — skip silently
      failed++
    }
  }

  console.log(`[stars] done: ${fetched} fetched, ${failed} failed`)
}
