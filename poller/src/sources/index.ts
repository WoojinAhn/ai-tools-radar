// poller/src/sources/index.ts
import { Octokit } from '@octokit/rest'
import { ClaudePluginsSource } from './claude-plugins.js'
import type { Source } from './types.js'

export function registerSources(octokit: Octokit): Source[] {
  return [new ClaudePluginsSource(octokit)]
}

export * from './types.js'
