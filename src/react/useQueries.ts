import React from 'react'
import { QueryFunction } from '../core/types'

import { notifyManager } from '../core/notifyManager'
import { QueriesObserver } from '../core/queriesObserver'
import { useQueryClient } from './QueryClientProvider'
import { UseQueryOptions, UseQueryResult } from './types'
import { useQueryErrorResetBoundary } from './QueryErrorResetBoundary'

// Avoid TS depth-limit error in case of large array literal
type MAXIMUM_DEPTH = 20

type GetOptions<T extends any> =
  // Part 1: responsible for applying explicit type parameter to function arguments, if object { queryFnData: TQueryFnData, error: TError, data: TData }
  T extends {
    queryFnData: infer TQueryFnData
    error?: infer TError
    data: infer TData
  }
    ? UseQueryOptions<TQueryFnData, TError, TData>
    : T extends { queryFnData: infer TQueryFnData; error?: infer TError }
    ? UseQueryOptions<TQueryFnData, TError>
    : T extends { data: infer TData; error?: infer TError }
    ? UseQueryOptions<unknown, TError, TData>
    : // Part 2: responsible for applying explicit type parameter to function arguments, if tuple [TQueryFnData, TError, TData]
    T extends [infer TQueryFnData, infer TError, infer TData]
    ? UseQueryOptions<TQueryFnData, TError, TData>
    : T extends [infer TQueryFnData, infer TError]
    ? UseQueryOptions<TQueryFnData, TError>
    : T extends [infer TQueryFnData]
    ? UseQueryOptions<TQueryFnData>
    : // Part 3: responsible for inferring and enforcing type if no explicit parameter was provided
    T extends {
        queryFn?: QueryFunction<infer TQueryFnData>
        select: (data: any) => infer TData
      }
    ? UseQueryOptions<TQueryFnData, unknown, TData>
    : T extends { queryFn?: QueryFunction<infer TQueryFnData> }
    ? UseQueryOptions<TQueryFnData>
    : // Fallback
      UseQueryOptions

type GetResults<T> =
  // Part 1: responsible for mapping explicit type parameter to function result, if object
  T extends { queryFnData: any; error?: infer TError; data: infer TData }
    ? UseQueryResult<TData, TError>
    : T extends { queryFnData: infer TQueryFnData; error?: infer TError }
    ? UseQueryResult<TQueryFnData, TError>
    : T extends { data: infer TData; error?: infer TError }
    ? UseQueryResult<TData, TError>
    : // Part 2: responsible for mapping explicit type parameter to function result, if tuple
    T extends [any, infer TError, infer TData]
    ? UseQueryResult<TData, TError>
    : T extends [infer TQueryFnData, infer TError]
    ? UseQueryResult<TQueryFnData, TError>
    : T extends [infer TQueryFnData]
    ? UseQueryResult<TQueryFnData>
    : // Part 3: responsible for mapping inferred type to results, if no explicit parameter was provided
    T extends {
        queryFn?: QueryFunction<any>
        select: (data: any) => infer TData
      }
    ? UseQueryResult<TData>
    : T extends { queryFn?: QueryFunction<infer TQueryFnData> }
    ? UseQueryResult<TQueryFnData>
    : // Fallback
      UseQueryResult

/**
 * QueriesOptions reducer recursively unwraps function arguments to infer/enforce type param
 */
export type QueriesOptions<
  T extends any[],
  Result extends any[] = [],
  Depth extends ReadonlyArray<number> = []
> = Depth['length'] extends MAXIMUM_DEPTH
  ? UseQueryOptions[]
  : T extends []
  ? []
  : T extends [infer Head]
  ? [...Result, GetOptions<Head>]
  : T extends [infer Head, ...infer Tail]
  ? QueriesOptions<[...Tail], [...Result, GetOptions<Head>], [...Depth, 1]>
  : unknown[] extends T
  ? T
  : // If T is *some* array but we couldn't assign unknown[] to it, then it must hold some known/homogenous type!
  // use this to infer the param types in the case of Array.map() argument
  T extends UseQueryOptions<infer TQueryFnData, infer TError, infer TData>[]
  ? UseQueryOptions<TQueryFnData, TError, TData>[]
  : // Fallback
    UseQueryOptions[]

/**
 * QueriesResults reducer recursively maps type param to results
 */
export type QueriesResults<
  T extends any[],
  Result extends any[] = [],
  Depth extends ReadonlyArray<number> = []
> = Depth['length'] extends MAXIMUM_DEPTH
  ? UseQueryResult[]
  : T extends []
  ? []
  : T extends [infer Head]
  ? [...Result, GetResults<Head>]
  : T extends [infer Head, ...infer Tail]
  ? QueriesResults<[...Tail], [...Result, GetResults<Head>], [...Depth, 1]>
  : T extends UseQueryOptions<infer TQueryFnData, infer TError, infer TData>[]
  ? // Dynamic-size (homogenous) UseQueryOptions array: map directly to array of results
    UseQueryResult<unknown extends TData ? TQueryFnData : TData, TError>[]
  : // Fallback
    UseQueryResult[]

export function useQueries<T extends any[]>(
  queries: readonly [...QueriesOptions<T>]
): QueriesResults<T> {
  const mountedRef = React.useRef(false)
  const [, forceUpdate] = React.useState(0)

  const queryClient = useQueryClient()
  const errorResetBoundary = useQueryErrorResetBoundary()

  const defaultedQueries = queries.map(options => {
    const defaultedOptions = queryClient.defaultQueryObserverOptions(options)

    // Make sure the results are already in fetching state before subscribing or updating options
    defaultedOptions.optimisticResults = true
    return defaultedOptions
  })

  // Make suspense and useErrorBoundary the same for all queries
  // TODO: allow & handle mixed values
  const isSuspense = defaultedQueries.some(q => q.suspense)
  const isUseErrorBoundary = defaultedQueries.some(q => q.useErrorBoundary)

  defaultedQueries.forEach(defaultedOptions => {
    if (isSuspense) {
      defaultedOptions.suspense = true
    }
    if (isUseErrorBoundary) {
      defaultedOptions.useErrorBoundary = true
    }

    if (defaultedOptions.suspense) {
      // Always set stale time when using suspense to prevent
      // fetching again when directly mounting after suspending
      // TODO: what if one query is very slow and 1000 is not enough? this isn't a great mechanism...
      if (typeof defaultedOptions.staleTime !== 'number') {
        // defaultedOptions.staleTime = Infinity
        defaultedOptions.staleTime = 1000
      }
      defaultedOptions.refetchOnMount = false
    }

    if (defaultedOptions.suspense || defaultedOptions.useErrorBoundary) {
      // Prevent retrying failed query if the error boundary has not been reset yet
      if (!errorResetBoundary.isReset()) {
        defaultedOptions.retryOnMount = false
      }
    }

    return defaultedOptions
  })

  const [observer] = React.useState(
    () => new QueriesObserver(queryClient, defaultedQueries)
  )

  const result = observer.getOptimisticResult(defaultedQueries)

  React.useEffect(() => {
    // Do not notify on updates because of changes in the options because
    // these changes should already be reflected in the optimistic result.
    observer.setQueries(defaultedQueries, { listeners: false })
  }, [observer, defaultedQueries])

  // TODO: should "first" mean chronologically first? as in
  //   minBy(result.filter(r => r.isError), (r) => r.errorUpdatedAt)
  const firstResultWithError = result.find(r => r.isError)
  const someError = firstResultWithError?.error
  const someIsLoading = result.some(r => r.isLoading)

  React.useEffect(() => {
    mountedRef.current = true
    const unsubscribe = observer.subscribe(
      notifyManager.batchCalls(() => {
        // TODO: will this trigger an unnecessary rerender
        // if we suspend after mount?
        if (mountedRef.current) {
          forceUpdate(x => x + 1)
        }
      })
    )

    return () => {
      mountedRef.current = false
      unsubscribe()
    }
  }, [observer])

  type DoFetch = (
    observer: QueriesObserver
  ) => ReturnType<QueriesObserver['fetchOptimistic']>
  const suspend = (doFetch: DoFetch) => {
    const unsubscribe = observer.subscribe()
    const promise = doFetch(observer)
      .then(partialResults => {
        partialResults.forEach((settledRes, i) => {
          const defaultedQuery = defaultedQueries[i]!
          if (settledRes.status === 'fulfilled') {
            const res = settledRes.value
            if (res === null) {
              // Wasn't fetched, no need to update anything
              return
            }
            defaultedQuery.onSuccess?.(res.data)
            defaultedQuery.onSettled?.(res.data, undefined)
          } else if (settledRes.status === 'rejected') {
            const error = settledRes.reason
            errorResetBoundary.clearReset()
            defaultedQuery.onError?.(error)
            defaultedQuery.onSettled?.(undefined, error)
          }
        })
      })
      .catch(err => console.error(err))
      .finally(unsubscribe)
    throw promise
  }

  // Handle suspense and error boundaries
  if (isSuspense || isUseErrorBoundary) {
    if (someError) {
      if (errorResetBoundary.isReset()) {
        suspend(observer => observer.fetchOptimistic(defaultedQueries))
      } else {
        errorResetBoundary.clearReset()
        throw someError
      }
    }

    if (isSuspense && someIsLoading) {
      suspend(observer => observer.fetchOptimistic(defaultedQueries))
    }
  }

  return result as QueriesResults<T>
}
