import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { dashboardApi, referenceApi } from '../../api'
import PageHeader from '../../components/PageHeader.jsx'
import StatTile from '../../components/StatTile.jsx'
import InfoBanner from '../../components/InfoBanner.jsx'
import ErrorState from '../../components/ErrorState.jsx'
import Select from '../../components/Select.jsx'
import DateInput from '../../components/DateInput.jsx'
import Button from '../../components/Button.jsx'
import Card from '../../components/Card.jsx'
import Skeleton from '../../components/Skeleton.jsx'
import { AlertTriangleIcon, ClockIcon, InboxIcon, RefreshIcon, ShieldIcon, WalletIcon } from '../../components/icons.jsx'
import { useAsync } from '../../hooks/useAsync.js'
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js'
import { categoryLabel, formatAge, formatDateRange, formatDateTime, formatMoney, formatNumber, stepTypeLabel, todayISO } from '../../utils/format.js'
import BarChart from './f1f6/BarChart.jsx'
import ChartCard from './f1f6/ChartCard.jsx'
import { compactInr, dismissAlert, isAlertDismissed, moneyToNumber, monthLabel, presetRange, RANGE_PRESETS } from './f1f6/chartUtils.js'
import './f1f6/finance-f1f6.css'

const TITLE = 'Finance dashboard'

/** F1: spend, violations, approval speed, queues and the approval-age alert (US16, US18). */
export default function DashboardPage() {
  useDocumentTitle(TITLE)
  const [preset, setPreset] = useState('6m')
  const [custom, setCustom] = useState(() => presetRange('3m'))
  const [departmentId, setDepartmentId] = useState('')
  const [dismissedAt, setDismissedAt] = useState(null)

  const customError = preset === 'custom' ? validateRange(custom) : null
  const range = preset === 'custom' ? custom : presetRange(preset)
  const queryFrom = customError ? null : range.from
  const queryTo = customError ? null : range.to

  const depts = useAsync(() => referenceApi.listDepartments(), [])
  const { data, error, loading, reload } = useAsync(
    () => (queryFrom ? dashboardApi.getDashboard({ from: queryFrom, to: queryTo, departmentId: departmentId || undefined }) : Promise.resolve(undefined)),
    [queryFrom, queryTo, departmentId],
  )

  const charts = useMemo(() => buildCharts(data), [data])
  const alert = data?.approvalAgeAlert
  const showAlert = Boolean(alert?.active && alert.openedAt && dismissedAt !== alert.openedAt && !isAlertDismissed(alert.openedAt))
  const oldest = data?.oldestPending
  const fatal = error && !data
  const first = loading && !data
  const deptName = departmentId ? depts.data?.find((d) => d.id === departmentId)?.name : null

  const onDismiss = () => {
    dismissAlert(alert.openedAt)
    setDismissedAt(alert.openedAt)
  }

  const deptOptions = [{ value: '', label: 'All departments' }, ...(depts.data ?? []).map((d) => ({ value: d.id, label: d.name }))]

  return (
    <div className="page page-hero">
      <PageHeader
        variant="hero"
        eyebrow="Finance head"
        title={TITLE}
        subtitle={`Spend, policy violations and approval speed for ${formatDateRange(range.from, range.to)}${deptName ? ` · ${deptName}` : ''}.`}
        actions={
          <Button variant="inverse" size="sm" icon={<RefreshIcon size={16} />} onClick={reload} loading={loading && Boolean(data)} loadingLabel="Refreshing">
            Refresh
          </Button>
        }
      >
        <form className="fx-hero-filters" aria-label="Dashboard filters" onSubmit={(e) => e.preventDefault()}>
          <Select label="Date range" size="sm" value={preset} onChange={(e) => setPreset(e.target.value)} options={RANGE_PRESETS.map(({ value, label }) => ({ value, label }))} />
          {preset === 'custom' && (
            <>
              <DateInput label="From" size="sm" value={custom.from} max={custom.to || todayISO()} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} error={customError?.from} />
              <DateInput label="To" size="sm" value={custom.to} min={custom.from} max={todayISO()} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} error={customError?.to} />
            </>
          )}
          <Select
            label="Department"
            size="sm"
            value={departmentId}
            onChange={(e) => setDepartmentId(e.target.value)}
            options={deptOptions}
            disabled={depts.loading && !depts.data}
            hint={depts.error ? 'Departments could not be loaded.' : undefined}
          />
        </form>
      </PageHeader>

      <div className="page-body fx-dash">
        {showAlert && (
          <InfoBanner
            tone="danger"
            live
            title="Approval age alert"
            icon={<AlertTriangleIcon size={20} />}
            onDismiss={onDismiss}
            action={
              <Link className="fx-banner-link" to={`/finance/audit-log?claim=${encodeURIComponent(alert.claimNumber ?? '')}`}>
                View {alert.claimNumber}
              </Link>
            }
          >
            Oldest pending approval has waited <strong>{formatAge(alert.ageHours)}</strong> (threshold {formatNumber(alert.thresholdHours)} h). Alert opened {formatDateTime(alert.openedAt)}. Queue size:{' '}
            <strong>{formatNumber(data.queues.total)}</strong>. Threshold is set in <Link to="/finance/policy">Policy configuration</Link>.
          </InfoBanner>
        )}

        {fatal ? (
          <ErrorState error={error} onRetry={reload} title="We couldn't load the dashboard" />
        ) : (
          <>
            {error && <InfoBanner tone="warning" title="Showing earlier figures">The latest refresh failed. <button type="button" className="fx-link-button" onClick={reload}>Try again</button></InfoBanner>}

            <section aria-labelledby="fx-kpi-h" className="fx-section">
              <h2 id="fx-kpi-h" className="sr-only">Key figures</h2>
              <div className="fx-kpis">
                <StatTile
                  label="Total approved spend"
                  icon={<WalletIcon size={20} />}
                  loading={first}
                  value={data ? formatMoney(data.totals?.approvedSpend, { whole: true }) : '—'}
                  hint={data ? `${formatNumber(data.totals?.claimsSubmitted)} claims submitted · ${formatMoney(data.totals?.pendingAmount, { compact: true })} pending` : ' '}
                />
                <StatTile
                  label="Policy violations"
                  tone="warning"
                  icon={<ShieldIcon size={20} />}
                  loading={first}
                  value={data ? formatNumber(data.violations.total) : '—'}
                  hint={data ? topReason(data.violations.byReason) : ' '}
                />
                <StatTile
                  label="Average approval time"
                  tone="info"
                  icon={<ClockIcon size={20} />}
                  loading={first}
                  value={data ? (data.avgApprovalHours == null ? '—' : formatAge(data.avgApprovalHours)) : '—'}
                  hint={data ? (data.avgApprovalHours == null ? 'No human decisions in this period' : 'Submission to final decision') : ' '}
                />
                <StatTile
                  label="Approval queue"
                  tone={alert?.active ? 'danger' : 'purple'}
                  icon={<InboxIcon size={20} />}
                  loading={first}
                  to="/approvals"
                  value={data ? formatNumber(data.queues.total) : '—'}
                  hint={
                    data
                      ? `Manager ${data.queues.manager} · Auditor ${data.queues.auditor} · Head ${data.queues.financeHead} · Sample ${data.queues.sampleAudit}`
                      : ' '
                  }
                />
              </div>
            </section>

            <Card
              title="Oldest pending approval"
              subtitle={`Alert threshold: ${alert ? `${formatNumber(alert.thresholdHours)} h` : '…'} (set in Policy configuration)`}
              className={`fx-oldest${oldest && alert && oldest.ageHours > alert.thresholdHours ? ' is-breach' : ''}`}
              actions={
                <Button variant="ghost" size="sm" to="/finance/policy">
                  Change threshold
                </Button>
              }
            >
              {first ? (
                <div className="fx-oldest-grid" aria-hidden="true">
                  {[0, 1, 2, 3].map((i) => (
                    <div key={i}>
                      <Skeleton width={70} height={12} />
                      <Skeleton width="80%" height={18} />
                    </div>
                  ))}
                </div>
              ) : oldest ? (
                <dl className="fx-oldest-grid">
                  <div>
                    <dt>Claim</dt>
                    <dd>
                      <Link to={`/finance/audit-log?claim=${encodeURIComponent(oldest.claimNumber)}`} className="mono">
                        {oldest.claimNumber}
                      </Link>
                    </dd>
                  </div>
                  <div>
                    <dt>Stage</dt>
                    <dd>{stepTypeLabel(oldest.stepType)}</dd>
                  </div>
                  <div>
                    <dt>Assignee</dt>
                    <dd>{oldest.assigneeName ?? '—'}</dd>
                  </div>
                  <div>
                    <dt>Waiting</dt>
                    <dd className={alert && oldest.ageHours > alert.thresholdHours ? 'fx-danger-text' : undefined}>
                      {formatAge(oldest.ageHours)}
                      <span className="muted fx-small"> since {formatDateTime(oldest.pendingSince)}</span>
                    </dd>
                  </div>
                </dl>
              ) : (
                <p className="muted">No approvals are pending{deptName ? ` in ${deptName}` : ''}. The queue is clear.</p>
              )}
            </Card>

            <section aria-labelledby="fx-charts-h" className="fx-section">
              <h2 id="fx-charts-h" className="fx-section-title">
                Spend and violations
              </h2>
              <div className="fx-chart-grid">
                <ChartCard
                  title="Spend by month"
                  subtitle="Approved, in batch and paid claims, by submission month"
                  className="fx-span-2"
                  loading={loading}
                  hasData={Boolean(data)}
                  empty={charts.months.every((d) => d.value === 0)}
                  emptyMessage="No approved spend in this date range."
                >
                  <BarChart orientation="column" title="Spend by month" description="Column chart of approved spend per month in rupees." data={charts.months} tickFormat={(v) => compactInr(v)} valueHeader="Spend" />
                </ChartCard>
                <ChartCard
                  title="Spend by category"
                  skeleton="bar"
                  loading={loading}
                  hasData={Boolean(data)}
                  empty={charts.categories.every((d) => d.value === 0)}
                  emptyMessage="No approved spend in this date range."
                >
                  <BarChart orientation="bar" title="Spend by category" description="Horizontal bars of approved spend per expense category." data={charts.categories} valueHeader="Spend" />
                </ChartCard>
                <ChartCard
                  title="Spend by department"
                  skeleton="bar"
                  loading={loading}
                  hasData={Boolean(data)}
                  empty={charts.departments.every((d) => d.value === 0)}
                  emptyMessage="No approved spend in this date range."
                >
                  <BarChart orientation="bar" title="Spend by department" description="Horizontal bars of approved spend per department." data={charts.departments} valueHeader="Spend" />
                </ChartCard>
                <ChartCard
                  title="Violations by reason"
                  subtitle={data ? `${formatNumber(data.violations.total)} findings across submitted lines` : undefined}
                  skeleton="bar"
                  loading={loading}
                  hasData={Boolean(data)}
                  empty={charts.reasons.length === 0}
                  emptyMessage="No policy violations in this date range."
                >
                  <BarChart orientation="bar" tone="navy" title="Policy violations by reason" description="Horizontal bars counting policy findings per reason." data={charts.reasons} valueHeader="Findings" />
                </ChartCard>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  )
}

function validateRange({ from, to }) {
  const errors = {}
  const today = todayISO()
  if (!from) errors.from = 'Pick a start date.'
  if (!to) errors.to = 'Pick an end date.'
  else if (to > today) errors.to = 'End date cannot be in the future.'
  if (from && to && from > to) errors.to = 'End date must be on or after the start date.'
  return Object.keys(errors).length ? errors : null
}

function topReason(byReason = []) {
  if (!byReason.length) return 'No findings in this period'
  return `Most common: ${byReason[0].label} (${formatNumber(byReason[0].count)})`
}

function moneyPoint(key, label, amount, longLabel) {
  return {
    key,
    label,
    longLabel,
    value: moneyToNumber(amount),
    display: compactInr(amount),
    tooltip: formatMoney(amount),
  }
}

function buildCharts(data) {
  if (!data) return { months: [], categories: [], departments: [], reasons: [] }
  return {
    months: data.spendByMonth.map((m) => moneyPoint(m.month, monthLabel(m.month), m.amount, monthLabel(m.month, true))),
    categories: [...data.spendByCategory]
      .sort((a, b) => moneyToNumber(b.amount) - moneyToNumber(a.amount))
      .map((c) => moneyPoint(c.category, c.categoryName ?? categoryLabel(c.category), c.amount)),
    departments: data.spendByDepartment.map((d) => moneyPoint(d.departmentId ?? d.departmentName, d.departmentName, d.amount)),
    reasons: data.violations.byReason.map((r) => ({
      key: r.reasonCode,
      label: r.label,
      value: r.count,
      display: formatNumber(r.count),
      tooltip: `${formatNumber(r.count)} ${r.count === 1 ? 'finding' : 'findings'}`,
    })),
  }
}
