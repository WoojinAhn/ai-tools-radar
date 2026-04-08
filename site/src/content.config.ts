// site/src/content.config.ts
import { defineCollection, z } from 'astro:content'
import { glob } from 'astro/loaders'

const digests = defineCollection({
  loader: glob({ pattern: '*.md', base: '../digests' }),
  schema: z.object({
    date: z.coerce.string(),
    added: z.number().default(0),
    removed: z.number().default(0),
    updated: z.number().default(0),
  }),
})

export const collections = { digests }
