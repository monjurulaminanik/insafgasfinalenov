import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { productService } from "@/services/product.service";
import { inventoryService } from "@/services/inventory.service";
import { ProductImage } from "@/components/common/ProductImage";
import { formatCurrency, formatDate } from "@/utils/formatters";
import { buildStockReport } from "@/lib/stock-report";
import type { DateRange } from "@/lib/date-range";
import { useT } from "@/i18n";

export function StockReport({ range }: { range: DateRange }) {
  const t = useT();
  const { data: products = [], isLoading: loadingProducts } = useQuery({
    queryKey: ["products"],
    queryFn: productService.list,
  });
  const { data: movements = [], isLoading: loadingMoves } = useQuery({
    queryKey: ["stockMovements"],
    queryFn: inventoryService.listMovements,
  });

  const rows = useMemo(
    () => buildStockReport(products, movements, range),
    [products, movements, range],
  );

  if (loadingProducts || loadingMoves) {
    return <p className="py-8 text-center text-sm text-muted-foreground">{t("common.loading")}</p>;
  }

  if (rows.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">{t("common.noRecords")}</p>
    );
  }

  return (
    <div className="space-y-5">
      <p className="no-print text-xs text-muted-foreground">{t("reports.stockHint")}</p>
      {rows.map((p) => (
        <section key={p.id} className="overflow-hidden rounded-xl border">
          <div className="grid grid-cols-2 gap-3 border-b bg-muted/40 p-3 sm:grid-cols-6 sm:items-center">
            <div className="col-span-2 flex min-w-0 items-center gap-2.5 sm:col-span-1">
              <ProductImage
                src={products.find((x) => x.id === p.id)?.image}
                alt={p.name}
                size="sm"
              />
              <div className="min-w-0">
                <Link
                  to="/products/$id"
                  params={{ id: p.id }}
                  className="block truncate font-semibold hover:text-primary hover:underline"
                >
                  {p.name}
                </Link>
                <p className="font-mono text-[10px] text-muted-foreground">{p.code}</p>
              </div>
            </div>
            <Stat label={t("reports.stockIn")} value={String(p.qtyIn)} />
            <Stat label={t("reports.stockOut")} value={String(p.qtyOut)} />
            <Stat label={t("reports.inHand")} value={String(p.inHand)} emphasize />
            <Stat label={t("reports.unitCost")} value={formatCurrency(p.unitCost)} />
            <Stat label={t("reports.valuation")} value={formatCurrency(p.valuation)} emphasize />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-card text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 font-medium">{t("common.date")}</th>
                  <th className="px-3 py-2 font-medium">{t("statement.particulars")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("reports.stockIn")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("reports.stockOut")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("reports.inHand")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("reports.unitCost")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("reports.valuation")}</th>
                </tr>
              </thead>
              <tbody>
                {p.lines.map((line) => (
                  <tr key={line.id} className="border-b last:border-0">
                    <td className="whitespace-nowrap px-3 py-2 text-xs">{formatDate(line.date)}</td>
                    <td className="px-3 py-2">
                      {line.particulars === "Opening" ? t("statement.opening") : line.particulars}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{line.qtyIn || "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{line.qtyOut || "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium">{line.inHand}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatCurrency(line.unitCost)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium">
                      {formatCurrency(line.valuation)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}

function Stat({ label, value, emphasize }: { label: string; value: string; emphasize?: boolean }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className={emphasize ? "font-display text-sm font-semibold" : "text-sm font-medium"}>
        {value}
      </p>
    </div>
  );
}
