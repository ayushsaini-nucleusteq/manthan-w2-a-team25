import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth.js'
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js'
import Button from '../../components/Button.jsx'
import { ArrowLeftIcon, HomeIcon, SearchIcon } from '../../components/icons.jsx'
import './shared-screens/shared.css'

function LostIllustration() {
  return (
    <svg className="nf-art" viewBox="0 0 320 200" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="nf-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#e6f1fc" />
          <stop offset="1" stopColor="#b9d8f7" />
        </linearGradient>
      </defs>
      <ellipse cx="160" cy="182" rx="120" ry="10" fill="#d7dbe0" />
      <rect x="40" y="20" width="240" height="150" rx="18" fill="url(#nf-bg)" />
      <text x="160" y="118" textAnchor="middle" fontSize="72" fontWeight="800" fill="#006fcf" fontFamily="system-ui, sans-serif" opacity="0.9">
        404
      </text>
      <g transform="translate(206 92) rotate(8)">
        <rect width="64" height="80" rx="8" fill="#fff" stroke="#a7adb4" strokeWidth="2" />
        <rect x="10" y="14" width="34" height="6" rx="3" fill="#0049b8" />
        <rect x="10" y="28" width="44" height="4" rx="2" fill="#d7dbe0" />
        <rect x="10" y="38" width="38" height="4" rx="2" fill="#d7dbe0" />
        <rect x="10" y="48" width="42" height="4" rx="2" fill="#d7dbe0" />
        <path d="M0 72 l8 -6 8 6 8 -6 8 6 8 -6 8 6 8 -6 8 6" fill="none" stroke="#a7adb4" strokeWidth="2" />
      </g>
      <g transform="translate(58 96)">
        <circle cx="26" cy="26" r="22" fill="#fff" stroke="#00175a" strokeWidth="6" />
        <line x1="42" y1="42" x2="62" y2="62" stroke="#00175a" strokeWidth="8" strokeLinecap="round" />
        <text x="26" y="34" textAnchor="middle" fontSize="22" fontWeight="800" fill="#006fcf" fontFamily="system-ui, sans-serif">?</text>
      </g>
    </svg>
  )
}

/**
 * 404 for unknown routes, and for screens the user has no role for
 * (never say "forbidden", US4-AC3).
 */
export default function NotFoundPage() {
  useDocumentTitle('Not found')
  const { isAuthenticated, homePath } = useAuth()
  const navigate = useNavigate()
  const home = isAuthenticated ? homePath || '/' : '/login'

  return (
    <div className="page">
      <div className="page-body">
        <section className="card nf-wrap" aria-labelledby="nf-title">
          <LostIllustration />
          <p className="state-eyebrow">Error 404</p>
          <h1 id="nf-title" className="nf-title" tabIndex={-1}>
            We can&rsquo;t find that page
          </h1>
          <p className="nf-message">
            This page doesn&rsquo;t exist, or you don&rsquo;t have access to it. Check the address, or head back to your home screen.
          </p>
          <p className="nf-hint">
            <SearchIcon size={18} aria-hidden="true" />
            <span>
              Looking for a claim? Open your home screen and use the search box to find it by claim number or title.
            </span>
          </p>
          <div className="nf-actions">
            <Button to={home} icon={<HomeIcon size={18} />}>
              Go to home
            </Button>
            <Button variant="secondary" icon={<ArrowLeftIcon size={18} />} onClick={() => navigate(-1)}>
              Go back
            </Button>
          </div>
        </section>
      </div>
    </div>
  )
}
