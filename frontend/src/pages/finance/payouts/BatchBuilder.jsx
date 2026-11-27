import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { payoutsApi, errorMessage, isConflictError } from '../../../api'
import { useAsync } from '../../../hooks/useAsync.js'
import { useDebounce } from '../../../hooks/useDebounce.js'
import { useToast } from '../../../components/toast/useToast.js'
import StepColumns from '../../../components/StepColumns.jsx'
import DataTable from '../../../components/DataTable.jsx'
import BulkActionBar from '../../../components/BulkActionBar.jsx'
import TextInput from '../../../components/TextInput.jsx'
import Select from '../../../components/Select.jsx'
import Checkbox from '../../../components/Checkbox.jsx'
import Money from '../../../components/Money.jsx'
import StatusChip from '../../../components/StatusChip.jsx'
import InfoBanner from '../../../components/InfoBanner.jsx'
import Button from '../../../components/Button.jsx'
import { ArrowRightIcon, SearchIcon, WalletIcon } from '../../../components/icons.jsx'
import { formatDate, pluralize } from '../../../utils/format.js'
import { groupByDepartment, matchesClaim, totalOf } from './payoutUtils.js'

/**
 * F2 "New batch" builder: 1 select approved claims → 2 review → 3 create.
 * @param {{onCancel: () => void}} props
 */
export default function BatchBuilder({ onCancel }) {
  const navigate = useNavigate()
  const toast = useToast()
  const eligible = useAsync(() => payoutsApi.listEligibleClaims(), [])
  const [selected, setSelected] = useState([])
  const [q, setQ] = useState('')
  const [dept, setDept] = useState('')
  const [reviewed, setReviewed] = useState(false)
  const [current, setCurrent] = useState(0)
  const [creating, setCreating] = useState(false)
  const [conflict, setConflict] = useState(null)
  const debouncedQ = useDebounce(q, 200)

  const rows = useMemo(() => eligible.data ?? [], [eligible.data])
  const departments = useMemo(
    () => [...new Set(rows.map((r) => r.departmentName).filter(Boolean))].sort().map((d) => ({ value: d, label: d })),
    [rows],
  )
  const visible = useMemo(
    () => rows.filter((r) => (!dept || r.departmentName === dept) && matchesClaim(r, debouncedQ)),
    [rows, dept, debouncedQ],
  )
  // Keep only selections that are still eligible after a reload.
  const selectedRows = useMemo(() => {
    const set = new Set(selected)
    return rows.filter((r) => set.has(r.id))
  }, [rows, selected])
  const selectedTotal = totalOf(selectedRows)
  const groups = useMemo(() => groupByDepartment(selectedRows), [selectedRows])
  const step1Valid = selectedRows.length >= 1
  const missingBank = selectedRows.filter((r) => !r.bankAccountMasked || !r.ifscCode)
  const step2Valid = step1Valid && reviewed && missingBank.length === 0

  const changeSelection = (ids) => {
    setSelected(ids)
    setReviewed(false)
  }

  const columns = [
    {
      key: 'claimNumber',
      header: 'Claim',
      sortable: true,
      mobileTitle: true,
      render: (r) => (
        <Link to={`/approvals/${r.id}`} className="mono" data-no-row-click>
          {r.claimNumber}
        </Link>
      ),
    },
    { key: 'employeeName', header: 'Employee', sortable: true },
    { key: 'departmentName', header: 'Department', sortable: true, mobileHidden: false },
    { key: 'status', header: 'Status', render: (r) => <StatusChip status={r.status} size="sm" />, mobileHidden: true },
    {
      key: 'totalAmount',
      header: 'Amount',
      align: 'right',
      sortable: true,
      sortValue: (r) => Number(r.totalAmount),
      render: (r) => <Money value={r.totalAmount} />,
    },
  ]

  const create = async () => {
    if (!step2Valid) return
    setCreating(true)
    setConflict(null)
    try {
      const batch = await payoutsApi.createBatch(selectedRows.map((r) => r.id))
      toast.success(`${batch.batchNumber} created with ${pluralize(batch.claimCount, 'claim')}.`, { title: 'Batch created' })
      navigate(`/finance/payouts/${batch.id}`)
    } catch (err) {
      if (isConflictError(err)) {
        setConflict(errorMessage(err))
        toast.error('Some claims are no longer eligible. The list was reloaded.', { title: 'Claims changed' })
        await eligible.reload()
      } else {
        toast.error(errorMessage(err), { title: 'Could not create batch' })
      }
      setCreating(false)
    }
  }

  const filtersActive = (q ? 1 : 0) + (dept ? 1 : 0)

  const step1 = (
    <div className="stack-sm stack">
      <div className="payout-toolbar">
        <TextInput
          label="Search claims"
          hideLabel
          placeholder="Search claim no., employee, title"
          icon={<SearchIcon size={18} />}
          size="sm"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          id="payout-search"
        />
        <Select
          label="Department"
          hideLabel
          size="sm"
          id="payout-dept"
          placeholder="All departments"
          options={departments}
          value={dept}
          onChange={(e) => setDept(e.target.value)}
        />
        {filtersActive > 0 && (
          <Button variant="ghost" size="sm" onClick={() => { setQ(''); setDept('') }}>
            Clear filters
          </Button>
        )}
      </div>
      <DataTable
        columns={columns}
        rows={visible}
        selectable
        selectedIds={selected}
        onSelectionChange={changeSelection}
        loading={eligible.loading}
        error={eligible.error}
        onRetry={eligible.reload}
        caption="Approved claims eligible for payout"
        maxHeight="420px"
        skeletonRows={6}
        empty={
          rows.length
            ? { title: 'No matching claims', message: 'Try another search or department.' }
            : { title: 'Nothing to pay right now', message: 'Approved claims, and auto-approved claims with no pending sample audit, appear here.', icon: <WalletIcon size={28} /> }
        }
      />
      <div className="payout-running" aria-live="polite">
        <span>
          <strong>{selectedRows.length}</strong> of {rows.length} {rows.length === 1 ? 'claim' : 'claims'} selected
        </span>
        <span>
          Total <Money value={selectedTotal} strong />
        </span>
      </div>
      <p className="payout-reason">Only Approved claims (or auto-approved ones with no pending sample audit) can be added to a batch.</p>
    </div>
  )

  const step2 = (
    <div className="stack">
      {!step1Valid ? (
        <p className="payout-reason">Select at least one claim to review the batch.</p>
      ) : (
        <>
          <table className="payout-dept-table">
            <caption className="sr-only">Selected claims by department</caption>
            <thead>
              <tr>
                <th scope="col">Department</th>
                <th scope="col" className="num">Claims</th>
                <th scope="col" className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.departmentName}>
                  <th scope="row" style={{ fontWeight: 600, background: 'none', color: 'inherit', fontSize: 'inherit' }}>{g.departmentName}</th>
                  <td className="num">{g.count}</td>
                  <td className="num"><Money value={g.total} /></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Batch total</td>
                <td className="num">{selectedRows.length}</td>
                <td className="num"><Money value={selectedTotal} strong /></td>
              </tr>
            </tfoot>
          </table>
          <ul className="payout-review-list" aria-label="Claims in this batch" tabIndex={0}>
            {selectedRows.map((r) => (
              <li key={r.id}>
                <span><span className="mono">{r.claimNumber}</span> · {r.employeeName}</span>
                <Money value={r.totalAmount} />
                <span className="muted">
                  A/c {r.bankAccountMasked || 'missing'} · IFSC {r.ifscCode || 'missing'}
                </span>
              </li>
            ))}
          </ul>
          {missingBank.length > 0 && (
            <InfoBanner tone="danger" title="Bank details missing" live>
              Remove {missingBank.map((r) => r.claimNumber).join(', ')} or update the employee's bank details first.
            </InfoBanner>
          )}
          <Checkbox
            label="I have checked the claims and bank details"
            description="Account numbers are masked; the bank file carries the full details."
            checked={reviewed}
            onChange={(e) => setReviewed(e.target.checked)}
          />
        </>
      )}
    </div>
  )

  const step3 = (
    <div className="stack">
      <dl className="payout-kv">
        <div>
          <dt>Claims</dt>
          <dd>{selectedRows.length}</dd>
        </div>
        <div>
          <dt>Total</dt>
          <dd><Money value={selectedTotal} strong /></dd>
        </div>
        <div>
          <dt>Departments</dt>
          <dd>{groups.length}</dd>
        </div>
        <div>
          <dt>Created on</dt>
          <dd>{formatDate(new Date())}</dd>
        </div>
      </dl>
      <InfoBanner tone="info" title="What happens next">
        Creating the batch reserves these claims so they cannot join another batch. On the next screen you export the bank file
        (claims move to In batch) and, once the bank confirms, mark the batch as paid.
      </InfoBanner>
      {conflict && (
        <InfoBanner tone="warning" title="Claims changed, list reloaded" live>
          {conflict}
        </InfoBanner>
      )}
    </div>
  )

  return (
    <section className="payout-builder stack" aria-labelledby="payout-builder-title" id="new-batch">
      <div className="row row-between">
        <h2 id="payout-builder-title" style={{ margin: 0 }}>New payout batch</h2>
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={creating}>
          Cancel
        </Button>
      </div>
      <StepColumns
        ariaLabel="New payout batch"
        columnTemplate="minmax(0, 1.7fr) minmax(0, 1.15fr) minmax(0, 0.9fr)"
        current={current}
        onCurrentChange={setCurrent}
        onComplete={create}
        completing={creating}
        completeLabel={`Create batch (${selectedRows.length})`}
        steps={[
          { id: 'select', title: 'Select approved claims', description: 'Pick one or more claims to pay.', valid: step1Valid, content: step1 },
          { id: 'review', title: 'Review batch', description: 'Totals by department and bank details.', valid: step2Valid, content: step2 },
          { id: 'create', title: 'Create', description: 'Reserve the claims in a new batch.', valid: step2Valid, content: step3 },
        ]}
      />
      <BulkActionBar
        count={selectedRows.length}
        onClear={() => changeSelection([])}
        noun="claim"
        summary={<>Total <Money value={selectedTotal} strong /></>}
      >
        <Button size="sm" iconRight={<ArrowRightIcon size={16} />} onClick={() => { setCurrent(1); document.getElementById('new-batch')?.scrollIntoView({ block: 'start', behavior: 'smooth' }) }}>
          Review batch
        </Button>
      </BulkActionBar>
    </section>
  )
}
