/** Delegation status computed from the dates (inclusive) and revocation. */
export function computeDelegationStatus(d, today) {
  if (d.revokedAt) return 'REVOKED'
  if (today < d.startsOn) return 'SCHEDULED'
  if (today > d.endsOn) return 'ENDED'
  return 'ACTIVE'
}

export const DELEGATION_STATUS_META = {
  ACTIVE: { label: 'Active', tone: 'success' },
  SCHEDULED: { label: 'Scheduled', tone: 'brand' },
  ENDED: { label: 'Ended', tone: 'neutral' },
  REVOKED: { label: 'Revoked', tone: 'danger' },
}
