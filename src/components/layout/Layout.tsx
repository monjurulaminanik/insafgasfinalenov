import type { ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { ShieldOff } from "lucide-react";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "./Sidebar";
import { Navbar } from "./Navbar";
import { AtmosphereBackground } from "./AtmosphereBackground";
import { PageMotion } from "@/components/common/PageMotion";
import { Button } from "@/components/ui/button";
import { useModuleAccess } from "@/hooks/useModuleAccess";
import { useT } from "@/i18n";

function ModuleGate({ children }: { children: ReactNode }) {
  const t = useT();
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const { canAccessPath, isLoading } = useModuleAccess();

  if (isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">{t("common.loading")}</div>;
  }
  if (canAccessPath(pathname)) return <>{children}</>;

  return (
    <div className="mx-auto flex min-h-[50vh] max-w-md flex-col items-center justify-center gap-4 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
        <ShieldOff className="h-7 w-7 text-muted-foreground" />
      </div>
      <div>
        <h2 className="font-display text-xl font-semibold">{t("settings.accessDenied")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("settings.accessDeniedHint")}</p>
      </div>
      <Button asChild>
        <Link to="/">{t("nav.dashboard")}</Link>
      </Button>
    </div>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  return (
    <SidebarProvider>
      <div className="app-shell flex min-h-screen w-full">
        <AtmosphereBackground />
        <AppSidebar />
        <div className="app-main-panel flex min-w-0 flex-1 flex-col">
          <Navbar />
          <main className="flex-1 p-3 sm:p-5 lg:p-6">
            <PageMotion>
              <ModuleGate>{children}</ModuleGate>
            </PageMotion>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
