import { createContext } from 'react'

const noop = () => undefined
const rejectNoProvider = () => Promise.reject(new Error('AuthProvider is missing'))

/**
 * Auth state and actions. See AuthProvider for the full shape.
 * The default value describes a signed-out user so components render outside the provider.
 */
export const AuthContext = createContext({
  session: null,
  user: null,
  roles: [],
  activeRole: null,
  token: null,
  homeScreen: null,
  homePath: '/login',
  isAuthenticated: false,
  hasRole: () => false,
  loadPickerUsers: rejectNoProvider,
  login: rejectNoProvider,
  logout: noop,
  switchRole: noop,
  activateRole: noop,
})
