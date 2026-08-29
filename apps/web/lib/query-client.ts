import { QueryClient } from "@tanstack/react-query";

/**
 * Cashmemo keeps authenticated data in React Query memory only. Every protected request belongs
 * to this client, so replacing its state is the privacy boundary used by logout and restricted
 * access transitions.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 0,
        gcTime: 0,
        retry: false,
        refetchOnWindowFocus: false,
      },
    },
  });
}

/** Cancel transport, then remove all private state before navigation. */
export async function clearPrivateQueryState(queryClient: QueryClient): Promise<void> {
  // cancelQueries aborts axios/fetch signals. clear immediately detaches observers and removes the
  // query objects, so even a non-cooperative late promise cannot repopulate this client.
  const cancellation = queryClient.cancelQueries();
  queryClient.clear();
  await cancellation;
}
