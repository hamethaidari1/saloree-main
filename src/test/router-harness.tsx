import type { ReactNode } from "react";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";

/**
 * Renders UI inside a minimal router so <Link> and useNavigate work in tests,
 * with a fresh React Query client (no retries) for components that query
 * (e.g. the wishlist heart). A test may still wrap `ui` in its own provider.
 */
export function renderWithRouter(ui: ReactNode, path = "/", queryClient = testQueryClient()) {
  const rootRoute = createRootRoute({ component: () => <>{ui}</> });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  return {
    router,
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    ),
  };
}

export const testQueryClient = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
