// site/src/components/SortSelect.tsx
import { useEffect, useState } from 'react'

type SortKey = 'newest' | 'oldest' | 'recently-updated' | 'most-stars'

const options: { value: SortKey; label: string }[] = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'recently-updated', label: 'Recently updated' },
  { value: 'most-stars', label: 'Most stars' },
]

const DEFAULT_SORT: SortKey = 'newest'
const SORT_KEYS = options.map((o) => o.value)

function isSortKey(v: string | null): v is SortKey {
  return v !== null && (SORT_KEYS as string[]).includes(v)
}

function readSortFromUrl(): SortKey {
  const v = new URLSearchParams(window.location.search).get('sort')
  return isSortKey(v) ? v : DEFAULT_SORT
}

function writeSortToUrl(key: SortKey): void {
  const url = new URL(window.location.href)
  if (key === DEFAULT_SORT) url.searchParams.delete('sort')
  else url.searchParams.set('sort', key)
  window.history.replaceState(window.history.state, '', url)
}

type SortConfig = { attr: string; desc: boolean; numeric?: boolean }

function sortAttr(key: SortKey): SortConfig {
  if (key === 'oldest') return { attr: 'data-first-seen', desc: false }
  if (key === 'recently-updated') return { attr: 'data-last-updated', desc: true }
  if (key === 'most-stars') return { attr: 'data-stars', desc: true, numeric: true }
  return { attr: 'data-first-seen', desc: true }
}

export default function SortSelect() {
  // Start from the SSR default to keep hydration in sync, then adopt the
  // URL-provided sort on mount so the choice survives back-navigation from a
  // detail page (where the browser restores the native <select> value but the
  // island re-initializes its React state).
  const [sort, setSort] = useState<SortKey>(DEFAULT_SORT)

  useEffect(() => {
    const fromUrl = readSortFromUrl()
    if (fromUrl !== sort) setSort(fromUrl)
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const grid = document.getElementById('entry-grid')
    if (!grid) return

    const { attr, desc, numeric } = sortAttr(sort)
    const cards = [...grid.querySelectorAll<HTMLElement>('article')]
    cards.sort((a, b) => {
      const va = a.getAttribute(attr) ?? ''
      const vb = b.getAttribute(attr) ?? ''
      if (numeric) {
        const na = Number(va) || 0
        const nb = Number(vb) || 0
        return desc ? nb - na : na - nb
      }
      return desc ? vb.localeCompare(va) : va.localeCompare(vb)
    })
    for (const card of cards) grid.appendChild(card)
  }, [sort])

  function onChange(value: SortKey) {
    setSort(value)
    writeSortToUrl(value)
  }

  return (
    <select
      value={sort}
      onChange={(e) => onChange(e.target.value as SortKey)}
      className="bg-neutral-900 border border-neutral-800 rounded-md px-3 py-2 text-sm text-neutral-400 focus:outline-none focus:border-neutral-600"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  )
}
