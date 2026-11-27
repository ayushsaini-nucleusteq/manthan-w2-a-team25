import TextArea from '../../../components/TextArea.jsx'
import InfoBanner from '../../../components/InfoBanner.jsx'
import EmptyState from '../../../components/EmptyState.jsx'

/** Step 3 "Review & publish": diff table, change note and the "new lines only" notice. */
export default function ReviewStep({ rows, note, noteError, onNoteChange, onNoteBlur, disabled }) {
  return (
    <div className="stack">
      {rows.length === 0 ? (
        <EmptyState compact title="No changes yet" message="Edit a limit or a city to see the difference here." />
      ) : (
        <div className="pc-diff-wrap">
          <table className="pc-diff">
            <caption className="sr-only">Changes compared with the current version</caption>
            <thead>
              <tr>
                <th scope="col">Field</th>
                <th scope="col">Current</th>
                <th scope="col">New</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <th scope="row">{r.field}</th>
                  <td className="pc-diff-from">{r.from}</td>
                  <td className="pc-diff-to">
                    <span aria-hidden="true">{'→ '}</span>
                    {r.to}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <TextArea
        label="Change note"
        required
        rows={3}
        maxLength={500}
        showCount
        hint="At least 10 characters. Shown in the version history."
        value={note}
        onChange={(e) => onNoteChange(e.target.value)}
        onBlur={onNoteBlur}
        error={noteError}
        disabled={disabled}
      />
      <InfoBanner tone="info" title="Applies to new and edited lines only. Past decisions are not re-run.">
        Claims already approved, rejected or paid keep the outcome they got under the version in force at the time.
      </InfoBanner>
    </div>
  )
}
