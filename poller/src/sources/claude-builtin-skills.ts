// poller/src/sources/claude-builtin-skills.ts
import { get as httpsGet } from 'node:https'
import { createGunzip } from 'node:zlib'
import type { CatalogEntry, Source } from './types.js'

const NPM_REGISTRY_URL = 'https://registry.npmjs.org/@anthropic-ai/claude-code/latest'
// Since claude-code 2.1.116 the wrapper tarball no longer ships cli.js — the JS source is
// embedded inside a Bun-compiled native binary distributed as a platform package. CI runs on
// Linux x64; we always fetch the matching version (published alongside the wrapper).
const NATIVE_PACKAGE = '@anthropic-ai/claude-code-linux-x64'

/**
 * Pattern for skill registrations in the embedded JS bundle.
 *
 * The bundle uses two forms, both anchored by `name:"..."`:
 *  - Function-call form:    `Af({name:"batch", ...})`               (`I$`, `H2`, etc.)
 *  - Object-literal form:   `_35={type:"prompt", description:"...", ..., name:"statusline", ...}`
 *
 * In the object-literal form, `name:` is not always adjacent to `type:"prompt"` —
 * other fields (description, aliases, contentLength) may appear in between, so we
 * allow up to 500 non-`}` chars between the `type:"prompt"` anchor and `name:"..."`.
 *
 * Minifier-picked identifiers can include `$`. Both forms are validated downstream
 * by `getPromptForCommand` proximity to filter non-skill objects.
 */
const SKILL_NAME_RE = /(?:[\w$]{1,4}\(\{|=\{type:"prompt",(?:[^}]{0,500}?,)?)name:"([^"]*)"/g

/**
 * Find the end of the object literal that opens at `openIdx` (which must point
 * to a `{`). Walks forward with brace-counting while skipping over string
 * literals (single, double, and template) so braces inside strings or nested
 * function bodies do not break the count. Returns the index of the matching
 * closing `}`, or `-1` if not found within `maxLen` chars.
 */
function findObjectEnd(source: string, openIdx: number, maxLen = 20000): number {
  const limit = Math.min(source.length, openIdx + maxLen)
  let depth = 0
  let i = openIdx
  while (i < limit) {
    const c = source[i]
    if (c === '"' || c === "'" || c === '`') {
      const quote = c
      i++
      while (i < limit) {
        const cc = source[i]
        if (cc === '\\') { i += 2; continue }
        if (cc === quote) { i++; break }
        i++
      }
      continue
    }
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return i
    }
    i++
  }
  return -1
}

/**
 * Extracts the description for the skill object that begins at `objectOpen`
 * (the position of the opening `{`) — bounded by the matching closing `}` so
 * we never read fields from an adjacent sibling registration.
 */
function extractDescription(source: string, objectOpen: number): string | undefined {
  const objectEnd = findObjectEnd(source, objectOpen)
  if (objectEnd === -1) return undefined
  const window = source.slice(objectOpen, objectEnd + 1)

  // Form 1: description:"..."
  const dqMatch = /description:"([^"]*)"/.exec(window)
  if (dqMatch) return dqMatch[1]!.replace(/\\n/g, '\n')

  // Form 2: description:'...'
  const sqMatch = /description:'([^']*)'/.exec(window)
  if (sqMatch) return sqMatch[1]!.replace(/\\n/g, '\n')

  // Form 3: description:`...` (template literal — used by some skills, e.g. schedule)
  const tlMatch = /description:`([^`]*)`/.exec(window)
  if (tlMatch) return tlMatch[1]!.replace(/\\n/g, '\n')

  // Form 4: get description(){...} — capture the first string literal in the body.
  // Handles plain returns, ternaries (`return cond?"A":"B"`) and conditional branches
  // (`if(x)return"A";return"B"`). The first branch is taken as the canonical description.
  const getterDqMatch = /get description\(\)\{[^}]*?"([^"]*)"/.exec(window)
  if (getterDqMatch) return getterDqMatch[1]!.replace(/\\n/g, '\n')
  const getterSqMatch = /get description\(\)\{[^}]*?'([^']*)'/.exec(window)
  if (getterSqMatch) return getterSqMatch[1]!.replace(/\\n/g, '\n')

  // description:<identifier> — value lives elsewhere in the bundle, not resolvable here.
  return undefined
}

interface NpmPackageInfo {
  version: string
  dist: { tarball: string }
}

async function fetchJson(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    httpsGet(url, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchJson(res.headers.location).then(resolve, reject)
        return
      }
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
        } catch (err) {
          reject(err)
        }
      })
      res.on('error', reject)
    }).on('error', reject)
  })
}

/**
 * Download a .tgz URL and extract a single file by path, returning its raw bytes.
 * Uses only Node.js built-ins (no tar library).
 *
 * tar format: 512-byte header blocks followed by file content blocks.
 * The native CLI binary is ~200MB decompressed — large but acceptable for a CI job.
 */
async function extractFileFromTarball(tarballUrl: string, targetPath: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const makeRequest = (url: string): void => {
      httpsGet(url, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          makeRequest(res.headers.location)
          return
        }

        const gunzip = createGunzip()
        const chunks: Buffer[] = []

        res.pipe(gunzip)

        gunzip.on('data', (chunk: Buffer) => chunks.push(chunk))
        gunzip.on('end', () => {
          const buf = Buffer.concat(chunks)
          const result = extractFromTarBuffer(buf, targetPath)
          if (result !== null) {
            resolve(result)
          } else {
            reject(new Error(`${targetPath} not found in tarball`))
          }
        })
        gunzip.on('error', reject)
        res.on('error', reject)
      }).on('error', reject)
    }
    makeRequest(tarballUrl)
  })
}

/** @internal Exported for testing only. */
export function extractFromTarBuffer(buf: Buffer, targetPath: string): Buffer | null {
  let offset = 0
  while (offset + 512 <= buf.length) {
    // tar header: first 100 bytes = file name (null-terminated)
    const nameRaw = buf.subarray(offset, offset + 100)
    const nameEnd = nameRaw.indexOf(0)
    const name = nameRaw.subarray(0, nameEnd === -1 ? 100 : nameEnd).toString('utf8')

    // Empty block = end of archive
    if (name === '') break

    // File size: bytes 124–135 in octal
    const sizeStr = buf.subarray(offset + 124, offset + 136).toString('utf8').trim()
    const size = parseInt(sizeStr, 8) || 0

    if (name === targetPath) {
      return buf.subarray(offset + 512, offset + 512 + size)
    }

    // Advance past header + content (rounded up to 512-byte blocks)
    offset += 512 + Math.ceil(size / 512) * 512
  }
  return null
}

export class ClaudeBuiltinSkillsSource implements Source {
  readonly tool = 'claude-code' as const
  readonly id = 'claude-code-builtin'

  constructor(
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async fetch(): Promise<CatalogEntry[]> {
    console.log('[builtin-skills] fetching latest @anthropic-ai/claude-code from npm')
    const wrapper = (await fetchJson(NPM_REGISTRY_URL)) as NpmPackageInfo
    const version = wrapper.version
    console.log(`[builtin-skills] version ${version}, fetching native binary from ${NATIVE_PACKAGE}`)

    const nativeMeta = (await fetchJson(
      `https://registry.npmjs.org/${NATIVE_PACKAGE}/${version}`,
    )) as NpmPackageInfo
    const tarballUrl = nativeMeta.dist.tarball

    const binary = await extractFileFromTarball(tarballUrl, 'package/claude')
    console.log(`[builtin-skills] binary size: ${(binary.length / 1024 / 1024).toFixed(1)}MB`)

    // latin1 preserves byte values 1-to-1 as chars, so JS source regions inside the
    // Bun standalone binary stay matchable by the same regexes used on the old cli.js.
    const skills = this.parseSkills(binary.toString('latin1'), version)
    console.log(`[builtin-skills] found ${skills.length} built-in skills`)
    return skills
  }

  parseSkills(source: string, version: string): CatalogEntry[] {
    const entries: CatalogEntry[] = []
    const seen = new Set<string>()

    let match: RegExpExecArray | null
    while ((match = SKILL_NAME_RE.exec(source)) !== null) {
      const name = match[1]!
      if (seen.has(name)) continue

      // The match starts with either `<id>(\{` (function-call form) or
      // `<id>=\{` (object-literal form); the object opens at the first `{`
      // inside the match.
      const objectOpen = source.indexOf('{', match.index)
      if (objectOpen === -1 || objectOpen >= match.index + match[0].length) continue

      // Validate: real skill registrations contain getPromptForCommand nearby.
      // Some skills have large description/config blocks before the method, so use 2000 chars.
      const validationWindow = source.slice(match.index, match.index + 2000)
      if (!validationWindow.includes('getPromptForCommand')) continue

      seen.add(name)

      const description = extractDescription(source, objectOpen)

      entries.push({
        tool: 'claude-code',
        kind: 'first-party',
        id: `builtin/${name}`,
        name,
        description,
        version,
        source_url: `https://www.npmjs.com/package/@anthropic-ai/claude-code`,
        metadata: { extra: { builtin: true } },
        fetched_at: this.now(),
      })
    }

    return entries
  }
}
