import { useId } from 'react'

/**
 * On/off switch (role="switch"). `onChange` receives the new boolean.
 *
 * @param {object} props
 * @param {React.ReactNode} props.label
 * @param {React.ReactNode} [props.description]
 * @param {boolean} props.checked
 * @param {(checked: boolean) => void} props.onChange
 * @param {boolean} [props.disabled]
 * @param {'sm'|'md'} [props.size]
 */
export default function Toggle({ label, description, checked = false, onChange, disabled = false, size = 'md', id, className = '' }) {
  const autoId = useId()
  const switchId = id || `tg${autoId}`
  const labelId = `${switchId}-label`
  const descId = description ? `${switchId}-desc` : undefined
  return (
    <div className={`toggle toggle-${size}${disabled ? ' is-disabled' : ''} ${className}`}>
      <button
        id={switchId}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        aria-describedby={descId}
        disabled={disabled}
        className={`toggle-track${checked ? ' is-on' : ''}`}
        onClick={() => onChange?.(!checked)}
      >
        <span className="toggle-thumb" aria-hidden="true" />
      </button>
      <span className="toggle-text">
        <label id={labelId} htmlFor={switchId} className="toggle-label">
          {label}
        </label>
        {description && (
          <span id={descId} className="toggle-desc">
            {description}
          </span>
        )}
      </span>
    </div>
  )
}
