import type { PayrollRun, PaymentMethod, Employee } from "../types/index.ts";

export class PayrollValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayrollValidationError";
  }
}

export interface SalaryAdvance {
  id: string;
  employeeId: string;
  employeeName: string;
  date: string;
  amount: number;
  paymentMethod: PaymentMethod;
}

export interface AdvanceSettlement {
  advanceId: string;
  amount: number;
}

export interface MonthlyPayroll extends PayrollRun {
  /** Immutable allocations recorded atomically when payment succeeds. */
  advanceSettlements?: AdvanceSettlement[];
  /** Actual cash/bank outflow; net remains earned salary after ordinary deductions. */
  cashPaid?: number;
}

export function payrollDate(value: string) {
  if (!Number.isFinite(Date.parse(value))) throw new PayrollValidationError("তারিখ সঠিক নয়");
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

export function assertPayrollMonth(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
    throw new PayrollValidationError("বেতনের মাস সঠিক নয়");
}

export function money(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER / 100)
    throw new PayrollValidationError("টাকার পরিমাণ সঠিক নয়");
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function payrollAmounts(
  input: Pick<PayrollRun, "basic" | "bonus" | "allowance" | "deduction">,
) {
  const basic = money(input.basic);
  const bonus = money(input.bonus);
  const allowance = money(input.allowance);
  const deduction = money(input.deduction);
  const gross = money(basic + bonus + allowance);
  if (deduction > gross) throw new PayrollValidationError("কর্তন মোট বেতনের বেশি হতে পারবে না");
  return { basic, bonus, allowance, deduction, gross, net: money(gross - deduction) };
}

export function settledAmount(run: MonthlyPayroll) {
  const total = money(
    (run.advanceSettlements ?? []).reduce((sum, item) => sum + money(item.amount), 0),
  );
  if (run.advanceRecovered !== undefined && money(run.advanceRecovered) !== total)
    throw new PayrollValidationError("অগ্রিম সমন্বয়ের হিসাব মিলছে না");
  return total;
}

/** FIFO across eligible advances. Only paid payroll consumes advances; drafts reserve nothing. */
export function planAdvanceSettlement(
  run: MonthlyPayroll,
  advances: SalaryAdvance[],
  payroll: MonthlyPayroll[],
  paymentDate: string,
  requested?: number,
) {
  if (run.status !== "draft") throw new PayrollValidationError("বেতন ইতিমধ্যে পরিশোধিত");
  assertPayrollMonth(run.month);
  if (!Number.isFinite(Date.parse(paymentDate)))
    throw new PayrollValidationError("পরিশোধের তারিখ সঠিক নয়");
  const net = payrollAmounts(run).net;
  if (money(run.net) !== net) throw new PayrollValidationError("বেতনের নিট হিসাব মিলছে না");
  const used = new Map<string, number>();
  for (const paid of payroll.filter(
    (p) => p.status === "paid" && p.employeeId === run.employeeId,
  )) {
    for (const item of paid.advanceSettlements ?? [])
      used.set(item.advanceId, money((used.get(item.advanceId) ?? 0) + money(item.amount)));
  }
  const seen = new Set<string>();
  const available = advances
    .filter((a) => a.employeeId === run.employeeId)
    .map((a) => {
      if (seen.has(a.id)) throw new PayrollValidationError("একই অগ্রিম একাধিকবার পাওয়া গেছে");
      seen.add(a.id);
      if (!Number.isFinite(Date.parse(a.date)))
        throw new PayrollValidationError("অগ্রিমের তারিখ সঠিক নয়");
      const amount = money(a.amount);
      const consumed = used.get(a.id) ?? 0;
      if (consumed > amount) throw new PayrollValidationError("অগ্রিম অতিরিক্ত সমন্বয় করা হয়েছে");
      return { ...a, remaining: money(amount - consumed) };
    })
    .filter((a) => Date.parse(a.date) <= Date.parse(paymentDate))
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date) || a.id.localeCompare(b.id));
  const outstanding = money(available.reduce((sum, a) => sum + a.remaining, 0));
  const recovery = requested === undefined ? Math.min(net, outstanding) : money(requested);
  if (recovery > net || recovery > outstanding)
    throw new PayrollValidationError("সমন্বয়ের পরিমাণ বেতন বা অগ্রিমের বেশি");
  let remaining = recovery;
  const advanceSettlements: AdvanceSettlement[] = [];
  for (const advance of available) {
    const amount = Math.min(remaining, advance.remaining);
    if (amount > 0) advanceSettlements.push({ advanceId: advance.id, amount });
    remaining = money(remaining - amount);
  }
  return {
    advanceSettlements,
    advanceRecovered: recovery,
    cashPaid: money(net - recovery),
    outstanding: money(outstanding - recovery),
  };
}

export function monthlyPayrollReport(payroll: MonthlyPayroll[], month: string) {
  assertPayrollMonth(month);
  const rows = payroll.filter((run) => run.month === month);
  const totals = { gross: 0, deduction: 0, net: 0, advanceRecovered: 0, cashPaid: 0, unpaid: 0 };
  for (const run of rows) {
    const amounts = payrollAmounts(run);
    if (money(run.net) !== amounts.net)
      throw new PayrollValidationError("বেতনের নিট হিসাব মিলছে না");
    totals.gross += amounts.gross;
    totals.deduction += amounts.deduction;
    totals.net += amounts.net;
    if (run.status === "paid") {
      const recovered = settledAmount(run);
      if (recovered > amounts.net) throw new PayrollValidationError("অগ্রিম সমন্বয় বেতনের বেশি");
      const cash =
        run.cashPaid === undefined ? money(amounts.net - recovered) : money(run.cashPaid);
      if (money(cash + recovered) !== amounts.net)
        throw new PayrollValidationError("পরিশোধের হিসাব মিলছে না");
      totals.advanceRecovered += recovered;
      totals.cashPaid += cash;
    } else totals.unpaid += amounts.net;
  }
  for (const key of Object.keys(totals) as (keyof typeof totals)[])
    totals[key] = money(totals[key]);
  return { rows, totals };
}

/** Each employee is its own atomic save; an individual failure never hides earlier results. */
export async function createMonthlyPayrollDrafts(
  employees: Employee[],
  payroll: MonthlyPayroll[],
  month: string,
  create: (
    input: Pick<PayrollRun, "employeeId" | "month" | "basic" | "bonus" | "allowance" | "deduction">,
  ) => Promise<unknown>,
) {
  assertPayrollMonth(month);
  const result = {
    created: 0,
    skipped: 0,
    failures: [] as { employeeName: string; message: string }[],
  };
  for (const employee of employees.filter((row) => row.status === "active")) {
    try {
      if (
        payrollDate(employee.joiningDate).slice(0, 7) > month ||
        payroll.some((run) => run.employeeId === employee.id && run.month === month)
      ) {
        result.skipped++;
        continue;
      }
      await create({
        employeeId: employee.id,
        month,
        basic: employee.salary,
        bonus: 0,
        allowance: 0,
        deduction: 0,
      });
      result.created++;
    } catch (error) {
      result.failures.push({
        employeeName: employee.name,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return result;
}
