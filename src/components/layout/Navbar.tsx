import { useRouteContext } from "@tanstack/react-router";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Bell, Languages, LogOut, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { BrandLogo } from "@/components/common/BrandLogo";
import { NotificationsDropdown } from "./NotificationsDropdown";
import { logoutFn } from "@/lib/auth.functions";
import { useI18n } from "@/i18n";

export function Navbar() {
  const { user } = useRouteContext({ from: "__root__" });
  const { locale, setLocale, t } = useI18n();

  const onLogout = async () => {
    try {
      await logoutFn();
      toast.success(t("login.signedOut"));
      // Hard navigation avoids stale layout/provider tree after session clear.
      window.location.assign("/login?redirect=%2F");
    } catch (e: any) {
      toast.error(e?.message || t("login.failed"));
    }
  };

  const toggleLocale = () => setLocale(locale === "bn" ? "en" : "bn");

  return (
    <header className="app-navbar sticky top-0 z-20 flex h-14 items-center gap-2 border-b px-3 backdrop-blur-xl sm:px-4">
      <SidebarTrigger />
      <div className="ml-1 flex min-w-0 items-center gap-2">
        <BrandLogo size="sm" className="block shrink-0" />
        <div className="flex min-w-0 flex-col leading-tight">
          <span className="font-display truncate text-sm font-semibold tracking-tight">
            {t("brand.name")}
          </span>
          <span className="hidden text-[11px] font-medium tracking-[0.08em] text-muted-foreground sm:block">
            {t("brand.tagline")}
          </span>
        </div>
      </div>
      <div className="ml-auto flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          className="h-9 gap-1.5 px-2.5 text-xs font-semibold"
          onClick={toggleLocale}
          title={t("common.language")}
        >
          <Languages className="h-3.5 w-3.5" />
          <span>{locale === "bn" ? "EN" : "বাং"}</span>
        </Button>
        <NotificationsDropdown />
        <div className="hidden items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground sm:flex">
          <User className="h-3.5 w-3.5" />
          <span className="font-medium text-foreground">{user?.displayName ?? "Operator"}</span>
          {user?.role && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px]">{user.role}</span>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9"
          onClick={onLogout}
          title={t("common.signOut")}
        >
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
    </header>
  );
}
