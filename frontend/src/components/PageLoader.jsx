import Spinner from './Spinner.jsx'

/** Centred spinner with a visible label, used as the Suspense fallback and for full-page loads. */
export default function PageLoader({ label = 'Loading…', fullScreen = false }) {
  return (
    <div className={`page-loader${fullScreen ? ' page-loader-full' : ''}`}>
      <Spinner size="lg" label={label} showLabel />
    </div>
  )
}
