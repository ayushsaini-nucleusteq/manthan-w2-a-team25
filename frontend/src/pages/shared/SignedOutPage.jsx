import { useEffect, useRef } from 'react'
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js'
import Logo from '../../components/Logo.jsx'
import Button from '../../components/Button.jsx'
import { ArrowRightIcon, CheckIcon } from '../../components/icons.jsx'
import './shared-screens/shared.css'

/** "You have been logged out" confirmation after a deliberate logout. */
export default function SignedOutPage() {
  useDocumentTitle('Logged out')
  const headingRef = useRef(null)

  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  return (
    <div className="auth-screen">
      <header className="auth-topbar">
        <Logo to="/login" />
      </header>
      <main id="main" tabIndex={-1} className="signedout-main">
        <section className="auth-card signedout-card" aria-labelledby="signedout-title">
          <span className="signedout-icon" aria-hidden="true">
            <CheckIcon size={30} strokeWidth={2.5} />
          </span>
          <h1 id="signedout-title" ref={headingRef} tabIndex={-1} className="auth-title">
            You have been logged out.
          </h1>
          <p className="auth-lead">
            Thanks for using ExpenseFlow. Any unsaved drafts on this device were cleared for your privacy.
          </p>
          <Button to="/login" size="lg" block iconRight={<ArrowRightIcon size={18} />}>
            Log in again
          </Button>
        </section>
      </main>
    </div>
  )
}
