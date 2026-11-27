import { CheckIcon, XIcon, CornerUpLeftIcon, ClockIcon } from '../../../components/icons.jsx'
import StatusChip from '../../../components/StatusChip.jsx'
import { STEP_STATUS_META } from '../../../utils/constants.js'
import { formatDateTime, stepTypeLabel } from '../../../utils/format.js'

const STEP_ICON = {
  APPROVED: CheckIcon,
  REJECTED: XIcon,
  SENT_BACK: CornerUpLeftIcon,
  PENDING: ClockIcon,
}

/** Approval chain stepper for M2 (wraps vertically on small screens). */
export default function ApprovalChain({ steps = [] }) {
  if (steps.length === 0) return <p className="muted rv-chain-empty">No approval steps (decided by policy).</p>
  return (
    <ol className="rv-chain" aria-label="Approval chain">
      {steps.map((step, i) => {
        const Icon = STEP_ICON[step.status]
        const who = step.actedByName || step.assigneeName || `${stepTypeLabel(step.stepType)} pool`
        return (
          <li key={step.id} className={`rv-chain-step is-${String(step.status).toLowerCase()}`}>
            <span className="rv-chain-dot" aria-hidden="true">
              {Icon ? <Icon size={14} strokeWidth={2.5} /> : i + 1}
            </span>
            <span className="rv-chain-body">
              <span className="rv-chain-title">
                {i + 1}. {stepTypeLabel(step.stepType)}
              </span>
              <StatusChip status={step.status} meta={STEP_STATUS_META} size="sm" />
              <span className="rv-chain-meta">
                {who}
                {step.onBehalfOfName && <> on behalf of {step.onBehalfOfName}</>}
              </span>
              {step.actedAt && <span className="rv-chain-meta">{formatDateTime(step.actedAt)}</span>}
              {step.status === 'PENDING' && step.pendingSince && (
                <span className="rv-chain-meta">Since {formatDateTime(step.pendingSince)}</span>
              )}
            </span>
          </li>
        )
      })}
    </ol>
  )
}
