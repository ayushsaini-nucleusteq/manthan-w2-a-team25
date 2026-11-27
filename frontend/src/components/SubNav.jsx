import { useContext } from 'react'
import { createPortal } from 'react-dom'
import { SubNavSlotContext } from './subNavContext.js'
import Tabs from './Tabs.jsx'

/**
 * Renders a second navbar row (white, blue links) in the AppShell's sub-nav slot,
 * sticky under the main navbar. Pass `tabs` (route tabs with `to`, or state tabs with
 * `value`/`onChange`) or custom `children`. Falls back to inline rendering outside the shell.
 *
 *   <SubNav ariaLabel="Inbox" tabs={[{id:'p', label:'Pending', count: 8, to:'/approvals?state=PENDING'}]} />
 *
 * Route tabs that differ only by query string are matched on the query too (see Tabs).
 * When the bare URL ("/approvals") means a default tab, pass `active` on each tab,
 * e.g. `active: state === 'PENDING'`, so exactly one tab is current.
 */
export default function SubNav({ tabs, value, onChange, ariaLabel = 'Section', idPrefix, children }) {
  const slot = useContext(SubNavSlotContext)
  const content = (
    <div className="subnav">
      <div className="subnav-inner">
        {tabs ? (
          <Tabs tabs={tabs} value={value} onChange={onChange} ariaLabel={ariaLabel} idPrefix={idPrefix} variant="subnav" />
        ) : (
          children
        )}
      </div>
    </div>
  )
  return slot ? createPortal(content, slot) : content
}
