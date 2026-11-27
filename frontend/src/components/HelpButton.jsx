import { useId } from 'react'
import { referenceApi } from '../api'
import { useAsync } from '../hooks/useAsync.js'
import { useDisclosure } from '../hooks/useDisclosure.js'
import { formatDate, formatMoney, unitLabel } from '../utils/format.js'
import ErrorState from './ErrorState.jsx'
import { SkeletonText } from './Skeleton.jsx'
import { HelpCircleIcon, XIcon } from './icons.jsx'

function PolicyLimits({ policy }) {
  const rules = policy.rules || []
  return (
    <div className="help-content">
      <p className="help-version muted small">
        Policy v{policy.versionNo}
        {policy.createdAt && <> · in force since {formatDate(policy.createdAt)}</>}
      </p>
      <table className="help-table">
        <caption className="sr-only">Spending limits</caption>
        <thead>
          <tr>
            <th scope="col">Rule</th>
            <th scope="col" className="align-right">
              Soft
            </th>
            <th scope="col" className="align-right">
              Hard
            </th>
          </tr>
        </thead>
        <tbody>
          {rules.map((r) => (
            <tr key={r.code}>
              <th scope="row">
                {r.name}
                <span className="muted xsmall"> {unitLabel(r.unit)}</span>
              </th>
              <td className="align-right num">{formatMoney(r.softLimit, { whole: true })}</td>
              <td className="align-right num">{formatMoney(r.hardLimit, { whole: true })}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="help-facts">
        <li>
          Receipt needed above <strong className="num">{formatMoney(policy.receiptThreshold, { whole: true })}</strong>
        </li>
        <li>
          Auto-approved when every line is within limits and the total is up to{' '}
          <strong className="num">{formatMoney(policy.autoApproveMaxTotal, { whole: true })}</strong>
        </li>
        <li>
          Over a <strong>soft</strong> limit goes to your manager; over a <strong>hard</strong> limit is rejected
        </li>
        {policy.weekendFlagEnabled && <li>Weekend expenses are flagged for review</li>}
        {policy.submissionWindowDays ? (
          <li>
            Claim within <strong>{policy.submissionWindowDays} days</strong> of the expense date
          </li>
        ) : null}
        <li>Airfare, train and other expenses always go for approval</li>
      </ul>
      {policy.tier1Cities?.length > 0 && (
        <p className="help-cities small">
          <span className="strong">Tier-1 cities:</span> {policy.tier1Cities.join(', ')}
        </p>
      )}
    </div>
  )
}

/**
 * Floating "Need help?" pill (employee screens) opening a small panel with the
 * current policy limits from referenceApi.getCurrentPolicy().
 */
export default function HelpButton() {
  const panelId = useId()
  const titleId = useId()
  const { open, onToggle, onClose, ref: wrapRef } = useDisclosure()
  const { data, error, loading, reload } = useAsync(() => referenceApi.getCurrentPolicy(), [], { immediate: false })

  const toggle = () => {
    if (!open && !data) reload()
    onToggle()
  }

  return (
    <div className="help-fab-wrap" ref={wrapRef}>
      {open && (
        <section id={panelId} className="help-panel" role="dialog" aria-modal="false" aria-labelledby={titleId}>
          <div className="help-panel-head">
            <h2 id={titleId} className="help-title">
              Policy limits
            </h2>
            <button type="button" className="icon-btn icon-btn-sm" onClick={onClose} aria-label="Close help">
              <XIcon size={18} />
            </button>
          </div>
          <div className="help-panel-body">
            {loading && !data && (
              <div role="status" aria-label="Loading policy">
                <SkeletonText lines={6} />
              </div>
            )}
            {error && !loading && <ErrorState compact error={error} title="Couldn't load the policy" onRetry={reload} mapNotFound={false} />}
            {data && <PolicyLimits policy={data} />}
          </div>
        </section>
      )}
      <button
        type="button"
        className={`help-fab${open ? ' is-open' : ''}`}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={toggle}
      >
        <HelpCircleIcon size={20} strokeWidth={2} />
        <span className="help-fab-label">Need help?</span>
      </button>
    </div>
  )
}
