import { useContext } from 'react'
import { AuthContext } from './authContext.js'

/**
 * const { user, roles, activeRole, isAuthenticated, login, logout, switchRole } = useAuth()
 */
export function useAuth() {
  return useContext(AuthContext)
}
