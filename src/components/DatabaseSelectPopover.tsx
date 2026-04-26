/**
 * DatabaseSelectPopover — anchored option list for SingleSelect / MultiSelect
 * cells. @floating-ui/react handles positioning + dismiss; the popover is
 * portalled out of overflow:hidden table cells.
 *
 * Single mode: clicking an option commits and closes the popover.
 * Multi mode: clicking toggles inclusion in the value array; the popover
 *   stays open until the user clicks outside or presses Escape.
 */

import {
  FloatingPortal,
  flip,
  offset,
  useDismiss,
  useFloating,
  useInteractions,
  useRole,
} from '@floating-ui/react'
import type { SelectOption } from '../bindings'

interface DatabaseSelectPopoverProps {
  options: SelectOption[]
  value: string | string[]
  multi: boolean
  onChange: (next: string | string[]) => void
  onClose: () => void
  referenceElement: HTMLElement | null
}

export function DatabaseSelectPopover({
  options,
  value,
  multi,
  onChange,
  onClose,
  referenceElement,
}: DatabaseSelectPopoverProps) {
  const { refs, floatingStyles, context } = useFloating({
    open: true,
    onOpenChange: open => {
      if (!open) onClose()
    },
    middleware: [offset(4), flip()],
    elements: { reference: referenceElement },
  })

  const dismiss = useDismiss(context, { outsidePress: true, escapeKey: true })
  const role = useRole(context, { role: 'listbox' })
  const { getFloatingProps } = useInteractions([dismiss, role])

  const selectedSet = new Set<string>(
    Array.isArray(value) ? value : value ? [value] : [],
  )

  const handlePick = (optionId: string) => {
    if (multi) {
      const current = Array.isArray(value) ? value : []
      if (selectedSet.has(optionId)) {
        onChange(current.filter(id => id !== optionId))
      } else {
        onChange([...current, optionId])
      }
      // Multi mode keeps the popover open — user closes via outside click.
    } else {
      onChange(optionId)
      onClose()
    }
  }

  return (
    <FloatingPortal>
      <div
        ref={refs.setFloating}
        style={floatingStyles}
        className="db-select-popover"
        {...getFloatingProps()}
      >
        {options.length === 0 ? (
          <div className="db-select-popover__option" aria-disabled="true">
            <span style={{ color: 'var(--heros-text-dim)' }}>No options</span>
          </div>
        ) : (
          options.map(opt => {
            const selected = selectedSet.has(opt.id)
            return (
              <button
                key={opt.id}
                type="button"
                role="option"
                aria-selected={selected}
                className={
                  selected
                    ? 'db-select-popover__option db-select-popover__option--selected'
                    : 'db-select-popover__option'
                }
                onClick={() => handlePick(opt.id)}
              >
                <span
                  className="db-select-popover__dot"
                  // Color is data-driven, not a design constant — Rule 12 carve-out.
                  style={{ background: `var(--select-color-${opt.color})` }}
                />
                <span>{opt.name}</span>
              </button>
            )
          })
        )}
      </div>
    </FloatingPortal>
  )
}
