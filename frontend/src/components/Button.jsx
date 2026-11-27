import { Link } from 'react-router-dom'
import Spinner from './Spinner.jsx'

/**
 * Button (or router Link when `to` is given, plain anchor when `href` is given).
 *
 * @param {object} props
 * @param {'primary'|'secondary'|'ghost'|'danger'|'danger-outline'|'inverse'} [props.variant]
 * @param {'sm'|'md'|'lg'} [props.size]
 * @param {boolean} [props.loading] shows a spinner and disables the button
 * @param {React.ReactNode} [props.icon] leading icon
 * @param {React.ReactNode} [props.iconRight] trailing icon
 * @param {boolean} [props.block] full width
 * @param {boolean} [props.iconOnly] square icon button (pass aria-label)
 * @param {string} [props.to] router link target
 * @param {string} [props.loadingLabel] screen-reader text while loading
 */
export default function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  loadingLabel = 'Working…',
  icon,
  iconRight,
  block = false,
  iconOnly = false,
  to,
  href,
  type = 'button',
  disabled,
  className = '',
  children,
  ref,
  ...rest
}) {
  const classes = [
    'btn',
    `btn-${variant}`,
    `btn-${size}`,
    block && 'btn-block',
    iconOnly && 'btn-icon',
    loading && 'is-loading',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  const content = (
    <>
      {loading ? <Spinner size="sm" tone="current" label={loadingLabel} /> : icon}
      {children != null && children !== false && <span className="btn-label">{children}</span>}
      {!loading && iconRight}
    </>
  )

  if (to && !disabled) {
    return (
      <Link ref={ref} to={to} className={classes} {...rest}>
        {content}
      </Link>
    )
  }
  if (href && !disabled) {
    return (
      <a ref={ref} href={href} className={classes} {...rest}>
        {content}
      </a>
    )
  }
  return (
    <button
      ref={ref}
      type={type}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {content}
    </button>
  )
}
