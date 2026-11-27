import { addMoney, sumMoney } from '../../../utils/money.js'

/** Batch lifecycle steps for the status stepper on F3. */
export const BATCH_STEPS = [
  { id: 'CREATED', title: 'Created' },
  { id: 'EXPORTED', title: 'Exported' },
  { id: 'PAID', title: 'Paid' },
]

export const BATCH_STATUS_INDEX = { CREATED: 0, EXPORTED: 1, PAID: 2 }

/**
 * Groups claims by department with a count and a money total (string maths only).
 * @param {Array<object>} rows
 * @param {string} amountKey
 * @returns {Array<{departmentName: string, count: number, total: string}>}
 */
export function groupByDepartment(rows, amountKey = 'totalAmount') {
  const map = new Map()
  for (const row of rows) {
    const name = row.departmentName || 'Unassigned'
    const entry = map.get(name) || { departmentName: name, count: 0, total: '0.00' }
    entry.count += 1
    entry.total = addMoney(entry.total, row[amountKey] ?? '0.00')
    map.set(name, entry)
  }
  return [...map.values()].sort((a, b) => a.departmentName.localeCompare(b.departmentName))
}

export function totalOf(rows, key = 'totalAmount') {
  return rows.length ? sumMoney(rows, key) : '0.00'
}

/** Triggers a browser download of a text file through a Blob URL. */
export function downloadTextFile(fileName, text, type = 'text/csv;charset=utf-8') {
  const blob = new Blob([text], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Case-insensitive match of a claim row against free text. */
export function matchesClaim(row, q) {
  const needle = q.trim().toLowerCase()
  if (!needle) return true
  return [row.claimNumber, row.employeeName, row.title, row.departmentName]
    .filter(Boolean)
    .some((v) => String(v).toLowerCase().includes(needle))
}
