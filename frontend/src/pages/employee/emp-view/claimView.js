import { formatMoney } from '../../../utils/format.js'

/** Statuses the owner may still edit (and so see a "Continue editing" action). */
export const CONTINUE_STATUSES = new Set(['DRAFT', 'SENT_BACK'])

/** Flags an employee may see on their own claims. The sample-audit tag stays hidden from them. */
export function employeeFlags(flags = []) {
  return flags.filter((f) => f !== 'SAMPLE')
}

/** Latest comment of the given kind (comments arrive oldest first). */
export function latestComment(comments = [], kind) {
  for (let i = comments.length - 1; i >= 0; i -= 1) {
    if (comments[i].kind === kind) return comments[i]
  }
  return null
}

/** True when the claim has never been submitted (only then can it be deleted). */
export function isNeverSubmitted(claim) {
  return claim.status === 'DRAFT' && !claim.submittedAt && !(claim.submissionNo > 0)
}

/**
 * What happens next, per status, for the status banner on E7.
 * @returns {{tone: 'info'|'warning'|'danger'|'success', title: string, text: string}}
 */
export function nextStepInfo(claim, policy) {
  const auditorAbove = formatMoney(policy?.auditorAboveTotal ?? '25000.00', { whole: true })
  const headAbove = formatMoney(policy?.financeHeadAboveTotal ?? '100000.00', { whole: true })
  const step = claim.currentStep
  const who = step?.assigneeName || step?.poolLabel
  switch (claim.status) {
    case 'DRAFT':
      return {
        tone: 'info',
        title: 'Draft: not submitted yet',
        text: 'Add your expense lines and receipts, then submit. Nobody else can see this claim until you do.',
      }
    case 'SUBMITTED':
      return { tone: 'info', title: 'Submitted', text: 'Policy checks are running. The claim will be routed shortly.' }
    case 'PENDING_MANAGER':
      return {
        tone: 'info',
        title: `Waiting for your manager${who ? ` (${who})` : ''}`,
        text: `Your manager reviews the claim first. Claims above ${auditorAbove} also go to the finance auditor afterwards.`,
      }
    case 'PENDING_AUDITOR':
      return {
        tone: 'info',
        title: 'Waiting for the finance auditor',
        text: `Above ${auditorAbove}, the finance auditor checks it after your manager. Claims above ${headAbove} then go to the finance head.`,
      }
    case 'PENDING_FINANCE_HEAD':
      return {
        tone: 'info',
        title: 'Waiting for the finance head',
        text: `Above ${headAbove}, the finance head gives the final approval after the auditor.`,
      }
    case 'AUTO_APPROVED':
      return {
        tone: 'success',
        title: 'Auto-approved',
        text: 'Every line was within policy, so no manual approval was needed. It will be included in the next payout batch.',
      }
    case 'APPROVED':
      return { tone: 'success', title: 'Approved', text: 'All approvers have signed off. Finance will include it in the next payout batch.' }
    case 'IN_BATCH':
      return {
        tone: 'success',
        title: 'In a payout batch',
        text: `Finance has added this claim to payout batch ${claim.payoutBatchNumber ?? ''}. You will be notified once it is paid.`.replace('  ', ' '),
      }
    case 'PAID':
      return { tone: 'success', title: 'Paid', text: 'The amount has been paid to your registered bank account.' }
    case 'SENT_BACK':
      return {
        tone: 'warning',
        title: 'Sent back to you',
        text: 'An approver asked for changes. Reply and resubmit. If you edit lines, the claim restarts at your manager.',
      }
    case 'REJECTED':
      return { tone: 'danger', title: 'Rejected', text: 'An approver rejected this claim. This decision is final.' }
    case 'AUTO_REJECTED':
      return {
        tone: 'danger',
        title: 'Auto-rejected by policy',
        text: 'At least one line broke a hard policy rule, so the claim was rejected automatically. This decision is final.',
      }
    default:
      return { tone: 'info', title: 'Status', text: '' }
  }
}

/** Human description of a policy finding's numbers, e.g. "Limit ₹1,500/day · actual ₹1,800 · over by ₹300". */
export function findingNumbers(finding, unitText = '') {
  const parts = []
  if (finding.limitValue) parts.push(`${finding.limitType === 'HARD' ? 'Hard limit' : 'Limit'} ${formatMoney(finding.limitValue)}${unitText}`)
  if (finding.actualValue) parts.push(`actual ${formatMoney(finding.actualValue)}`)
  if (finding.excessValue) parts.push(`over by ${formatMoney(finding.excessValue)}`)
  return parts.join(' · ')
}
