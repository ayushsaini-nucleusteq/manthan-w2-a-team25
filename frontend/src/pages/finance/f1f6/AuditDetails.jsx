import { humanize } from '../../../utils/format.js'

/**
 * Readable view of an audit event's `details` object: `changes` render as a
 * field / before / after diff; other keys as a definition list; raw JSON on demand.
 */
export default function AuditDetails({ event }) {
  const details = event.details
  if (!details || typeof details !== 'object' || Object.keys(details).length === 0) {
    return <p className="muted fx-small">No additional details were recorded for this entry.</p>
  }
  const { changes, ...rest } = details
  const changeRows = changes && typeof changes === 'object' ? Object.entries(changes) : []
  const restRows = Object.entries(rest)

  return (
    <div className="fx-details">
      {changeRows.length > 0 && (
        <table className="fx-diff">
          <caption className="fx-details-caption">Changes</caption>
          <thead>
            <tr>
              <th scope="col">Field</th>
              <th scope="col">Before</th>
              <th scope="col">After</th>
            </tr>
          </thead>
          <tbody>
            {changeRows.map(([field, change]) => {
              const isPair = change && typeof change === 'object' && ('from' in change || 'to' in change)
              return (
                <tr key={field}>
                  <th scope="row">{humanize(field)}</th>
                  <td>
                    <span className="fx-diff-old">
                      <span className="sr-only">Removed: </span>
                      {renderValue(isPair ? change.from : null)}
                    </span>
                  </td>
                  <td>
                    <span className="fx-diff-new">
                      <span className="sr-only">Added: </span>
                      {renderValue(isPair ? change.to : change)}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      {restRows.length > 0 && (
        <dl className="fx-kv">
          {restRows.map(([key, value]) => (
            <div key={key}>
              <dt>{humanize(key)}</dt>
              <dd>{renderValue(value)}</dd>
            </div>
          ))}
        </dl>
      )}
      <details className="fx-raw">
        <summary>Raw JSON</summary>
        <pre className="mono">{JSON.stringify(details, null, 2)}</pre>
      </details>
    </div>
  )
}

function renderValue(value) {
  if (value === null || value === undefined || value === '') return <span className="muted">(empty)</span>
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (Array.isArray(value)) {
    if (value.every((v) => v === null || typeof v !== 'object')) return value.length ? value.join(', ') : <span className="muted">(none)</span>
    return <code className="fx-json">{JSON.stringify(value)}</code>
  }
  if (typeof value === 'object') return <code className="fx-json">{JSON.stringify(value)}</code>
  const s = String(value)
  if (/^[0-9a-f]{40,}$/i.test(s)) return <code className="mono" title={s}>{`${s.slice(0, 12)}…${s.slice(-6)}`}</code>
  return s
}
