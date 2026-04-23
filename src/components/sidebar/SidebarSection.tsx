import { ChevronRight } from 'lucide-react'
import { useState } from 'react'

interface Props {
  label: string
  children: React.ReactNode
  defaultOpen?: boolean
}

export function SidebarSection({ label, children, defaultOpen = true }: Props) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="mb-1">
      <button
        className="flex items-center gap-1 w-full px-2 py-0.5 text-xs font-semibold
          text-neutral-500 dark:text-neutral-400 uppercase tracking-wider
          hover:text-neutral-700 dark:hover:text-neutral-200"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <ChevronRight
          size={10}
          className={`transition-transform duration-150 ${open ? 'rotate-90' : ''}`}
        />
        {label}
      </button>
      {open && <div className="mt-0.5">{children}</div>}
    </div>
  )
}
