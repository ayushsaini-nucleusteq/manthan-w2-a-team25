import { CheckIcon } from './icons.jsx'

/**
 * Numbered step circles joined by lines that fill blue as you progress.
 * A completed step is a filled blue circle with a white tick.
 *
 * @param {object} props
 * @param {Array<{id: string, title: React.ReactNode, valid?: boolean}>} props.steps
 * @param {number} props.current zero-based index of the current step
 * @param {(index: number) => void} [props.onStepClick] makes reachable steps clickable
 * @param {(index: number) => boolean} [props.canGoTo] whether a step may be clicked
 * @param {boolean} [props.compact] hides titles except the current one (mobile)
 */
export default function StepIndicator({ steps, current, onStepClick, canGoTo, compact = false, className = '' }) {
  return (
    <ol className={`step-indicator${compact ? ' is-compact' : ''} ${className}`} aria-label="Progress">
      {steps.map((step, i) => {
        const isCurrent = i === current
        const done = Boolean(step.valid) && !isCurrent
        const state = isCurrent ? 'current' : done ? 'done' : 'todo'
        const clickable = onStepClick && (canGoTo ? canGoTo(i) : true) && !isCurrent
        const circle = <span className="step-circle">{done ? <CheckIcon size={16} strokeWidth={3} /> : i + 1}</span>
        const label = (
          <span className="step-text">
            <span className="sr-only">
              Step {i + 1} of {steps.length}
              {done ? ', complete' : isCurrent ? ', current' : ''}:{' '}
            </span>
            <span className="step-title">{step.title}</span>
          </span>
        )
        const lineFilled = Boolean(step.valid) && i < current
        return (
          <li key={step.id} className={`step is-${state}`} aria-current={isCurrent ? 'step' : undefined}>
            {clickable ? (
              <button type="button" className="step-button" onClick={() => onStepClick(i)}>
                {circle}
                {label}
              </button>
            ) : (
              <span className="step-button">
                {circle}
                {label}
              </span>
            )}
            {i < steps.length - 1 && <span className={`step-line${lineFilled ? ' is-filled' : ''}`} aria-hidden="true" />}
          </li>
        )
      })}
    </ol>
  )
}
