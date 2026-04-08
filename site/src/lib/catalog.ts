// site/src/lib/catalog.ts
import catalogJson from '../../../catalog/data.json'
import type { CatalogFile } from './types.ts'

export const catalog: CatalogFile = catalogJson as CatalogFile
