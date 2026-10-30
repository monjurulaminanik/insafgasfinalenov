import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";

type BackLink = string | { to: string; params?: Record<string, string> };

export function PageHeader({
  title,
  description,
  actions,
  backTo,
  backLabel,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  backTo?: BackLink;
  backLabel?: string;
}) {
  const t = useT();
  const label = backLabel ?? t("common.back");

  return (
    <div className="page-header mb-5 space-y-3 no-print sm:mb-6">
      {backTo && (
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2 h-8 gap-1.5 px-2 text-muted-foreground"
          asChild
        >
          {typeof backTo === "string" ? (
            <Link to={backTo as "/"}>
              <ArrowLeft className="h-3.5 w-3.5" />
              {label}
            </Link>
          ) : (
            <Link to={backTo.to as "/"} params={backTo.params as never}>
              <ArrowLeft className="h-3.5 w-3.5" />
              {label}
            </Link>
          )}
        </Button>
      )}
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 sm:flex sm:flex-wrap sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="font-display truncate text-xl font-semibold tracking-tight sm:text-2xl">
            {title}
          </h1>
          {description && (
            <p className="mt-1 line-clamp-2 text-xs font-medium text-muted-foreground sm:text-sm">
              {description}
            </p>
          )}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
