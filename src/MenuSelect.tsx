import { Fragment, useEffect, useId, useRef, useState } from 'react'
import { FloatingPopover } from './FloatingPopover'

export type MenuSelectOption<T extends string> = {
  value: T
  label: string
  group?: string
}

export function MenuSelect<T extends string>({
  ariaLabel,
  invalid = false,
  describedBy,
  options,
  value,
  onChange,
}: {
  ariaLabel: string
  invalid?: boolean
  describedBy?: string
  options: MenuSelectOption<T>[]
  value: T
  onChange: (value: T) => void
}) {
  const [open, setOpen] = useState(false)
  const selectId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const selectedIndex = options.findIndex((option) => option.value === value)
  const selectedLabel = options[selectedIndex]?.label ?? 'Choose an option'

  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target) && !popoverRef.current?.contains(event.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [open])

  const focusOption = (index: number) => {
    const nextIndex = Math.max(0, Math.min(index, options.length - 1))
    window.requestAnimationFrame(() => optionRefs.current[nextIndex]?.focus())
  }

  const openFromKeyboard = (index: number) => {
    if (options.length === 0) return
    setOpen(true)
    focusOption(index)
  }

  const handleTriggerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      openFromKeyboard(selectedIndex < 0 ? 0 : selectedIndex)
    } else if (event.key === 'Escape' && open) {
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
    }
  }

  const handleOptionKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      triggerRef.current?.focus()
      return
    }

    let nextIndex: number | null = null
    if (event.key === 'ArrowDown') nextIndex = (index + 1) % options.length
    if (event.key === 'ArrowUp') nextIndex = (index - 1 + options.length) % options.length
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = options.length - 1
    if (nextIndex !== null) {
      event.preventDefault()
      focusOption(nextIndex)
    }
  }

  const chooseOption = (option: MenuSelectOption<T>) => {
    onChange(option.value)
    setOpen(false)
    triggerRef.current?.focus()
  }

  const optionNodes = open ? options.map((option, index) => (
    <Fragment key={option.value}>
      {option.group && options[index - 1]?.group !== option.group && (
        <p className="menu-select-group" aria-hidden="true">{option.group}</p>
      )}
      <button
        ref={(element) => { optionRefs.current[index] = element }}
        type="button"
        role="option"
        aria-label={option.group ? `${option.group}: ${option.label}` : option.label}
        aria-selected={option.value === value}
        className={option.value === value ? 'menu-select-option selected' : 'menu-select-option'}
        onClick={() => chooseOption(option)}
        onKeyDown={(event) => handleOptionKeyDown(event, index)}
      >
        <span>{option.label}</span>
      </button>
    </Fragment>
  )) : null

  return (
    <div
      className="menu-select"
      ref={rootRef}
      onBlur={(event) => {
        if (!(event.relatedTarget instanceof Node) || (!event.currentTarget.contains(event.relatedTarget) && !popoverRef.current?.contains(event.relatedTarget))) {
          setOpen(false)
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="menu-select-trigger"
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={selectId}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={handleTriggerKeyDown}
      >
        <span>{selectedLabel}</span>
        <span className="menu-select-chevron" aria-hidden="true" />
      </button>
      {open && (
        <FloatingPopover anchorRef={triggerRef} popoverRef={popoverRef} owner={selectId} className="menu-select-popover" id={selectId} role="listbox" aria-label={ariaLabel}
          onBlur={(event) => {
            if (!(event.relatedTarget instanceof Node) || (!rootRef.current?.contains(event.relatedTarget) && !event.currentTarget.contains(event.relatedTarget))) setOpen(false)
          }}>
          {optionNodes}
        </FloatingPopover>
      )}
    </div>
  )
}
