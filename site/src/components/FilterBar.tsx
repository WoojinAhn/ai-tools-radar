// site/src/components/FilterBar.tsx
import { useEffect, useState } from 'react'

type Kind = 'all' | 'first-party' | 'third-party'

export default function FilterBar() {
  const [kind, setKind] = useState<Kind>('all')

  useEffect(() => {
    const cards = document.querySelectorAll<HTMLElement>('#entry-grid [data-kind]')
    cards.forEach((card) => {
      const cardKind = card.dataset.kind
      const match = kind === 'all' || cardKind === kind
      if (match) {
        if (card.dataset.searchHidden !== 'true') card.style.display = ''
      } else {
        card.style.display = 'none'
      }
    })
  }, [kind])

  const options: { value: Kind; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'first-party', label: 'First-party' },
    { value: 'third-party', label: 'Third-party' },
  ]

  return (
    <div className="flex gap-2 text-sm">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => setKind(o.value)}
          className={
            'px-3 py-1 rounded-md border ' +
            (kind === o.value
              ? 'bg-white text-black border-white'
              : 'border-neutral-800 text-neutral-400 hover:text-white')
          }
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
