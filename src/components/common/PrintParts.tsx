import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n";

export function PrintSignatures({
  left,
  right,
  className,
}: {
  left?: string;
  right?: string;
  className?: string;
}) {
  const t = useT();
  return (
    <div
      className={cn(
        "print-signatures mt-12 flex justify-between gap-8 px-2 pt-4 print:mt-4 print:gap-4 print:pt-2",
        className,
      )}
    >
      <div className="w-40 border-t border-foreground/40 pt-2 text-center text-xs">
        {left ?? t("doc.authorizedSign")}
      </div>
      <div className="w-40 border-t border-foreground/40 pt-2 text-center text-xs">
        {right ?? t("doc.receivedBy")}
      </div>
    </div>
  );
}

export function PrintMeta({
  items,
  className,
}: {
  items: Array<{ label: string; value: ReactNode }>;
  className?: string;
}) {
  return (
    <div className={cn("grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3", className)}>
      {items.map((item) => (
        <div key={item.label} className="print-avoid-break">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {item.label}
          </p>
          <div className="mt-0.5 font-medium">{item.value || "—"}</div>
        </div>
      ))}
    </div>
  );
}

export function PrintTotals({
  rows,
  className,
}: {
  rows: Array<{ label: string; value: string; bold?: boolean }>;
  className?: string;
}) {
  return (
    <div className={cn("print-avoid-break ml-auto w-full max-w-xs space-y-1 text-sm", className)}>
      {rows.map((row) => (
        <div
          key={row.label}
          className={cn("flex justify-between gap-4", row.bold && "border-t pt-1 font-semibold")}
        >
          <span>{row.label}</span>
          <span className="tabular-nums">{row.value}</span>
        </div>
      ))}
    </div>
  );
}
