import { compareMoney } from '../../../utils/money.js'

export const INBOX_STATES = ['PENDING', 'OVERDUE', 'SENT_BACK', 'DECIDED']

export const INBOX_STATE_LABEL = {
  PENDING: 'Pending',
  OVERDUE: 'Overdue',
  SENT_BACK: 'Sent back',
  DECIDED: 'Decided',
}

/** Amount bands for the inbox filter (boundaries are inclusive at the top). */
export const INBOX_AMOUNT_BANDS = [
  { value: 'ALL', label: 'All amounts' },
  { value: 'UNDER_25K', label: 'Up to ₹25,000' },
  { value: '25K_50K', label: '₹25,000 – ₹50,000' },
  { value: '50K_1L', label: '₹50,000 – ₹1,00,000' },
  { value: '1L_PLUS', label: 'Above ₹1,00,000' },
]

const BAND_RANGES = {
  UNDER_25K: [null, '25000.00'],
  '25K_50K': ['25000.00', '50000.00'],
  '50K_1L': ['50000.00', '100000.00'],
  '1L_PLUS': ['100000.00', null],
}

/** True when a money string falls in the band (lower bound exclusive, upper inclusive). */
export function inAmountBand(amount, band) {
  const range = BAND_RANGES[band]
  if (!range) return true
  const [low, high] = range
  if (low !== null && compareMoney(amount, low) <= 0) return false
  if (high !== null && compareMoney(amount, high) > 0) return false
  return true
}

export function normalizeState(value) {
  return INBOX_STATES.includes(value) ? value : 'PENDING'
}
