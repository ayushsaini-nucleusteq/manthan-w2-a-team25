import { useMemo, useState } from 'react'
import Modal from '../../../components/Modal.jsx'
import Button from '../../../components/Button.jsx'
import TextInput from '../../../components/TextInput.jsx'
import Select from '../../../components/Select.jsx'
import Checkbox from '../../../components/Checkbox.jsx'
import Toggle from '../../../components/Toggle.jsx'
import InfoBanner from '../../../components/InfoBanner.jsx'
import { SearchIcon } from '../../../components/icons.jsx'
import { usersApi, isApiError, errorMessage, fieldErrors } from '../../../api'
import { useToast } from '../../../components/toast/useToast.js'
import { ROLE_LABEL, ROLE_PRIORITY } from '../../../utils/constants.js'

const ROLE_HINT = {
  EMPLOYEE: 'Everyone can file claims. Always on.',
  MANAGER: 'Approves claims from direct reports.',
  AUDITOR: 'Reviews larger claims and sample audits.',
  FINANCE_HEAD: 'Final approvals, payouts, policy and users.',
}
const ROLE_ORDER = [...ROLE_PRIORITY].reverse()

/**
 * Edit a user's manager, roles and active flag. Keyed by user id by the page,
 * so form state starts from the selected user each time.
 */
export default function UserEditModal({ user, allUsers, isSelf, onClose, onSaved, onReloadList }) {
  const toast = useToast()
  const [managerId, setManagerId] = useState(user.managerId || '')
  const [roles, setRoles] = useState(() => new Set(user.roles))
  const [active, setActive] = useState(user.active)
  const [managerQuery, setManagerQuery] = useState('')
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState(null)
  const [conflict, setConflict] = useState(false)

  const candidates = useMemo(() => {
    const q = managerQuery.trim().toLowerCase()
    return (allUsers || [])
      .filter((u) => u.id !== user.id && (u.active || u.id === user.managerId))
      .filter((u) => !q || u.id === managerId || `${u.fullName} ${u.employeeCode} ${u.departmentName}`.toLowerCase().includes(q))
  }, [allUsers, managerQuery, user.id, user.managerId, managerId])

  const dirty =
    (managerId || null) !== (user.managerId || null) ||
    active !== user.active ||
    roles.size !== user.roles.length ||
    user.roles.some((r) => !roles.has(r))

  const toggleRole = (role, on) => {
    setRoles((prev) => {
      const next = new Set(prev)
      if (on) next.add(role)
      else next.delete(role)
      next.add('EMPLOYEE')
      return next
    })
  }

  const save = async () => {
    setSaving(true)
    setErrors({})
    setFormError(null)
    try {
      const saved = await usersApi.updateUser(user.id, {
        managerId: managerId || null,
        roles: ROLE_ORDER.filter((r) => roles.has(r)),
        active,
        version: user.version,
      })
      toast.success(`${saved.fullName} was updated.`, { title: 'User saved' })
      onSaved(saved)
    } catch (err) {
      if (isApiError(err) && err.status === 409) {
        setConflict(true)
      } else if (isApiError(err) && err.status === 422) {
        if (err.code === 'MANAGER_CYCLE') setErrors({ managerId: err.message })
        else setFormError(err.message)
      } else {
        const fields = fieldErrors(err)
        if (fields) setErrors(fields)
        setFormError(errorMessage(err))
      }
      toast.error(errorMessage(err), { title: 'Not saved' })
    } finally {
      setSaving(false)
    }
  }

  const managerOptions = candidates.map((u) => ({
    value: u.id,
    label: `${u.fullName} (${u.employeeCode}) · ${u.departmentName || 'No department'}${u.active ? '' : ' · inactive'}`,
  }))

  return (
    <Modal
      open
      onClose={saving ? () => {} : onClose}
      dismissible={!saving}
      title={`Edit ${user.fullName}`}
      description={`${user.email} · ${user.employeeCode} · ${user.departmentName || 'No department'}`}
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} loading={saving} loadingLabel="Saving…" disabled={!dirty || conflict}>
            Save changes
          </Button>
        </>
      }
    >
      <div className="stack">
        {conflict && (
          <InfoBanner
            tone="danger"
            live
            title="This user changed, reload"
            action={
              <Button
                size="sm"
                variant="danger"
                onClick={() => {
                  onReloadList()
                  onClose()
                }}
              >
                Reload
              </Button>
            }
          >
            Someone else saved changes to this user while you were editing.
          </InfoBanner>
        )}
        {formError && (
          <InfoBanner tone="danger" live title="Could not save">
            {formError}
          </InfoBanner>
        )}

        <div className="ua-manager-pick">
          <TextInput
            label="Find a manager"
            size="sm"
            icon={<SearchIcon size={16} />}
            type="search"
            placeholder="Name, code or department"
            value={managerQuery}
            onChange={(e) => setManagerQuery(e.target.value)}
            hint={`${candidates.length} match${candidates.length === 1 ? '' : 'es'}`}
          />
          <Select
            label="Reports to"
            value={managerId}
            onChange={(e) => {
              setManagerId(e.target.value)
              setErrors((x) => ({ ...x, managerId: undefined }))
            }}
            placeholder="No manager (top of the hierarchy)"
            options={managerOptions}
            error={errors.managerId}
            disabled={saving}
          />
        </div>

        <fieldset className="ua-fieldset">
          <legend>Roles</legend>
          <div className="ua-role-grid">
            {ROLE_ORDER.map((role) => (
              <Checkbox
                key={role}
                label={ROLE_LABEL[role]}
                description={ROLE_HINT[role]}
                checked={roles.has(role)}
                disabled={role === 'EMPLOYEE' || saving}
                onChange={(e) => toggleRole(role, e.target.checked)}
              />
            ))}
          </div>
          {errors.roles && <p className="field-error">{errors.roles}</p>}
        </fieldset>

        <Toggle
          label="Active"
          description={
            isSelf
              ? "You can't deactivate your own account."
              : 'Inactive users cannot sign in. Their pending approvals move to their manager or the role pool.'
          }
          checked={active}
          onChange={setActive}
          disabled={saving || (isSelf && active)}
        />
      </div>
    </Modal>
  )
}
