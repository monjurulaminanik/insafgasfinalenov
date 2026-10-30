import { useLayoutEffect, useRef, type DependencyList, type RefObject } from "react";
import { gsap, prefersReducedMotion } from "@/lib/gsap";

type RevealOptions = {
  y?: number;
  stagger?: number;
  duration?: number;
  delay?: number;
  /** Child selector inside the scoped root (default: "[data-reveal]") */
  selector?: string;
};

/**
 * Fade / rise reveal for a container and its `[data-reveal]` children.
 * Safe for SSR — runs only after mount; cleans up tweens on unmount.
 */
export function useGsapReveal(
  scopeRef: RefObject<HTMLElement | null>,
  deps: DependencyList = [],
  options: RevealOptions = {},
) {
  const {
    y = 18,
    stagger = 0.06,
    duration = 0.55,
    delay = 0,
    selector = "[data-reveal]",
  } = options;

  useLayoutEffect(() => {
    const root = scopeRef.current;
    if (!root) return;

    if (prefersReducedMotion()) {
      gsap.set(root.querySelectorAll(selector), { clearProps: "all", opacity: 1, y: 0 });
      return;
    }

    const ctx = gsap.context(() => {
      const targets = root.querySelectorAll(selector);
      if (!targets.length) {
        gsap.fromTo(
          root,
          { opacity: 0, y },
          { opacity: 1, y: 0, duration, delay, ease: "power3.out", clearProps: "transform" },
        );
        return;
      }

      gsap.fromTo(
        targets,
        { opacity: 0, y },
        {
          opacity: 1,
          y: 0,
          duration,
          delay,
          stagger,
          ease: "power3.out",
          clearProps: "transform",
        },
      );
    }, root);

    return () => ctx.revert();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- caller controls deps
  }, deps);
}

export function useGsapScope() {
  return useRef<HTMLDivElement>(null);
}
