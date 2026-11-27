import TextInput from '../../../components/TextInput.jsx'
import Select from '../../../components/Select.jsx'
import Toggle from '../../../components/Toggle.jsx'
import { unitLabel } from '../../../utils/format.js'
import { SAMPLE_PERCENT_OPTIONS } from './policyDraft.js'

/**
 * Step 1 "Spending limits": per-rule soft/hard limits plus the global knobs.
 * Errors are shown only for fields the user has touched (or after a publish attempt).
 */
export default function LimitsStep({ draft, errors, touched, onTouch, onChange, onRuleChange, disabled }) {
  const err = (key) => (touched[key] ? errors[key] : undefined)
  const field = (key) => ({
    value: draft[key],
    onChange: (e) => onChange(key, e.target.value),
    onBlur: () => onTouch(key),
    error: err(key),
    disabled,
  })

  return (
    <div className="stack">
      <div className="pc-rules" role="group" aria-labelledby="pc-rules-heading">
        <h3 id="pc-rules-heading" className="pc-subheading">Spending rules</h3>
        <p className="xsmall muted mt-0">Soft limit flags a line for review; above the hard limit the line is rejected.</p>
        <ul className="pc-rule-list">
          {draft.rules.map((rule) => {
            const softKey = `rules.${rule.code}.softLimit`
            const hardKey = `rules.${rule.code}.hardLimit`
            return (
              <li key={rule.code} className="pc-rule">
                <div className="pc-rule-name">
                  <span className="semibold">{rule.name}</span>
                  <span className="xsmall muted">{unitLabel(rule.unit) || rule.unit}{rule.cityTier ? ` · ${rule.cityTier === 'TIER1' ? 'Tier-1 city' : 'Other city'}` : ''}</span>
                </div>
                <div className="pc-rule-inputs">
                  <TextInput
                    label="Soft limit"
                    size="sm"
                    prefix="₹"
                    inputMode="decimal"
                    value={rule.softLimit}
                    onChange={(e) => onRuleChange(rule.code, 'softLimit', e.target.value)}
                    onBlur={() => onTouch(softKey)}
                    error={err(softKey)}
                    required
                    disabled={disabled}
                    aria-label={`${rule.name} soft limit`}
                  />
                  <TextInput
                    label="Hard limit"
                    size="sm"
                    prefix="₹"
                    inputMode="decimal"
                    value={rule.hardLimit}
                    onChange={(e) => onRuleChange(rule.code, 'hardLimit', e.target.value)}
                    onBlur={() => onTouch(hardKey)}
                    error={err(hardKey)}
                    required
                    disabled={disabled}
                    aria-label={`${rule.name} hard limit`}
                  />
                </div>
              </li>
            )
          })}
        </ul>
      </div>

      <h3 className="pc-subheading">General rules</h3>
      <div className="pc-grid">
        <TextInput label="Receipt required above" prefix="₹" inputMode="decimal" required hint="Lines above this amount need a receipt." {...field('receiptThreshold')} />
        <TextInput
          label="Overdue / alert threshold"
          suffix="hours"
          inputMode="numeric"
          required
          hint="1 to 720. Drives overdue flags and the dashboard age alert."
          {...field('overdueThresholdHours')}
        />
        <Select
          label="Sample audit rate"
          required
          hint="Share of auto-approved claims picked for audit."
          value={draft.samplePercent}
          onChange={(e) => {
            onChange('samplePercent', e.target.value)
            onTouch('samplePercent')
          }}
          error={errors.samplePercent}
          disabled={disabled}
          options={SAMPLE_PERCENT_OPTIONS.map((p) => ({ value: String(p), label: `${p} % (1 in ${100 / p})` }))}
        />
        <TextInput label="Submission window" suffix="days" inputMode="numeric" required hint="Oldest expense date allowed, 1 to 365." {...field('submissionWindowDays')} />
      </div>
      <Toggle
        label="Flag weekend expenses"
        description="Lines dated on a Saturday or Sunday get a Weekend flag and are routed for approval."
        checked={draft.weekendFlagEnabled}
        onChange={(v) => onChange('weekendFlagEnabled', v)}
        disabled={disabled}
      />
    </div>
  )
}
