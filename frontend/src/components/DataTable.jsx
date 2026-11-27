import { useId, useMemo, useState } from 'react'
import { useMediaQuery, MOBILE_QUERY } from '../hooks/useMediaQuery.js'
import Checkbox from './Checkbox.jsx'
import EmptyState from './EmptyState.jsx'
import ErrorState from './ErrorState.jsx'
import Skeleton from './Skeleton.jsx'
import { ChevronDownIcon, ChevronUpIcon, SortIcon } from './icons.jsx'

const INTERACTIVE = 'a, button, input, select, textarea, label, [role="button"], [data-no-row-click]'

function getKey(row, rowKey, index) {
  if (typeof rowKey === 'function') return rowKey(row, index)
  return row[rowKey] ?? index
}

function cellValue(row, col) {
  return col.sortValue ? col.sortValue(row) : row[col.key]
}

const NUMERIC = /^-?\d+(\.\d+)?$/

function compareValues(a, b) {
  if (a === b) return 0
  if (a === null || a === undefined || a === '') return 1
  if (b === null || b === undefined || b === '') return -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (typeof a === 'boolean' && typeof b === 'boolean') return a === b ? 0 : a ? -1 : 1
  const sa = String(a)
  const sb = String(b)
  // Decimal money strings ("1500.00") compare numerically; display-only comparison.
  if (NUMERIC.test(sa) && NUMERIC.test(sb)) return Number(sa) - Number(sb)
  return sa.localeCompare(sb, 'en-IN', { numeric: true, sensitivity: 'base' })
}

function renderCell(row, col, index) {
  if (col.render) return col.render(row, index)
  const v = row[col.key]
  return v === null || v === undefined || v === '' ? <span className="muted">—</span> : String(v)
}

/**
 * Dense, scannable data table.
 *
 * @param {object} props
 * @param {Array<{key: string, header: React.ReactNode, render?: (row, index) => React.ReactNode,
 *   align?: 'left'|'right'|'center', sortable?: boolean, sortValue?: (row) => any, width?: string|number,
 *   mobileLabel?: React.ReactNode, mobileHidden?: boolean, mobileTitle?: boolean}>} props.columns
 *   `mobileTitle` marks the column shown as the card heading under 720 px.
 * @param {Array<object>} props.rows
 * @param {string|((row, index) => string)} [props.rowKey] default "id"
 * @param {boolean} [props.selectable]
 * @param {Array<string>} [props.selectedIds]
 * @param {(ids: string[]) => void} [props.onSelectionChange]
 * @param {(row) => boolean|string} [props.isRowSelectable] a string is the reason (shown as a tooltip)
 * @param {{key: string, dir: 'asc'|'desc'}|null} [props.sort] controlled sort (uncontrolled when omitted)
 * @param {(sort) => void} [props.onSortChange]
 * @param {boolean} [props.manualSort] rows are already sorted by the caller/server
 * @param {boolean} [props.loading] skeleton rows (keeps existing rows dimmed if any)
 * @param {any} [props.error]
 * @param {() => any} [props.onRetry]
 * @param {React.ReactNode|{title, message, action, icon}} [props.empty]
 * @param {boolean} [props.dense] 40 px rows (default); false = 52 px
 * @param {(row) => void} [props.onRowClick]
 * @param {(row) => string} [props.rowLabel] accessible label for clickable rows
 * @param {(row) => string} [props.rowClassName]
 * @param {string} [props.caption] screen-reader caption
 * @param {string} [props.maxHeight] scroll container height for the sticky header (default 70vh; "none" to grow)
 * @param {number} [props.skeletonRows]
 */
export default function DataTable({
  columns,
  rows = [],
  rowKey = 'id',
  selectable = false,
  selectedIds = [],
  onSelectionChange,
  isRowSelectable,
  sort: sortProp,
  onSortChange,
  manualSort = false,
  loading = false,
  error,
  onRetry,
  empty,
  dense = true,
  onRowClick,
  rowLabel,
  rowClassName,
  caption,
  maxHeight = '70vh',
  skeletonRows = 6,
  className = '',
}) {
  const mobile = useMediaQuery(MOBILE_QUERY)
  const tableId = useId()
  const [innerSort, setInnerSort] = useState(null)
  const sort = sortProp === undefined ? innerSort : sortProp
  const selected = useMemo(() => new Set(selectedIds), [selectedIds])

  const sortedRows = useMemo(() => {
    if (!sort || manualSort) return rows
    const col = columns.find((c) => c.key === sort.key)
    if (!col) return rows
    const dir = sort.dir === 'desc' ? -1 : 1
    return rows
      .map((row, i) => ({ row, i }))
      .sort((a, b) => compareValues(cellValue(a.row, col), cellValue(b.row, col)) * dir || a.i - b.i)
      .map((x) => x.row)
  }, [rows, sort, manualSort, columns])

  const selectability = (row) => {
    if (!isRowSelectable) return { ok: true, reason: null }
    const r = isRowSelectable(row)
    if (typeof r === 'string') return { ok: false, reason: r }
    return { ok: r !== false, reason: null }
  }

  const selectableKeys = selectable
    ? sortedRows
        .map((r, i) => ({ r, k: String(getKey(r, rowKey, i)) }))
        .filter((x) => selectability(x.r).ok)
        .map((x) => x.k)
    : []
  const selectedVisible = selectableKeys.filter((k) => selected.has(k)).length
  const allSelected = selectableKeys.length > 0 && selectedVisible === selectableKeys.length
  const someSelected = selectedVisible > 0 && !allSelected

  const toggleAll = () => {
    if (!onSelectionChange) return
    if (allSelected) {
      const visible = new Set(selectableKeys)
      onSelectionChange(selectedIds.filter((id) => !visible.has(String(id))))
    } else {
      onSelectionChange(Array.from(new Set([...selectedIds.map(String), ...selectableKeys])))
    }
  }

  const toggleRow = (key) => {
    if (!onSelectionChange) return
    if (selected.has(key)) onSelectionChange(selectedIds.filter((id) => String(id) !== key))
    else onSelectionChange([...selectedIds, key])
  }

  const changeSort = (col) => {
    const next =
      !sort || sort.key !== col.key
        ? { key: col.key, dir: col.align === 'right' ? 'desc' : 'asc' }
        : sort.dir === 'asc'
          ? { key: col.key, dir: 'desc' }
          : { key: col.key, dir: 'asc' }
    if (sortProp === undefined) setInnerSort(next)
    onSortChange?.(next)
  }

  const handleRowClick = (e, row) => {
    if (!onRowClick) return
    if (e.target.closest(INTERACTIVE)) return
    onRowClick(row)
  }
  const handleRowKey = (e, row) => {
    if (!onRowClick || e.target !== e.currentTarget) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onRowClick(row)
    }
  }

  const showSkeleton = loading && rows.length === 0
  const showError = !loading && error
  const showEmpty = !loading && !error && rows.length === 0

  const emptyNode =
    empty && typeof empty === 'object' && !('$$typeof' in empty) && !Array.isArray(empty) ? (
      <EmptyState compact {...empty} />
    ) : (
      empty || <EmptyState compact title="No results" message="Nothing matches the current filters." />
    )

  const statusNode = showError ? (
    <ErrorState compact error={error} onRetry={onRetry} />
  ) : showEmpty ? (
    emptyNode
  ) : null

  const selectCell = (row, key, label) => {
    const { ok, reason } = selectability(row)
    const box = (
      <Checkbox
        checked={selected.has(key)}
        disabled={!ok}
        onChange={() => toggleRow(key)}
        aria-label={ok ? `Select ${label}` : `${label} cannot be selected: ${reason || 'not available'}`}
      />
    )
    if (ok || !reason) return box
    return (
      <span className="tooltip-host" tabIndex={0} data-tooltip={reason} aria-label={`Not selectable: ${reason}`} data-no-row-click>
        {box}
      </span>
    )
  }

  const visibleColumns = mobile ? columns.filter((c) => !c.mobileHidden) : columns

  /* ---------------- Mobile: cards ---------------- */
  if (mobile) {
    const titleCol = visibleColumns.find((c) => c.mobileTitle) || visibleColumns[0]
    const restCols = visibleColumns.filter((c) => c !== titleCol)
    return (
      <div className={`dtable-cards ${className}`} aria-busy={loading || undefined}>
        {caption && <h3 className="sr-only">{caption}</h3>}
        {selectable && selectableKeys.length > 0 && !showSkeleton && (
          <div className="dtable-cards-selectall">
            <Checkbox
              checked={allSelected}
              indeterminate={someSelected}
              onChange={toggleAll}
              label={allSelected ? 'Deselect all' : `Select all (${selectableKeys.length})`}
            />
          </div>
        )}
        {showSkeleton && (
          <ul className="dtable-card-list" aria-label="Loading">
            {Array.from({ length: Math.min(skeletonRows, 4) }, (_, i) => (
              <li className="dtable-card" key={i}>
                <Skeleton width="55%" height={16} />
                <Skeleton width="80%" />
                <Skeleton width="40%" />
              </li>
            ))}
          </ul>
        )}
        {statusNode && <div className="dtable-status card">{statusNode}</div>}
        {!showSkeleton && !statusNode && (
          <ul className={`dtable-card-list${loading ? ' is-reloading' : ''}`}>
            {sortedRows.map((row, i) => {
              const key = String(getKey(row, rowKey, i))
              const isSel = selected.has(key)
              const label = rowLabel ? rowLabel(row) : `row ${i + 1}`
              return (
                <li
                  key={key}
                  className={`dtable-card${isSel ? ' is-selected' : ''}${onRowClick ? ' is-clickable' : ''} ${rowClassName?.(row) || ''}`}
                  onClick={(e) => handleRowClick(e, row)}
                  onKeyDown={(e) => handleRowKey(e, row)}
                  tabIndex={onRowClick ? 0 : undefined}
                  aria-label={onRowClick ? `Open ${label}` : undefined}
                >
                  <div className="dtable-card-head">
                    {selectable && selectCell(row, key, label)}
                    <div className="dtable-card-title">{renderCell(row, titleCol, i)}</div>
                  </div>
                  <dl className="dtable-card-fields">
                    {restCols.map((col) => (
                      <div key={col.key} className={`dtable-card-field align-${col.align || 'left'}`}>
                        <dt>{col.mobileLabel ?? col.header}</dt>
                        <dd>{renderCell(row, col, i)}</dd>
                      </div>
                    ))}
                  </dl>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    )
  }

  /* ---------------- Desktop: table ---------------- */
  const colCount = visibleColumns.length + (selectable ? 1 : 0)
  return (
    <div
      className={`dtable-wrap${dense ? ' is-dense' : ''} ${className}`}
      style={{ maxHeight: maxHeight === 'none' ? undefined : maxHeight }}
      aria-busy={loading || undefined}
    >
      <table className={`dtable${loading && rows.length > 0 ? ' is-reloading' : ''}`} id={tableId}>
        {caption && <caption className="sr-only">{caption}</caption>}
        <colgroup>
          {selectable && <col style={{ width: 44 }} />}
          {visibleColumns.map((c) => (
            <col key={c.key} style={c.width ? { width: c.width } : undefined} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {selectable && (
              <th scope="col" className="dtable-select">
                <Checkbox
                  checked={allSelected}
                  indeterminate={someSelected}
                  onChange={toggleAll}
                  disabled={selectableKeys.length === 0 || showSkeleton}
                  aria-label={allSelected ? 'Deselect all rows' : 'Select all rows'}
                />
              </th>
            )}
            {visibleColumns.map((col) => {
              const active = sort && sort.key === col.key
              const ariaSort = active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : col.sortable ? 'none' : undefined
              return (
                <th key={col.key} scope="col" className={`align-${col.align || 'left'}${active ? ' is-sorted' : ''}`} aria-sort={ariaSort}>
                  {col.sortable ? (
                    <button type="button" className="dtable-sort" onClick={() => changeSort(col)}>
                      <span>{col.header}</span>
                      <span className="dtable-sort-icon" aria-hidden="true">
                        {active ? sort.dir === 'asc' ? <ChevronUpIcon size={14} strokeWidth={2.5} /> : <ChevronDownIcon size={14} strokeWidth={2.5} /> : <SortIcon size={14} />}
                      </span>
                    </button>
                  ) : (
                    col.header
                  )}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {showSkeleton &&
            Array.from({ length: skeletonRows }, (_, r) => (
              <tr key={`sk${r}`} className="dtable-skeleton-row" aria-hidden="true">
                {selectable && (
                  <td className="dtable-select">
                    <Skeleton width={18} height={18} radius={4} />
                  </td>
                )}
                {visibleColumns.map((col, c) => (
                  <td key={col.key} className={`align-${col.align || 'left'}`}>
                    <Skeleton width={col.align === 'right' ? '70%' : `${50 + ((r * 17 + c * 11) % 45)}%`} />
                  </td>
                ))}
              </tr>
            ))}
          {statusNode && (
            <tr className="dtable-status-row">
              <td colSpan={colCount}>{statusNode}</td>
            </tr>
          )}
          {!showSkeleton &&
            !statusNode &&
            sortedRows.map((row, i) => {
              const key = String(getKey(row, rowKey, i))
              const isSel = selected.has(key)
              const label = rowLabel ? rowLabel(row) : `row ${i + 1}`
              return (
                <tr
                  key={key}
                  className={`${isSel ? 'is-selected' : ''}${onRowClick ? ' is-clickable' : ''} ${rowClassName?.(row) || ''}`}
                  onClick={(e) => handleRowClick(e, row)}
                  onKeyDown={(e) => handleRowKey(e, row)}
                  tabIndex={onRowClick ? 0 : undefined}
                  aria-label={onRowClick ? `Open ${label}` : undefined}
                >
                  {selectable && <td className="dtable-select">{selectCell(row, key, label)}</td>}
                  {visibleColumns.map((col) => (
                    <td key={col.key} className={`align-${col.align || 'left'}${col.align === 'right' ? ' num' : ''}`}>
                      {renderCell(row, col, i)}
                    </td>
                  ))}
                </tr>
              )
            })}
        </tbody>
      </table>
    </div>
  )
}
