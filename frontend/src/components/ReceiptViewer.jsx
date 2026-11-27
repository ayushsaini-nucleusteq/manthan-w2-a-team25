import { useCallback, useEffect, useRef, useState } from 'react'
import EmptyState from './EmptyState.jsx'
import ErrorState from './ErrorState.jsx'
import Spinner from './Spinner.jsx'
import {
  DownloadIcon,
  ExternalLinkIcon,
  FileTextIcon,
  MaximizeIcon,
  ReceiptIcon,
  RotateIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from './icons.jsx'

const MIN_ZOOM = 0.5
const MAX_ZOOM = 5
const STEP = 0.25

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

function ToolButton({ label, onClick, disabled, children }) {
  return (
    <button type="button" className="rv-tool" onClick={onClick} disabled={disabled} aria-label={label} title={label}>
      {children}
    </button>
  )
}

function ImageStage({ src, alt, fileName, toolbarExtra, height }) {
  const viewportRef = useRef(null)
  const drag = useRef(null)
  const [status, setStatus] = useState('loading')
  const [nonce, setNonce] = useState(0)
  const [natural, setNatural] = useState({ w: 0, h: 0 })
  const [box, setBox] = useState({ w: 0, h: 0 })
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState(0)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)

  const zoomBy = useCallback((delta) => {
    setZoom((z) => {
      const next = clamp(Math.round((z + delta) * 100) / 100, MIN_ZOOM, MAX_ZOOM)
      if (next <= 1) setOffset({ x: 0, y: 0 })
      return next
    })
  }, [])

  const reset = () => {
    setZoom(1)
    setRotation(0)
    setOffset({ x: 0, y: 0 })
  }

  const rotate = () => {
    setRotation((r) => (r + 90) % 360)
    setOffset({ x: 0, y: 0 })
  }

  // Track the viewport size to compute the "fit" scale.
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return undefined
    const ro = new ResizeObserver(([entry]) => {
      const { width, height: h } = entry.contentRect
      setBox({ w: width, h })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Ctrl/Cmd + wheel zooms (needs a non-passive listener to stop page zoom).
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return undefined
    const onWheel = (e) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      zoomBy(e.deltaY < 0 ? STEP : -STEP)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomBy])

  const sideways = rotation % 180 !== 0
  const w = sideways ? natural.h : natural.w
  const h = sideways ? natural.w : natural.h
  const fit = w && h && box.w && box.h ? Math.min((box.w - 24) / w, (box.h - 24) / h, 2) : 1
  const scale = fit * zoom
  const canPan = zoom > 1

  const onPointerDown = (e) => {
    if (!canPan || e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y }
    setDragging(true)
  }
  const onPointerMove = (e) => {
    if (!drag.current) return
    const maxX = (w * scale) / 2 + box.w / 4
    const maxY = (h * scale) / 2 + box.h / 4
    setOffset({
      x: clamp(drag.current.ox + e.clientX - drag.current.x, -maxX, maxX),
      y: clamp(drag.current.oy + e.clientY - drag.current.y, -maxY, maxY),
    })
  }
  const endDrag = () => {
    drag.current = null
    setDragging(false)
  }

  const onKeyDown = (e) => {
    const k = e.key
    if (k === '+' || k === '=') zoomBy(STEP)
    else if (k === '-' || k === '_') zoomBy(-STEP)
    else if (k === '0') reset()
    else if (k === 'r' || k === 'R') rotate()
    else if (canPan && k.startsWith('Arrow')) {
      const d = 40
      setOffset((o) => ({
        x: o.x + (k === 'ArrowLeft' ? d : k === 'ArrowRight' ? -d : 0),
        y: o.y + (k === 'ArrowUp' ? d : k === 'ArrowDown' ? -d : 0),
      }))
    } else return
    e.preventDefault()
  }

  return (
    <>
      <div className="rv-toolbar" role="toolbar" aria-label="Receipt controls">
        <ToolButton label="Zoom out" onClick={() => zoomBy(-STEP)} disabled={status !== 'loaded' || zoom <= MIN_ZOOM}>
          <ZoomOutIcon size={18} />
        </ToolButton>
        <span className="rv-zoom num" aria-live="polite">
          {Math.round(zoom * 100)}%
        </span>
        <ToolButton label="Zoom in" onClick={() => zoomBy(STEP)} disabled={status !== 'loaded' || zoom >= MAX_ZOOM}>
          <ZoomInIcon size={18} />
        </ToolButton>
        <ToolButton label="Rotate 90 degrees" onClick={rotate} disabled={status !== 'loaded'}>
          <RotateIcon size={18} />
        </ToolButton>
        <ToolButton label="Reset to fit" onClick={reset} disabled={status !== 'loaded' || (zoom === 1 && rotation === 0 && !offset.x && !offset.y)}>
          <MaximizeIcon size={18} />
        </ToolButton>
        <span className="rv-toolbar-spacer" />
        {toolbarExtra}
        <a className="rv-tool" href={src} download={fileName || true} aria-label="Download receipt" title="Download receipt">
          <DownloadIcon size={18} />
        </a>
      </div>
      <div
        ref={viewportRef}
        className={`rv-viewport${canPan ? ' can-pan' : ''}${dragging ? ' is-dragging' : ''}`}
        style={height ? { height } : undefined}
        tabIndex={0}
        role="group"
        aria-label={`${alt}. Use plus and minus to zoom, R to rotate, 0 to reset${canPan ? ', arrow keys to pan' : ''}. Hold Ctrl and scroll to zoom.`}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={() => (zoom > 1 ? reset() : zoomBy(1))}
      >
        {status === 'loading' && (
          <div className="rv-center">
            <Spinner label="Loading receipt…" showLabel />
          </div>
        )}
        {status === 'error' && (
          <div className="rv-center">
            <ErrorState
              compact
              title="Couldn't display the receipt"
              message="The image failed to load. Check your connection and try again."
              onRetry={() => {
                setStatus('loading')
                setNonce((n) => n + 1)
              }}
            />
          </div>
        )}
        <img
          key={nonce}
          src={src}
          alt={alt}
          draggable={false}
          className="rv-image"
          onLoad={(e) => {
            setNatural({ w: e.currentTarget.naturalWidth || 600, h: e.currentTarget.naturalHeight || 800 })
            setStatus('loaded')
          }}
          onError={() => setStatus('error')}
          style={{
            visibility: status === 'loaded' ? 'visible' : 'hidden',
            width: natural.w || undefined,
            height: natural.h || undefined,
            transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px) rotate(${rotation}deg) scale(${scale})`,
          }}
        />
      </div>
    </>
  )
}

function PdfStage({ src, fileName, toolbarExtra, height }) {
  return (
    <>
      <div className="rv-toolbar" role="toolbar" aria-label="Receipt controls">
        <span className="rv-file">
          <FileTextIcon size={16} /> PDF document
        </span>
        <span className="rv-toolbar-spacer" />
        {toolbarExtra}
        <a className="rv-tool" href={src} target="_blank" rel="noreferrer" aria-label="Open PDF in a new tab" title="Open in new tab">
          <ExternalLinkIcon size={18} />
        </a>
        <a className="rv-tool" href={src} download={fileName || true} aria-label="Download receipt" title="Download receipt">
          <DownloadIcon size={18} />
        </a>
      </div>
      <div className="rv-viewport rv-viewport-pdf" style={height ? { height } : undefined}>
        <object data={src} type="application/pdf" className="rv-pdf" aria-label={fileName || 'Receipt PDF'}>
          <div className="rv-center">
            <EmptyState
              compact
              icon={<FileTextIcon size={28} />}
              title="PDF preview isn't available here"
              message="Your browser can't show this PDF inline. Open or download it instead."
              action={
                <a className="btn btn-secondary btn-sm" href={src} download={fileName || true}>
                  <DownloadIcon size={16} />
                  <span className="btn-label">Download PDF</span>
                </a>
              }
            />
          </div>
        </object>
      </div>
    </>
  )
}

/**
 * Receipt preview with zoom in/out/reset (buttons, Ctrl+wheel, keyboard), 90° rotation,
 * drag-to-pan when zoomed, and loading/error/empty states. PDFs render via <object>
 * with a download fallback; mock "PDF" receipts that are image data URLs render as images.
 *
 * @param {object} props
 * @param {string|null} props.src receipt URL (object URL or data URL)
 * @param {string} [props.contentType] e.g. 'image/png' | 'application/pdf'
 * @param {string} [props.fileName]
 * @param {string} [props.alt]
 * @param {boolean} [props.loading] the receipt metadata is still being fetched
 * @param {any} [props.error] error fetching the receipt
 * @param {() => any} [props.onRetry]
 * @param {string|number} [props.height] viewport height (default from CSS: 520px, 60vh on mobile)
 * @param {React.ReactNode} [props.toolbarExtra] extra toolbar buttons
 * @param {React.ReactNode} [props.footer] e.g. file name / SHA-256 row
 */
export default function ReceiptViewer({
  src,
  contentType,
  fileName,
  alt = 'Receipt',
  loading = false,
  error,
  onRetry,
  height,
  toolbarExtra,
  footer,
  className = '',
}) {
  let body
  if (loading) {
    body = (
      <div className="rv-viewport" style={height ? { height } : undefined}>
        <div className="rv-center">
          <Spinner label="Loading receipt…" showLabel />
        </div>
      </div>
    )
  } else if (error) {
    body = (
      <div className="rv-viewport" style={height ? { height } : undefined}>
        <div className="rv-center">
          <ErrorState compact error={error} title="Couldn't load the receipt" onRetry={onRetry} mapNotFound={false} />
        </div>
      </div>
    )
  } else if (!src) {
    body = (
      <div className="rv-viewport" style={height ? { height } : undefined}>
        <div className="rv-center">
          <EmptyState compact icon={<ReceiptIcon size={28} />} title="No receipt attached" message="This line has no receipt." />
        </div>
      </div>
    )
  } else {
    const isPdf = contentType === 'application/pdf' && !String(src).startsWith('data:image')
    body = isPdf ? (
      <PdfStage key={src} src={src} fileName={fileName} toolbarExtra={toolbarExtra} height={height} />
    ) : (
      <ImageStage key={src} src={src} alt={alt} fileName={fileName} toolbarExtra={toolbarExtra} height={height} />
    )
  }

  return (
    <figure className={`receipt-viewer ${className}`}>
      {body}
      {footer && <figcaption className="rv-footer">{footer}</figcaption>}
    </figure>
  )
}
