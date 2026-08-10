import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";

import { createApi } from "./api-client.js";
import { AuthRoutes } from "../features/auth/AuthRoutes.js";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

const api = createApi();

export function AppRouter() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="*" element={<AuthRoutes api={api} />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
