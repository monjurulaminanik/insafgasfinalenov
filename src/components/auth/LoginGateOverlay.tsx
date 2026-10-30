import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { BrandLogo } from "@/components/common/BrandLogo";
import { gsap, prefersReducedMotion } from "@/lib/gsap";
import { useT } from "@/i18n";

type Phase = "auth" | "open" | "done";

export function LoginGateOverlay({
  active,
  displayName,
  role,
  onComplete,
}: {
  active: boolean;
  displayName: string;
  role?: string;
  onComplete: () => void;
}) {
  const t = useT();
  const [phase, setPhase] = useState<Phase>("auth");
  const rootRef = useRef<HTMLDivElement>(null);
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useLayoutEffect(() => {
    if (!active) {
      setPhase("auth");
      return;
    }

    const root = rootRef.current;
    const left = leftRef.current;
    const right = rightRef.current;
    const bar = barRef.current;
    const content = contentRef.current;
    if (!root || !left || !right || !bar || !content) return;

    if (prefersReducedMotion()) {
      setPhase("open");
      gsap.set(bar, { width: "100%" });
      const id = window.setTimeout(() => {
        setPhase("done");
        onCompleteRef.current();
      }, 200);
      return () => clearTimeout(id);
    }

    setPhase("auth");
    const ctx = gsap.context(() => {
      gsap.set([left, right], { xPercent: 0 });
      gsap.set(bar, { width: "8%" });
      gsap.set(content, { opacity: 0, scale: 0.92, y: 12 });

      const tl = gsap.timeline({
        defaults: { ease: "power3.inOut" },
        onComplete: () => {
          setPhase("done");
          onCompleteRef.current();
        },
      });

      tl.to(content, { opacity: 1, scale: 1, y: 0, duration: 0.45, ease: "power3.out" }, 0)
        .to(bar, { width: "48%", duration: 0.45 }, 0.15)
        .add(() => setPhase("open"), 0.7)
        .to(left, { xPercent: -102, duration: 0.75 }, 0.7)
        .to(right, { xPercent: 102, duration: 0.75 }, 0.7)
        .to(bar, { width: "100%", duration: 0.4 }, 0.85)
        .to(content, { opacity: 0, y: -10, duration: 0.3 }, 1.35)
        .to(root, { opacity: 0, duration: 0.25 }, 1.5);
    }, root);

    return () => ctx.revert();
  }, [active]);

  useEffect(() => {
    if (!active) setPhase("auth");
  }, [active]);

  if (!active) return null;

  return (
    <div
      ref={rootRef}
      className="login-gate-overlay fixed inset-0 z-[100] flex items-center justify-center overflow-hidden"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="login-gate-bg absolute inset-0" />
      <div className="login-gate-scan absolute inset-0 opacity-40" />

      <div
        ref={leftRef}
        className="login-gate-panel login-gate-panel-left absolute inset-y-0 left-0 w-1/2 border-r border-emerald-500/20"
      />
      <div
        ref={rightRef}
        className="login-gate-panel login-gate-panel-right absolute inset-y-0 right-0 w-1/2 border-l border-emerald-500/20"
      />

      <div
        ref={contentRef}
        className="relative z-10 flex w-full max-w-sm flex-col items-center px-6 text-center"
      >
        <div className="login-gate-emblem relative mb-5">
          <BrandLogo size="xl" className="rounded-2xl shadow-[0_0_40px_rgba(30,58,95,0.55)]" />
          <span className="login-gate-ring absolute inset-0 rounded-2xl border border-amber-300/40" />
        </div>
        <p className="font-display text-lg font-semibold tracking-tight text-white">
          {phase === "auth" ? t("login.gateAuth") : t("login.gateOpen")}
        </p>
        <p className="mt-1 text-sm text-emerald-200/80">{displayName}</p>
        {role && (
          <span className="mt-2 rounded-full border border-white/10 bg-white/5 px-3 py-0.5 text-[10px] uppercase tracking-widest text-slate-300">
            {role}
          </span>
        )}
        <div className="login-gate-track mt-6 h-1 w-full overflow-hidden rounded-full bg-white/10">
          <div
            ref={barRef}
            className="login-gate-bar h-full rounded-full bg-gradient-to-r from-emerald-400 via-teal-300 to-emerald-500"
            style={{ width: "8%" }}
          />
        </div>
        <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.2em] text-slate-500">
          Insaf Gas Corp · ERP
        </p>
      </div>
    </div>
  );
}
