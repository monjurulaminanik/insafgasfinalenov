import { useLayoutEffect, useRef, type ReactNode } from "react";
import { useRouterState } from "@tanstack/react-router";
import { gsap, prefersReducedMotion } from "@/lib/gsap";

/** Smooth page-content enter animation on route changes. */
export function PageMotion({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const reveals = () => el.querySelectorAll<HTMLElement>("[data-reveal]");

    const showAll = () => {
      gsap.set(el, { clearProps: "all", opacity: 1, y: 0, filter: "none" });
      gsap.set(reveals(), { clearProps: "all", opacity: 1, y: 0 });
    };

    if (prefersReducedMotion()) {
      showAll();
      return;
    }

    const ctx = gsap.context(() => {
      gsap.fromTo(
        el,
        { opacity: 0, y: 16 },
        {
          opacity: 1,
          y: 0,
          duration: 0.45,
          ease: "power4.out",
          clearProps: "all",
        },
      );

      const nodes = reveals();
      if (nodes.length) {
        gsap.fromTo(
          nodes,
          { opacity: 0, y: 12 },
          {
            opacity: 1,
            y: 0,
            duration: 0.4,
            stagger: 0.04,
            delay: 0.05,
            ease: "power3.out",
            clearProps: "all",
          },
        );
      }
    }, el);

    // Safety: if animation is interrupted, never leave content invisible
    const safety = window.setTimeout(showAll, 900);

    return () => {
      window.clearTimeout(safety);
      ctx.revert();
      showAll();
    };
  }, [pathname]);

  return (
    <div ref={ref} className="page-motion will-change-[transform,opacity]">
      {children}
    </div>
  );
}
