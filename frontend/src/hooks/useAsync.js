import { useCallback, useEffect, useRef, useState } from 'react'
import { EVENTS } from '../utils/constants.js'

/**
 * Runs an async function and tracks its result.
 *
 *   const { data, error, loading, reload, setData } = useAsync(() => claimsApi.getClaim(id), [id])
 *
 * - Re-runs whenever a value in `deps` changes (compared with Object.is).
 * - Ignores responses from superseded calls, so fast filter changes never show stale data.
 * - Keeps the previous `data` while reloading; `loading` is true until the new call settles.
 * - Pass `{ immediate: false }` to start idle and call `reload()` yourself.
 * - A 401 from the API broadcasts `expenseflow:unauthorized` so the AuthProvider signs out.
 *
 * @template T
 * @param {() => Promise<T>} fn
 * @param {unknown[]} [deps]
 * @param {{immediate?: boolean}} [options]
 * @returns {{data: T|undefined, error: any, loading: boolean, reload: () => Promise<T|undefined>, setData: Function}}
 */
export function useAsync(fn, deps = [], options = {}) {
  const { immediate = true } = options
  const fnRef = useRef(fn)
  const callId = useRef(0)
  const mounted = useRef(true)
  const [state, setState] = useState({ data: undefined, error: null, loading: immediate })

  useEffect(() => {
    fnRef.current = fn
  })

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  // Starts a call without touching state synchronously (the caller marks `loading`).
  const execute = useCallback(() => {
    const id = ++callId.current
    let promise
    try {
      promise = Promise.resolve(fnRef.current())
    } catch (err) {
      promise = Promise.reject(err)
    }
    return promise.then(
      (data) => {
        if (mounted.current && id === callId.current) setState({ data, error: null, loading: false })
        return data
      },
      (error) => {
        if (error && error.status === 401) {
          window.dispatchEvent(new CustomEvent(EVENTS.unauthorized))
        }
        if (mounted.current && id === callId.current) setState((s) => ({ ...s, error, loading: false }))
        return undefined
      },
    )
  }, [])

  const reload = useCallback(() => {
    setState((s) => (s.loading && !s.error ? s : { ...s, loading: true, error: null }))
    return execute()
  }, [execute])

  // When deps change, flip to loading in the same render (no flash of stale "loaded" UI).
  const [prevDeps, setPrevDeps] = useState(deps)
  const [version, setVersion] = useState(0)
  const depsChanged = prevDeps.length !== deps.length || prevDeps.some((d, i) => !Object.is(d, deps[i]))
  if (depsChanged) {
    // Adjusting state while rendering: React's documented pattern for resets derived from props.
    setPrevDeps(deps)
    setVersion((v) => v + 1)
    setState((s) => ({ ...s, loading: true, error: null }))
  }

  useEffect(() => {
    if (immediate || version > 0) execute()
  }, [version, immediate, execute])

  const setData = useCallback((updater) => {
    setState((s) => ({ ...s, data: typeof updater === 'function' ? updater(s.data) : updater }))
  }, [])

  return { data: state.data, error: state.error, loading: state.loading, reload, setData }
}
