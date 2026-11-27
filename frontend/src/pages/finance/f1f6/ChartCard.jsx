import Card from '../../../components/Card.jsx'
import EmptyState from '../../../components/EmptyState.jsx'
import ErrorState from '../../../components/ErrorState.jsx'
import Skeleton from '../../../components/Skeleton.jsx'
import { BarChartIcon } from '../../../components/icons.jsx'

/**
 * Card shell for a dashboard chart with loading skeleton, error-with-retry and empty states.
 * Keeps the previous chart visible (dimmed) while a filter change reloads.
 */
export default function ChartCard({ title, subtitle, loading, hasData, error, onRetry, empty, emptyMessage, skeleton = 'column', className = '', children }) {
  let body
  if (error) body = <ErrorState error={error} onRetry={onRetry} compact />
  else if (loading && !hasData) body = <ChartSkeleton kind={skeleton} />
  else if (empty) body = <EmptyState compact icon={<BarChartIcon size={28} />} title="No data for this period" message={emptyMessage} />
  else body = <div className={loading ? 'fx-reloading' : undefined}>{children}</div>
  return (
    <Card title={title} subtitle={subtitle} className={`fx-chart-card ${className}`} aria-busy={loading || undefined}>
      {body}
    </Card>
  )
}

function ChartSkeleton({ kind }) {
  if (kind === 'bar') {
    return (
      <div className="fx-skel-bars" aria-hidden="true">
        {[90, 72, 60, 44, 30, 18].map((w, i) => (
          <div key={i} className="fx-skel-bar-row">
            <Skeleton width={80} height={12} />
            <Skeleton width={`${w}%`} height={14} />
          </div>
        ))}
      </div>
    )
  }
  return (
    <div className="fx-skel-cols" aria-hidden="true">
      {[40, 65, 52, 80, 70, 92].map((h, i) => (
        <Skeleton key={i} width="10%" height={`${h}%`} />
      ))}
    </div>
  )
}
