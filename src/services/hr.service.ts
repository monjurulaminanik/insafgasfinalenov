import { hrService as existing } from "./_services";
import { payrollFn, type PayrollCommand } from "@/lib/payroll.functions";
import { PayrollValidationError, type MonthlyPayroll, type SalaryAdvance } from "@/lib/payroll";
import type { PayrollRun, PaymentMethod } from "@/types";

async function request<T>(data: PayrollCommand): Promise<T> {
  const result = await payrollFn({ data });
  if (result && "validationError" in result)
    throw new PayrollValidationError(result.validationError);
  return result as T;
}

type DraftInput = Pick<
  PayrollRun,
  "employeeId" | "month" | "basic" | "bonus" | "allowance" | "deduction"
>;
export const hrService = {
  ...existing,
  listPayroll: existing.listPayroll as () => Promise<MonthlyPayroll[]>,
  listAdvances: () => request({ action: "advances" }) as Promise<SalaryAdvance[]>,
  createAdvance: (input: Omit<SalaryAdvance, "id" | "employeeName"> & { requestId: string }) =>
    request({ action: "advance", ...input }) as Promise<SalaryAdvance>,
  createPayroll: (input: DraftInput & { employeeName?: string }) =>
    request({
      action: "save",
      employeeId: input.employeeId,
      month: input.month,
      basic: input.basic,
      bonus: input.bonus,
      allowance: input.allowance,
      deduction: input.deduction,
    }) as Promise<MonthlyPayroll>,
  updatePayroll: async (
    id: string,
    input: Partial<Pick<PayrollRun, "basic" | "bonus" | "allowance" | "deduction" | "month">>,
  ) => {
    const run = (await existing.listPayroll()).find((row) => row.id === id);
    if (!run) throw new Error("বেতন পাওয়া যায়নি");
    return request({
      action: "save",
      id,
      employeeId: run.employeeId,
      month: input.month ?? run.month,
      basic: input.basic ?? run.basic,
      bonus: input.bonus ?? run.bonus,
      allowance: input.allowance ?? run.allowance,
      deduction: input.deduction ?? run.deduction,
    }) as Promise<MonthlyPayroll>;
  },
  removePayroll: (id: string) => request({ action: "remove", id }),
  payWithSettlement: (input: {
    id: string;
    method: PaymentMethod;
    paymentDate: string;
    advanceRecovery: number;
    requestId: string;
  }) => request({ action: "pay", ...input }) as Promise<MonthlyPayroll>,
};
