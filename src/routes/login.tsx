import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { createFileRoute, redirect, useNavigate, useRouter } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Eye, EyeOff, Languages } from "lucide-react";
import { loginFn, getSessionFn } from "@/lib/auth.functions";
import { LoginGateOverlay } from "@/components/auth/LoginGateOverlay";
import { BrandLogo } from "@/components/common/BrandLogo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT, useI18n } from "@/i18n";
import { gsap, prefersReducedMotion } from "@/lib/gsap";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "Login · Insaf Gas Corp" }] }),
  beforeLoad: async () => {
    try {
      const session = await getSessionFn();
      if (session?.user) throw redirect({ to: "/" });
    } catch (e) {
      if (e && typeof e === "object" && "to" in e) throw e;
    }
  },
  component: LoginPage,
  validateSearch: (s: Record<string, unknown>) => ({
    redirect: typeof s.redirect === "string" ? s.redirect : "/",
  }),
});

/** Keep post-login navigate targets as same-origin paths only. */
function safeRedirectPath(raw: string | undefined) {
  if (!raw) return "/";
  try {
    if (raw.startsWith("/") && !raw.startsWith("//")) return raw;
    const url = new URL(
      raw,
      typeof window !== "undefined" ? window.location.origin : "http://localhost",
    );
    if (typeof window !== "undefined" && url.origin !== window.location.origin) return "/";
    return `${url.pathname}${url.search}${url.hash}` || "/";
  } catch {
    return "/";
  }
}

function LoginPage() {
  const t = useT();
  const { locale, setLocale } = useI18n();
  const navigate = useNavigate();
  const router = useRouter();
  const qc = useQueryClient();
  const { redirect: redirectTo } = Route.useSearch();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [gateActive, setGateActive] = useState(false);
  const [gateUser, setGateUser] = useState<{ name: string; role?: string }>({ name: "" });
  const [pendingNav, setPendingNav] = useState<string | null>(null);
  const pageRef = useRef<HTMLDivElement>(null);

  // Unlock document scroll on login (Lenis / previous pages may leave body locked)
  useLayoutEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prevHtmlOverflow = html.style.overflow;
    const prevBodyOverflow = body.style.overflow;
    const prevBodyHeight = body.style.height;
    html.classList.remove("lenis", "lenis-smooth");
    html.style.overflow = "auto";
    body.style.overflow = "auto";
    body.style.height = "auto";
    body.classList.add("login-route");
    return () => {
      html.style.overflow = prevHtmlOverflow;
      body.style.overflow = prevBodyOverflow;
      body.style.height = prevBodyHeight;
      body.classList.remove("login-route");
    };
  }, []);

  useLayoutEffect(() => {
    const root = pageRef.current;
    if (!root) return;

    // Always visible by default — never leave opacity stuck at 0
    gsap.set("[data-login-enter], [data-login-card]", { opacity: 1, clearProps: "transform" });
    if (prefersReducedMotion()) return;

    const ctx = gsap.context(() => {
      gsap.from("[data-login-enter]", {
        opacity: 0,
        y: 16,
        duration: 0.5,
        stagger: 0.08,
        ease: "power3.out",
        clearProps: "all",
      });
      gsap.from("[data-login-card]", {
        opacity: 0,
        y: 18,
        scale: 0.98,
        duration: 0.55,
        ease: "power3.out",
        clearProps: "all",
      });
    }, root);

    return () => ctx.revert();
  }, []);

  const finishGate = useCallback(async () => {
    const target = safeRedirectPath(pendingNav || redirectTo || "/");
    // Fresh session context + force dashboard queries to load after cookie is set
    await qc.invalidateQueries();
    await router.invalidate();
    await navigate({ to: target });
  }, [navigate, pendingNav, qc, redirectTo, router]);

  const scrollFieldIntoView = (el: HTMLElement | null) => {
    if (!el || typeof window === "undefined") return;
    if (window.matchMedia("(min-width: 1024px)").matches) return;
    window.setTimeout(() => el.scrollIntoView({ block: "center", behavior: "smooth" }), 120);
  };

  const doLogin = async (user: string, pass: string) => {
    setPending(true);
    try {
      const result = await loginFn({ data: { username: user, password: pass } });
      if (!result.ok) {
        toast.error(
          result.error === "Invalid username or password" ? t("login.invalid") : result.error,
        );
        return;
      }
      setGateUser({
        name: result.user.displayName || user,
        role: result.user.role,
      });
      setPendingNav(safeRedirectPath(redirectTo || "/"));
      // Do NOT router.invalidate() here — login beforeLoad would redirect mid-gate
      // and dashboard mounts without a clean query refetch.
      setGateActive(true);
    } catch (err: any) {
      toast.error(err?.message || t("login.failed"));
    } finally {
      setPending(false);
    }
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await doLogin(username, password);
  };

  return (
    <div ref={pageRef} className="login-page login-ambient relative w-full text-slate-50">
      <div className="login-grid-lines pointer-events-none absolute inset-0" />

      <div className="relative z-10 flex min-h-dvh flex-col">
        <header className="flex justify-end px-4 pt-4 sm:px-6 sm:pt-6">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 gap-1.5 border-slate-700/80 bg-slate-950/50 px-3 text-xs text-slate-200 hover:bg-slate-800"
            onClick={() => setLocale(locale === "bn" ? "en" : "bn")}
          >
            <Languages className="h-3.5 w-3.5" />
            {locale === "bn" ? "EN" : "বাং"}
          </Button>
        </header>

        <main className="flex flex-1 items-center justify-center px-4 py-8">
          <section
            data-login-card
            className="w-full max-w-[420px] rounded-3xl border border-white/10 bg-slate-950/75 p-7 shadow-2xl shadow-black/50 backdrop-blur-xl sm:p-9"
          >
            <div data-login-enter className="mb-8 flex flex-col items-center text-center">
              <BrandLogo
                size="xl"
                className="mb-4 rounded-2xl bg-white/95 p-2 shadow-lg shadow-emerald-950/40"
              />
              <h1 className="font-display text-2xl font-semibold tracking-tight text-white">
                {t("login.title")}
              </h1>
              <p className="mt-1.5 text-sm text-slate-400">{t("login.subtitle")}</p>
            </div>

            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="username" className="text-xs font-medium text-slate-300">
                  {t("login.username")}
                </Label>
                <Input
                  id="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  onFocus={(e) => scrollFieldIntoView(e.currentTarget)}
                  autoComplete="username"
                  disabled={gateActive}
                  className="h-11 border-slate-700/80 bg-slate-950/80 text-base sm:text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password" className="text-xs font-medium text-slate-300">
                  {t("login.password")}
                </Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onFocus={(e) => scrollFieldIntoView(e.currentTarget)}
                    autoComplete="current-password"
                    disabled={gateActive}
                    className="h-11 border-slate-700/80 bg-slate-950/80 pr-11 text-base sm:text-sm"
                  />
                  <button
                    type="button"
                    className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-slate-400 hover:text-slate-200"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <Button
                type="submit"
                className="mt-2 h-11 w-full bg-emerald-500 text-sm font-semibold text-slate-950 shadow-lg shadow-emerald-500/20 hover:bg-emerald-400"
                disabled={pending || gateActive}
              >
                {pending ? t("login.submitting") : t("login.submit")}
              </Button>
            </form>
          </section>
        </main>
      </div>

      <LoginGateOverlay
        active={gateActive}
        displayName={gateUser.name}
        role={gateUser.role}
        onComplete={finishGate}
      />
    </div>
  );
}
