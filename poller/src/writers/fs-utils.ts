// poller/src/writers/fs-utils.ts
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export async function writeFileAtomic(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content, 'utf8')
}
