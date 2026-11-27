import { useContext } from 'react'
import { ToastContext } from './toastContext.js'

/**
 * const toast = useToast()
 * toast.success('Claim submitted')
 * toast.error(errorMessage(err), { title: "Couldn't submit" })
 */
export function useToast() {
  return useContext(ToastContext)
}
