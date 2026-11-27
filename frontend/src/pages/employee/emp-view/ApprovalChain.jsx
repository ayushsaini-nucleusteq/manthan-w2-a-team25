import { CheckIcon, ClockIcon, CornerUpLeftIcon, XIcon } from '../../../components/icons.jsx'
import { STEP_STATUS_META } from '../../../utils/constants.js'
import { formatAge, formatDateTime, stepTypeLabel } from '../../../utils/format.js'

const STEP_ICON = {
  APPROVED: <CheckIcon size={16} />,
  REJECTED: <XIcon size={16} />,
  SENT_BACK: <CornerUpLeftIcon size={16} />,
  PENDING: <ClockIcon size={16} />,
}

function emptyText(status) {
  if (status === 'DRAFT') {
    return 'The approval chain is set when you submit: your manager first, then the auditor and finance head for larger claims.'
  }
  if (status === 'AUTO_APPROVED') return 'No manual approval was needed: every line was within policy.'
  if (status === 'AUTO_REJECTED') return 'No approvers were involved: policy rejected the claim automatically.'
  return 'No approval steps.'
}

/** Vertical stepper of the claim's approval steps (E7). */
export default function ApprovalChain({ steps = [], status }) {
  if (steps.length === 0) return <p className="muted">{emptyText(status)}</p>
  return (
    <ol className="emp-chain">
      {steps.map((step, i) => {
        const meta = STEP_STATUS_META[step.status] ?? { label: step.status, tone: 'neutral' }
        return (
          <li key={step.id} className={`emp-chain-step tone-${meta.tone} is-${String(step.status).toLowerCase()}`}>
            <span className="emp-chain-dot" aria-hidden="true">
              {STEP_ICON[step.status] ?? i + 1}
            </span>
            <div className="emp-chain-body">
              <div className="emp-chain-head">
                <strong>{stepTypeLabel(step.stepType)}</strong>
                <span className={`chip chip-sm tone-${meta.tone}`}>{meta.label}</span>
                {step.overdue && <span className="chip chip-sm tone-danger">Overdue</span>}
              </div>
              <p className="emp-chain-who">{step.assigneeName ?? step.poolLabel ?? 'Assigned on submit'}</p>
              {step.actedByName && (
                <p className="muted emp-chain-meta">
                  {meta.label} by {step.actedByName}
                  {step.onBehalfOfName ? ` on behalf of ${step.onBehalfOfName}` : ''}
                  {step.actedAt ? ` · ${formatDateTime(step.actedAt)}` : ''}
                </p>
              )}
              {step.status === 'PENDING' && step.ageHours != null && (
                <p className="muted emp-chain-meta">Waiting {formatAge(step.ageHours)}</p>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
