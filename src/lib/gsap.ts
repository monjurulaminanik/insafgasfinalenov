import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger);
}

export { gsap, ScrollTrigger };

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return true;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Shared defaults for UI motion across the app. */
export function useMotionDefaults() {
  if (prefersReducedMotion()) {
    gsap.defaults({ duration: 0 });
  } else {
    gsap.defaults({
      ease: "power3.out",
      duration: 0.6,
    });
  }
}
