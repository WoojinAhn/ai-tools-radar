// poller/src/sources/cursor-builtin-commands.ts
import { fetchHtml } from './http.js'
import type { CatalogEntry, Source } from './types.js'

const CHANGELOG_BASE = 'https://cursor.com/changelog'
const MAX_PAGE = 5

/** Pattern for an RSC `code` element wrapping a slash command. */
const COMMAND_RE = /\{"children":"(\/[a-z][\w-]*)"\}/g

/** Opener for `<p>`/`<li>` RSC elements that contain inline text. */
const CONTAINER_OPENER_RE = /\["\$","(?:p|li)",null,\{"children":/g

/** Decoder for the `__next_f.push([1, "..."])` chunks Next.js emits with the RSC stream. */
const RSC_CHUNK_RE = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g

/**
 * Decode every `__next_f.push([1, "..."])` JS-string chunk in the page and
 * concatenate them into the underlying RSC payload string.
 *
 * The earlier double-`replace` unescaper was lossy: it conflated outer JS-string
 * escapes with inner JSON-string escapes, breaking JSON parsing on any element
 * whose text contained an embedded quote.
 */
function decodeRscPayload(html: string): string {
  const out: string[] = []
  let m: RegExpExecArray | null
  RSC_CHUNK_RE.lastIndex = 0
  while ((m = RSC_CHUNK_RE.exec(html)) !== null) {
    try {
      out.push(JSON.parse('"' + m[1]! + '"') as string)
    } catch {
      // skip malformed chunks
    }
  }
  return out.join('')
}

/**
 * Walk forward from an opening `[` to its matching `]`, skipping over JSON
 * string contents. Returns the index of the closing `]`, or -1 if not found
 * within `maxLen` chars.
 */
function findArrayEnd(s: string, openIdx: number, maxLen = 50000): number {
  const limit = Math.min(s.length, openIdx + maxLen)
  let depth = 0
  let i = openIdx
  while (i < limit) {
    const c = s[i]
    if (c === '"') {
      i++
      while (i < limit) {
        if (s[i] === '\\') { i += 2; continue }
        if (s[i] === '"') { i++; break }
        i++
      }
      continue
    }
    if (c === '[') depth++
    else if (c === ']') {
      depth--
      if (depth === 0) return i
    }
    i++
  }
  return -1
}

/**
 * Extract human-visible text from a parsed RSC node, recursively. Supports the
 * `["$", tag, key, props]` element form and arbitrary children arrays. RSC
 * sentinel strings (`$L1f`, `$undefined`) are dropped.
 */
function extractText(node: unknown, out: string[]): void {
  if (typeof node === 'string') {
    if (/^\$(L?[0-9a-f]+|undefined)$/i.test(node)) return
    out.push(node)
    return
  }
  if (Array.isArray(node)) {
    if (
      node.length === 4 &&
      node[0] === '$' &&
      typeof node[1] === 'string' &&
      typeof node[3] === 'object' &&
      node[3] !== null &&
      'children' in (node[3] as Record<string, unknown>)
    ) {
      extractText((node[3] as Record<string, unknown>).children, out)
      return
    }
    for (const child of node) extractText(child, out)
  }
}

interface Container {
  start: number
  end: number
  text: string
}

/**
 * Locate every `<p>`/`<li>` element in the payload, parse it as JSON, and
 * extract its concatenated text. Containers are returned in document order.
 */
function findContainers(payload: string): Container[] {
  const containers: Container[] = []
  CONTAINER_OPENER_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = CONTAINER_OPENER_RE.exec(payload)) !== null) {
    const end = findArrayEnd(payload, m.index)
    if (end === -1) continue
    const slice = payload.slice(m.index, end + 1)
    let parsed: unknown
    try {
      parsed = JSON.parse(slice)
    } catch {
      continue
    }
    const parts: string[] = []
    extractText(parsed, parts)
    const text = parts.join('').replace(/\s+/g, ' ').trim()
    if (text) containers.push({ start: m.index, end, text })
  }
  return containers
}

/**
 * Parse Cursor built-in commands from one HTML page (or multiple pages joined).
 * Exported for testing.
 */
export function parseCommands(html: string): CatalogEntry[] {
  // Decode RSC chunks if present (real cursor.com pages); otherwise fall back
  // to treating the input as already-decoded payload (used by simple fixtures).
  const decoded = decodeRscPayload(html)
  const payload = decoded.length > 0 ? decoded : html

  const containers = findContainers(payload)
  const entries: CatalogEntry[] = []
  const seen = new Set<string>()
  const now = new Date().toISOString()

  COMMAND_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = COMMAND_RE.exec(payload)) !== null) {
    const commandName = match[1]!
    if (seen.has(commandName)) continue
    seen.add(commandName)

    // Innermost <p>/<li> whose JSON range covers the command position is the
    // most specific description.
    let best: Container | undefined
    for (const c of containers) {
      if (c.start <= match.index && match.index <= c.end) {
        if (!best || c.end - c.start < best.end - best.start) best = c
      }
    }

    entries.push({
      tool: 'cursor',
      kind: 'first-party',
      id: `builtin/${commandName.slice(1)}`,
      name: commandName,
      description: best?.text,
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
