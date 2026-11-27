import { useEffect, useId, useRef } from 'react'
import { CheckIcon, MinusIcon } from './icons.jsx'

/**
 * Custom-styled native checkbox with an indeterminate state.
 * `onChange` receives the native change event (use `e.target.checked`).
 *
 * @param {object} props
 * @param {React.ReactNode} [props.label] visible label (omit and pass aria-label for table checkboxes)
 * @param {React.ReactNode} [props.description]
 * @param {boolean} [props.checked]
 * @param {boolean} [props.indeterminate]
 * @param {React.ReactNode} [props.error]
 */
export default function Checkbox({ label, description, checked, indeterminate = false, error, id, className = '', ...inputProps }) {
  const ref = useRef(null)
  const autoId = useId()
  const inputId = id || `cb${autoId}`
  const descId = description ? `${inputId}-desc` : undefined
  const errId = error ? `${inputId}-err` : undefined

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate && !checked
  }, [indeterminate, checked])

  return (
    <div className={`checkbox${inputProps.disabled ? ' is-disabled' : ''}${error ? ' has-error' : ''} ${className}`}>
      <span className="checkbox-control">
        <input
          ref={ref}
          id={inputId}
          type="checkbox"
          className="checkbox-input"
          checked={checked}
          aria-describedby={[errId, descId].filter(Boolean).join(' ') || undefined}
          aria-invalid={error ? true : undefined}
          {...inputProps}
        />
        <span className="checkbox-box" aria-hidden="true">
          {indeterminate && !checked ? <MinusIcon size={14} strokeWidth={3} /> : <CheckIcon size={14} strokeWidth={3} />}
        </span>
      </span>
      {(label || description) && (
        <span className="checkbox-text">
          {label && (
            <label htmlFor={inputId} className="checkbox-label">
              {label}
            </label>
          )}
          {description && (
            <span id={descId} className="checkbox-desc">
              {description}
            </span>
          )}
          {error && (
            <span id={errId} className="field-error">
              {error}
            </span>
          )}
        </span>
      )}
    </div>
  )
}
