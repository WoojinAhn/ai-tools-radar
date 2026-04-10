// poller/src/sources/cursor-builtin-commands.ts
import { fetchHtml } from './http.js'
import type { CatalogEntry, Source } from './types.js'

const CHANGELOG_BASE = 'https://cursor.com/changelog'
const MAX_PAGE = 5

/** Pattern for RSC payload entries like `{"children":"/worktree"}` */
const COMMAND_RE = /\{"children":"(\/[a-z][\w-]*)"\}/g

/**
 * Parse Cursor built-in commands from RSC HTML payload(s).
 * Exported for testing.
 */
export function parseCommands(html: string): CatalogEntry[] {
  // Unescape HTML-encoded quotes
  const unescaped = html.replace(/\\\\"/g, '"').replace(/\\"/g, '"')

  const entries: CatalogEntry[] = []
  const seen = new Set<string>()
  const now = new Date().toISOString()

  let match: RegExpExecArray | null
  while ((match = COMMAND_RE.exec(unescaped)) !== null) {
    const commandName = match[1]!
    if (seen.has(commandName)) continue
    seen.add(commandName)

    // Try extracting a description from the surrounding text.
    // Pattern: {"children":"/command"}],"<description>"
    const descRe = new RegExp(
      `\\{"children":"${commandName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\}\\],"([^"]{10,})"`,
    )
    const descMatch = descRe.exec(unescaped)
    const description = descMatch ? descMatch[1] : undefined

    const idName = commandName.slice(1) // remove leading /

    entries.push({
      tool: 'cursor',
      kind: 'first-party',
      id: `builtin/${idName}`,
      name: commandName,
      description,
      source_url: CHANGELOG_BASE,
      metadata: { extra: { builtin: true } },
      fetched_at: now,
    })
  }

  return entries
}

export class CursorBuiltinCommandsSource implements Source {
  readonly tool = 'cursor' as const
  readonly id = 'cursor-builtin-commands'

  async fetch(): Promise<CatalogEntry[]> {
    try {
      console.log('[cursor-builtin-commands] fetching changelog pages')
      const pages: string[] = []

      // Fetch page 1 (base URL) and pages 2..MAX_PAGE
      pages.push(await fetchHtml(CHANGELOG_BASE))
      for (let p = 2; p <= MAX_PAGE; p++) {
        pages.push(await fetchHtml(`${CHANGELOG_BASE}/page/${p}`))
      }

      const combined = pages.join('\n')
      const entries = parseCommands(combined)
      console.log(`[cursor-builtin-commands] found ${entries.length} built-in commands`)
      return entries
    } catch (err) {
      console.warn('[cursor-builtin-commands] fetch failed, returning empty:', err)
      return []
    }
  }
}
