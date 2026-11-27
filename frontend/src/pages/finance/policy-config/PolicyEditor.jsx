import { useMemo, useState } from 'react'
import StepColumns from '../../../components/StepColumns.jsx'
import InfoBanner from '../../../components/InfoBanner.jsx'
import Button from '../../../components/Button.jsx'
import { policyApi, isApiError, errorMessage, fieldErrors } from '../../../api'
import { useToast } from '../../../components/toast/useToast.js'
import { isValid, validatePolicyPublish } from '../../../utils/validation.js'
import { diffPolicy, toDraft, toPayload, validateCities, validateLimits } from './policyDraft.js'
import LimitsStep from './LimitsStep.jsx'
import CitiesStep from './CitiesStep.jsx'
import ReviewStep from './ReviewStep.jsx'

/**
 * The 3-column editor. Keyed by the current version number in the page, so it
 * starts fresh from the server copy after every publish or reload.
 */
export default function PolicyEditor({ policy, onPublished, onReload }) {
  const toast = useToast()
  const [draft, setDraft] = useState(() => toDraft(policy))
  const [touched, setTouched] = useState({})
  const [note, setNote] = useState('')
  const [noteTouched, setNoteTouched] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [conflict, setConflict] = useState(null)
  const [serverError, setServerError] = useState(null)

  const limitErrors = useMemo(() => validateLimits(draft), [draft])
  const cityErrors = useMemo(() => validateCities(draft), [draft])
  const noteErrors = validatePolicyPublish({ changeNote: note })
  const diffRows = useMemo(() => diffPolicy(policy, draft), [policy, draft])

  const onTouch = (key) => setTouched((t) => (t[key] ? t : { ...t, [key]: true }))
  const onChange = (key, value) => setDraft((d) => ({ ...d, [key]: value }))
  const onRuleChange = (code, key, value) =>
    setDraft((d) => ({ ...d, rules: d.rules.map((r) => (r.code === code ? { ...r, [key]: value } : r)) }))

  const reset = () => {
    setDraft(toDraft(policy))
    setTouched({})
    setNote('')
    setNoteTouched(false)
    setServerError(null)
  }

  const publish = async () => {
    setNoteTouched(true)
    if (!isValid(noteErrors) || !diffRows.length) return
    setPublishing(true)
    setServerError(null)
    try {
      const saved = await policyApi.publishPolicyVersion(toPayload(policy, draft, note))
      toast.success(`Version ${saved.versionNo} is now in force for new and edited lines.`, { title: 'Policy published' })
      onPublished(saved)
    } catch (err) {
      if (isApiError(err) && err.status === 409) {
        setConflict(err)
        toast.error('Policy was changed by someone else. Reload to continue.', { title: 'Not published' })
      } else {
        const fields = fieldErrors(err)
        const list = fields ? Object.values(fields).filter(Boolean) : []
        setServerError(list.length ? `${errorMessage(err)} ${list.join(' ')}` : errorMessage(err))
        if (fields) setTouched(Object.fromEntries(Object.keys(fields).map((k) => [k, true])))
        toast.error(errorMessage(err), { title: 'Not published' })
      }
    } finally {
      setPublishing(false)
    }
  }

  const steps = [
    {
      id: 'limits',
      title: 'Spending limits',
      description: 'Soft and hard limits, receipts and timings.',
      valid: isValid(limitErrors),
      content: (
        <LimitsStep
          draft={draft}
          errors={limitErrors}
          touched={touched}
          onTouch={onTouch}
          onChange={onChange}
          onRuleChange={onRuleChange}
          disabled={publishing}
        />
      ),
    },
    {
      id: 'cities',
      title: 'Tier-1 cities',
      description: 'Cities that use the higher hotel limits.',
      valid: isValid(cityErrors),
      content: (
        <CitiesStep cities={draft.tier1Cities} error={cityErrors.tier1Cities} onChange={(c) => onChange('tier1Cities', c)} disabled={publishing} />
      ),
    },
    {
      id: 'review',
      title: 'Review & publish',
      description: 'Check the changes and explain them.',
      valid: isValid(noteErrors) && diffRows.length > 0,
      content: (
        <ReviewStep
          rows={diffRows}
          note={note}
          noteError={noteTouched ? noteErrors.changeNote : undefined}
          onNoteChange={setNote}
          onNoteBlur={() => setNoteTouched(true)}
          disabled={publishing}
        />
      ),
    },
  ]

  return (
    <div className="stack">
      {conflict && (
        <InfoBanner
          tone="danger"
          live
          title="Policy was changed by someone else; reload"
          action={
            <Button size="sm" variant="danger" onClick={onReload}>
              Reload
            </Button>
          }
        >
          {errorMessage(conflict)} Your edits here are not saved.
        </InfoBanner>
      )}
      {serverError && (
        <InfoBanner tone="danger" live title="Could not publish" onDismiss={() => setServerError(null)}>
          {serverError}
        </InfoBanner>
      )}
      <div className="row-between">
        <p className="small muted mt-0">
          Editing a copy of version {policy.versionNo}. {diffRows.length ? `${diffRows.length} change${diffRows.length === 1 ? '' : 's'} pending.` : 'No changes yet.'}
        </p>
        <Button variant="ghost" size="sm" onClick={reset} disabled={publishing || (!diffRows.length && !note)}>
          Discard changes
        </Button>
      </div>
      <StepColumns
        steps={steps}
        ariaLabel="Policy editor"
        columnTemplate="1.5fr 1fr 1.3fr"
        onComplete={publish}
        completeLabel="Publish new version"
        completing={publishing}
      />
    </div>
  )
}
