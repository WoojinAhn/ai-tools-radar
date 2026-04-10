import { Octokit } from '@octokit/rest'
import { ClaudeBuiltinSkillsSource } from './claude-builtin-skills.js'
import { ClaudePluginsSource } from './claude-plugins.js'
import { CursorBuiltinCommandsSource } from './cursor-builtin-commands.js'
import { CursorMarketplaceSource } from './cursor-marketplace.js'
import type { Source } from './types.js'

export function registerSources(octokit: Octokit): Source[] {
  return [
    new ClaudePluginsSource(octokit),
    new ClaudeBuiltinSkillsSource(),
    new CursorMarketplaceSource(),
    new CursorBuiltinCommandsSource(),
  ]
}

export * from './types.js'
