import { useMemo, useState } from 'react'
import { delegationsApi, errorMessage, fieldErrors, isApiError } from '../../api'
import { useAsync } from '../../hooks/useAsync.js'
import { useDebounce } from '../../hooks/useDebounce.js'
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js'
import { useToast } from '../../components/toast/useToast.js'
import PageHeader from '../../components/PageHeader.jsx'
import StepColumns from '../../components/StepColumns.jsx'
import TextInput from '../../components/TextInput.jsx'
import DateInput from '../../components/DateInput.jsx'
import TextArea from '../../components/TextArea.jsx'
import Card from '../../components/Card.jsx'
import DataTable from '../../components/DataTable.jsx'
import StatusChip from '../../components/StatusChip.jsx'
import Button from '../../components/Button.jsx'
import ConfirmDialog from '../../components/ConfirmDialog.jsx'
import InfoBanner from '../../components/InfoBanner.jsx'
import EmptyState from '../../components/EmptyState.jsx'
import ErrorState from '../../components/ErrorState.jsx'
import Skeleton from '../../components/Skeleton.jsx'
import { CheckIcon, SearchIcon, UsersIcon, XIcon } from '../../components/icons.jsx'
import { FIELD_LIMITS } from '../../utils/constants.js'
import { formatDate, formatDateRange, initials, roleLabel, todayISO } from '../../utils/format.js'
import { validateDelegationDates, hasErrors } from '../../utils/validation.js'
import { computeDelegationStatus, DELEGATION_STATUS_META } from './delegation/delegationStatus.js'
import './delegation/delegation.css'

const APPROVER_ROLES = ['MANAGER', 'AUDITOR', 'FINANCE_HEAD']

function rolesText(roles = []) {
  const shown = roles.filter((r) => APPROVER_ROLES.includes(r))
  return (shown.length ? shown : roles).map(roleLabel).join(', ')
}

const EMPTY_FORM = { startsOn: '', endsOn: '', reason: '' }

/** M4 Delegation: hand approvals to a colleague while on leave. */
export default function DelegationPage() {
  useDocumentTitle('Delegation')
  const toast = useToast()
  const today = todayISO()

  const [search, setSearch] = useState('')
  const q = useDebounce(search.trim(), 250)
  const candidates = useAsync(() => delegationsApi.listDelegateCandidates({ q }), [q])
  const given = useAsync(() => delegationsApi.listDelegations({ scope: 'given' }), [])
  const received = useAsync(() => delegationsApi.listDelegations({ scope: 'received' }), [])

  const [delegate, setDelegate] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [touched, setTouched] = useState({})
  const [serverErrors, setServerErrors] = useState({})
  const [overlapError, setOverlapError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [current, setCurrent] = useState(0)
  const [revokeTarget, setRevokeTarget] = useState(null)
  const [revoking, setRevoking] = useState(false)

  const dateErrors = useMemo(() => validateDelegationDates(form, { today }), [form, today])
  const datesValid = !hasErrors(dateErrors) && !overlapError

  const update = (key) => (e) => {
    const value = e.target.value
    setForm((prev) => ({ ...prev, [key]: value }))
    setTouched((prev) => ({ ...prev, [key]: true }))
    setServerErrors((prev) => ({ ...prev, [key]: undefined }))
    if (key !== 'reason') setOverlapError(null)
  }
  const blur = (key) => () => setTouched((prev) => ({ ...prev, [key]: true }))
  const errorFor = (key) => serverErrors[key] || (touched[key] ? dateErrors[key] : undefined)

  const chooseDelegate = (c) => {
    setDelegate(c)
    setServerErrors((prev) => ({ ...prev, delegateId: undefined }))
    setOverlapError(null)
  }

  const reset = () => {
    setDelegate(null)
    setForm(EMPTY_FORM)
    setTouched({})
    setServerErrors({})
    setOverlapError(null)
    setSearch('')
    setCurrent(0)
  }

  const create = async () => {
    if (!delegate || hasErrors(dateErrors)) return
    setSaving(true)
    try {
      const created = await delegationsApi.createDelegation({
        delegateId: delegate.id,
        startsOn: form.startsOn,
        endsOn: form.endsOn,
        reason: form.reason.trim() || undefined,
      })
      toast.success(`${created.delegateName} will approve for you ${formatDateRange(created.startsOn, created.endsOn)}.`, {
        title: 'Delegation created',
      })
      reset()
      given.reload()
    } catch (err) {
      if (isApiError(err) && err.status === 409) {
        setOverlapError(err.message)
        setCurrent(1)
        toast.error(err.message, { title: 'Dates overlap another delegation' })
      } else if (isApiError(err) && err.status === 400) {
        const fields = fieldErrors(err) || {}
        setServerErrors(fields)
        setTouched({ startsOn: true, endsOn: true, reason: true })
        if (fields.delegateId) {
          setDelegate(null)
          setCurrent(0)
        } else setCurrent(1)
        toast.error(err.message || 'Please correct the highlighted fields.', { title: 'Could not create delegation' })
      } else if (isApiError(err) && err.status === 422) {
        setServerErrors({ delegateId: err.message })
        setDelegate(null)
        setCurrent(0)
        toast.error(err.message, { title: 'Choose another delegate' })
      } else {
        toast.error(errorMessage(err), { title: 'Could not create delegation' })
      }
    } finally {
      setSaving(false)
    }
  }

  const confirmRevoke = async () => {
    if (!revokeTarget) return
    setRevoking(true)
    try {
      await delegationsApi.revokeDelegation(revokeTarget.id)
      toast.success(`Approvals no longer go to ${revokeTarget.delegateName}.`, { title: 'Delegation revoked' })
      setRevokeTarget(null)
      given.reload()
    } catch (err) {
      if (isApiError(err) && err.status === 409) {
        toast.warning(err.message, { title: 'This delegation changed, reload' })
        setRevokeTarget(null)
        given.reload()
      } else {
        toast.error(errorMessage(err), { title: 'Could not revoke delegation' })
      }
    } finally {
      setRevoking(false)
    }
  }

  /* ---------------- Step 1: choose delegate ---------------- */
  const candidateList = candidates.data ?? []
  const step1 = (
    <div className="stack stack-sm">
      <TextInput
        label="Search colleagues"
        hideLabel
        placeholder="Search by name, code or email"
        icon={<SearchIcon size={16} />}
        size="sm"
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {serverErrors.delegateId && (
        <InfoBanner tone="danger" live>
          {serverErrors.delegateId}
        </InfoBanner>
      )}
      {candidates.error ? (
        <ErrorState error={candidates.error} onRetry={candidates.reload} compact />
      ) : candidates.loading && !candidates.data ? (
        <div className="stack stack-sm" aria-busy="true" aria-label="Loading colleagues">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="deleg-candidate">
              <Skeleton circle width={34} height={34} />
              <div className="deleg-candidate-body stack stack-sm">
                <Skeleton width="60%" />
                <Skeleton width="40%" height={10} />
              </div>
            </div>
          ))}
        </div>
      ) : candidateList.length === 0 ? (
        <EmptyState compact icon={<UsersIcon size={24} />} title="No colleagues found" message={q ? `Nobody matches "${q}".` : 'No eligible approvers are available.'} />
      ) : (
        <ul className="deleg-candidates" role="radiogroup" aria-label="Delegate" aria-busy={candidates.loading}>
          {candidateList.map((c) => {
            const selected = delegate?.id === c.id
            return (
              <li key={c.id}>
                <label className={`deleg-candidate${selected ? ' is-selected' : ''}`}>
                  <input type="radio" name="delegate" value={c.id} checked={selected} onChange={() => chooseDelegate(c)} />
                  <span className="avatar" aria-hidden="true">
                    {initials(c.fullName)}
                  </span>
                  <span className="deleg-candidate-body">
                    <span className="deleg-candidate-name">{c.fullName}</span>
                    <span className="deleg-candidate-meta">
                      {rolesText(c.roles)} · {c.departmentName || 'No department'}
                    </span>
                  </span>
                  {selected && <CheckIcon size={18} className="deleg-check" />}
                </label>
              </li>
            )
          })}
        </ul>
      )}
      {delegate && !candidateList.some((c) => c.id === delegate.id) && (
        <p className="muted">
          Selected: <strong>{delegate.fullName}</strong>
        </p>
      )}
    </div>
  )

  /* ---------------- Step 2: dates and reason ---------------- */
  const step2 = (
    <div className="stack">
      <DateInput
        label="First day of leave"
        required
        min={today}
        value={form.startsOn}
        onChange={update('startsOn')}
        onBlur={blur('startsOn')}
        error={errorFor('startsOn')}
      />
      <DateInput
        label="Last day of leave"
        required
        min={form.startsOn || today}
        value={form.endsOn}
        onChange={update('endsOn')}
        onBlur={blur('endsOn')}
        error={errorFor('endsOn')}
        hint="The delegation ends automatically after this day."
      />
      <TextArea
        label="Reason (optional)"
        rows={3}
        maxLength={FIELD_LIMITS.delegationReason}
        showCount
        value={form.reason}
        onChange={update('reason')}
        onBlur={blur('reason')}
        error={errorFor('reason')}
        placeholder="e.g. Annual leave"
      />
      {overlapError && (
        <InfoBanner tone="danger" title="These dates overlap" live>
          {overlapError}
        </InfoBanner>
      )}
    </div>
  )

  /* ---------------- Step 3: confirm ---------------- */
  const step3 = (
    <Card padded>
      <dl className="deleg-summary">
        <dt>Delegate</dt>
        <dd>{delegate ? delegate.fullName : '—'}</dd>
        <dt>Role</dt>
        <dd>{delegate ? rolesText(delegate.roles) : '—'}</dd>
        <dt>Department</dt>
        <dd>{delegate?.departmentName || '—'}</dd>
        <dt>Dates</dt>
        <dd>{form.startsOn && form.endsOn ? formatDateRange(form.startsOn, form.endsOn) : '—'}</dd>
        <dt>Reason</dt>
        <dd>{form.reason.trim() || <span className="muted">None given</span>}</dd>
        <dt>Starts</dt>
        <dd>{form.startsOn ? (form.startsOn === today ? 'Immediately (today)' : `Scheduled for ${formatDate(form.startsOn)}`) : '—'}</dd>
      </dl>
      <p className="muted" style={{ marginTop: 12 }}>
        Claims that arrive during these dates go to {delegate?.fullName || 'your delegate'} and show &ldquo;Delegated&rdquo;. You can
        revoke at any time.
      </p>
    </Card>
  )

  const steps = [
    {
      id: 'delegate',
      title: 'Choose delegate',
      description: 'Who approves while you are away',
      valid: Boolean(delegate) && !serverErrors.delegateId,
      content: step1,
    },
    {
      id: 'dates',
      title: 'Leave dates & reason',
      description: 'Inclusive dates; ends automatically',
      valid: datesValid,
      content: step2,
    },
    {
      id: 'confirm',
      title: 'Confirm',
      description: 'Check the details',
      valid: Boolean(delegate) && datesValid,
      content: step3,
    },
  ]

  /* ---------------- Lists ---------------- */
  const withStatus = (list) => (list ?? []).map((d) => ({ ...d, computedStatus: computeDelegationStatus(d, today) }))
  const givenRows = withStatus(given.data)
  const receivedRows = withStatus(received.data)

  const statusCol = {
    key: 'computedStatus',
    header: 'Status',
    sortable: true,
    render: (d) => <StatusChip status={d.computedStatus} meta={DELEGATION_STATUS_META} size="sm" />,
  }
  const datesCol = {
    key: 'startsOn',
    header: 'Dates',
    sortable: true,
    render: (d) => formatDateRange(d.startsOn, d.endsOn),
  }
  const reasonCol = {
    key: 'reason',
    header: 'Reason',
    mobileHidden: false,
    render: (d) => d.reason || <span className="muted">—</span>,
  }

  const givenColumns = [
    { key: 'delegateName', header: 'Delegate', mobileTitle: true, sortable: true, render: (d) => <strong>{d.delegateName}</strong> },
    datesCol,
    reasonCol,
    statusCol,
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      mobileLabel: '',
      render: (d) =>
        d.computedStatus === 'ACTIVE' || d.computedStatus === 'SCHEDULED' ? (
          <Button
            size="sm"
            variant="danger-outline"
            icon={<XIcon size={14} />}
            onClick={() => setRevokeTarget(d)}
            aria-label={`Revoke delegation to ${d.delegateName}, ${formatDateRange(d.startsOn, d.endsOn)}`}
          >
            Revoke
          </Button>
        ) : null,
    },
  ]

  const receivedColumns = [
    { key: 'delegatorName', header: 'On behalf of', mobileTitle: true, sortable: true, render: (d) => <strong>{d.delegatorName}</strong> },
    datesCol,
    {
      key: 'coveredRoles',
      header: 'Covers',
      render: (d) => (d.coveredRoles?.length ? d.coveredRoles.map(roleLabel).join(', ') : <span className="muted">—</span>),
    },
    reasonCol,
    statusCol,
  ]

  return (
    <div className="page page-hero">
      <PageHeader
        variant="hero"
        eyebrow="Out of office"
        title="Delegation"
        subtitle="Hand your approvals to a colleague while you're on leave. It switches on and off by itself on the dates you choose."
      />
      <div className="page-body stack stack-lg">
        <InfoBanner tone="info" title="How delegation works">
          While a delegation is active, claims waiting for you also appear in your delegate&rsquo;s inbox, marked &ldquo;Delegated&rdquo;
          with your name. Delegations can&rsquo;t be passed on again, and they end automatically after the last day.
        </InfoBanner>

        <section aria-labelledby="deleg-new-title" className="stack stack-sm">
          <h2 id="deleg-new-title" className="deleg-section-title">
            Set up a delegation
          </h2>
          <StepColumns
            steps={steps}
            current={current}
            onCurrentChange={setCurrent}
            onComplete={create}
            completeLabel="Create delegation"
            completing={saving}
            columnTemplate="1.2fr 1fr 1fr"
            ariaLabel="New delegation"
          />
        </section>

        <section aria-labelledby="deleg-given-title" className="stack stack-sm">
          <h2 id="deleg-given-title" className="deleg-section-title">
            Delegations I&rsquo;ve given
          </h2>
          <DataTable
            columns={givenColumns}
            rows={givenRows}
            loading={given.loading}
            error={given.error}
            onRetry={given.reload}
            empty={{ title: 'No delegations yet', message: 'Delegations you set up appear here.', icon: <UsersIcon size={28} /> }}
            caption="Delegations I've given"
            maxHeight="none"
            skeletonRows={3}
          />
        </section>

        <section aria-labelledby="deleg-received-title" className="stack stack-sm">
          <h2 id="deleg-received-title" className="deleg-section-title">
            Delegated to me
          </h2>
          <DataTable
            columns={receivedColumns}
            rows={receivedRows}
            loading={received.loading}
            error={received.error}
            onRetry={received.reload}
            empty={{ title: 'Nobody has delegated to you', message: 'When a colleague hands you their approvals, it shows here.', icon: <UsersIcon size={28} /> }}
            caption="Delegations to me"
            maxHeight="none"
            skeletonRows={2}
          />
        </section>
      </div>

      <ConfirmDialog
        open={Boolean(revokeTarget)}
        title="Revoke this delegation?"
        message={
          revokeTarget
            ? `${revokeTarget.delegateName} will stop receiving your approvals (${formatDateRange(revokeTarget.startsOn, revokeTarget.endsOn)}). This can't be undone.`
            : ''
        }
        confirmLabel="Revoke delegation"
        tone="danger"
        loading={revoking}
        onConfirm={confirmRevoke}
        onCancel={() => setRevokeTarget(null)}
      />
    </div>
  )
}
