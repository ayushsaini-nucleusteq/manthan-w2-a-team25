/**
 * Shimmering placeholder blocks.
 *
 *   <Skeleton width="40%" height={20} />
 *   <SkeletonText lines={3} />
 *   <SkeletonCard />           card with heading + text
 *   <SkeletonList rows={5} />  stacked rows (list pages)
 */
export default function Skeleton({ width = '100%', height = 14, radius, circle = false, className = '', style }) {
  const size = circle ? { width: height, height, borderRadius: '50%' } : { width, height, borderRadius: radius }
  return <span className={`skeleton ${className}`} style={{ ...size, ...style }} aria-hidden="true" />
}

export function SkeletonText({ lines = 3, lastWidth = '60%' }) {
  return (
    <span className="skeleton-text" aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} width={i === lines - 1 && lines > 1 ? lastWidth : '100%'} />
      ))}
    </span>
  )
}

export function SkeletonCard({ lines = 3, label = 'Loading…' }) {
  return (
    <div className="card card-pad skeleton-card" role="status" aria-label={label}>
      <Skeleton width="45%" height={20} />
      <SkeletonText lines={lines} />
    </div>
  )
}

export function SkeletonList({ rows = 5, label = 'Loading…' }) {
  return (
    <div className="skeleton-list" role="status" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => (
        <div className="skeleton-list-row" key={i}>
          <Skeleton circle height={36} />
          <span className="grow stack stack-sm">
            <Skeleton width={`${55 + ((i * 13) % 30)}%`} height={14} />
            <Skeleton width={`${30 + ((i * 7) % 20)}%`} height={12} />
          </span>
          <Skeleton width={80} height={14} />
        </div>
      ))}
    </div>
  )
}
