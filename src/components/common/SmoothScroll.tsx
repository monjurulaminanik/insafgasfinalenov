import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import Lenis from "lenis";
import { useRouterState } from "@tanstack/react-router";
import { gsap, prefersReducedMotion, ScrollTrigger } from "@/lib/gsap";

type SmoothScrollApi = {
  scrollTo: (
    target?: number | string | HTMLElement,
    opts?: { immediate?: boolean; offset?: number },
  ) => void;
  stop: () => void;
  start: () => void;
};

const SmoothScrollContext = createContext<SmoothScrollApi>({
  scrollTo: () => {},
  stop: () => {},
  start: () => {},
});

export function useSmoothScroll() {
  return useContext(SmoothScrollContext);
}

export function SmoothScrollProvider({ children }: { children: ReactNode }) {
  const lenisRef = useRef<Lenis | null>(null);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isLogin = pathname === "/login";

  useEffect(() => {
    if (typeof window === "undefined" || isLogin) return;
    if (prefersReducedMotion()) {
      document.documentElement.classList.add("scroll-smooth");
      return () => document.documentElement.classList.remove("scroll-smooth");
    }

    const lenis = new Lenis({
      duration: 1.2,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
      touchMultiplier: 1.35,
      wheelMultiplier: 0.85,
      autoRaf: false,
      syncTouch: false,
    });
    lenisRef.current = lenis;

    lenis.on("scroll", ScrollTrigger.update);

    const tick = (time: number) => {
      lenis.raf(time * 1000);
    };
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);

    document.documentElement.classList.add("lenis", "lenis-smooth");

    return () => {
      gsap.ticker.remove(tick);
      lenis.destroy();
      lenisRef.current = null;
      document.documentElement.classList.remove("lenis", "lenis-smooth");
    };
  }, [isLogin]);

  const scrollTo = useCallback(
    (
      target: number | string | HTMLElement = 0,
      opts?: { immediate?: boolean; offset?: number },
    ) => {
      const lenis = lenisRef.current;
      if (lenis) {
        lenis.scrollTo(target, {
          immediate: opts?.immediate ?? false,
          offset: opts?.offset ?? 0,
          force: true,
        });
        return;
      }
      if (typeof window === "undefined") return;
      if (typeof target === "number") {
        window.scrollTo({
          top: target,
          behavior: opts?.immediate || prefersReducedMotion() ? "auto" : "smooth",
        });
      }
    },
    [],
  );

  const stop = useCallback(() => lenisRef.current?.stop(), []);
  const start = useCallback(() => lenisRef.current?.start(), []);

  // Soft reset to top on navigation (skip login — it manages its own scroll)
  useEffect(() => {
    if (isLogin) return;
    scrollTo(0, { immediate: prefersReducedMotion() });
    requestAnimationFrame(() => ScrollTrigger.refresh());
  }, [pathname, scrollTo, isLogin]);

  const api = useMemo(() => ({ scrollTo, stop, start }), [scrollTo, stop, start]);

  return <SmoothScrollContext.Provider value={api}>{children}</SmoothScrollContext.Provider>;
}
