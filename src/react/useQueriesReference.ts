import { useQuery } from './useQuery'
import {
  QueriesOptions,
  QueriesResults,
  useQueries as useQueriesReal,
} from './useQueries'

export function useQueries<T extends any[]>(
  queries: readonly [...QueriesOptions<T>]
): QueriesResults<T> {
  if (queries.some(q => q.suspense)) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useQueriesSuspense(queries)
  } else {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useQueriesReal<T>(queries)
  }
}

export function useQueriesSuspense<T extends any[]>(
  queries: readonly [...QueriesOptions<T>]
): QueriesResults<T> {
  // Execute the queries "in parallel", see if any of them suspend or throw an error
  // (kind of like Promise.allSettled)
  const queryAttempts = queries.map(query => {
    try {
      // eslint-disable-next-line react-hooks/rules-of-hooks
      const value = useQuery({
        ...query,
        suspense: true,
        useErrorBoundary: true,
      })
      return { type: 'ready' as const, value }
    } catch (thrown) {
      if (thrown instanceof Promise) {
        return { type: 'suspended' as const, promise: thrown }
      } else {
        return { type: 'error' as const, error: thrown }
      }
    }
  })

  type Attempt = typeof queryAttempts[0]
  const didError = (a: Attempt) => a.type === 'error'
  const didSuspend = (a: Attempt) => a.type === 'suspended'

  if (queryAttempts.some(didError)) {
    // Throw the first error
    throw queryAttempts.find(didError)!.error
  } else if (queryAttempts.some(didSuspend)) {
    // Suspend until all the queries that suspended are ready
    throw Promise.all(queryAttempts.filter(didSuspend).map(a => a.promise))
  } else {
    // Everything's ready, return!
    return queryAttempts.map(a => a.value) as any
  }
}
