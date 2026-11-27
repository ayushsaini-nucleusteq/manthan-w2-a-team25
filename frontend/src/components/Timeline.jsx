import { useMemo } from 'react'
import StatusChip from './StatusChip.jsx'
import { ArrowRightIcon, CheckIcon, CornerUpLeftIcon, MessageIcon, XIcon } from './icons.jsx'
import { COMMENT_KIND_LABEL } from '../utils/constants.js'
import { formatDateTime, roleLabel } from '../utils/format.js'

const STATUS_DOT = {
  APPROVED: 'success',
  AUTO_APPROVED: 'success',
  PAID: 'navy',
  REJECTED: 'danger',
  AUTO_REJECTED: 'danger',
  SENT_BACK: 'purple',
  IN_BATCH: 'info',
}

const KIND_TONE = { SEND_BACK: 'purple', REJECT_REASON: 'danger', APPROVE_NOTE: 'success', REPLY: 'brand', COMMENT: 'neutral' }

function statusIcon(status) {
  if (status === 'APPROVED' || status === 'AUTO_APPROVED' || status === 'PAID') return <CheckIcon size={14} strokeWidth={2.5} />
  if (status === 'REJECTED' || status === 'AUTO_REJECTED') return <XIcon size={14} strokeWidth={2.5} />
  if (status === 'SENT_BACK') return <CornerUpLeftIcon size={14} strokeWidth={2.25} />
  return <ArrowRightIcon size={14} strokeWidth={2.25} />
}

/**
 * Status history and comments merged chronologically.
 *
 * @param {object} props
 * @param {Array<{at, fromStatus, toStatus, actorName, onBehalfOfName, note}>} [props.statusHistory]
 * @param {Array<{id, at, authorName, authorRole, kind, text}>} [props.comments]
 * @param {'asc'|'desc'} [props.order] oldest first by default
 * @param {React.ReactNode} [props.emptyText]
 */
export default function Timeline({ statusHistory = [], comments = [], order = 'asc', emptyText = 'No activity yet.' }) {
  const items = useMemo(() => {
    const merged = [
      ...statusHistory.map((h, i) => ({ type: 'status', at: h.at, key: `h${i}-${h.at}`, data: h, seq: i })),
      ...comments.map((c, i) => ({ type: 'comment', at: c.at, key: `c${c.id ?? i}`, data: c, seq: i + 0.5 })),
    ]
    merged.sort((a, b) => {
      const d = new Date(a.at).getTime() - new Date(b.at).getTime()
      // Same timestamp: status change before the comment that explains it.
      return d || (a.type === b.type ? a.seq - b.seq : a.type === 'status' ? -1 : 1)
    })
    return order === 'desc' ? merged.reverse() : merged
  }, [statusHistory, comments, order])

  if (items.length === 0) return <p className="muted">{emptyText}</p>

  return (
    <ol className="timeline">
      {items.map((item) => {
        if (item.type === 'status') {
          const h = item.data
          const tone = STATUS_DOT[h.toStatus] || 'brand'
          return (
            <li key={item.key} className="timeline-item">
              <span className={`timeline-dot tone-${tone}`} aria-hidden="true">
                {statusIcon(h.toStatus)}
              </span>
              <div className="timeline-content">
                <div className="timeline-head">
                  <span className="timeline-status">
                    {h.fromStatus && (
                      <>
                        <StatusChip status={h.fromStatus} size="sm" dot={false} />
                        <ArrowRightIcon size={14} className="muted" title="to" />
                      </>
                    )}
                    <StatusChip status={h.toStatus} size="sm" />
                  </span>
                  <time className="timeline-time" dateTime={h.at}>
                    {formatDateTime(h.at)}
                  </time>
                </div>
                <p className="timeline-actor">
                  {h.actorName ? (
                    <>
                      by <strong>{h.actorName}</strong>
                      {h.onBehalfOfName && <> on behalf of <strong>{h.onBehalfOfName}</strong></>}
                    </>
                  ) : (
                    <span className="muted">by the system</span>
                  )}
                </p>
                {h.note && <p className="timeline-note">{h.note}</p>}
              </div>
            </li>
          )
        }
        const c = item.data
        const tone = KIND_TONE[c.kind] || 'neutral'
        return (
          <li key={item.key} className="timeline-item is-comment">
            <span className={`timeline-dot timeline-dot-comment tone-${tone}`} aria-hidden="true">
              <MessageIcon size={14} strokeWidth={2} />
            </span>
            <div className="timeline-content">
              <div className="timeline-head">
                <span className="timeline-author">
                  <strong>{c.authorName}</strong>
                  {c.authorRole && <span className="muted small"> · {roleLabel(c.authorRole)}</span>}
                  <span className={`chip chip-sm tone-${tone}`}>{COMMENT_KIND_LABEL[c.kind] || 'Comment'}</span>
                </span>
                <time className="timeline-time" dateTime={c.at}>
                  {formatDateTime(c.at)}
                </time>
              </div>
              <blockquote className={`timeline-bubble tone-${tone}`}>{c.text}</blockquote>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
