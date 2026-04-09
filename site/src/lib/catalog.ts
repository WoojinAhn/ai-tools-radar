// site/src/lib/catalog.ts
import catalogJson from '../../../catalog/data.json'
import type { CatalogEntryView, CatalogFile } from './types.ts'

export const catalog: CatalogFile = catalogJson as CatalogFile

export function isBuiltin(entry: CatalogEntryView): boolean {
  return entry.metadata.extra?.['builtin'] === true
}

export const pluginEntries = catalog.entries.filter((e) => !isBuiltin(e))
export const builtinEntries = catalog.entries.filter(isBuiltin)
