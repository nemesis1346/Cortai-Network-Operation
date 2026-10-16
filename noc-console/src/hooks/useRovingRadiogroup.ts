import type { KeyboardEvent } from 'react'

/**
 * Arrow-key roving focus for a single-select `role="radiogroup"` (v2
 * UI-SPEC.md §6: "Theme and typeface are radiogroups with arrow keys").
 * WAI-ARIA radio pattern: arrow keys move focus AND selection together,
 * unlike tabs. Moves real DOM focus to the new option directly off the
 * event's own container, rather than threading refs through — the button
 * that becomes selected is also the one that should hold focus next, and
 * both facts are available right where the key was pressed.
 */
export function useRovingRadiogroup<T extends string>(options: readonly T[], value: T, onChange: (v: T) => void) {
  return (e: KeyboardEvent<HTMLElement>) => {
    const forward = e.key === 'ArrowRight' || e.key === 'ArrowDown'
    const backward = e.key === 'ArrowLeft' || e.key === 'ArrowUp'
    if (!forward && !backward) return
    e.preventDefault()
    const i = options.indexOf(value)
    const next = options[((forward ? i + 1 : i - 1) + options.length) % options.length]!
    onChange(next)
    const group = e.currentTarget.closest('[role="radiogroup"]')
    const buttons = group?.querySelectorAll<HTMLElement>('[role="radio"]')
    buttons?.[options.indexOf(next)]?.focus()
  }
}
