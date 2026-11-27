import FormField from './FormField.jsx'

/**
 * Multi-line input with an optional live character counter (`maxLength` + `showCount`).
 *
 * @param {object} props
 * @param {React.ReactNode} [props.label]
 * @param {React.ReactNode} [props.hint]
 * @param {React.ReactNode} [props.error]
 * @param {boolean} [props.required]
 * @param {boolean} [props.showCount]
 * @param {number} [props.rows]
 */
export default function TextArea({
  label,
  hint,
  error,
  required,
  id,
  showCount = false,
  rows = 4,
  hideLabel,
  className = '',
  ref,
  ...textareaProps
}) {
  const length = String(textareaProps.value ?? '').length
  const max = textareaProps.maxLength
  const counter =
    showCount && max ? (
      <span className={`field-count${length > max * 0.9 ? ' is-near' : ''}`} aria-live="polite">
        {length}/{max}
      </span>
    ) : null
  return (
    <FormField label={label} htmlFor={id} required={required} hint={hint} error={error} hideLabel={hideLabel} labelAction={counter} className={className}>
      {({ id: fieldId, describedBy, invalid }) => (
        <div className={`input-wrap textarea-wrap${invalid ? ' is-invalid' : ''}${textareaProps.disabled ? ' is-disabled' : ''}`}>
          <textarea
            ref={ref}
            id={fieldId}
            rows={rows}
            className="input textarea"
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            aria-required={required || undefined}
            {...textareaProps}
          />
        </div>
      )}
    </FormField>
  )
}
