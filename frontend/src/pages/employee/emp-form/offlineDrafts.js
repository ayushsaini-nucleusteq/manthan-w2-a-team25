/**
 * Offline drafts for the claim form (US3-AC3).
 *
 * When the browser is offline (or a call fails with a network error) the form
 * applies the change to a local copy of the claim and queues the API call in
 * localStorage. Every record created offline carries a client-generated UUID,
 * so replaying the queue is idempotent. Keys start with STORAGE_KEYS.draftsPrefix
 * and are therefore wiped on logout.
 */
import { STORAGE_KEYS } from '../../../utils/constants.js'
import { isApiError } from '../../../api'
import { parseMoneyInput, sumMoney } from '../../../utils/money.js'

const QUEUE_KEY = `${STORAGE_KEYS.draftsPrefix}.queue`
const SNAPSHOT_PREFIX = `${STORAGE_KEYS.draftsPrefix}.claim.`
export const QUEUE_EVENT = 'expenseflow:draft-queue-changed'

export function newUuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  // RFC 4122 v4 fallback.
  const bytes = new Uint8Array(16)
  globalThis.crypto?.getRandomValues?.(bytes)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

function writeJson(key, value) {
  try {
    if (value === null || value === undefined) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage full or blocked: the in-memory state still works for this visit */
  }
}

function emitChange() {
  window.dispatchEvent(new CustomEvent(QUEUE_EVENT))
}

export function readQueue() {
  const q = readJson(QUEUE_KEY, [])
  return Array.isArray(q) ? q : []
}

export function pendingCount(claimId) {
  return readQueue().filter((op) => !claimId || op.claimId === claimId).length
}

export function enqueue(op) {
  writeJson(QUEUE_KEY, [...readQueue(), { ...op, queuedAt: new Date().toISOString() }])
  emitChange()
}

export function readSnapshot(claimId) {
  return claimId ? readJson(SNAPSHOT_PREFIX + claimId, null) : null
}

export function writeSnapshot(claim) {
  if (claim?.id) writeJson(SNAPSHOT_PREFIX + claim.id, claim)
}

export function clearSnapshot(claimId) {
  writeJson(SNAPSHOT_PREFIX + claimId, null)
}

/** True for failures that mean "no connection" rather than a server answer. */
export function isNetworkError(error) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true
  if (!error) return false
  if (isApiError(error)) return error.status === 0 || error.code === 'NETWORK_ERROR'
  return error instanceof TypeError || error?.name === 'NetworkError'
}

function localLine(input, existing, lineNo) {
  const isHotel = input.category === 'HOTEL'
  return {
    ...(existing ?? {}),
    id: input.id ?? existing?.id,
    lineNo: existing?.lineNo ?? lineNo,
    category: input.category,
    amount: parseMoneyInput(String(input.amount ?? '')) ?? '0.00',
    expenseDate: input.expenseDate,
    vendor: input.vendor,
    notes: input.notes ?? '',
    city: isHotel ? input.city : null,
    nights: isHotel ? Number(input.nights) : null,
    receipt: existing?.receipt ?? null,
    policyOutcome: null,
    findings: [],
    flags: [],
  }
}

/** Applies a queued operation to the local copy of the claim. */
export function applyLocal(claim, op) {
  const now = new Date().toISOString()
  let next
  switch (op.op) {
    case 'create':
      next = {
        id: op.claimId,
        claimNumber: null,
        status: 'DRAFT',
        currency: 'INR',
        editable: true,
        version: 0,
        submissionNo: 0,
        lines: [],
        comments: [],
        statusHistory: [],
        approvalSteps: [],
        flags: [],
        createdAt: now,
        ...op.payload,
      }
      break
    case 'update':
      next = { ...claim, ...op.payload }
      break
    case 'addLine': {
      const lineNo = (claim.lines ?? []).reduce((m, l) => Math.max(m, l.lineNo ?? 0), 0) + 1
      next = { ...claim, lines: [...(claim.lines ?? []), localLine(op.payload, null, lineNo)] }
      break
    }
    case 'updateLine':
      next = {
        ...claim,
        lines: claim.lines.map((l) => (l.id === op.lineId ? localLine({ ...op.payload, id: l.id }, l) : l)),
      }
      break
    case 'deleteLine':
      next = { ...claim, lines: claim.lines.filter((l) => l.id !== op.lineId) }
      break
    default:
      next = claim
  }
  next = { ...next, totalAmount: sumMoney(next.lines ?? [], 'amount'), updatedAt: now, offline: true }
  writeSnapshot(next)
  return next
}

let replaying = null

async function runOp(api, op) {
  switch (op.op) {
    case 'create':
      try {
        return await api.createClaim({ id: op.claimId, ...op.payload })
      } catch (err) {
        if (isApiError(err) && err.code === 'ID_CONFLICT') return null
        throw err
      }
    case 'update':
      return api.updateClaim(op.claimId, op.payload)
    case 'addLine':
      try {
        return await api.addLine(op.claimId, op.payload)
      } catch (err) {
        if (isApiError(err) && err.code === 'ID_CONFLICT') return null
        throw err
      }
    case 'updateLine':
      return api.updateLine(op.claimId, op.lineId, op.payload)
    case 'deleteLine':
      try {
        return await api.deleteLine(op.claimId, op.lineId)
      } catch (err) {
        if (isApiError(err) && err.status === 404) return null
        throw err
      }
    default:
      return null
  }
}

/**
 * Replays the queue in order. Stops at the first network failure (the rest
 * stays queued); drops operations the server rejects and reports them.
 * @returns {Promise<{synced: number, failed: Array<{op, error}>, claimIds: string[], stopped: boolean}>}
 */
export function replayQueue(api) {
  if (replaying) return replaying
  replaying = (async () => {
    const result = { synced: 0, failed: [], claimIds: [], stopped: false }
    let queue = readQueue()
    while (queue.length) {
      const [op, ...rest] = queue
      try {
        await runOp(api, op)
        result.synced += 1
        if (!result.claimIds.includes(op.claimId)) result.claimIds.push(op.claimId)
      } catch (error) {
        if (isNetworkError(error)) {
          result.stopped = true
          break
        }
        result.failed.push({ op, error })
      }
      queue = rest
      writeJson(QUEUE_KEY, queue)
    }
    if (!result.stopped) {
      for (const id of result.claimIds) clearSnapshot(id)
    }
    emitChange()
    return result
  })().finally(() => {
    replaying = null
  })
  return replaying
}
