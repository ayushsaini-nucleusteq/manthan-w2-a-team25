import { useEffect, useRef, useState } from 'react'
import { toPaise } from '../../../utils/money.js'
import { addDaysISO, formatMoney, todayISO } from '../../../utils/format.js'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Money string → rupees as a number, for chart geometry only (never for arithmetic). */
export function moneyToNumber(value) {
  const paise = toPaise(value ?? '0')
  return Number.isFinite(paise) ? paise / 100 : 0
}

/** Compact Indian label without the space: ₹1.2L, ₹3.4Cr, ₹12K. */
export function compactInr(value) {
  return formatMoney(value, { compact: true, whole: true }).replace(/\s(?=(K|L|Cr)$)/, '')
}

/** "2026-06" → "Jun 26" (short) or "Jun 2026" (long). */
export function monthLabel(ym, long = false) {
  const [y, m] = String(ym).split('-')
  const name = MONTHS[Number(m) - 1] ?? ym
  return long ? `${name} ${y}` : `${name} ${String(y).slice(2)}`
}

/** A rounded axis maximum (1, 2, 2.5, 5 × 10^n) above the largest value. */
export function niceMax(value) {
  if (!(value > 0)) return 1
  const exp = 10 ** Math.floor(Math.log10(value))
  for (const step of [1, 2, 2.5, 5, 10]) {
    if (step * exp >= value) return step * exp
  }
  return 10 * exp
}

/** Measures an element's content width (ResizeObserver), for pixel-exact SVG charts. */
export function useElementWidth(initial = 600) {
  const ref = useRef(null)
  const [width, setWidth] = useState(initial)
  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const update = () => {
      const w = Math.floor(el.getBoundingClientRect().width)
      if (w > 0) setWidth(w)
    }
    update()
    if (typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width]
}

export const RANGE_PRESETS = [
  { value: '30d', label: 'Last 30 days', days: 30 },
  { value: '3m', label: 'Last 3 months', days: 91 },
  { value: '6m', label: 'Last 6 months', days: 182 },
  { value: 'custom', label: 'Custom range' },
]

/** {from, to} for a preset (IST dates). */
export function presetRange(preset) {
  const to = todayISO()
  const p = RANGE_PRESETS.find((r) => r.value === preset) ?? RANGE_PRESETS[2]
  return { from: addDaysISO(to, -(p.days ?? 182) + 1), to }
}

const ALERT_KEY = 'expenseflow.f1.alertDismissed'

/** True if the alert opened at `openedAt` was dismissed by this viewer (one alert per breach). */
export function isAlertDismissed(openedAt) {
  if (!openedAt) return false
  try {
    return window.localStorage.getItem(ALERT_KEY) === openedAt
  } catch {
    return false
  }
}

export function dismissAlert(openedAt) {
  try {
    window.localStorage.setItem(ALERT_KEY, openedAt)
  } catch {
    /* storage unavailable: dismiss for this view only */
  }
}
