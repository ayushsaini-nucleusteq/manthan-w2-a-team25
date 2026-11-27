import FormField from './FormField.jsx'
import { ChevronDownIcon } from './icons.jsx'

/**
 * Native select styled like the inputs.
 *
 * @param {object} props
 * @param {Array<{value: string, label: React.ReactNode, disabled?: boolean}>} [props.options] or pass <option> children
 * @param {string} [props.placeholder] adds an empty first option
 * @param {React.ReactNode} [props.label]
 * @param {React.ReactNode} [props.hint]
 * @param {React.ReactNode} [props.error]
 * @param {boolean} [props.required]
 * @param {'sm'|'md'} [props.size]
 */
export default function Select({
  label,
  hint,
  error,
  required,
  id,
  options,
  placeholder,
  size = 'md',
  hideLabel,
  className = '',
  children,
  ref,
  ...selectProps
}) {
  return (
    <FormField label={label} htmlFor={id} required={required} hint={hint} error={error} hideLabel={hideLabel} className={className}>
      {({ id: fieldId, describedBy, invalid }) => (
        <div className={`input-wrap select-wrap input-${size}${invalid ? ' is-invalid' : ''}${selectProps.disabled ? ' is-disabled' : ''}`}>
          <select
            ref={ref}
            id={fieldId}
            className="input select"
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            aria-required={required || undefined}
            {...selectProps}
          >
            {placeholder !== undefined && <option value="">{placeholder}</option>}
            {options
              ? options.map((o) => (
                  <option key={o.value} value={o.value} disabled={o.disabled}>
                    {o.label}
                  </option>
                ))
              : children}
          </select>
          <ChevronDownIcon size={18} className="select-chevron" />
        </div>
      )}
    </FormField>
  )
}
