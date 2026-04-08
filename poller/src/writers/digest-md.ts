// poller/src/writers/digest-md.ts
import type { AddedEvent, Event, RemovedEvent, UpdatedEvent } from '../sources/types.js'
import { writeFileAtomic } from './fs-utils.js'

export function renderDigest(events: Event[], date: string): string {
  const added = events.filter((e): e is AddedEvent => e.type === 'added')
  const removed = events.filter((e): e is RemovedEvent => e.type === 'removed')
  const updated = events.filter((e): e is UpdatedEvent => e.type === 'updated')

  const frontmatter = [
    '---',
    `date: ${date}`,
    `added: ${added.length}`,
    `removed: ${removed.length}`,
    `updated: ${updated.length}`,
    '---',
    '',
  ].join('\n')

  const body: string[] = [
    `# ai-tools-radar — ${date}`,
    '',
    renderAddedSection(added),
    '',
    renderUpdatedSection(updated),
    '',
    renderRemovedSection(removed),
    '',
  ]

  return frontmatter + body.join('\n')
}

function renderAddedSection(added: AddedEvent[]): string {
  const header = `## Added (${added.length})`
  if (added.length === 0) return `${header}\n\n_(none)_`
  const lines = added.map((e) => {
    const entry = e.entry
    const label = `${displayTool(entry.tool)} · ${entry.kind} · [${entry.name}](${entry.source_url})`
    return entry.description ? `- **${label}** — ${entry.description}` : `- **${label}**`
  })
  return `${header}\n\n${lines.join('\n')}`
}

function renderUpdatedSection(updated: UpdatedEvent[]): string {
  const header = `## Updated (${updated.length})`
  if (updated.length === 0) return `${header}\n\n_(none)_`
  const blocks = updated.map((e) => {
    const [tool, kind, id] = e.key.split('/')
    const label = `${displayTool(tool!)} · ${kind} · [${id}](${sourceUrlFromKey(e.key)})`
    const changes = e.changes
      .map((c) => `  - \`${c.path}\`: \`${formatValue(c.before)}\` → \`${formatValue(c.after)}\``)
      .join('\n')
    return `- **${label}**\n${changes}`
  })
  return `${header}\n\n${blocks.join('\n')}`
}

function renderRemovedSection(removed: RemovedEvent[]): string {
  const header = `## Removed (${removed.length})`
  if (removed.length === 0) return `${header}\n\n_(none)_`
  const lines = removed.map((e) => {
    const entry = e.previous
    return `- **${displayTool(entry.tool)} · ${entry.kind} · ${entry.name}**`
  })
  return `${header}\n\n${lines.join('\n')}`
}

function displayTool(tool: string): string {
  if (tool === 'claude-code') return 'Claude Code'
  if (tool === 'cursor') return 'Cursor'
  return tool
}

function sourceUrlFromKey(key: string): string {
  const [, kind, id] = key.split('/')
  const dir = kind === 'third-party' ? 'external_plugins' : 'plugins'
  return `https://github.com/anthropics/claude-plugins-official/tree/main/${dir}/${id}`
}

function formatValue(v: unknown): string {
  if (v === undefined) return '(none)'
  if (typeof v === 'string') return v
  return JSON.stringify(v)
}

export async function writeDigest(path: string, events: Event[], date: string): Promise<void> {
  const md = renderDigest(events, date)
  await writeFileAtomic(path, md)
}
