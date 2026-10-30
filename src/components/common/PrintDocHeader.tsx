import type { ReactNode } from "react";
import { BrandLogo } from "@/components/common/BrandLogo";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";

/** Brand block that leads every printable invoice / bill / report. */
export function PrintDocHeader({
  title,
  subtitle,
  className,
  right,
}: {
  title?: string;
  subtitle?: string;
  className?: string;
  right?: ReactNode;
}) {
  const t = useT();
  return (
    <div
      className={cn(
        "flex flex-wrap items-start justify-between gap-4 border-b pb-4 print-doc-header",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <BrandLogo size="lg" className="rounded-lg print:block" />
        <div>
          <p className="font-display text-base font-semibold sm:text-lg">{t("brand.name")}</p>
          <p className="text-xs text-muted-foreground">{t("brand.tagline")}</p>
          {title && <p className="mt-2 text-sm font-semibold">{title}</p>}
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
        </div>
      </div>
      {right}
    </div>
  );
}
