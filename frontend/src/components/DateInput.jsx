import TextInput from './TextInput.jsx'
import { CalendarIcon } from './icons.jsx'

/**
 * Native date picker (value is "YYYY-MM-DD") with a calendar icon.
 * Accepts the same props as TextInput plus `min`/`max`.
 */
export default function DateInput({ icon, ...props }) {
  return <TextInput type="date" icon={icon === undefined ? <CalendarIcon size={18} /> : icon} {...props} />
}
