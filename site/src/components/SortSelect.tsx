// site/src/components/SortSelect.tsx
import { useEffect, useState } from 'react'

type SortKey = 'newest' | 'oldest' | 'recently-updated'

const options: { value: SortKey; label: string }[] = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'recently-updated', label: 'Recently updated' },
]

function sortAttr(key: SortKey): { attr: string; desc: boolean } {
  if (key === 'oldest') return { attr: 'data-first-seen', desc: false }
  if (key === 'recently-updated') return { attr: 'data-last-updated', desc: true }
  return { attr: 'data-first-seen', desc: true }
}

export default function SortSelect() {
  const [sort, setSort] = useState<SortKey>('newest')

  useEffect(() => {
    const grid = document.getElementById('entry-grid')
    if (!grid) return

    const { attr, desc } = sortAttr(sort)
    const cards = [...grid.querySelectorAll<HTMLElement>('article')]
    cards.sort((a, b) => {
      const va = a.getAttribute(attr) ?? ''
      const vb = b.getAttribute(attr) ?? ''
      return desc ? vb.localeCompare(va) : va.localeCompare(vb)
    })
    for (const card of cards) grid.appendChild(card)
  }, [sort])

  return (
    <select
      value={sort}
      onChange={(e) => setSort(e.target.value as SortKey)}
      className="bg-neutral-900 border border-neutral-800 rounded-md px-3 py-2 text-sm text-neutral-400 focus:outline-none focus:border-neutral-600"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  )
}
