import { policyApi, referenceApi } from '../../api'
import PageHeader from '../../components/PageHeader.jsx'
import Card from '../../components/Card.jsx'
import Accordion from '../../components/Accordion.jsx'
import ErrorState from '../../components/ErrorState.jsx'
import Skeleton from '../../components/Skeleton.jsx'
import Money from '../../components/Money.jsx'
import { useAsync } from '../../hooks/useAsync.js'
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js'
import { formatDate } from '../../utils/format.js'
import PolicyEditor from './policy-config/PolicyEditor.jsx'
import VersionHistory from './policy-config/VersionHistory.jsx'
import './policy-config/policy-config.css'

const HELP_ITEMS = [
  {
    id: 'limits',
    title: 'Soft and hard limits',
    content: (
      <p>
        A line at or below the soft limit can be auto-approved. Above the soft limit it is flagged "Over limit" and routed to an approver.
        Above the hard limit the line is rejected. Meal limits are summed per day; hotel limits apply per night and depend on whether the
        city is tier-1.
      </p>
    ),
  },
  {
    id: 'routing',
    title: 'Approval thresholds',
    content: (
      <p>
        Claim totals decide the approval chain: up to the auto-approve amount with no flags, the claim is approved automatically (a share is
        sampled for audit). Above the auditor threshold an auditor must approve; above the finance-head threshold the finance head approves
        last. These thresholds are fixed by the approval matrix and are not editable here.
      </p>
    ),
  },
  {
    id: 'versions',
    title: 'Versions and past claims',
    content: (
      <p>
        Every publish creates a new numbered version with its author, date and note. Only new and edited lines are evaluated against the new
        version; decisions already made are never re-run.
      </p>
    ),
  },
]

/** F4 Policy configuration (finance head). */
export default function PolicyConfigPage() {
  useDocumentTitle('Policy configuration')
  const current = useAsync(() => referenceApi.getCurrentPolicy(), [])
  const versions = useAsync(() => policyApi.listPolicyVersions(), [])
  const policy = current.data

  const reloadAll = () => {
    current.reload()
    versions.reload()
  }

  return (
    <div className="page">
      <PageHeader
        title="Policy configuration"
        subtitle="Spending limits, receipt rules and tier-1 cities. Each publish creates a new version."
        breadcrumbs={[{ label: 'Dashboard', to: '/finance/dashboard' }, { label: 'Policy' }]}
        meta={
          policy ? (
            <span className="chip tone-brand">
              Version {policy.versionNo} in force since {formatDate(policy.createdAt)}
            </span>
          ) : null
        }
      />
      <div className="page-body stack-lg">
        {current.error && !policy ? (
          <ErrorState error={current.error} onRetry={current.reload} />
        ) : !policy ? (
          <div className="pc-skeleton" aria-busy="true">
            <span className="sr-only">Loading policy…</span>
            <Skeleton height={420} />
            <Skeleton height={420} />
            <Skeleton height={420} />
          </div>
        ) : (
          <PolicyEditor key={policy.versionNo} policy={policy} onPublished={reloadAll} onReload={reloadAll} />
        )}

        <div className="pc-lower">
          <Card title="Approval thresholds" subtitle="Read-only. Set by the approval matrix, not by this editor.">
            {policy ? (
              <dl className="pc-dl">
                <dt>Auto-approve up to</dt>
                <dd><Money value={policy.autoApproveMaxTotal} strong /></dd>
                <dt>Auditor approval above</dt>
                <dd><Money value={policy.auditorAboveTotal} strong /></dd>
                <dt>Finance head approval above</dt>
                <dd><Money value={policy.financeHeadAboveTotal} strong /></dd>
              </dl>
            ) : current.error ? (
              <p className="small muted">Unavailable.</p>
            ) : (
              <Skeleton height={96} />
            )}
            <p className="xsmall muted">
              Claims with no flags and a total up to the auto-approve amount are approved automatically. Larger claims add an auditor and then
              the finance head to the chain.
            </p>
          </Card>
          <VersionHistory
            versions={versions.data}
            loading={versions.loading}
            error={versions.error}
            onRetry={versions.reload}
            currentVersionNo={policy?.versionNo}
          />
        </div>

        <section aria-labelledby="pc-help">
          <h2 id="pc-help" className="pc-section-title">How policy rules work</h2>
          <Accordion items={HELP_ITEMS} headingLevel={3} />
        </section>
      </div>
    </div>
  )
}
