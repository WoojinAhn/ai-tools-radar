// site/src/lib/format.ts
export function isNew(firstSeenAt: string, latestFirstSeenAt: string): boolean {
  return firstSeenAt.slice(0, 10) === latestFirstSeenAt.slice(0, 10)
}

export function formatDate(iso: string): string {
  return iso.slice(0, 10)
}

export function displayTool(tool: string): string {
  if (tool === 'claude-code') return 'Claude Code'
  if (tool === 'cursor') return 'Cursor'
  return tool
}
