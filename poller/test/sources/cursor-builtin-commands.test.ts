// poller/test/sources/cursor-builtin-commands.test.ts
import { describe, it, expect } from 'vitest'
import {
  parseCommands,
  fetchAllPages,
} from '../../src/sources/cursor-builtin-commands.js'

describe('parseCommands', () => {
  it('extracts command from RSC payload pattern', () => {
    const html = `some stuff {"children":"/worktree"} more stuff`
    const entries = parseCommands(html)

    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      tool: 'cursor',
      kind: 'first-party',
      id: 'builtin/worktree',
      name: '/worktree',
      metadata: { extra: { builtin: true } },
    })
  })

  it('deduplicates commands', () => {
    const html = `{"children":"/chat"} and then {"children":"/chat"} again`
    const entries = parseCommands(html)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.name).toBe('/chat')
  })

  it('extracts description from the enclosing RSC paragraph', () => {
    const html = `["$","p",null,{"children":["Added a new command ",["$","code",null,{"children":"/worktree"}]," that creates a separate git worktree so changes happen in isolation."]}]`
    const entries = parseCommands(html)

    expect(entries).toHaveLength(1)
    expect(entries[0]!.description).toBe(
      'Added a new command /worktree that creates a separate git worktree so changes happen in isolation.',
    )
  })

  it('returns empty array for no matches', () => {
    const entries = parseCommands('just some random html with no commands')
    expect(entries).toEqual([])
  })

  it('handles missing description gracefully when no text follows pattern', () => {
    const html = `{"children":"/edit"}`
    const entries = parseCommands(html)

    expect(entries).toHaveLength(1)
    expect(entries[0]!.name).toBe('/edit')
    expect(entries[0]!.description).toBeUndefined()
  })

  it('handles short text after pattern (below 10 char threshold)', () => {
    const html = `[{"children":"/run"}],"short"`
    const entries = parseCommands(html)

    expect(entries).toHaveLength(1)
    expect(entries[0]!.name).toBe('/run')
    expect(entries[0]!.description).toBeUndefined()
  })

  it('extracts multiple commands', () => {
    const html = `{"children":"/chat"} blah {"children":"/edit"} blah {"children":"/worktree"}`
    const entries = parseCommands(html)

    expect(entries).toHaveLength(3)
    expect(entries.map((e) => e.name).sort()).toEqual(['/chat', '/edit', '/worktree'])
  })

  it('decodes RSC chunks emitted by Next.js __next_f.push wrappers', () => {
    // Real cursor.com pages embed the RSC payload inside JS-string chunks; the
    // parser must JS-string-decode each chunk before walking the JSON.
    const inner = `["$","p",null,{"children":["Use ",["$","code",null,{"children":"/review"}]," to review a pull request."]}]`
    const jsString = JSON.stringify(inner).slice(1, -1) // escape for JS string literal
    const html = `<script>self.__next_f.push([1,"${jsString}"])</script>`
    const entries = parseCommands(html)

    expect(entries).toHaveLength(1)
    expect(entries[0]!.name).toBe('/review')
    expect(entries[0]!.description).toBe('Use /review to review a pull request.')
  })

  it('sets source_url to changelog URL', () => {
    const html = `{"children":"/debug"}`
    const entries = parseCommands(html)

    expect(entries[0]!.source_url).toBe('https://cursor.com/changelog')
  })

  it('picks innermost paragraph when command sits inside nested containers', () => {
    // Simulates an outer <li> wrapping a <p>; the <p> is more specific.
    const html = `["$","li",null,{"children":[["$","p",null,{"children":[["$","code",null,{"children":"/btw"}]," allows you to get clarification."]}]]}]`
    const entries = parseCommands(html)
    expect(entries[0]!.description).toBe('/btw allows you to get clarification.')
  })

  it('handles a paragraph containing multiple commands (each gets the same description)', () => {
    const html = `["$","p",null,{"children":[["$","code",null,{"children":"/auto-run"}],", ",["$","code",null,{"children":"/max-mode"}]," now toggle with a single invocation."]}]`
    const entries = parseCommands(html)
    expect(entries.map((e) => e.name).sort()).toEqual(['/auto-run', '/max-mode'])
    for (const e of entries) {
      expect(e.description).toBe('/auto-run, /max-mode now toggle with a single invocation.')
    }
  })

  it('preserves embedded quotes in description text after RSC chunk decoding', () => {
    // The earlier double-replace unescaper destroyed JSON-internal escapes,
    // breaking JSON.parse on text containing quotes. JS-string decoding
    // must keep the inner JSON escape intact.
    const inner = `["$","p",null,{"children":["Typing ",["$","code",null,{"children":"/plan"}]," sets the option to \\"Build in cloud.\\""]}]`
    const jsString = JSON.stringify(inner).slice(1, -1)
    const html = `<script>self.__next_f.push([1,"${jsString}"])</script>`
    const entries = parseCommands(html)
    expect(entries[0]!.name).toBe('/plan')
    expect(entries[0]!.description).toBe('Typing /plan sets the option to "Build in cloud."')
  })

  it('returns undefined description when the command has no enclosing paragraph', () => {
    // E.g. a standalone `code` chunk that other elements reference via $L<id>;
    // we cannot resolve cross-chunk references, so description is left empty.
    const html = `["$","code",null,{"children":"/orphan"}]`
    const entries = parseCommands(html)
    expect(entries[0]!.name).toBe('/orphan')
    expect(entries[0]!.description).toBeUndefined()
  })
})

describe('fetchAllPages', () => {
  it('stops after two consecutive empty pages', async () => {
    const calls: string[] = []
    const fetcher = async (url: string): Promise<string> => {
      calls.push(url)
      if (url.endsWith('/changelog')) return `{"children":"/alpha"}`
      if (url.endsWith('/page/2')) return `{"children":"/beta"}`
      // pages 3, 4, ... return content with no commands
      return `nothing here`
    }

    const entries = await fetchAllPages(fetcher)

    expect(entries.map((e) => e.name).sort()).toEqual(['/alpha', '/beta'])
    // Should fetch base + page 2 (yields) + page 3 (empty) + page 4 (empty, triggers stop)
    expect(calls).toEqual([
      'https://cursor.com/changelog',
      'https://cursor.com/changelog/page/2',
      'https://cursor.com/changelog/page/3',
      'https://cursor.com/changelog/page/4',
    ])
  })

  it('stops after two consecutive 404 pages without throwing', async () => {
    const calls: string[] = []
    const fetcher = async (url: string): Promise<string> => {
      calls.push(url)
      if (url.endsWith('/changelog')) return `{"children":"/foo"}`
      throw new Error(`HTTP 404 for ${url}`)
    }

    const entries = await fetchAllPages(fetcher)
    expect(entries.map((e) => e.name)).toEqual(['/foo'])
    expect(calls).toEqual([
      'https://cursor.com/changelog',
      'https://cursor.com/changelog/page/2',
      'https://cursor.com/changelog/page/3',
    ])
  })

  it('resets the empty-page counter when a later page yields commands', async () => {
    const calls: string[] = []
    const fetcher = async (url: string): Promise<string> => {
      calls.push(url)
      if (url.endsWith('/changelog')) return `{"children":"/a"}`
      if (url.endsWith('/page/2')) return `no commands`
      if (url.endsWith('/page/3')) return `{"children":"/b"}`
      // pages 4, 5 empty -> stop
      return `nothing`
    }

    const entries = await fetchAllPages(fetcher)
    expect(entries.map((e) => e.name).sort()).toEqual(['/a', '/b'])
    expect(calls.length).toBe(5) // base, /page/2, /page/3, /page/4, /page/5
  })

  it('deduplicates commands seen on multiple pages', async () => {
    const fetcher = async (url: string): Promise<string> => {
      if (url.endsWith('/changelog')) return `{"children":"/dup"}`
      if (url.endsWith('/page/2')) return `{"children":"/dup"} {"children":"/new"}`
      return `nothing`
    }
    const entries = await fetchAllPages(fetcher)
    expect(entries.map((e) => e.name).sort()).toEqual(['/dup', '/new'])
  })

  it('propagates non-404 errors', async () => {
    const fetcher = async (url: string): Promise<string> => {
      if (url.endsWith('/changelog')) return `{"children":"/x"}`
      throw new Error(`HTTP 500 for ${url}`)
    }
    await expect(fetchAllPages(fetcher)).rejects.toThrow(/HTTP 500/)
  })
})
