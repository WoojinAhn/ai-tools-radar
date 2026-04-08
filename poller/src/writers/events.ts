// poller/src/writers/events.ts
import { readFile } from 'node:fs/promises'
import { appendFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Event } from '../sources/types.js'

export async function appendEvents(path: string, events: Event[]): Promise<void> {
  if (events.length === 0) return
  await mkdir(dirname(path), { recursive: true })
  const lines = events.map((e) => JSON.stringify(e)).join('\n') + '\n'
  await appendFile(path, lines, 'utf8')
}

export async function readAllEvents(path: string): Promise<Event[]> {
  try {
    const raw = await readFile(path, 'utf8')
    return raw
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as Event)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
}
