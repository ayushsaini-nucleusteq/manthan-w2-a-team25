import { useEffect } from 'react'
import { APP_NAME } from '../utils/constants.js'

/** Sets the tab title to "<title> · ExpenseFlow" while the component is mounted. */
export function useDocumentTitle(title) {
  useEffect(() => {
    if (!title) return undefined
    const previous = document.title
    document.title = `${title} · ${APP_NAME}`
    return () => {
      document.title = previous
    }
  }, [title])
}
