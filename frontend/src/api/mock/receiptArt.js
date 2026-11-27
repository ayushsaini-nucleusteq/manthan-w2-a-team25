/**
 * Receipt images for the mock.
 *
 * Seed receipts are SVG data URLs drawn like thermal-printed receipts.
 * Uploaded files get an object URL (URL.createObjectURL) kept in a
 * module-level Map, because object URLs don't survive a reload; after a
 * reload the receipt falls back to a generated placeholder with the file name.
 */
import { fromPaise, toPaise } from '../../utils/money.js';
import { fnv1a, mulberry32 } from './util.js';

const objectUrls = new Map();
const svgCache = new Map();

const MONO = "ui-monospace,'Cascadia Code','Courier New',Consolas,monospace";
const amountFormatter = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function esc(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function money(paise) {
  return amountFormatter.format(paise / 100);
}

function toDataUrl(svg) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/* ----------------------------------------------------------- object URLs */

export function rememberObjectUrl(receiptId, url) {
  const previous = objectUrls.get(receiptId);
  if (previous && previous !== url) revoke(previous);
  objectUrls.set(receiptId, url);
}

function revoke(url) {
  try {
    globalThis.URL?.revokeObjectURL?.(url);
  } catch {
    // Nothing to clean up.
  }
}

export function forgetObjectUrl(receiptId) {
  const url = objectUrls.get(receiptId);
  if (url) revoke(url);
  objectUrls.delete(receiptId);
}

export function clearObjectUrls() {
  for (const url of objectUrls.values()) revoke(url);
  objectUrls.clear();
  svgCache.clear();
}

/** Creates an object URL for a File/Blob, or null when unavailable. */
export function createObjectUrl(file) {
  try {
    return globalThis.URL?.createObjectURL ? globalThis.URL.createObjectURL(file) : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------ item split */

const ITEM_NAMES = {
  MEALS: ['Veg thali', 'Masala dosa', 'Filter coffee', 'Paneer tikka', 'Butter naan', 'Dal makhani', 'Fresh lime soda', 'Veg biryani', 'Idli vada', 'Masala chai'],
  LOCAL_CAB: ['Base fare', 'Distance charge', 'Waiting charge', 'Toll & parking'],
  AIRFARE: ['Base fare', 'Taxes & fees', 'Convenience fee'],
  TRAIN: ['Ticket fare', 'Reservation charge', 'Catering'],
  OTHER: ['Item charges', 'Service charge'],
};

function splitItems(art, rand) {
  const total = toPaise(art.amount);
  if (art.category === 'HOTEL') {
    const nights = Math.max(1, Number(art.nights) || 1);
    const room = Math.round(total / 1.12);
    return [
      { name: `Room tariff x ${nights} night${nights === 1 ? '' : 's'}`, paise: room },
      { name: 'GST 12%', paise: total - room },
    ];
  }
  if (art.category === 'OTHER') {
    const base = Math.round(total / 1.18);
    return [
      { name: 'Item charges', paise: base },
      { name: 'GST 18%', paise: total - base },
    ];
  }
  const pool = ITEM_NAMES[art.category] ?? ITEM_NAMES.OTHER;
  const count = Math.min(pool.length, art.category === 'MEALS' ? 2 + Math.floor(rand() * 3) : 2 + Math.floor(rand() * 2));
  const start = Math.floor(rand() * pool.length);
  const weights = Array.from({ length: count }, (_, i) => (i === 0 ? 3 : 1) + rand() * 2);
  const sum = weights.reduce((a, b) => a + b, 0);
  const items = [];
  let used = 0;
  for (let i = 0; i < count; i += 1) {
    const paise = i === count - 1 ? total - used : Math.round((total * weights[i]) / sum / 100) * 100;
    used += paise;
    items.push({ name: pool[(start + i) % pool.length], paise });
  }
  return items.filter((item) => item.paise > 0);
}

/* ------------------------------------------------------------ seed receipt */

function zigzag(width, bottom, left, tooth) {
  const points = [];
  for (let x = width - left, up = true; x >= left; x -= tooth, up = !up) points.push(`${x},${up ? bottom : bottom + 7}`);
  return points.join(' ');
}

/**
 * Draws a thermal-printed receipt: vendor, date, items, total, monospace,
 * slight tilt. Deterministic for a receipt's art.
 */
export function receiptSvg(art, seedKey) {
  const rand = mulberry32(parseInt(fnv1a(`${seedKey}|${art.vendor}|${art.amount}`), 16));
  const items = splitItems(art, rand);
  const total = items.reduce((s, i) => s + i.paise, 0);
  const width = 340;
  const left = 22;
  const lineH = 22;
  const height = 300 + items.length * lineH;
  const tilt = ((rand() * 3 - 1.5) || 0.8).toFixed(2);
  const billNo = String(1000 + Math.floor(rand() * 89000)).padStart(6, '0');
  const hour = 9 + Math.floor(rand() * 12);
  const minute = Math.floor(rand() * 60);
  const [y, m, d] = String(art.date ?? '').split('-');
  const dateText = y ? `${d}-${m}-${y}` : '';
  const gstin = `${String(10 + Math.floor(rand() * 27)).padStart(2, '0')}AAB${fnv1a(art.vendor ?? '').slice(0, 4).toUpperCase()}${Math.floor(rand() * 9)}Z${Math.floor(rand() * 9)}`;
  const vendor = String(art.vendor ?? 'Vendor').toUpperCase().slice(0, 26);
  const city = art.city || ['Bengaluru', 'Mumbai', 'Pune', 'Chennai', 'Hyderabad', 'Delhi'][Math.floor(rand() * 6)];
  const right = width - left - 12;
  const textX = left + 14;
  let yPos = 52;
  const rows = [];
  const text = (x, yy, content, extra = '') => rows.push(`<text x="${x}" y="${yy}" ${extra}>${esc(content)}</text>`);
  const rule = (yy) => rows.push(`<line x1="${textX}" y1="${yy}" x2="${right}" y2="${yy}" stroke="#555" stroke-width="1" stroke-dasharray="4 3"/>`);

  text(width / 2, yPos, vendor, 'text-anchor="middle" font-size="17" font-weight="700"');
  yPos += 20;
  text(width / 2, yPos, `Main Road, ${city}`, 'text-anchor="middle" font-size="12"');
  yPos += 16;
  text(width / 2, yPos, `GSTIN ${gstin}`, 'text-anchor="middle" font-size="11" fill="#444"');
  yPos += 14;
  rule(yPos);
  yPos += 20;
  text(textX, yPos, `Bill No: ${billNo}`, 'font-size="12"');
  text(right, yPos, `Date: ${dateText}`, 'font-size="12" text-anchor="end"');
  yPos += 17;
  text(textX, yPos, `Time: ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`, 'font-size="12"');
  yPos += 12;
  rule(yPos);
  yPos += 20;
  for (const item of items) {
    text(textX, yPos, item.name.slice(0, 24), 'font-size="13"');
    text(right, yPos, money(item.paise), 'font-size="13" text-anchor="end"');
    yPos += lineH;
  }
  yPos -= 8;
  rule(yPos);
  yPos += 24;
  text(textX, yPos, 'TOTAL', 'font-size="16" font-weight="700"');
  text(right, yPos, `INR ${money(total)}`, 'font-size="16" font-weight="700" text-anchor="end"');
  yPos += 22;
  text(textX, yPos, `Paid by ${['UPI', 'CARD', 'CASH'][Math.floor(rand() * 3)]}`, 'font-size="12"');
  yPos += 26;
  const bars = [];
  for (let x = textX + 40, i = 0; x < right - 40; i += 1) {
    const w = 1 + Math.floor(rand() * 3);
    if (i % 2 === 0) bars.push(`<rect x="${x}" y="${yPos}" width="${w}" height="26" fill="#222"/>`);
    x += w + 1;
  }
  rows.push(...bars);
  yPos += 46;
  text(width / 2, yPos, 'Thank you! Visit again', 'text-anchor="middle" font-size="12"');
  const paperBottom = height - 26;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(`Receipt from ${art.vendor} for INR ${fromPaise(total)}`)}">`,
    `<rect width="${width}" height="${height}" fill="#e7eaee"/>`,
    `<g transform="rotate(${tilt} ${width / 2} ${height / 2})">`,
    `<polygon points="${left},14 ${width - left},14 ${zigzag(width, paperBottom, left, 10)} ${left},${paperBottom}" fill="#fffdf5" stroke="#d6d0bd" stroke-width="1"/>`,
    `<g font-family="${MONO}" fill="#1d1d1d">`,
    ...rows,
    '</g></g></svg>',
  ].join('');
}

/** Placeholder shown for an uploaded file whose object URL was lost (after a reload). */
export function placeholderSvg(fileName, contentType) {
  const isPdf = contentType === 'application/pdf';
  const name = String(fileName ?? 'receipt').slice(0, 40);
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="340" height="420" viewBox="0 0 340 420" role="img" aria-label="Receipt preview unavailable">',
    '<rect width="340" height="420" fill="#f4f6f8"/>',
    '<rect x="20" y="20" width="300" height="380" rx="14" fill="#ffffff" stroke="#d7dbe0"/>',
    '<path d="M140 110h44l26 26v74a8 8 0 0 1-8 8h-62a8 8 0 0 1-8-8v-92a8 8 0 0 1 8-8z" fill="#e6f1fc" stroke="#006fcf" stroke-width="2"/>',
    '<path d="M184 110v26h26" fill="none" stroke="#006fcf" stroke-width="2"/>',
    `<text x="170" y="190" text-anchor="middle" font-family="Segoe UI,system-ui,sans-serif" font-size="14" font-weight="700" fill="#006fcf">${isPdf ? 'PDF' : 'IMG'}</text>`,
    `<text x="170" y="262" text-anchor="middle" font-family="Segoe UI,system-ui,sans-serif" font-size="14" font-weight="600" fill="#1f2933">${esc(name)}</text>`,
    '<text x="170" y="290" text-anchor="middle" font-family="Segoe UI,system-ui,sans-serif" font-size="12" fill="#53606c">Preview not available after a reload</text>',
    '<text x="170" y="308" text-anchor="middle" font-family="Segoe UI,system-ui,sans-serif" font-size="12" fill="#53606c">(demo storage keeps file details only)</text>',
    '</svg>',
  ].join('');
}

/** URL for a stored receipt: live object URL, seed artwork, or placeholder. */
export function receiptUrl(receipt) {
  if (!receipt) return null;
  const live = objectUrls.get(receipt.id);
  if (live) return live;
  const key = receipt.art ? `art:${receipt.id}` : `ph:${receipt.id}`;
  if (!svgCache.has(key)) {
    const svg = receipt.art ? receiptSvg(receipt.art, receipt.art.seedKey ?? receipt.sha256) : placeholderSvg(receipt.fileName, receipt.contentType);
    svgCache.set(key, toDataUrl(svg));
  }
  return svgCache.get(key);
}
