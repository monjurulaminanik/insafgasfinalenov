import { useRef } from "react";
import { Link } from "@tanstack/react-router";
import { Card, CardContent } from "@/components/ui/card";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { gsap, prefersReducedMotion } from "@/lib/gsap";

type StatLink =
  string | { to: string; params?: Record<string, string>; search?: Record<string, unknown> };

export function StatCard({
  title,
  value,
  icon: Icon,
  hint,
  tone = "default",
  to,
}: {
  title: string;
  value: string;
  icon: LucideIcon;
  hint?: string;
  tone?: "default" | "positive" | "warning" | "danger" | "info";
  to?: StatLink;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const toneMap = {
    default: "bg-primary/10 text-primary",
    positive: "bg-success/15 text-success",
    warning: "bg-warning/20 text-warning-foreground",
    danger: "bg-destructive/10 text-destructive",
    info: "bg-info/15 text-info",
  } as const;

  const onEnter = () => {
    if (!to || prefersReducedMotion() || !cardRef.current) return;
    gsap.to(cardRef.current, { y: -4, duration: 0.28, ease: "power2.out", overwrite: "auto" });
  };
  const onLeave = () => {
    if (!to || prefersReducedMotion() || !cardRef.current) return;
    gsap.to(cardRef.current, { y: 0, duration: 0.35, ease: "power3.out", overwrite: "auto" });
  };

  const body = (
    <Card
      ref={cardRef}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      className={cn(
        "relative h-full overflow-hidden border-border/60 shadow-sm will-change-transform",
        to && "cursor-pointer hover:border-primary/40 hover:shadow-md",
      )}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-primary/60 via-primary/30 to-transparent" />
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {title}
            </p>
            <p className="mt-1.5 text-xl font-bold tracking-tight sm:text-2xl">{value}</p>
            {hint && <p className="mt-1 truncate text-xs text-muted-foreground">{hint}</p>}
          </div>
          <div
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
              toneMap[tone],
            )}
          >
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );

  if (!to) return body;

  if (typeof to === "string") {
    return (
      <Link
        to={to as "/"}
        className="block h-full outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-xl"
      >
        {body}
      </Link>
    );
  }

  return (
    <Link
      to={to.to as "/"}
      params={to.params as never}
      search={to.search as never}
      className="block h-full outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-xl"
    >
      {body}
    </Link>
  );
}
