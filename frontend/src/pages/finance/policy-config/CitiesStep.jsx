import { useState } from 'react'
import TextInput from '../../../components/TextInput.jsx'
import Button from '../../../components/Button.jsx'
import { PlusIcon, XIcon } from '../../../components/icons.jsx'
import { validateNewCity } from '../../../utils/validation.js'

/** Step 2 "Tier-1 cities": removable chips plus an add field (case-insensitive dedupe). */
export default function CitiesStep({ cities, error, onChange, disabled }) {
  const [text, setText] = useState('')
  const [addError, setAddError] = useState(null)

  const add = (e) => {
    e?.preventDefault()
    const message = validateNewCity(text, cities)
    if (message) {
      setAddError(message)
      return
    }
    const name = text.trim().replace(/\s+/g, ' ')
    onChange([...cities, name].sort((a, b) => a.localeCompare(b)))
    setText('')
    setAddError(null)
  }

  return (
    <div className="stack">
      <p className="small muted mt-0">Hotel stays in these cities use the tier-1 nightly limits.</p>
      <div className="pc-add-city">
        <TextInput
          label="Add a city"
          size="sm"
          value={text}
          maxLength={80}
          onChange={(e) => {
            setText(e.target.value)
            if (addError) setAddError(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add(e)
          }}
          error={addError}
          disabled={disabled}
          className="grow"
        />
        <Button variant="secondary" size="sm" icon={<PlusIcon size={16} />} onClick={add} disabled={disabled || !text.trim()}>
          Add
        </Button>
      </div>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <ul className="pc-chips" aria-label={`Tier-1 cities (${cities.length})`}>
        {cities.map((city) => (
          <li key={city} className="chip tone-brand pc-city-chip">
            <span>{city}</span>
            <button
              type="button"
              className="pc-chip-remove"
              aria-label={`Remove ${city}`}
              disabled={disabled}
              onClick={() => onChange(cities.filter((c) => c !== city))}
            >
              <XIcon size={12} strokeWidth={2.5} />
            </button>
          </li>
        ))}
      </ul>
      <p className="xsmall muted" aria-live="polite">
        {cities.length} {cities.length === 1 ? 'city' : 'cities'}
      </p>
    </div>
  )
}
