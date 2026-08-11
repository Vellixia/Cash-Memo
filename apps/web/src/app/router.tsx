import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";

import { createApi } from "./api-client.js";
import { createJournalApi } from "./journal-api.js";
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
const journalApi = createJournalApi();

export function AppRouter() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="*" element={<AuthRoutes api={api} journalApi={journalApi} />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
