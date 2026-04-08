// site/src/components/SearchBox.tsx
import { useEffect, useState } from 'react'

export default function SearchBox() {
  const [q, setQ] = useState('')

  useEffect(() => {
    const cards = document.querySelectorAll<HTMLElement>('#entry-grid [data-search]')
    const needle = q.trim().toLowerCase()
    cards.forEach((card) => {
      const hay = card.dataset.search ?? ''
      const match = needle === '' || hay.includes(needle)
      card.style.display = match ? '' : 'none'
    })
  }, [q])

  return (
    <input
      type="search"
      value={q}
      onChange={(e) => setQ(e.target.value)}
      placeholder="Search catalog..."
      className="w-full bg-neutral-900 border border-neutral-800 rounded-md px-4 py-2 text-sm placeholder:text-neutral-600 focus:outline-none focus:border-neutral-600"
    />
  )
}
