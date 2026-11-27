import { useId, useState } from 'react'
import { niceMax, useElementWidth } from './chartUtils.js'

/**
 * Single-series bar chart in plain SVG.
 * - `orientation="column"`: vertical columns (time series, e.g. spend by month).
 * - `orientation="bar"`: horizontal bars with category labels on the left (ranked lists).
 * Every bar is focusable and shows its tooltip on hover or focus; a visually
 * hidden table carries the same data for screen readers.
 *
 * @param {object} props
 * @param {Array<{key: string, label: string, longLabel?: string, value: number, display: string, tooltip?: string}>} props.data
 * @param {'column'|'bar'} [props.orientation]
 * @param {string} props.title accessible chart title
 * @param {string} [props.description]
 * @param {(v: number) => string} [props.tickFormat] axis tick formatter
 * @param {string} [props.valueHeader] header for the hidden table's value column
 * @param {'brand'|'navy'} [props.tone]
 */
export default function BarChart({ data, orientation = 'column', title, description, tickFormat = String, valueHeader = 'Value', tone = 'brand' }) {
  const [wrapRef, width] = useElementWidth()
  const [active, setActive] = useState(null)
  const uid = useId()
  const titleId = `${uid}-title`
  const descId = `${uid}-desc`
  const max = niceMax(Math.max(0, ...data.map((d) => d.value)))

  const show = (i, x, y) => setActive({ i, x, y })
  const hide = () => setActive(null)

  let svg
  if (orientation === 'column') {
    const height = 260
    const pad = { top: 24, right: 8, bottom: 34, left: 56 }
    const innerW = Math.max(40, width - pad.left - pad.right)
    const innerH = height - pad.top - pad.bottom
    const band = innerW / Math.max(1, data.length)
    const barW = Math.max(6, Math.min(48, band * 0.6))
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max)
    const showValues = band >= 46
    const labelEvery = band < 34 ? Math.ceil(34 / band) : 1
    svg = (
      <svg width={width} height={height} role="group" aria-labelledby={titleId} aria-describedby={description ? descId : undefined} className="fx-chart-svg">
        {ticks.map((t) => {
          const y = pad.top + innerH - (t / max) * innerH
          return (
            <g key={t} aria-hidden="true">
              <line x1={pad.left} x2={pad.left + innerW} y1={y} y2={y} className={t === 0 ? 'fx-axis' : 'fx-grid'} />
              <text x={pad.left - 8} y={y} dy="0.32em" textAnchor="end" className="fx-tick">
                {tickFormat(t)}
              </text>
            </g>
          )
        })}
        {data.map((d, i) => {
          const h = max ? (d.value / max) * innerH : 0
          const x = pad.left + band * i + (band - barW) / 2
          const y = pad.top + innerH - h
          const cx = x + barW / 2
          return (
            <g
              key={d.key}
              className={`fx-mark${active?.i === i ? ' is-active' : ''}`}
              tabIndex={0}
              role="img"
              aria-label={`${d.longLabel ?? d.label}: ${d.tooltip ?? d.display}`}
              onMouseEnter={() => show(i, cx, y)}
              onMouseLeave={hide}
              onFocus={() => show(i, cx, y)}
              onBlur={hide}
            >
              <rect x={pad.left + band * i} y={pad.top} width={band} height={innerH} className="fx-hit" />
              {h > 0 && <path d={roundedTop(x, y, barW, h, Math.min(4, barW / 2, h))} className={`fx-bar tone-${tone}`} />}
              {showValues && d.value > 0 && (
                <text x={cx} y={y - 6} textAnchor="middle" className="fx-value" aria-hidden="true">
                  {d.display}
                </text>
              )}
              {i % labelEvery === 0 && (
                <text x={cx} y={pad.top + innerH + 20} textAnchor="middle" className="fx-tick" aria-hidden="true">
                  {d.label}
                </text>
              )}
            </g>
          )
        })}
      </svg>
    )
  } else {
    const rowH = 34
    const pad = { top: 4, right: 64, bottom: 4 }
    const labelW = Math.min(150, Math.max(84, Math.floor(width * 0.34)))
    const innerW = Math.max(30, width - labelW - pad.right)
    const height = pad.top + pad.bottom + rowH * data.length
    const barH = 16
    svg = (
      <svg width={width} height={height} role="group" aria-labelledby={titleId} aria-describedby={description ? descId : undefined} className="fx-chart-svg">
        <line x1={labelW} x2={labelW} y1={pad.top} y2={height - pad.bottom} className="fx-axis" aria-hidden="true" />
        {data.map((d, i) => {
          const w = max ? (d.value / max) * innerW : 0
          const y = pad.top + rowH * i
          const by = y + (rowH - barH) / 2
          return (
            <g
              key={d.key}
              className={`fx-mark${active?.i === i ? ' is-active' : ''}`}
              tabIndex={0}
              role="img"
              aria-label={`${d.longLabel ?? d.label}: ${d.tooltip ?? d.display}`}
              onMouseEnter={() => show(i, labelW + w, by)}
              onMouseLeave={hide}
              onFocus={() => show(i, labelW + w, by)}
              onBlur={hide}
            >
              <rect x={0} y={y} width={width} height={rowH} className="fx-hit" />
              <text x={labelW - 10} y={y + rowH / 2} dy="0.32em" textAnchor="end" className="fx-label" aria-hidden="true">
                {truncate(d.label, Math.floor((labelW - 12) / 7))}
              </text>
              {w > 0 && <path d={roundedRight(labelW, by, w, barH, Math.min(4, w))} className={`fx-bar tone-${tone}`} />}
              <text x={labelW + w + 6} y={y + rowH / 2} dy="0.32em" className="fx-value" aria-hidden="true">
                {d.display}
              </text>
            </g>
          )
        })}
      </svg>
    )
  }

  const tip = active ? data[active.i] : null
  return (
    <figure className="fx-chart">
      <figcaption className="sr-only">
        <span id={titleId}>{title}</span>
        {description && <span id={descId}>. {description}</span>}
      </figcaption>
      <div className="fx-chart-canvas" ref={wrapRef}>
        {svg}
        {tip && (
          <div
            className={`fx-tooltip${orientation === 'bar' ? ' is-bar' : ''}`}
            style={{ left: Math.min(Math.max(active.x, 80), Math.max(80, width - 80)), top: active.y }}
            aria-hidden="true"
          >
            <span className="fx-tooltip-label">{tip.longLabel ?? tip.label}</span>
            <strong className="num">{tip.tooltip ?? tip.display}</strong>
          </div>
        )}
      </div>
      <table className="sr-only">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th scope="col">Item</th>
            <th scope="col">{valueHeader}</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.key}>
              <th scope="row">{d.longLabel ?? d.label}</th>
              <td>{d.tooltip ?? d.display}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}

function roundedTop(x, y, w, h, r) {
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`
}

function roundedRight(x, y, w, h, r) {
  return `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x}Z`
}

function truncate(text, max) {
  const s = String(text ?? '')
  return s.length > max && max > 3 ? `${s.slice(0, max - 1)}…` : s
}
