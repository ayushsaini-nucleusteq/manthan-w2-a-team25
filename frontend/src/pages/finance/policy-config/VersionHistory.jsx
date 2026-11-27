import { useState } from 'react'
import Card from '../../../components/Card.jsx'
import Modal from '../../../components/Modal.jsx'
import Button from '../../../components/Button.jsx'
import ErrorState from '../../../components/ErrorState.jsx'
import Skeleton from '../../../components/Skeleton.jsx'
import Money from '../../../components/Money.jsx'
import { formatDateTime, unitLabel } from '../../../utils/format.js'

/** Version history list; each entry opens a read-only view of that version. */
export default function VersionHistory({ versions, loading, error, onRetry, currentVersionNo }) {
  const [viewing, setViewing] = useState(null)

  return (
    <Card title="Version history" subtitle="Every publish creates a new version. Versions are never edited.">
      {error ? (
        <ErrorState error={error} onRetry={onRetry} compact />
      ) : loading && !versions ? (
        <div className="stack-sm" aria-busy="true">
          <span className="sr-only">Loading…</span>
          <Skeleton height={56} />
          <Skeleton height={56} />
        </div>
      ) : (
        <ol className="pc-versions">
          {(versions || []).map((v) => (
            <li key={v.versionNo}>
              <button type="button" className="pc-version" onClick={() => setViewing(v)} aria-label={`View version ${v.versionNo}`}>
                <span className={`chip chip-sm ${v.versionNo === currentVersionNo ? 'tone-success' : 'tone-neutral'}`}>
                  v{v.versionNo}
                  {v.versionNo === currentVersionNo ? ' · current' : ''}
                </span>
                <span className="pc-version-body">
                  <span className="small semibold">{v.changeNote || 'Initial policy'}</span>
                  <span className="xsmall muted">
                    {v.createdByName || 'System'} {'·'} {formatDateTime(v.createdAt)}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}

      <Modal
        open={Boolean(viewing)}
        onClose={() => setViewing(null)}
        title={viewing ? `Policy version ${viewing.versionNo}` : ''}
        description={viewing ? `${viewing.createdByName || 'System'} · ${formatDateTime(viewing.createdAt)} · read-only` : ''}
        size="lg"
        footer={<Button variant="secondary" onClick={() => setViewing(null)}>Close</Button>}
      >
        {viewing && (
          <div className="stack">
            {viewing.changeNote && <p className="mt-0">{viewing.changeNote}</p>}
            <dl className="pc-dl">
              <dt>Receipt required above</dt>
              <dd><Money value={viewing.receiptThreshold} /></dd>
              <dt>Weekend flag</dt>
              <dd>{viewing.weekendFlagEnabled ? 'On' : 'Off'}</dd>
              <dt>Overdue threshold</dt>
              <dd>{viewing.overdueThresholdHours} h</dd>
              <dt>Sample audit rate</dt>
              <dd>{viewing.samplePercent} %</dd>
              <dt>Submission window</dt>
              <dd>{viewing.submissionWindowDays} days</dd>
              <dt>Auto-approve up to</dt>
              <dd><Money value={viewing.autoApproveMaxTotal} /></dd>
              <dt>Auditor above / Head above</dt>
              <dd>
                <Money value={viewing.auditorAboveTotal} /> / <Money value={viewing.financeHeadAboveTotal} />
              </dd>
            </dl>
            <div className="pc-diff-wrap">
              <table className="pc-diff">
                <caption className="sr-only">Spending rules in version {viewing.versionNo}</caption>
                <thead>
                  <tr>
                    <th scope="col">Rule</th>
                    <th scope="col">Soft</th>
                    <th scope="col">Hard</th>
                  </tr>
                </thead>
                <tbody>
                  {(viewing.rules || []).map((r) => (
                    <tr key={r.code}>
                      <th scope="row">
                        {r.name} <span className="xsmall muted">{unitLabel(r.unit)}</span>
                      </th>
                      <td><Money value={r.softLimit} /></td>
                      <td><Money value={r.hardLimit} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="small">
              <span className="semibold">Tier-1 cities: </span>
              {(viewing.tier1Cities || []).join(', ')}
            </p>
          </div>
        )}
      </Modal>
    </Card>
  )
}
