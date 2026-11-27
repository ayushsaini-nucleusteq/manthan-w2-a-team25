import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import RequireAuth from './auth/RequireAuth.jsx'
import RequireRole from './auth/RequireRole.jsx'
import { useAuth } from './auth/useAuth.js'
import AppShell from './components/AppShell.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import PageLoader from './components/PageLoader.jsx'
import NotFoundPage from './pages/shared/NotFoundPage.jsx'
import { ROLES } from './utils/constants.js'

/* Pages are code-split; each route loads its screen on demand. */
const LoginPage = lazy(() => import('./pages/shared/LoginPage.jsx'))
const SignedOutPage = lazy(() => import('./pages/shared/SignedOutPage.jsx'))
const NotificationsPage = lazy(() => import('./pages/shared/NotificationsPage.jsx'))
const ClaimAuditTrailPage = lazy(() => import('./pages/shared/ClaimAuditTrailPage.jsx'))

const MyClaimsPage = lazy(() => import('./pages/employee/MyClaimsPage.jsx'))
const ClaimFormPage = lazy(() => import('./pages/employee/ClaimFormPage.jsx'))
const ClaimDetailPage = lazy(() => import('./pages/employee/ClaimDetailPage.jsx'))

const ApprovalInboxPage = lazy(() => import('./pages/manager/ApprovalInboxPage.jsx'))
const ClaimReviewPage = lazy(() => import('./pages/manager/ClaimReviewPage.jsx'))
const DelegationPage = lazy(() => import('./pages/manager/DelegationPage.jsx'))

const ReviewQueuePage = lazy(() => import('./pages/auditor/ReviewQueuePage.jsx'))
const ReceiptViewerPage = lazy(() => import('./pages/auditor/ReceiptViewerPage.jsx'))
const SampleAuditPage = lazy(() => import('./pages/auditor/SampleAuditPage.jsx'))

const DashboardPage = lazy(() => import('./pages/finance/DashboardPage.jsx'))
const PayoutsPage = lazy(() => import('./pages/finance/PayoutsPage.jsx'))
const PayoutBatchPage = lazy(() => import('./pages/finance/PayoutBatchPage.jsx'))
const PolicyConfigPage = lazy(() => import('./pages/finance/PolicyConfigPage.jsx'))
const UsersPage = lazy(() => import('./pages/finance/UsersPage.jsx'))
const AuditLogPage = lazy(() => import('./pages/finance/AuditLogPage.jsx'))

const { EMPLOYEE, MANAGER, AUDITOR, FINANCE_HEAD } = ROLES

/** "/" → the active role's home screen. */
function HomeRedirect() {
  const { homePath } = useAuth()
  return <Navigate to={homePath} replace />
}

/** Public screens (no app shell): own error boundary + full-screen loader. */
function PublicScreen({ children }) {
  const { pathname } = useLocation()
  return (
    <ErrorBoundary resetKey={pathname}>
      <Suspense fallback={<PageLoader fullScreen label="Loading…" />}>{children}</Suspense>
    </ErrorBoundary>
  )
}

export default function App() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <PublicScreen>
            <LoginPage />
          </PublicScreen>
        }
      />
      <Route
        path="/signed-out"
        element={
          <PublicScreen>
            <SignedOutPage />
          </PublicScreen>
        }
      />

      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route index element={<HomeRedirect />} />
        <Route path="notifications" element={<NotificationsPage />} />
        {/* S3: visibility (owner / approver / auditor / head) is enforced by the API → 404 shows "Not found". */}
        <Route path="claims/:id/audit" element={<ClaimAuditTrailPage />} />

        <Route element={<RequireRole roles={[EMPLOYEE]} />}>
          <Route path="claims" element={<MyClaimsPage />} />
          <Route path="claims/new" element={<ClaimFormPage />} />
          <Route path="claims/:id/edit" element={<ClaimFormPage />} />
          <Route path="claims/:id" element={<ClaimDetailPage />} />
        </Route>

        <Route element={<RequireRole roles={[MANAGER, FINANCE_HEAD]} />}>
          <Route path="approvals" element={<ApprovalInboxPage />} />
          <Route path="approvals/:claimId" element={<ClaimReviewPage />} />
        </Route>

        <Route element={<RequireRole roles={[MANAGER, AUDITOR, FINANCE_HEAD]} />}>
          <Route path="delegation" element={<DelegationPage />} />
        </Route>

        <Route element={<RequireRole roles={[AUDITOR]} />}>
          <Route path="audit/queue" element={<ReviewQueuePage />} />
          <Route path="audit/claims/:claimId" element={<ReceiptViewerPage />} />
          <Route path="audit/samples" element={<SampleAuditPage />} />
        </Route>

        <Route element={<RequireRole roles={[FINANCE_HEAD]} />}>
          <Route path="finance/dashboard" element={<DashboardPage />} />
          <Route path="finance/payouts" element={<PayoutsPage />} />
          <Route path="finance/payouts/:batchId" element={<PayoutBatchPage />} />
          <Route path="finance/policy" element={<PolicyConfigPage />} />
          <Route path="finance/users" element={<UsersPage />} />
        </Route>

        <Route element={<RequireRole roles={[FINANCE_HEAD, AUDITOR]} />}>
          <Route path="finance/audit-log" element={<AuditLogPage />} />
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}
