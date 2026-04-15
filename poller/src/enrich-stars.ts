// poller/src/enrich-stars.ts
import type { Octokit } from '@octokit/rest'
import type { CatalogEntry } from './sources/types.js'

const GITHUB_REPO_RE = /github\.com\/([^/]+)\/([^/?#]+)/

function parseGitHubRepo(url: string): { owner: string; repo: string } | null {
  const m = url.match(GITHUB_REPO_RE)
  if (!m) return null
  return { owner: m[1]!, repo: m[2]!.replace(/\.git$/, '') }
}

export async function enrichStars(
  entries: CatalogEntry[],
  octokit: Octokit,
): Promise<void> {
  const toEnrich = entries
    .map((entry) => ({ entry, parsed: parseGitHubRepo(entry.source_url) }))
    .filter((x): x is { entry: CatalogEntry; parsed: { owner: string; repo: string } } => x.parsed !== null)

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
