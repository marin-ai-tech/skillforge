import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { router } from "./app/router.tsx";
import { ApiError } from "./api/client.ts";
import { useLang } from "./i18n/index.ts";
import "./index.css";

function redirectToLoginOn401(error: unknown): void {
  if (!(error instanceof ApiError) || error.status !== 401) return;
  const path = window.location.pathname + window.location.search;
  if (path.startsWith("/login")) return;
  // me() returns null on 401 and does not throw — other queries/mutations redirect
  const next = encodeURIComponent(path || "/");
  if (window.location.pathname !== "/login") {
    window.location.assign(`/login?next=${next}`);
  }
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
      const key = query.queryKey;
      if (Array.isArray(key) && key[0] === "me") return;
      redirectToLoginOn401(error);
    },
  }),
  mutationCache: new MutationCache({
    onError: (error) => {
      redirectToLoginOn401(error);
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});

/** A language change remounts the routed app so every component reads the new dictionary. */
function LangRoot() {
  const lang = useLang();
  return <RouterProvider key={lang} router={router} />;
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <LangRoot />
      </QueryClientProvider>
    </StrictMode>,
  );
}
