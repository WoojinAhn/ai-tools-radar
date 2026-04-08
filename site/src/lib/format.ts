// site/src/lib/format.ts
const NEW_THRESHOLD_DAYS = 7

export function isNew(firstSeenAt: string, now: Date = new Date()): boolean {
  const seen = new Date(firstSeenAt).getTime()
  const ms = now.getTime() - seen
  return ms < NEW_THRESHOLD_DAYS * 24 * 60 * 60 * 1000
}

export function formatDate(iso: string): string {
  return iso.slice(0, 10)
}

export function displayTool(tool: string): string {
  if (tool === 'claude-code') return 'Claude Code'
  if (tool === 'cursor') return 'Cursor'
  return tool
}
