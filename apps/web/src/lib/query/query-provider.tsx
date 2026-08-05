"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

import { AccountSessionProvider } from "@/lib/auth/session";

export function QueryProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
            staleTime: 0,
            gcTime: 5 * 60 * 1000,
            refetchOnWindowFocus: true,
          },
          mutations: { retry: false },
        },
      }),
  );

  return (
    <QueryClientProvider client={client}>
      <AccountSessionProvider queryClient={client}>
        {children}
      </AccountSessionProvider>
    </QueryClientProvider>
  );
}
