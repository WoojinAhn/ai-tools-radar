// poller/src/sources/claude-builtin-skills.ts
import { get as httpsGet } from 'node:https'
import { createGunzip } from 'node:zlib'
import type { CatalogEntry, Source } from './types.js'

const NPM_REGISTRY_URL = 'https://registry.npmjs.org/@anthropic-ai/claude-code/latest'

/**
 * Pattern for skill registration calls in the minified bundle.
 * The function name changes across versions (UO, H2, etc.) so we match
 * any short identifier followed by ({name:"<name>". We validate matches
 * by checking for `getPromptForCommand` in a nearby window.
 */
const SKILL_NAME_RE = /\w{1,4}\(\{name:"([^"]*)"/g

/**
 * Extracts skill descriptions from the bundle.
 *
 * Strategy: find `({name:"<skillName>"` anchor (function name varies across
 * bundler versions), then search within a bounded window for the description.
 */
function extractDescription(source: string, skillName: string): string | undefined {
  const anchor = `({name:"${skillName}"`
  const idx = source.indexOf(anchor)
  if (idx === -1) return undefined

  // Work within a bounded window after the anchor.
  // Some descriptions are 500+ chars, so use a generous window.
  const window = source.slice(idx, idx + 2000)

  // Form 1: description:"..."
  const dqMatch = /description:"([^"]*)"/.exec(window)
  if (dqMatch) return dqMatch[1]!.replace(/\\n/g, '\n')

  // Form 2: description:'...'
  const sqMatch = /description:'([^']*)'/.exec(window)
  if (sqMatch) return sqMatch[1]!.replace(/\\n/g, '\n')

  // Form 3: get description(){return"..."}
  const getterMatch = /get description\(\)\{return"([^"]*)"/.exec(window)
  if (getterMatch) return getterMatch[1]!.replace(/\\n/g, '\n')

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
 * Download a .tgz URL and extract a single file by path, returning its
 * contents as a string. Uses only Node.js built-ins (no tar library).
 *
 * tar format: 512-byte header blocks followed by file content blocks.
 */
async function extractFileFromTarball(tarballUrl: string, targetPath: string): Promise<string> {
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

        // Accumulate the entire decompressed tar into memory, then parse.
        // cli.js is ~20MB decompressed — acceptable for a CI job.
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
export function extractFromTarBuffer(buf: Buffer, targetPath: string): string | null {
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
      return buf.subarray(offset + 512, offset + 512 + size).toString('utf8')
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
    const pkg = (await fetchJson(NPM_REGISTRY_URL)) as NpmPackageInfo
    const version = pkg.version
    const tarballUrl = pkg.dist.tarball
    console.log(`[builtin-skills] version ${version}, extracting cli.js`)

    const cliJs = await extractFileFromTarball(tarballUrl, 'package/cli.js')
    console.log(`[builtin-skills] cli.js size: ${(cliJs.length / 1024 / 1024).toFixed(1)}MB`)

    const skills = this.parseSkills(cliJs, version)
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

      // Validate: real skill registrations contain getPromptForCommand nearby.
      // Some skills have large description/config blocks before the method, so use 2000 chars.
      const validationWindow = source.slice(match.index, match.index + 2000)
      if (!validationWindow.includes('getPromptForCommand')) continue

      seen.add(name)

      const description = extractDescription(source, name)

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
