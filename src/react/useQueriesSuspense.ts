import React from 'react'

import {
  notifyManager,
  QueriesObserver,
  useQueryClient,
  useQueryErrorResetBoundary,
} from 'react-query'
import { QueriesOptions, QueriesResults } from './useQueries';

export function useQueries<T extends any[]>(
  queries: readonly [...QueriesOptions<T>]
): QueriesResults<T> {
  console.log([
    '######################################################',
    '##################### useQueries #####################',
    '######################################################',
  ].join('\n'))
  const mountedRef = React.useRef(false)
  const [, forceUpdate] = React.useState(0)

  const queryClient = useQueryClient()
  const errorResetBoundary = useQueryErrorResetBoundary()

  const defaultedQueries = queries.map(options => {
    const defaultedOptions = queryClient.defaultQueryObserverOptions(options)

    // Make sure the results are already in fetching state before subscribing or updating options
    defaultedOptions.optimisticResults = true
    return defaultedOptions;
  });

  // Make suspense and useErrorBoundary the same for all queries
  // TODO: allow & handle mixed values
  const isSuspense = defaultedQueries.some(q => q.suspense)
  const isUseErrorBoundary = defaultedQueries.some(q => q.useErrorBoundary)

  defaultedQueries.forEach((defaultedOptions) => {
    if (isSuspense) {
      defaultedOptions.suspense = true;
    }
    if (isUseErrorBoundary) {
      defaultedOptions.useErrorBoundary = true;
    }

    if (defaultedOptions.suspense) {
      // Always set stale time when using suspense to prevent
      // fetching again when directly mounting after suspending
      // TODO: what if one query is very slow and 1000 is not enough? this isn't a great mechanism...
      if (typeof defaultedOptions.staleTime !== 'number') {
        // defaultedOptions.staleTime = Infinity
        defaultedOptions.staleTime = 1000
      }
      defaultedOptions.refetchOnMount = false;
    }

    if (defaultedOptions.suspense || defaultedOptions.useErrorBoundary) {
      // Prevent retrying failed query if the error boundary has not been reset yet
      if (!errorResetBoundary.isReset()) {
        defaultedOptions.retryOnMount = false
      }
    }

    return defaultedOptions
  })

  const [observer] = React.useState(() =>
    new QueriesObserver(queryClient, defaultedQueries)
  );

  const result = observer.getOptimisticResult(defaultedQueries)
  console.log('useQueries :: optimisticResult', defaultedQueries.map((q, i) => ({ key: q.queryKey, status: result[i]!.status })))


  React.useEffect(() => {
    // Do not notify on updates because of changes in the options because
    // these changes should already be reflected in the optimistic result.
    observer.setQueries(defaultedQueries, { listeners: false })
  }, [defaultedQueries])

  // TODO: should "first" mean chronologically first? as in
  //   minBy(result.filter(r => r.isError), (r) => r.errorUpdatedAt)
  const firstResultWithError = result.find(r => r.isError)
  const someError = firstResultWithError?.error
  const someIsLoading = result.some(r => r.isLoading)

  React.useEffect(() => {
    mountedRef.current = true
    console.log('mounting >>>>>>')
    const unsubscribe = observer.subscribe(
      notifyManager.batchCalls(() => {
        // TODO: will this trigger an unnecessary rerender
        // if we suspend after mount?
        if (mountedRef.current) {
          console.log('useQueries :: observer notifiation - forcing update')
          forceUpdate(x => x + 1)
        }
      })
    )

    return () => {
      console.log('unmounting <<<<<<<')
      mountedRef.current = false
      unsubscribe()
    }
  }, [])

  type DoFetch = (observer: QueriesObserver) => ReturnType<QueriesObserver['fetchOptimistic']>
  const suspend = (doFetch: DoFetch) => {
    console.log('useQueries :: suspending', defaultedQueries.map((q, i) => ({ key: q.queryKey, status: result[i]!.status})))
    const unsubscribe = observer.subscribe()
    const promise = doFetch(observer).then((partialResults) => {
      console.log('useQueries :: promise done. partialResults', partialResults.map((r) => r && r.status))
      partialResults.forEach((settledRes, i) => {
        const defaultedQuery = defaultedQueries[i]!;
        if (settledRes.status === 'fulfilled') {
          const res = settledRes.value;
          if (res === null) {
            // Wasn't fetched, no need to update anything
            return;
          }
          defaultedQuery.onSuccess?.(res.data);
          defaultedQuery.onSettled?.(res.data, undefined)
        } else if (settledRes.status === 'rejected') {
          const error = settledRes.reason;
          errorResetBoundary.clearReset();
          defaultedQuery.onError?.(error);
          defaultedQuery.onSettled?.(undefined, error)
        }
      })
    })
    .catch((err) => console.log('useQueries :: caught from suspension promise', err))
    .finally(unsubscribe);
    throw promise;
  }

  // Handle suspense and error boundaries
  if (isSuspense || isUseErrorBoundary) {
    if (someError) {
      if (errorResetBoundary.isReset()) {
        console.log('useQueries :: refetching (error boundary reset)')
        suspend((observer) => observer.fetchOptimistic(defaultedQueries));
      } else {
        console.log('useQueries :: throwing error')
        errorResetBoundary.clearReset();
        throw someError;
      }
    }

    if (isSuspense && someIsLoading) {
      console.log('useQueries :: fetching')
      suspend((observer) => observer.fetchOptimistic(defaultedQueries));
    }
  }

  return result as QueriesResults<T>
}
