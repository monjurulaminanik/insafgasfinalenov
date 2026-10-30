import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import type { AuthUser } from "@/types";

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 60_000 },
    },
  });

  const router = createRouter({
    routeTree,
    context: {
      queryClient,
      user: null as AuthUser | null,
    },
    scrollRestoration: true,
    defaultPreloadStaleTime: 60_000,
  });

  return router;
};
