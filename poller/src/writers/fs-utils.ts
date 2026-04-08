// poller/src/writers/fs-utils.ts
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/**
 * Creates any missing parent directories and writes the file.
 *
 * NOTE: Not actually atomic — there is no temp-file + rename dance. The name
 * captures the *intent* (one-call "just write this file") for the single-writer
 * GitHub Actions use case. Do not call this from concurrent writers; if that
 * ever becomes a requirement, replace the body with a real atomic write.
 */
export async function writeFileAtomic(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content, 'utf8')
}
