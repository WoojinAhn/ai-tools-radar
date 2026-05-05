// poller/test/sources/claude-builtin-skills.test.ts
import { describe, it, expect } from 'vitest'
import { ClaudeBuiltinSkillsSource, extractFromTarBuffer } from '../../src/sources/claude-builtin-skills.js'

const VERSION = '2.1.97'

function makeSource(): ClaudeBuiltinSkillsSource {
  return new ClaudeBuiltinSkillsSource(() => '2026-04-10T00:00:00.000Z')
}

describe('ClaudeBuiltinSkillsSource.parseSkills', () => {
  it('extracts skill with double-quoted description', () => {
    const js = `some code;UO({name:"simplify",description:"Review changed code for reuse.",userInvocable:!0,async getPromptForCommand(q){}});more code`
    const entries = makeSource().parseSkills(js, VERSION)

    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      tool: 'claude-code',
      kind: 'first-party',
      id: 'builtin/simplify',
      name: 'simplify',
      description: 'Review changed code for reuse.',
      version: VERSION,
      metadata: { extra: { builtin: true } },
    })
  })

  it('extracts skill with single-quoted description', () => {
    const js = `UO({name:"keybindings-help",description:'Customize keyboard shortcuts.',allowedTools:["Read"],async getPromptForCommand(q){}})`
    const entries = makeSource().parseSkills(js, VERSION)

    expect(entries).toHaveLength(1)
    expect(entries[0]!.name).toBe('keybindings-help')
    expect(entries[0]!.description).toBe('Customize keyboard shortcuts.')
  })

  it('extracts skill with getter description', () => {
    const js = `UO({name:"loop",get description(){return"Run a prompt on a recurring interval"},async getPromptForCommand(q){}})`
    const entries = makeSource().parseSkills(js, VERSION)

    expect(entries).toHaveLength(1)
    expect(entries[0]!.name).toBe('loop')
    expect(entries[0]!.description).toBe('Run a prompt on a recurring interval')
  })

  it('handles missing description gracefully', () => {
    const js = `UO({name:"mystery",userInvocable:!0,async getPromptForCommand(q){}})`
    const entries = makeSource().parseSkills(js, VERSION)

    expect(entries).toHaveLength(1)
    expect(entries[0]!.name).toBe('mystery')
    expect(entries[0]!.description).toBeUndefined()
  })

  it('deduplicates skills by name', () => {
    const js = `UO({name:"debug",description:"Enable debug logging",async getPromptForCommand(q){}});UO({name:"debug",description:"Enable debug logging",async getPromptForCommand(q){}})`
    const entries = makeSource().parseSkills(js, VERSION)
    expect(entries).toHaveLength(1)
  })

  it('extracts multiple skills from realistic bundle fragment', () => {
    const js = [
      `function x(){UO({name:"batch",description:"Research and plan a large-scale change.",async getPromptForCommand(q){}})}`,
      `function y(){UO({name:"simplify",description:"Review changed code.",async getPromptForCommand(q){}})}`,
      `function z(){UO({name:"schedule",description:"Create scheduled agents.",async getPromptForCommand(q){}})}`,
    ].join(';')
    const entries = makeSource().parseSkills(js, VERSION)

    expect(entries).toHaveLength(3)
    expect(entries.map((e) => e.name).sort()).toEqual(['batch', 'schedule', 'simplify'])
  })

  it('unescapes \\n in descriptions', () => {
    const js = `UO({name:"claude-api",description:"Build apps.\\nTRIGGER when: code imports.",async getPromptForCommand(q){}})`
    const entries = makeSource().parseSkills(js, VERSION)
    expect(entries[0]!.description).toContain('\nTRIGGER when:')
  })

  it('returns empty array for no matches', () => {
    const entries = makeSource().parseSkills('var x = 42; console.log(x);', VERSION)
    expect(entries).toEqual([])
  })

  it('extracts description when other fields appear between name and description', () => {
    const js = `UO({name:"dream",aliases:["learn"],description:"Reflective memory consolidation.",async getPromptForCommand(q){}})`
    const entries = makeSource().parseSkills(js, VERSION)
    expect(entries[0]!.description).toBe('Reflective memory consolidation.')
  })

  it('works with different minified function names (H2 instead of UO)', () => {
    const js = `H2({name:"simplify",description:"Review code.",async getPromptForCommand(q){}})`
    const entries = makeSource().parseSkills(js, VERSION)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.name).toBe('simplify')
    expect(entries[0]!.description).toBe('Review code.')
  })

  it('accepts minifier identifiers that contain $ (Bun-era bundle)', () => {
    const js = `I$({name:"debug",description:"Enable debug logging.",async getPromptForCommand(q){}})`
    const entries = makeSource().parseSkills(js, VERSION)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.name).toBe('debug')
    expect(entries[0]!.description).toBe('Enable debug logging.')
  })

  it('extracts skill with template-literal description', () => {
    const js = 'UO({name:"schedule",description:`Create, update, list, or run scheduled remote agents.`,async getPromptForCommand(q){}})'
    const entries = makeSource().parseSkills(js, VERSION)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.description).toBe('Create, update, list, or run scheduled remote agents.')
  })

  it('extracts getter description with conditional logic before return', () => {
    const js = `UO({name:"loop",get description(){if(FLAG.enabled())return"enabled version";return"default version"},async getPromptForCommand(q){}})`
    const entries = makeSource().parseSkills(js, VERSION)
    expect(entries[0]!.description).toBe('enabled version')
  })

  it('rejects false positives without getPromptForCommand', () => {
    const js = `XY({name:"not-a-skill",description:"Should be ignored."})`
    const entries = makeSource().parseSkills(js, VERSION)
    expect(entries).toEqual([])
  })

  it('extracts skill registered via object-literal form (var=type:prompt,name:...)', () => {
    const js = `var B$5;var Is7=T(()=>{i9$();d8();l$();B$5={type:"prompt",name:"init",description:"Initialize a new CLAUDE.md file with codebase documentation",source:"builtin",async getPromptForCommand(H){return[]}}});`
    const entries = makeSource().parseSkills(js, VERSION)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      id: 'builtin/init',
      name: 'init',
      description: 'Initialize a new CLAUDE.md file with codebase documentation',
    })
  })

  it('extracts mixed function-call and object-literal forms in the same bundle', () => {
    const js = [
      `Af({name:"batch",description:"Run a large change.",async getPromptForCommand(q){}})`,
      `W_5={type:"prompt",name:"review",description:"Review a pull request",source:"builtin",async getPromptForCommand(H){}}`,
      `T2={type:"prompt",name:"commit",description:"Create a commit.",source:"builtin",async getPromptForCommand(H){}}`,
    ].join(';')
    const entries = makeSource().parseSkills(js, VERSION)
    expect(entries.map((e) => e.name).sort()).toEqual(['batch', 'commit', 'review'])
  })

  it('object-literal form still requires getPromptForCommand to validate', () => {
    const js = `Q1={type:"prompt",name:"not-a-skill",description:"missing GPC"}`
    const entries = makeSource().parseSkills(js, VERSION)
    expect(entries).toEqual([])
  })

  it('object-literal form: name field not adjacent to type:prompt (other fields between)', () => {
    const js = `_35={type:"prompt",description:"Set up Claude Code's status line UI",contentLength:0,aliases:[],name:"statusline",source:"builtin",async getPromptForCommand(H){}}`
    const entries = makeSource().parseSkills(js, VERSION)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.name).toBe('statusline')
    expect(entries[0]!.description).toBe("Set up Claude Code's status line UI")
  })
})

describe('extractFromTarBuffer', () => {
  /** Build a minimal valid tar buffer with one file entry. */
  function makeTarBuffer(fileName: string, content: string): Buffer {
    const contentBuf = Buffer.from(content, 'utf8')
    const header = Buffer.alloc(512)

    // name: bytes 0-99
    header.write(fileName, 0, Math.min(fileName.length, 100), 'utf8')

    // size: bytes 124-135 in octal, zero-padded, null-terminated
    const sizeOctal = contentBuf.length.toString(8).padStart(11, '0')
    header.write(sizeOctal, 124, 12, 'utf8')

    // content padded to 512-byte boundary
    const contentPadded = Buffer.alloc(Math.ceil(contentBuf.length / 512) * 512)
    contentBuf.copy(contentPadded)

    // Two empty 512-byte blocks = end of archive
    const end = Buffer.alloc(1024)

    return Buffer.concat([header, contentPadded, end])
  }

  it('extracts file content by exact path', () => {
    const tar = makeTarBuffer('package/cli.js', 'console.log("hello")')
    const result = extractFromTarBuffer(tar, 'package/cli.js')
    expect(result?.toString('utf8')).toBe('console.log("hello")')
  })

  it('returns null when file not found', () => {
    const tar = makeTarBuffer('package/cli.js', 'content')
    const result = extractFromTarBuffer(tar, 'package/other.js')
    expect(result).toBeNull()
  })

  it('preserves raw bytes including high-bit values (needed for Bun native binaries)', () => {
    const raw = Buffer.from([0x00, 0xff, 0x7f, 0x80, 0x41]) // null, 255, 127, 128, 'A'
    const header = Buffer.alloc(512)
    header.write('package/claude', 0, 14, 'utf8')
    const size = raw.length.toString(8).padStart(11, '0')
    header.write(size, 124, 12, 'utf8')
    const contentPadded = Buffer.alloc(Math.ceil(raw.length / 512) * 512)
    raw.copy(contentPadded)
    const tar = Buffer.concat([header, contentPadded, Buffer.alloc(1024)])

    const result = extractFromTarBuffer(tar, 'package/claude')
    expect(result).not.toBeNull()
    expect(Buffer.compare(result!, raw)).toBe(0)
  })

  it('handles empty tar (no entries)', () => {
    const empty = Buffer.alloc(1024) // two empty blocks
    expect(extractFromTarBuffer(empty, 'anything')).toBeNull()
  })
})
