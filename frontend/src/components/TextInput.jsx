import FormField from './FormField.jsx'

/**
 * 48 px text input with optional left icon, prefix/suffix text, label, hint and error.
 * Extra props go to the <input>.
 *
 * @param {object} props
 * @param {React.ReactNode} [props.label]
 * @param {React.ReactNode} [props.hint]
 * @param {React.ReactNode} [props.error]
 * @param {boolean} [props.required]
 * @param {React.ReactNode} [props.icon] left icon
 * @param {React.ReactNode} [props.prefix] e.g. "₹"
 * @param {React.ReactNode} [props.suffix] e.g. "nights"
 * @param {'sm'|'md'} [props.size]
 * @param {boolean} [props.hideLabel]
 * @param {React.ReactNode} [props.labelAction]
 */
export default function TextInput({
  label,
  hint,
  error,
  required,
  icon,
  prefix,
  suffix,
  id,
  size = 'md',
  hideLabel,
  labelAction,
  className = '',
  type = 'text',
  ref,
  ...inputProps
}) {
  return (
    <FormField label={label} htmlFor={id} required={required} hint={hint} error={error} hideLabel={hideLabel} labelAction={labelAction} className={className}>
      {({ id: fieldId, describedBy, invalid }) => (
        <div className={`input-wrap input-${size}${icon ? ' has-icon' : ''}${prefix ? ' has-prefix' : ''}${suffix ? ' has-suffix' : ''}${invalid ? ' is-invalid' : ''}${inputProps.disabled ? ' is-disabled' : ''}`}>
          {icon && (
            <span className="input-icon" aria-hidden="true">
              {icon}
            </span>
          )}
          {prefix && (
            <span className="input-affix input-prefix" aria-hidden="true">
              {prefix}
            </span>
          )}
          <input
            ref={ref}
            id={fieldId}
            type={type}
            className="input"
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            aria-required={required || undefined}
            {...inputProps}
          />
          {suffix && <span className="input-affix input-suffix">{suffix}</span>}
        </div>
      )}
    </FormField>
  )
}
