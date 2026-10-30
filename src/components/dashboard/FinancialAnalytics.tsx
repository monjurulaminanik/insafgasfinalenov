import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import { salesService } from "@/services/sales.service";
import { purchaseService } from "@/services/purchase.service";
import { supplierReturnService } from "@/services/supplier-return.service";
import { expenseService } from "@/services/expense.service";
import { inventoryService } from "@/services/inventory.service";
import { accountingService } from "@/services/accounting.service";
import { hrService } from "@/services/hr.service";
import { FinancialSummaryCards } from "./widgets/FinancialSummaryCards";
import { RevenueOverviewChart, type MonthlyDataPoint } from "./widgets/RevenueOverviewChart";
import {
  filterByDateRange,
  parseRecordTime,
  toDateInputValue,
  type DateRange,
} from "@/lib/date-range";
import {
  computeProfitAndLoss,
  isPostedPurchaseStatus,
  isPostedSalesStatus,
  roundMoney,
} from "@/lib/accounting-engine";
import { hasPermission } from "@/lib/rbac";

export function FinancialAnalytics({ range }: { range: DateRange }) {
  const { user } = useRouteContext({ from: "__root__" });

  // RBAC Permission check: verify user can view financial/sales metrics
  const canView =
    !user?.role ||
    hasPermission(user.role, "accounting.read") ||
    hasPermission(user.role, "sales.read");

  // Query primary financial records with React Query caching
  const { data: sales = [], isLoading: salesLoading } = useQuery({
    queryKey: ["sales"],
    queryFn: salesService.list,
    staleTime: 30_000,
  });

  const { data: purchases = [], isLoading: purchasesLoading } = useQuery({
    queryKey: ["purchases"],
    queryFn: purchaseService.list,
    staleTime: 30_000,
  });

  const { data: supplierReturns = [], isLoading: returnsLoading } = useQuery({
    queryKey: ["supplierReturns"],
    queryFn: supplierReturnService.list,
    staleTime: 30_000,
  });

  const { data: expenses = [], isLoading: expensesLoading } = useQuery({
    queryKey: ["expenses"],
    queryFn: expenseService.list,
    staleTime: 30_000,
  });

  const { data: stockMovements = [], isLoading: stockLoading } = useQuery({
    queryKey: ["stockMovements"],
    queryFn: inventoryService.listStockMovements,
    staleTime: 30_000,
  });

  const { data: vouchers = [], isLoading: vouchersLoading } = useQuery({
    queryKey: ["vouchers"],
    queryFn: accountingService.listVouchers,
    staleTime: 30_000,
  });

  const { data: payroll = [], isLoading: payrollLoading } = useQuery({
    queryKey: ["payroll"],
    queryFn: hrService.listPayroll,
    staleTime: 30_000,
  });

  const isLoading =
    salesLoading ||
    purchasesLoading ||
    returnsLoading ||
    expensesLoading ||
    stockLoading ||
    vouchersLoading ||
    payrollLoading;

  // 1. FILTERED METRICS FOR THE FOUR SUMMARY CARDS
  const financialSummary = useMemo(() => {
    // 1.1 Total Sales (Posted invoices only, excluding draft and cancelled)
    const validSalesInRange = filterByDateRange(sales, range, (r) => r.date).filter((s) =>
      isPostedSalesStatus(s.status),
    );
    const grossSales = roundMoney(validSalesInRange.reduce((acc, s) => acc + (s.total || 0), 0));
    const salesRevenue = roundMoney(
      validSalesInRange.reduce((acc, s) => acc + (s.subtotal || (s.total || 0) - (s.tax || 0)), 0),
    );

    // 1.2 Total Purchases (Posted POs minus non-cancelled supplier returns)
    const validPurchasesInRange = filterByDateRange(purchases, range, (r) => r.date).filter((p) =>
      isPostedPurchaseStatus(p.status),
    );
    const purchasesGross = roundMoney(
      validPurchasesInRange.reduce((acc, p) => acc + (p.total || 0), 0),
    );

    const validReturnsInRange = filterByDateRange(supplierReturns, range, (r) => r.date).filter(
      (r) => r.status !== "cancelled",
    );
    const returnsTotal = roundMoney(
      validReturnsInRange.reduce((acc, r) => acc + (r.total || 0), 0),
    );
    const purchasesNet = roundMoney(Math.max(0, purchasesGross - returnsTotal));

    // 1.3 Total Expenses & Net Profit/Loss via authoritative accounting engine
    const validExpensesInRange = filterByDateRange(expenses, range, (r) => r.date);
    const pnl = computeProfitAndLoss({
      sales: validSalesInRange,
      stockMovements,
      expenses: validExpensesInRange,
      payroll,
      vouchers,
      range,
    });

    // Count of operating expense items including expenses and salary disbursements
    const validSalaryVouchersInRange = filterByDateRange(vouchers, range, (r) => r.date).filter(
      (v) =>
        v.type === "payment" &&
        (v.refType === "payroll" ||
          (v.partyType === "employee" && /salary|payroll/i.test(v.notes || ""))),
    );
    const validJvsInRange = filterByDateRange(vouchers, range, (r) => r.date).filter(
      (v) =>
        v.type === "journal" &&
        v.lines?.some(
          (l) => l.debit > 0 && /expense|salary|rent|utility|fuel/i.test(l.accountName),
        ),
    );
    const expensesCount =
      validExpensesInRange.length + validSalaryVouchersInRange.length + validJvsInRange.length;

    return {
      salesRevenue: grossSales, // Display gross invoiced sales on card 1
      salesNetRevenue: salesRevenue,
      salesCount: validSalesInRange.length,
      purchasesNet,
      purchasesCount: validPurchasesInRange.length,
      returnsCount: validReturnsInRange.length,
      returnsTotal,
      expensesTotal: pnl.totalExpenses,
      expensesCount,
      cogs: pnl.cogs,
      grossProfit: pnl.grossProfit,
      netProfit: pnl.netProfit,
    };
  }, [sales, purchases, supplierReturns, expenses, stockMovements, vouchers, payroll, range]);

  // Monthly chart uses the same transaction period as the summary cards.
  const monthlyChartData = useMemo<MonthlyDataPoint[]>(() => {
    const anchor = new Date((range.to || toDateInputValue()) + "T00:00:00Z");
    const anchorYear = anchor.getUTCFullYear();
    const anchorMonth = anchor.getUTCMonth();
    const first = range.preset !== "all" && range.from ? new Date(range.from + "T00:00:00Z") : null;
    const monthCount = first
      ? Math.max(
          1,
          (anchorYear - first.getUTCFullYear()) * 12 + anchorMonth - first.getUTCMonth() + 1,
        )
      : 6;
    const monthOf = (value: string) => {
      const time = parseRecordTime(value);
      return time == null ? "" : toDateInputValue(new Date(time)).slice(0, 7);
    };
    const periodSales = filterByDateRange(sales, range, (r) => r.date);
    const periodPurchases = filterByDateRange(purchases, range, (r) => r.date);
    const periodReturns = filterByDateRange(supplierReturns, range, (r) => r.date);
    const periodExpenses = filterByDateRange(expenses, range, (r) => r.date);

    const points: MonthlyDataPoint[] = [];

    // All-time view retains six months of chart context; bounded ranges show their months.
    for (let i = monthCount - 1; i >= 0; i--) {
      const d = new Date(Date.UTC(anchorYear, anchorMonth - i, 1));
      const year = d.getUTCFullYear();
      const monthNum = String(d.getUTCMonth() + 1).padStart(2, "0");
      const monthKey = `${year}-${monthNum}`;
      const monthLabel = d.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" });

      // Sales for monthKey
      const mSales = periodSales.filter(
        (s) => isPostedSalesStatus(s.status) && monthOf(s.date || "") === monthKey,
      );
      const mSalesTotal = mSales.reduce((acc, s) => acc + (s.total || 0), 0);

      // Purchases for monthKey
      const mPurchases = periodPurchases.filter(
        (p) => isPostedPurchaseStatus(p.status) && monthOf(p.date || "") === monthKey,
      );
      const mPurchasesGross = mPurchases.reduce((acc, p) => acc + (p.total || 0), 0);
      const mReturns = periodReturns.filter(
        (r) => r.status !== "cancelled" && monthOf(r.date || "") === monthKey,
      );
      const mReturnsTotal = mReturns.reduce((acc, r) => acc + (r.total || 0), 0);
      const mPurchasesNet = Math.max(0, mPurchasesGross - mReturnsTotal);

      // Expenses for monthKey
      const mExpenses = periodExpenses.filter((e) => monthOf(e.date || "") === monthKey);
      const monthStart = monthKey + "-01";
      const monthEnd = new Date(Date.UTC(year, d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
      const monthRange: DateRange = {
        preset: "custom",
        from: range.preset !== "all" && range.from > monthStart ? range.from : monthStart,
        to: range.preset !== "all" && range.to && range.to < monthEnd ? range.to : monthEnd,
      };
      const monthlyPnl = computeProfitAndLoss({
        sales: mSales,
        stockMovements,
        expenses: mExpenses,
        vouchers,
        payroll,
        range: monthRange,
      });
      const mTotalExpenses = monthlyPnl.totalExpenses;
      const mNetProfit = monthlyPnl.netProfit;

      points.push({
        month: monthLabel,
        key: monthKey,
        sales: Math.round(mSalesTotal),
        purchases: Math.round(mPurchasesNet),
        expenses: Math.round(mTotalExpenses),
        netProfit: Math.round(mNetProfit),
      });
    }

    return points;
  }, [sales, purchases, supplierReturns, expenses, stockMovements, vouchers, payroll, range]);

  if (!canView) return null;

  return (
    <div className="space-y-4">
      {/* Exactly Four New Financial Summary Cards */}
      <FinancialSummaryCards
        salesRevenue={financialSummary.salesRevenue}
        salesCount={financialSummary.salesCount}
        purchasesNet={financialSummary.purchasesNet}
        purchasesCount={financialSummary.purchasesCount}
        returnsCount={financialSummary.returnsCount}
        returnsTotal={financialSummary.returnsTotal}
        expensesTotal={financialSummary.expensesTotal}
        expensesCount={financialSummary.expensesCount}
        netProfit={financialSummary.netProfit}
        cogs={financialSummary.cogs}
        grossProfit={financialSummary.grossProfit}
      />

      {/* Revenue Overview Chart */}
      <RevenueOverviewChart data={monthlyChartData} isLoading={isLoading} />
    </div>
  );
}
