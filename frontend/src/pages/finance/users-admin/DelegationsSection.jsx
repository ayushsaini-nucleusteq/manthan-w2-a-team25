import { useState } from 'react'
import DataTable from '../../../components/DataTable.jsx'
import ConfirmDialog from '../../../components/ConfirmDialog.jsx'
import Button from '../../../components/Button.jsx'
import { delegationsApi, errorMessage } from '../../../api'
import { useAsync } from '../../../hooks/useAsync.js'
import { useToast } from '../../../components/toast/useToast.js'
import { formatDateRange, formatDateTime } from '../../../utils/format.js'

const STATUS_TONE = { ACTIVE: 'tone-success', SCHEDULED: 'tone-info', EXPIRED: 'tone-neutral', REVOKED: 'tone-danger' }
const STATUS_LABEL = { ACTIVE: 'Active', SCHEDULED: 'Scheduled', EXPIRED: 'Ended', REVOKED: 'Revoked' }

/** All delegations in the company, with revoke for active and scheduled ones. */
export default function DelegationsSection() {
  const toast = useToast()
  const { data, error, loading, reload } = useAsync(() => delegationsApi.listDelegations({ scope: 'all' }), [])
  const [revoking, setRevoking] = useState(null)
  const [busy, setBusy] = useState(false)

  const confirmRevoke = async () => {
    setBusy(true)
    try {
      await delegationsApi.revokeDelegation(revoking.id)
      toast.success(`${revoking.delegateName} can no longer act for ${revoking.delegatorName}.`, { title: 'Delegation revoked' })
      setRevoking(null)
      reload()
    } catch (err) {
      toast.error(errorMessage(err), { title: 'Not revoked' })
      if (err?.status === 409) {
        setRevoking(null)
        reload()
      }
    } finally {
      setBusy(false)
    }
  }

  const columns = [
    { key: 'delegator', header: 'From', mobileTitle: true, render: (d) => <span className="semibold">{d.delegatorName}</span>, sortable: true, sortValue: (d) => d.delegatorName },
    { key: 'delegate', header: 'To', render: (d) => d.delegateName, sortable: true, sortValue: (d) => d.delegateName },
    { key: 'dates', header: 'Dates', render: (d) => <span className="nowrap">{formatDateRange(d.startsOn, d.endsOn)}</span>, sortable: true, sortValue: (d) => d.startsOn },
    { key: 'reason', header: 'Reason', render: (d) => d.reason || '—' },
    {
      key: 'status',
      header: 'Status',
      render: (d) => (
        <span className={`chip chip-sm ${STATUS_TONE[d.status] || 'tone-neutral'}`} title={d.revokedAt ? `Revoked ${formatDateTime(d.revokedAt)}` : undefined}>
          {STATUS_LABEL[d.status] || d.status}
        </span>
      ),
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      mobileLabel: 'Actions',
      render: (d) =>
        d.status === 'ACTIVE' || d.status === 'SCHEDULED' ? (
          <Button size="sm" variant="danger-outline" onClick={() => setRevoking(d)} aria-label={`Revoke delegation from ${d.delegatorName} to ${d.delegateName}`}>
            Revoke
          </Button>
        ) : null,
    },
  ]

  return (
    <section aria-labelledby="ua-delegations">
      <div className="ua-section-head">
        <h2 id="ua-delegations" className="ua-section-title">Delegations</h2>
        {data && <span className="small muted">{data.filter((d) => d.status === 'ACTIVE').length} active</span>}
      </div>
      <DataTable
        columns={columns}
        rows={data || []}
        loading={loading && !data}
        error={error}
        onRetry={reload}
        dense
        caption="All approval delegations"
        empty={{ title: 'No delegations', message: 'Approvers have not delegated to anyone yet.' }}
        skeletonRows={3}
      />
      <ConfirmDialog
        open={Boolean(revoking)}
        title="Revoke delegation?"
        message={revoking ? `${revoking.delegateName} will stop acting for ${revoking.delegatorName} straight away. Items they already decided stay decided.` : ''}
        confirmLabel="Revoke"
        tone="danger"
        loading={busy}
        onConfirm={confirmRevoke}
        onCancel={() => !busy && setRevoking(null)}
      />
    </section>
  )
}
