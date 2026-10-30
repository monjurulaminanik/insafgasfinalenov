import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { PrintDocHeader } from "@/components/common/PrintDocHeader";
import { formatCurrency, formatDate } from "@/utils/formatters";
import type { PayrollRun } from "@/types";
import { useT } from "@/i18n";
import { Printer } from "lucide-react";

export function PayslipPrint({
  run,
  open,
  onOpenChange,
}: {
  run: PayrollRun | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  if (!run) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="print-sheet max-w-2xl sm:max-w-2xl print:max-w-none print:border-none print:p-0 print:m-0 print:shadow-none">
        <DialogHeader className="no-print flex flex-row items-center justify-between space-y-0">
          <DialogTitle>Payslip</DialogTitle>
          <Button variant="outline" size="sm" className="mr-4" onClick={() => window.print()}>
            <Printer className="mr-2 h-4 w-4" />
            {t("common.print")}
          </Button>
        </DialogHeader>

        <div className="space-y-6 bg-white p-6 text-black print:p-0">
          <PrintDocHeader
            title="Payslip"
            subtitle={`${t("hr.month")}: ${run.month}`}
            right={
              <div className="text-right">
                <p className="text-xl font-bold uppercase tracking-wider">PAYSLIP</p>
                <p className="mt-1 text-sm font-medium">{run.month}</p>
              </div>
            }
          />

          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="mb-1 font-semibold text-muted-foreground">Employee Details</p>
              <p className="text-lg font-medium">{run.employeeName}</p>
              <p>Status: {t(`status.${run.status}` as any) || run.status}</p>
            </div>
            <div className="text-right">
              <p className="mb-1 font-semibold text-muted-foreground">Payment Info</p>
              <p>Date: {run.paidAt ? formatDate(run.paidAt) : "—"}</p>
              <p>
                Method:{" "}
                {run.paymentMethod
                  ? t(`common.${run.paymentMethod}` as any) || run.paymentMethod
                  : "—"}
              </p>
            </div>
          </div>

          <div className="mt-6 overflow-hidden rounded-md border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40">
                <tr>
                  <th className="px-4 py-2 text-left font-semibold">Earnings</th>
                  <th className="px-4 py-2 text-right font-semibold">Amount</th>
                  <th className="border-l px-4 py-2 text-left font-semibold">Deductions</th>
                  <th className="px-4 py-2 text-right font-semibold">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                <tr>
                  <td className="px-4 py-2">{t("hr.basicSalary")}</td>
                  <td className="px-4 py-2 text-right">{formatCurrency(run.basic)}</td>
                  <td className="border-l px-4 py-2">{t("hr.deduction")}</td>
                  <td className="px-4 py-2 text-right">
                    {run.deduction > 0 ? formatCurrency(run.deduction) : "—"}
                  </td>
                </tr>
                <tr>
                  <td className="px-4 py-2">{t("hr.bonus")}</td>
                  <td className="px-4 py-2 text-right">
                    {run.bonus > 0 ? formatCurrency(run.bonus) : "—"}
                  </td>
                  <td className="border-l px-4 py-2" />
                  <td className="px-4 py-2 text-right" />
                </tr>
                <tr>
                  <td className="px-4 py-2">{t("hr.allowance")}</td>
                  <td className="px-4 py-2 text-right">
                    {run.allowance > 0 ? formatCurrency(run.allowance) : "—"}
                  </td>
                  <td className="border-l px-4 py-2" />
                  <td className="px-4 py-2 text-right" />
                </tr>
              </tbody>
              <tfoot className="border-t bg-muted/30 font-bold">
                <tr>
                  <td className="px-4 py-3 text-right">Gross Earnings</td>
                  <td className="px-4 py-3 text-right">
                    {formatCurrency(run.basic + run.bonus + run.allowance)}
                  </td>
                  <td className="border-l px-4 py-3 text-right">Total Deductions</td>
                  <td className="px-4 py-3 text-right">{formatCurrency(run.deduction)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="flex justify-end pt-4">
            <div className="w-64 border-t-2 border-foreground pt-2">
              <div className="flex items-center justify-between text-lg font-bold">
                <span>Net Pay</span>
                <span>{formatCurrency(run.net)}</span>
              </div>
            </div>
          </div>

          <div className="flex justify-between px-8 pb-8 pt-16">
            <div className="w-40 border-t border-muted-foreground pt-2 text-center text-sm">
              Employer Signature
            </div>
            <div className="w-40 border-t border-muted-foreground pt-2 text-center text-sm">
              Employee Signature
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
