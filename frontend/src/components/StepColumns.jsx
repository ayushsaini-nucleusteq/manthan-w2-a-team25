import { useEffect, useId, useRef, useState } from 'react'
import { useMediaQuery, NARROW_QUERY } from '../hooks/useMediaQuery.js'
import Button from './Button.jsx'
import StepIndicator from './StepIndicator.jsx'
import { ArrowLeftIcon, ArrowRightIcon, CheckIcon, InfoIcon } from './icons.jsx'

/**
 * Multi-step form laid out as 2–3 gated columns on one page (≥ 900 px) and as a
 * one-panel-at-a-time stepper below 900 px.
 *
 * A column is locked (dimmed, aria-disabled, inert, inputs disabled, overlay
 * "Complete step N first") until every earlier step reports `valid: true`.
 * On mobile, Next is enabled only when the current step is valid.
 *
 * @param {object} props
 * @param {Array<{id: string, title: React.ReactNode, description?: React.ReactNode, valid: boolean, content: React.ReactNode}>} props.steps
 * @param {() => void} [props.onComplete] shows a finish button after the last step (enabled when all are valid)
 * @param {React.ReactNode} [props.completeLabel]
 * @param {boolean} [props.completing] spinner on the finish button
 * @param {number} [props.current] controlled mobile step index
 * @param {(index: number) => void} [props.onCurrentChange]
 * @param {string} [props.columnTemplate] CSS grid-template-columns for desktop, e.g. "1fr 1.4fr 1fr"
 * @param {string} [props.ariaLabel]
 */
export default function StepColumns({
  steps,
  onComplete,
  completeLabel = 'Finish',
  completing = false,
  current,
  onCurrentChange,
  columnTemplate,
  ariaLabel = 'Form steps',
  className = '',
}) {
  const narrow = useMediaQuery(NARROW_QUERY)
  const baseId = useId()
  const [innerIndex, setInnerIndex] = useState(0)
  const headingRefs = useRef([])
  const focusPending = useRef(false)

  const firstInvalid = steps.findIndex((s) => !s.valid)
  const allValid = firstInvalid === -1
  const reachable = allValid ? steps.length - 1 : firstInvalid
  const requested = current ?? innerIndex
  const index = Math.max(0, Math.min(requested, reachable, steps.length - 1))
  const validCount = steps.filter((s) => s.valid).length
  const progress = Math.round((validCount / steps.length) * 100)

  const goTo = (i) => {
    const next = Math.max(0, Math.min(i, steps.length - 1))
    focusPending.current = true
    if (current === undefined) setInnerIndex(next)
    onCurrentChange?.(next)
  }

  useEffect(() => {
    if (focusPending.current && narrow) {
      focusPending.current = false
      headingRefs.current[index]?.focus()
      headingRefs.current[index]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [index, narrow])

  const isLocked = (i) => !allValid && firstInvalid < i
  const blockedBy = firstInvalid + 1

  const renderHeader = (step, i, { as = 'h2' } = {}) => {
    const Heading = as
    const done = step.valid
    return (
      <div className="step-col-header">
        <span className={`step-col-circle${done ? ' is-done' : ''}${isLocked(i) ? ' is-locked' : ''}`} aria-hidden="true">
          {done ? <CheckIcon size={18} strokeWidth={3} /> : i + 1}
        </span>
        <div className="step-col-heading">
          <Heading
            className="step-col-title"
            id={`${baseId}-h-${step.id}`}
            tabIndex={-1}
            ref={(el) => {
              headingRefs.current[i] = el
            }}
          >
            <span className="sr-only">
              Step {i + 1} of {steps.length}:{' '}
            </span>
            {step.title}
            {done && <span className="sr-only"> (complete)</span>}
          </Heading>
          {step.description && <p className="step-col-desc">{step.description}</p>}
        </div>
      </div>
    )
  }

  const finishButton = onComplete && (
    <Button
      variant="primary"
      size="lg"
      onClick={onComplete}
      disabled={!allValid}
      loading={completing}
      iconRight={<CheckIcon size={18} />}
      block={narrow}
    >
      {completeLabel}
    </Button>
  )

  /* ---------------- Mobile / narrow: stepper ---------------- */
  if (narrow) {
    const step = steps[index]
    const isLast = index === steps.length - 1
    const hintId = `${baseId}-next-hint`
    return (
      <section className={`step-stepper ${className}`} aria-label={ariaLabel}>
        <StepIndicator
          steps={steps}
          current={index}
          compact
          onStepClick={goTo}
          canGoTo={(i) => i <= reachable}
        />
        <div className="step-progress" aria-hidden="true">
          <span style={{ width: `${progress}%` }} />
        </div>
        <div className="step-panel card" key={step.id} aria-labelledby={`${baseId}-h-${step.id}`} role="group">
          {renderHeader(step, index)}
          <div className="step-col-body">{step.content}</div>
        </div>
        <div className="step-nav" role="group" aria-label="Step navigation">
          <Button variant="secondary" size="lg" onClick={() => goTo(index - 1)} disabled={index === 0} icon={<ArrowLeftIcon size={18} />}>
            Back
          </Button>
          {!isLast ? (
            <Button
              variant="primary"
              size="lg"
              onClick={() => goTo(index + 1)}
              disabled={!step.valid}
              aria-describedby={!step.valid ? hintId : undefined}
              iconRight={<ArrowRightIcon size={18} />}
            >
              Next
            </Button>
          ) : (
            finishButton
          )}
          {!step.valid && (
            <p id={hintId} className="step-nav-hint">
              <InfoIcon size={14} /> Complete the required fields in this step to continue.
            </p>
          )}
        </div>
      </section>
    )
  }

  /* ---------------- Desktop: gated columns ---------------- */
  return (
    <section className={`step-columns-wrap ${className}`} aria-label={ariaLabel}>
      <div className="step-progress" role="progressbar" aria-label="Steps complete" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={validCount}>
        <span style={{ width: `${progress}%` }} />
      </div>
      <div
        className="step-columns"
        style={{ gridTemplateColumns: columnTemplate || `repeat(${steps.length}, minmax(0, 1fr))` }}
      >
        {steps.map((step, i) => {
          const locked = isLocked(i)
          return (
            <div
              key={step.id}
              className={`step-col card${locked ? ' is-locked' : ''}${step.valid ? ' is-valid' : ''}`}
              role="group"
              aria-labelledby={`${baseId}-h-${step.id}`}
              aria-disabled={locked || undefined}
            >
              {renderHeader(step, i)}
              <fieldset className="step-col-body" disabled={locked} inert={locked}>
                {step.content}
              </fieldset>
              {i === steps.length - 1 && finishButton && <div className="step-col-footer">{finishButton}</div>}
              {locked && (
                <div className="step-col-overlay">
                  <span className="step-col-lock">
                    <span className="step-col-lock-num" aria-hidden="true">
                      {blockedBy}
                    </span>
                    Complete step {blockedBy} first
                  </span>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
