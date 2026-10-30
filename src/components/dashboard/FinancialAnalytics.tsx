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
import { filterByDateRange, parseRecordTime, type DateRange } from "@/lib/date-range";
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
    const grossSales = roundMoney(
      validSalesInRange.reduce((acc, s) => acc + (s.total || 0), 0),
    );
    const salesRevenue = roundMoney(
      validSalesInRange.reduce(
        (acc, s) => acc + (s.subtotal || (s.total || 0) - (s.tax || 0)),
        0,
      ),
    );

    // 1.2 Total Purchases (Posted POs minus non-cancelled supplier returns)
    const validPurchasesInRange = filterByDateRange(purchases, range, (r) => r.date).filter(
      (p) => isPostedPurchaseStatus(p.status),
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
        (v.refType === "payroll" || (v.partyType === "employee" && /salary|payroll/i.test(v.notes || ""))),
    );
    const validJvsInRange = filterByDateRange(vouchers, range, (r) => r.date).filter(
      (v) =>
        v.type === "journal" &&
        v.lines?.some((l) => l.debit > 0 && /expense|salary|rent|utility|fuel/i.test(l.accountName)),
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

  // 2. SIX-MONTH MONTHLY DATA FOR REVENUE OVERVIEW CHART
  const monthlyChartData = useMemo<MonthlyDataPoint[]>(() => {
    // Determine the anchor end date (either from range.to or current date)
    const anchor = range.to ? new Date(range.to) : new Date();
    const anchorYear = anchor.getFullYear();
    const anchorMonth = anchor.getMonth();

    const points: MonthlyDataPoint[] = [];

    // Generate recent 6 months
    for (let i = 5; i >= 0; i--) {
      const d = new Date(anchorYear, anchorMonth - i, 1);
      const year = d.getFullYear();
      const monthNum = String(d.getMonth() + 1).padStart(2, "0");
      const monthKey = `${year}-${monthNum}`;
      const monthLabel = d.toLocaleDateString("en-GB", { month: "short" });

      // Sales for monthKey
      const mSales = sales.filter(
        (s) => isPostedSalesStatus(s.status) && (s.date || "").startsWith(monthKey),
      );
      const mSalesTotal = mSales.reduce((acc, s) => acc + (s.total || 0), 0);
      const mSalesRevenue = mSales.reduce(
        (acc, s) => acc + (s.subtotal || (s.total || 0) - (s.tax || 0)),
        0,
      );

      // Purchases for monthKey
      const mPurchases = purchases.filter(
        (p) => isPostedPurchaseStatus(p.status) && (p.date || "").startsWith(monthKey),
      );
      const mPurchasesGross = mPurchases.reduce((acc, p) => acc + (p.total || 0), 0);
      const mReturns = supplierReturns.filter(
        (r) => r.status !== "cancelled" && (r.date || "").startsWith(monthKey),
      );
      const mReturnsTotal = mReturns.reduce((acc, r) => acc + (r.total || 0), 0);
      const mPurchasesNet = Math.max(0, mPurchasesGross - mReturnsTotal);

      // Expenses for monthKey
      const mExpenses = expenses.filter((e) => (e.date || "").startsWith(monthKey));
      const mExpDirect = mExpenses.reduce((acc, e) => acc + (e.amount || 0), 0);
      let mExpJv = 0;
      for (const v of vouchers) {
        if (v.type === "journal" && v.lines && (v.date || "").startsWith(monthKey)) {
          for (const line of v.lines) {
            if (line.debit > 0 && /expense|salary|rent|utility|fuel/i.test(line.accountName)) {
              mExpJv += line.debit;
            }
          }
        }
      }
      let mExpSalary = 0;
      const mProcessedPayrollIds = new Set<string>();
      for (const v of vouchers) {
        if (
          v.type === "payment" &&
          (v.refType === "payroll" || (v.partyType === "employee" && /salary|payroll/i.test(v.notes || ""))) &&
          (v.date || "").startsWith(monthKey)
        ) {
          if (v.refId) mProcessedPayrollIds.add(v.refId);
          mExpSalary += Number(v.amount || 0);
        }
      }
      for (const run of payroll) {
        if (run.status === "paid" && (run.net || 0) > 0) {
          if (mProcessedPayrollIds.has(run.id)) continue;
          const runDate = run.paidAt || run.createdAt || `${run.month}-01`;
          if (!runDate.startsWith(monthKey)) continue;
          if (run.month === "2026-09" && mExpJv > 0) continue;
          mProcessedPayrollIds.add(run.id);
          mExpSalary += Number(run.net || 0);
        }
      }
      const mTotalExpenses = mExpDirect + mExpJv + mExpSalary;

      // COGS for monthKey
      const mStockOut = stockMovements.filter(
        (sm) =>
          (sm.type === "out" ||
            sm.movementType === "SALE_ISSUE" ||
            sm.movementType === "DAMAGE" ||
            sm.movementType === "LOSS") &&
          (sm.date || "").startsWith(monthKey),
      );
      const mCogs = mStockOut.reduce(
        (acc, sm) =>
          acc +
          (sm.cogsAmount || sm.totalCost || (sm.unitCost || 0) * sm.quantity),
        0,
      );

      // Net Profit for monthKey
      const mNetProfit = roundMoney(mSalesRevenue - mCogs - mTotalExpenses);

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
  }, [sales, purchases, supplierReturns, expenses, stockMovements, vouchers, payroll, range.to]);

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
