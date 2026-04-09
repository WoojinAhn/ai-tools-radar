// poller/src/sources/index.ts
import { Octokit } from '@octokit/rest'
import { ClaudeBuiltinSkillsSource } from './claude-builtin-skills.js'
import { ClaudePluginsSource } from './claude-plugins.js'
import type { Source } from './types.js'

export function registerSources(octokit: Octokit): Source[] {
  return [new ClaudePluginsSource(octokit), new ClaudeBuiltinSkillsSource()]
}

export * from './types.js'
