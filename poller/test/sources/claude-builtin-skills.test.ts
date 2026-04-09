// poller/test/sources/claude-builtin-skills.test.ts
import { describe, it, expect } from 'vitest'
import { ClaudeBuiltinSkillsSource } from '../../src/sources/claude-builtin-skills.js'

const VERSION = '2.1.97'

function makeSource(): ClaudeBuiltinSkillsSource {
  return new ClaudeBuiltinSkillsSource(() => '2026-04-10T00:00:00.000Z')
}

describe('ClaudeBuiltinSkillsSource.parseSkills', () => {
  it('extracts skill with double-quoted description', () => {
    const js = `some code;UO({name:"simplify",description:"Review changed code for reuse.",userInvocable:!0});more code`
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
    const js = `UO({name:"keybindings-help",description:'Customize keyboard shortcuts.',allowedTools:["Read"]})`
    const entries = makeSource().parseSkills(js, VERSION)

    expect(entries).toHaveLength(1)
    expect(entries[0]!.name).toBe('keybindings-help')
    expect(entries[0]!.description).toBe('Customize keyboard shortcuts.')
  })

  it('extracts skill with getter description', () => {
    const js = `UO({name:"loop",get description(){return"Run a prompt on a recurring interval"}})`
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
    const js = `UO({name:"debug",description:"Enable debug logging"});UO({name:"debug",description:"Enable debug logging"})`
    const entries = makeSource().parseSkills(js, VERSION)
    expect(entries).toHaveLength(1)
  })

  it('extracts multiple skills from realistic bundle fragment', () => {
    const js = [
      `function x(){UO({name:"batch",description:"Research and plan a large-scale change."})}`,
      `function y(){UO({name:"simplify",description:"Review changed code."})}`,
      `function z(){UO({name:"schedule",description:"Create scheduled agents."})}`,
    ].join(';')
    const entries = makeSource().parseSkills(js, VERSION)

    expect(entries).toHaveLength(3)
    expect(entries.map((e) => e.name).sort()).toEqual(['batch', 'schedule', 'simplify'])
  })

  it('unescapes \\n in descriptions', () => {
    const js = `UO({name:"claude-api",description:"Build apps.\\nTRIGGER when: code imports."})`
    const entries = makeSource().parseSkills(js, VERSION)
    expect(entries[0]!.description).toContain('\nTRIGGER when:')
  })

  it('returns empty array for no matches', () => {
    const entries = makeSource().parseSkills('var x = 42; console.log(x);', VERSION)
    expect(entries).toEqual([])
  })

  it('extracts description when other fields appear between name and description', () => {
    const js = `UO({name:"dream",aliases:["learn"],description:"Reflective memory consolidation."})`
    const entries = makeSource().parseSkills(js, VERSION)
    expect(entries[0]!.description).toBe('Reflective memory consolidation.')
  })
})
