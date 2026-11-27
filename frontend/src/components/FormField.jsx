import { useId } from 'react'
import { AlertTriangleIcon } from './icons.jsx'

/**
 * Label above the field, red `*` for required, hint and error text with an icon.
 *
 * `children` may be a node (then pass `htmlFor` to link the label) or a render
 * function receiving `{id, describedBy, invalid, required}` to spread onto the control.
 *
 * @param {object} props
 * @param {React.ReactNode} [props.label]
 * @param {string} [props.htmlFor]
 * @param {boolean} [props.required]
 * @param {React.ReactNode} [props.hint]
 * @param {React.ReactNode} [props.error]
 * @param {React.ReactNode} [props.labelAction] right side of the label row (e.g. a counter or link)
 * @param {boolean} [props.hideLabel] keep the label for screen readers only
 * @param {'div'|'fieldset'} [props.as] use fieldset for radio/checkbox groups (label → legend)
 */
export default function FormField({
  label,
  htmlFor,
  required = false,
  hint,
  error,
  labelAction,
  hideLabel = false,
  as = 'div',
  className = '',
  children,
}) {
  const autoId = useId()
  const id = htmlFor || `f${autoId}`
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined
  const invalid = Boolean(error)

  const control =
    typeof children === 'function' ? children({ id, describedBy, invalid, required }) : children

  const labelContent = label && (
    <>
      {label}
      {required && (
        <span className="field-required" aria-hidden="true">
          {' '}*
        </span>
      )}
      {required && <span className="sr-only"> (required)</span>}
    </>
  )

  const Tag = as
  return (
    <Tag className={`field${invalid ? ' has-error' : ''} ${className}`}>
      {label &&
        (as === 'fieldset' ? (
          <legend className={`field-label${hideLabel ? ' sr-only' : ''}`}>{labelContent}</legend>
        ) : (
          <div className={`field-label-row${hideLabel ? ' sr-only' : ''}`}>
            <label className="field-label" htmlFor={id}>
              {labelContent}
            </label>
            {labelAction && <span className="field-label-action">{labelAction}</span>}
          </div>
        ))}
      {control}
      {hint && (
        <p className="field-hint" id={hintId}>
          {hint}
        </p>
      )}
      {error && (
        <p className="field-error" id={errorId} role="alert">
          <AlertTriangleIcon size={14} strokeWidth={2} />
          <span>{error}</span>
        </p>
      )}
    </Tag>
  )
}
