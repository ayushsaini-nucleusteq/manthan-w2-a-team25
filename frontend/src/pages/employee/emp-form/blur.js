/**
 * Rough blur check for receipt photos: the variance of a 3x3 Laplacian over a
 * downscaled greyscale copy. Low variance means few sharp edges. It is a hint
 * only and never blocks saving.
 */
const MAX_SIDE = 320
export const BLUR_THRESHOLD = 60

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not read the image.'))
    img.src = url
  })
}

/**
 * @param {File|Blob} file
 * @returns {Promise<{blurry: boolean, score: number}|null>} null when not an image or not measurable
 */
export async function detectBlur(file) {
  if (!file || !String(file.type).startsWith('image/') || typeof document === 'undefined') return null
  const url = URL.createObjectURL(file)
  try {
    const img = await loadImage(url)
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth || 1, img.naturalHeight || 1))
    const w = Math.max(3, Math.round(img.naturalWidth * scale))
    const h = Math.max(3, Math.round(img.naturalHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.drawImage(img, 0, 0, w, h)
    const { data } = ctx.getImageData(0, 0, w, h)
    const grey = new Float32Array(w * h)
    for (let i = 0; i < w * h; i += 1) {
      grey[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]
    }
    let sum = 0
    let sumSq = 0
    let n = 0
    for (let y = 1; y < h - 1; y += 1) {
      for (let x = 1; x < w - 1; x += 1) {
        const i = y * w + x
        const lap = grey[i - w] + grey[i + w] + grey[i - 1] + grey[i + 1] - 4 * grey[i]
        sum += lap
        sumSq += lap * lap
        n += 1
      }
    }
    if (!n) return null
    const mean = sum / n
    const score = sumSq / n - mean * mean
    return { blurry: score < BLUR_THRESHOLD, score: Math.round(score) }
  } catch {
    return null
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** True on touch-first devices, where the camera should open first. */
export function isTouchDevice() {
  if (typeof window === 'undefined') return false
  return window.matchMedia?.('(pointer: coarse)').matches || (navigator.maxTouchPoints ?? 0) > 0
}

export function isWeekend(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false
  const [y, m, d] = iso.split('-').map(Number)
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return day === 0 || day === 6
}

/** Payload sent to addLine/updateLine/policyPreview from the editor's string values. */
export function linePayload(values, parseMoney) {
  const isHotel = values.category === 'HOTEL'
  return {
    category: values.category,
    amount: parseMoney(String(values.amount ?? '')) ?? values.amount,
    expenseDate: values.expenseDate,
    vendor: String(values.vendor ?? '').trim(),
    notes: String(values.notes ?? '').trim(),
    city: isHotel ? String(values.city ?? '').trim() : null,
    nights: isHotel ? Number(values.nights) : null,
  }
}
