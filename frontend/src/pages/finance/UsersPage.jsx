import { useState } from 'react'
import { usersApi, referenceApi } from '../../api'
import PageHeader from '../../components/PageHeader.jsx'
import DataTable from '../../components/DataTable.jsx'
import FilterBar from '../../components/FilterBar.jsx'
import TextInput from '../../components/TextInput.jsx'
import Select from '../../components/Select.jsx'
import Button from '../../components/Button.jsx'
import { EditIcon, SearchIcon } from '../../components/icons.jsx'
import { useAsync } from '../../hooks/useAsync.js'
import { useDebounce } from '../../hooks/useDebounce.js'
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js'
import { useAuth } from '../../auth/useAuth.js'
import { ROLE_LABEL, ROLE_PRIORITY } from '../../utils/constants.js'
import UserEditModal from './users-admin/UserEditModal.jsx'
import DelegationsSection from './users-admin/DelegationsSection.jsx'
import './users-admin/users-admin.css'

const ROLE_TONE = { FINANCE_HEAD: 'tone-navy', AUDITOR: 'tone-purple', MANAGER: 'tone-brand', EMPLOYEE: 'tone-neutral' }
const ROLE_OPTIONS = ROLE_PRIORITY.map((r) => ({ value: r, label: ROLE_LABEL[r] }))

/** F5 Users and delegations (finance head). */
export default function UsersPage() {
  useDocumentTitle('Users')
  const { user: me } = useAuth()
  const [q, setQ] = useState('')
  const [role, setRole] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [sort, setSort] = useState({ key: 'name', dir: 'asc' })
  const [editing, setEditing] = useState(null)
  const query = useDebounce(q.trim(), 250)

  const list = useAsync(() => usersApi.listUsers({ q: query, role: role || undefined, departmentId: departmentId || undefined }), [query, role, departmentId])
  const everyone = useAsync(() => usersApi.listUsers({}), [])
  const departments = useAsync(() => referenceApi.listDepartments(), [])

  const activeCount = [q.trim(), role, departmentId].filter(Boolean).length
  const clear = () => {
    setQ('')
    setRole('')
    setDepartmentId('')
  }

  const onSaved = () => {
    setEditing(null)
    list.reload()
    everyone.reload()
  }

  const columns = [
    {
      key: 'name',
      header: 'Name',
      mobileTitle: true,
      sortable: true,
      sortValue: (u) => u.fullName,
      render: (u) => (
        <span className="ua-name">
          <span className="semibold">{u.fullName}</span>
          <span className="xsmall muted truncate">{u.email}</span>
        </span>
      ),
    },
    { key: 'code', header: 'Code', sortable: true, sortValue: (u) => u.employeeCode, render: (u) => <span className="mono small">{u.employeeCode}</span> },
    { key: 'department', header: 'Department', sortable: true, sortValue: (u) => u.departmentName || '', render: (u) => u.departmentName || '—' },
    { key: 'manager', header: 'Manager', sortable: true, sortValue: (u) => u.managerName || '', render: (u) => u.managerName || <span className="muted">None</span> },
    {
      key: 'roles',
      header: 'Roles',
      render: (u) => (
        <span className="ua-roles">
          {ROLE_PRIORITY.filter((r) => u.roles.includes(r)).map((r) => (
            <span key={r} className={`chip chip-sm ${ROLE_TONE[r]}`}>
              {ROLE_LABEL[r]}
            </span>
          ))}
        </span>
      ),
    },
    {
      key: 'active',
      header: 'Status',
      sortable: true,
      sortValue: (u) => (u.active ? 0 : 1),
      render: (u) => <span className={`chip chip-sm ${u.active ? 'tone-success' : 'tone-neutral'}`}>{u.active ? 'Active' : 'Inactive'}</span>,
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      mobileLabel: 'Actions',
      align: 'right',
      render: (u) => (
        <Button
          size="sm"
          variant="secondary"
          icon={<EditIcon size={14} />}
          onClick={(e) => {
            e.stopPropagation()
            setEditing(u)
          }}
          aria-label={`Edit ${u.fullName}`}
        >
          Edit
        </Button>
      ),
    },
  ]

  const deptOptions = (departments.data || []).map((d) => ({ value: d.id, label: d.name }))

  return (
    <div className="page">
      <PageHeader
        title="Users"
        subtitle="Reporting lines, roles and account status. Every change is audited."
        breadcrumbs={[{ label: 'Dashboard', to: '/finance/dashboard' }, { label: 'Users' }]}
        meta={list.data ? <span className="chip tone-brand">{list.data.length} {list.data.length === 1 ? 'user' : 'users'}</span> : null}
      />
      <div className="page-body stack-lg">
        <section aria-label="Users" className="stack">
          <FilterBar
            label="User filters"
            activeCount={activeCount}
            onClear={clear}
            search={
              <TextInput
                label="Search users"
                hideLabel
                size="sm"
                type="search"
                icon={<SearchIcon size={16} />}
                placeholder="Search name, email or code"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            }
          >
            <Select label="Role" size="sm" value={role} onChange={(e) => setRole(e.target.value)} placeholder="All roles" options={ROLE_OPTIONS} />
            <Select
              label="Department"
              size="sm"
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
              placeholder={departments.error ? 'Departments unavailable' : 'All departments'}
              options={deptOptions}
            />
          </FilterBar>
          <DataTable
            columns={columns}
            rows={list.data || []}
            loading={list.loading}
            error={list.error}
            onRetry={list.reload}
            sort={sort}
            onSortChange={setSort}
            dense
            caption="Users"
            rowLabel={(u) => u.fullName}
            onRowClick={(u) => setEditing(u)}
            maxHeight="70vh"
            empty={{
              title: activeCount ? 'No users match these filters' : 'No users yet',
              message: activeCount ? 'Try a different name or clear the filters.' : undefined,
              action: activeCount ? (
                <Button variant="secondary" size="sm" onClick={clear}>
                  Clear filters
                </Button>
              ) : undefined,
            }}
          />
        </section>

        <DelegationsSection />
      </div>

      {editing && (
        <UserEditModal
          key={editing.id}
          user={editing}
          allUsers={everyone.data}
          isSelf={editing.id === me?.id}
          onClose={() => setEditing(null)}
          onSaved={onSaved}
          onReloadList={() => {
            list.reload()
            everyone.reload()
          }}
        />
      )}
    </div>
  )
}
