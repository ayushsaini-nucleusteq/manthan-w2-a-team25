import { Link } from 'react-router-dom'

/**
 * White rounded card. Clickable cards (`to` or `onClick`) lift on hover.
 *
 * @param {object} props
 * @param {React.ReactNode} [props.title]
 * @param {React.ReactNode} [props.subtitle]
 * @param {React.ReactNode} [props.actions] header-right slot
 * @param {React.ReactNode} [props.footer]
 * @param {string} [props.to] makes the whole card a link
 * @param {() => void} [props.onClick] makes the whole card a button
 * @param {boolean} [props.padded]
 * @param {'section'|'div'|'article'} [props.as]
 */
export default function Card({
  title,
  subtitle,
  actions,
  footer,
  to,
  onClick,
  padded = true,
  as = 'section',
  className = '',
  children,
  headingLevel = 2,
  ...rest
}) {
  const interactive = Boolean(to || onClick)
  const classes = ['card', padded && 'card-pad', interactive && 'card-interactive', className].filter(Boolean).join(' ')
  const Heading = `h${headingLevel}`

  const header =
    title || actions ? (
      <div className="card-header">
        <div className="card-heading">
          {title && <Heading className="card-title">{title}</Heading>}
          {subtitle && <p className="card-subtitle">{subtitle}</p>}
        </div>
        {actions && <div className="card-actions">{actions}</div>}
      </div>
    ) : null

  const body = (
    <>
      {header}
      {children}
      {footer && <div className="card-footer">{footer}</div>}
    </>
  )

  if (to) {
    return (
      <Link to={to} className={classes} {...rest}>
        {body}
      </Link>
    )
  }
  if (onClick) {
    return (
      <button type="button" className={`${classes} card-button`} onClick={onClick} {...rest}>
        {body}
      </button>
    )
  }
  const Tag = as
  return (
    <Tag className={classes} {...rest}>
      {body}
    </Tag>
  )
}
