import { Link } from "@tanstack/react-router";
import { Card, CardContent } from "@/components/ui/card";
import { formatCurrency, formatCompactCurrency } from "@/utils/formatters";
import { ShoppingCart, Truck, Receipt, TrendingUp, TrendingDown, ArrowUpRight } from "lucide-react";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";

export type FinancialSummaryCardsProps = {
  salesRevenue: number;
  salesCount: number;
  grossSales?: number;
  purchasesNet: number;
  purchasesCount: number;
  returnsCount?: number;
  returnsTotal?: number;
  expensesTotal: number;
  expensesCount: number;
  netProfit: number;
  cogs: number;
  grossProfit: number;
};

export function FinancialSummaryCards({
  salesRevenue,
  salesCount,
  purchasesNet,
  purchasesCount,
  returnsTotal = 0,
  expensesTotal,
  expensesCount,
  netProfit,
  cogs,
}: FinancialSummaryCardsProps) {
  const t = useT();

  const isProfit = netProfit >= 0;
  const marginPct =
    salesRevenue > 0 ? ((netProfit / salesRevenue) * 100).toFixed(1) : undefined;

  const cards = [
    {
      id: "sales",
      title: t("dash.totalSales") || "TOTAL SALES",
      value: formatCurrency(salesRevenue),
      subtitle: `${salesCount} ${t("dash.approvedInvoices") || "Approved invoices"}`,
      icon: ShoppingCart,
      iconBg: "bg-[#2563eb] text-white shadow-blue-500/20",
      valueClass: "text-foreground",
      to: "/sales" as const,
      badgeText: "↗ Active",
      badgeTone: "bg-blue-500/10 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400",
      testId: "financial-card-sales",
    },
    {
      id: "purchases",
      title: t("dash.totalPurchases") || "TOTAL PURCHASES",
      value: formatCurrency(purchasesNet),
      subtitle: `${purchasesCount} ${t("dash.activePurchases") || "Purchase orders"}${returnsTotal > 0 ? ` · -${formatCompactCurrency(returnsTotal)} ret.` : ""}`,
      icon: Truck,
      iconBg: "bg-gradient-to-br from-amber-500 to-orange-500 text-white shadow-amber-500/20",
      valueClass: "text-foreground",
      to: "/purchases" as const,
      badgeText: `${purchasesCount} POs`,
      badgeTone: "bg-amber-500/10 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400",
      testId: "financial-card-purchases",
    },
    {
      id: "expenses",
      title: t("dash.totalExpenses") || "TOTAL EXPENSES",
      value: formatCurrency(expensesTotal),
      subtitle: `${expensesCount} ${t("dash.operatingExpenses") || "Operating expenses"}`,
      icon: Receipt,
      iconBg: "bg-gradient-to-br from-purple-600 to-violet-600 text-white shadow-purple-500/20",
      valueClass: "text-foreground",
      to: "/expenses" as const,
      badgeText: "Operating",
      badgeTone: "bg-purple-500/10 text-purple-600 dark:bg-purple-500/20 dark:text-purple-400",
      testId: "financial-card-expenses",
    },
    {
      id: "profit",
      title: t("dash.netProfitLoss") || "NET PROFIT / LOSS",
      value: `${netProfit < 0 ? "-" : ""}${formatCurrency(Math.abs(netProfit))}`,
      subtitle: `${isProfit ? t("dash.netProfit") || "Net Profit" : t("dash.netLoss") || "Net Loss"}${cogs > 0 ? ` · COGS: ${formatCompactCurrency(cogs)}` : ""}`,
      icon: isProfit ? TrendingUp : TrendingDown,
      iconBg: isProfit
        ? "bg-gradient-to-br from-emerald-600 to-teal-500 text-white shadow-emerald-500/20"
        : "bg-gradient-to-br from-rose-600 to-red-500 text-white shadow-rose-500/20",
      valueClass: isProfit
        ? "text-emerald-600 dark:text-emerald-400"
        : "text-rose-600 dark:text-rose-400",
      to: "/reports" as const,
      badgeText: marginPct !== undefined ? `↗ ${marginPct}% ${t("dash.margin") || "margin"}` : isProfit ? "↗ Profitable" : "↘ Deficit",
      badgeTone: isProfit
        ? "bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400"
        : "bg-rose-500/10 text-rose-600 dark:bg-rose-500/20 dark:text-rose-400",
      testId: "financial-card-profit",
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 sm:gap-4">
      {cards.map((c) => {
        const Icon = c.icon;
        return (
          <div key={c.id} data-reveal data-testid={c.testId} className="h-full">
            <Card className="group relative flex h-full flex-col justify-between overflow-hidden rounded-2xl border border-border/70 bg-card p-4 sm:p-5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md">
              <div>
                {/* Header Row: Title & Category Icon */}
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    {c.title}
                  </p>
                  <div
                    className={cn(
                      "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl shadow-sm transition-transform duration-200 group-hover:scale-105 sm:h-10 sm:w-10",
                      c.iconBg,
                    )}
                  >
                    <Icon className="h-4 w-4 sm:h-5 sm:w-5" />
                  </div>
                </div>

                {/* Amount Row: Full width of card, NO truncation, NO line break of negative sign */}
                <div className="mt-2 min-w-0">
                  <p
                    className={cn(
                      "font-bold tracking-tight tabular-nums leading-none whitespace-nowrap",
                      // Adaptive responsive font sizing to fit large monetary figures cleanly on any screen
                      c.value.length > 13
                        ? "text-base sm:text-lg lg:text-base xl:text-xl"
                        : c.value.length > 10
                          ? "text-lg sm:text-xl lg:text-[1.2rem] xl:text-[1.65rem]"
                          : "text-xl sm:text-2xl lg:text-xl xl:text-3xl",
                      c.valueClass,
                    )}
                  >
                    {c.value}
                  </p>
                  <p className="mt-1.5 text-xs text-muted-foreground truncate">
                    {c.subtitle}
                  </p>
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between border-t border-border/50 pt-3 text-xs">
                <Link
                  to={c.to}
                  className="inline-flex items-center gap-1 font-medium text-muted-foreground transition-colors hover:text-primary"
                >
                  <span>{t("dash.viewAll")}</span>
                  <ArrowUpRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                </Link>
                <span
                  className={cn(
                    "inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums",
                    c.badgeTone,
                  )}
                >
                  {c.badgeText}
                </span>
              </div>
            </Card>
          </div>
        );
      })}
    </div>
  );
}
