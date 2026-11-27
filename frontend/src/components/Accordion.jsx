import { useId, useState } from 'react'
import { ChevronDownIcon } from './icons.jsx'

/**
 * Rounded white accordion items with a blue chevron (e.g. "How policy rules work").
 *
 * @param {object} props
 * @param {Array<{id: string, title: React.ReactNode, content: React.ReactNode, icon?: React.ReactNode}>} props.items
 * @param {boolean} [props.allowMultiple] keep several items open at once
 * @param {string[]} [props.defaultOpen] ids open on first render
 * @param {2|3|4} [props.headingLevel]
 */
export default function Accordion({ items, allowMultiple = false, defaultOpen = [], headingLevel = 3, className = '' }) {
  const baseId = useId()
  const [open, setOpen] = useState(() => new Set(defaultOpen))
  const Heading = `h${headingLevel}`

  const toggle = (id) => {
    setOpen((prev) => {
      const next = new Set(allowMultiple ? prev : [])
      if (prev.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const onKeyDown = (e) => {
    const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End']
    if (!keys.includes(e.key)) return
    const buttons = Array.from(e.currentTarget.querySelectorAll(':scope > .accordion-item > .accordion-heading > .accordion-trigger'))
    const index = buttons.indexOf(document.activeElement)
    if (index === -1) return
    e.preventDefault()
    let next = index
    if (e.key === 'ArrowDown') next = (index + 1) % buttons.length
    if (e.key === 'ArrowUp') next = (index - 1 + buttons.length) % buttons.length
    if (e.key === 'Home') next = 0
    if (e.key === 'End') next = buttons.length - 1
    buttons[next].focus()
  }

  return (
    <div className={`accordion ${className}`} onKeyDown={onKeyDown}>
      {items.map((item) => {
        const isOpen = open.has(item.id)
        const triggerId = `${baseId}-t-${item.id}`
        const panelId = `${baseId}-p-${item.id}`
        return (
          <div className={`accordion-item${isOpen ? ' is-open' : ''}`} key={item.id}>
            <Heading className="accordion-heading">
              <button
                type="button"
                id={triggerId}
                className="accordion-trigger"
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() => toggle(item.id)}
              >
                {item.icon && (
                  <span className="accordion-icon" aria-hidden="true">
                    {item.icon}
                  </span>
                )}
                <span className="accordion-title">{item.title}</span>
                <ChevronDownIcon size={20} className="accordion-chevron" />
              </button>
            </Heading>
            <div id={panelId} role="region" aria-labelledby={triggerId} className="accordion-panel" hidden={!isOpen}>
              <div className="accordion-content">{item.content}</div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
