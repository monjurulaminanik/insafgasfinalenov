import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  HeadContent,
  Scripts,
  redirect,
} from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { Toaster } from "@/components/ui/sonner";
import { Layout } from "@/components/layout/Layout";
import { getSessionFn } from "@/lib/auth.functions";
import type { AuthUser } from "@/types";

import appCss from "../styles.css?url";
import { I18nProvider, useT } from "@/i18n";
import { ThemeProvider } from "@/lib/theme";
import { BrandingProvider } from "@/lib/branding";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { SmoothScrollProvider } from "@/components/common/SmoothScroll";

/** Fallback client if route context is unavailable during a hard navigation. */
const fallbackQueryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 60_000 },
  },
});

function NotFoundComponent() {
  return (
    <I18nProvider>
      <NotFoundInner />
    </I18nProvider>
  );
}

function NotFoundInner() {
  const t = useT();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold">{t("error.404")}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{t("error.404hint")}</p>
        <div className="mt-6">
          <Link
            to="/login"
            search={{ redirect: "/" }}
            className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            {t("common.home")}
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <I18nProvider>
      <ErrorInner error={error} reset={reset} />
    </I18nProvider>
  );
}

function ErrorInner({ error, reset }: { error: Error; reset: () => void }) {
  const t = useT();
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold">{t("error.title")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("error.hint")}</p>
        {error?.message && (
          <p className="mt-3 break-words rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-left font-mono text-xs text-destructive">
            {error.message}
          </p>
        )}
        <div className="mt-6 flex justify-center gap-2">
          <button
            type="button"
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            {t("common.tryAgain")}
          </button>
          <a
            href="/login"
            className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
          >
            {t("common.home")}
          </a>
        </div>
      </div>
    </div>
  );
}

export type RouterContext = {
  queryClient: QueryClient;
  user: AuthUser | null;
};

function redirectPathFromLocation(location: {
  href: string;
  pathname: string;
  searchStr?: string;
  hash?: string;
}) {
  try {
    const url = new URL(location.href, "http://localhost");
    const path = `${url.pathname}${url.search}${url.hash}`;
    return path.startsWith("/") ? path : location.pathname || "/";
  } catch {
    return location.pathname || "/";
  }
}

export const Route = createRootRouteWithContext<RouterContext>()({
  beforeLoad: async ({ location }): Promise<{ user: AuthUser | null }> => {
    const isLogin = location.pathname === "/login";
    const isPublic =
      isLogin ||
      location.pathname.startsWith("/api/branding") ||
      location.pathname.startsWith("/api/inventory");
    const redirectTo = redirectPathFromLocation(location);
    try {
      const session = await getSessionFn();
      const user = session?.user ?? null;
      if (!user && !isPublic) {
        throw redirect({
          to: "/login",
          search: { redirect: redirectTo },
        });
      }
      return { user };
    } catch (e) {
      if (e && typeof e === "object" && "to" in e) throw e;
      // Session/Mongo failure should not block the login homepage or public endpoints.
      if (isLogin || isPublic) return { user: null };
      throw redirect({ to: "/login", search: { redirect: redirectTo } });
    }
  },
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Insaf Gas Corp ERP — Complete Gas & Cylinder Management" },
      {
        name: "description",
        content:
          "Enterprise resource planning for Insaf Gas Corp — sales, cylinders, deliveries and master data.",
      },
      { property: "og:site_name", content: "Insaf Gas Corp ERP" },
      { property: "og:type", content: "website" },
      { property: "og:title", content: "Insaf Gas Corp ERP — Complete Gas & Cylinder Management" },
      {
        property: "og:description",
        content:
          "Enterprise resource planning for Insaf Gas Corp — sales, cylinders, deliveries and master data.",
      },
      { property: "og:image", content: "/api/branding/og-image" },
      { property: "og:image:secure_url", content: "https://insafgascorp.com/api/branding/og-image" },
      { property: "og:image:alt", content: "Insaf Gas Corp ERP — Complete Gas & Cylinder Management" },
      { property: "og:url", content: "https://insafgascorp.com" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Insaf Gas Corp ERP — Complete Gas & Cylinder Management" },
      {
        name: "twitter:description",
        content:
          "Enterprise resource planning for Insaf Gas Corp — sales, cylinders, deliveries and master data.",
      },
      { name: "twitter:image", content: "/api/branding/og-image" },
      { name: "twitter:image:alt", content: "Insaf Gas Corp ERP — Complete Gas & Cylinder Management" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.png?v=4", type: "image/png" },
      { rel: "icon", href: "/favicon.ico?v=4", sizes: "any" },
      { rel: "apple-touch-icon", href: "/favicon.png?v=4" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&family=Noto+Sans+Bengali:wght@400;500;600;700&family=Outfit:wght@500;600;700&family=Sora:wght@400;500;600;700&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="bn">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const ctx = Route.useRouteContext();
  const queryClient = ctx.queryClient ?? fallbackQueryClient;
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const isLogin = pathname === "/login";
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <ThemeProvider>
          <BrandingProvider>
            <SmoothScrollProvider>
              {isLogin ? (
                <Outlet />
              ) : (
                <Layout>
                  <Outlet />
                </Layout>
              )}
              {mounted && <Toaster richColors position={isLogin ? "bottom-center" : "top-right"} />}
            </SmoothScrollProvider>
          </BrandingProvider>
        </ThemeProvider>
      </I18nProvider>
    </QueryClientProvider>
  );
}

