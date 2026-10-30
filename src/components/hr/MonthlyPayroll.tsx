import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { hrService } from "@/services/hr.service";
import {
  monthlyPayrollReport,
  planAdvanceSettlement,
  settledAmount,
  PayrollValidationError,
  createMonthlyPayrollDrafts,
} from "@/lib/payroll";
import type { MonthlyPayroll as Payroll } from "@/lib/payroll";
import type { Employee, PaymentMethod } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { formatCurrency } from "@/utils/formatters";
import { PayslipPrint } from "./PayslipPrint";
import { DateRangeFilter } from "@/components/common/DateRangeFilter";
import { createTodayDateRange, filterByDateRange, toDateInputValue } from "@/lib/date-range";

const localDate = toDateInputValue;
const selectClass = "h-9 w-full rounded-md border bg-background px-3 text-sm";
const empty = { employeeId: "", basic: "0", bonus: "0", allowance: "0", deduction: "0" };

export function MonthlyPayroll({ employees }: { employees: Employee[] }) {
  const qc = useQueryClient();
  const [month, setMonth] = useState(localDate().slice(0, 7));
  const [form, setForm] = useState(empty);
  const [editId, setEditId] = useState<string>();
  const [advanceEmployee, setAdvanceEmployee] = useState("");
  const [advanceAmount, setAdvanceAmount] = useState("");
  const [advanceDate, setAdvanceDate] = useState(localDate());
  const [advanceMethod, setAdvanceMethod] = useState<PaymentMethod>("cash");
  const [historyRange, setHistoryRange] = useState(createTodayDateRange);
  const [advanceRejected, setAdvanceRejected] = useState(false);
  const [paymentRejected, setPaymentRejected] = useState(false);
  const [selected, setSelected] = useState<Payroll | null>(null);
  const [paymentDate, setPaymentDate] = useState(localDate());
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("bank");
  const [recovery, setRecovery] = useState("0");
  const [print, setPrint] = useState<Payroll | null>(null);
  // Keep tokens and payloads across retries, including uncertain network outcomes.
  const advanceRequest = useRef<Parameters<typeof hrService.createAdvance>[0] | null>(null);
  const paymentRequest = useRef<Parameters<typeof hrService.payWithSettlement>[0] | null>(null);
  const runs = useQuery({ queryKey: ["payroll"], queryFn: hrService.listPayroll });
  const advances = useQuery({ queryKey: ["salaryAdvances"], queryFn: hrService.listAdvances });
  const refresh = () => {
    for (const key of [
      "payroll",
      "salaryAdvances",
      "ledger",
      "vouchers",
      "dashboard",
      "accounting",
      "reports",
      "statement",
    ])
      void qc.invalidateQueries({ queryKey: [key] });
  };
  const save = useMutation({
    mutationFn: () => {
      const input = {
        employeeId: form.employeeId,
        month,
        basic: Number(form.basic),
        bonus: Number(form.bonus),
        allowance: Number(form.allowance),
        deduction: Number(form.deduction),
      };
      return editId ? hrService.updatePayroll(editId, input) : hrService.createPayroll(input);
    },
    onSuccess: () => {
      refresh();
      setForm(empty);
      setEditId(undefined);
      toast.success("বেতন সংরক্ষিত হয়েছে");
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const bulk = useMutation({
    mutationFn: () =>
      createMonthlyPayrollDrafts(employees, runs.data ?? [], month, hrService.createPayroll),
    onSuccess: (result) => {
      refresh();
      if (result.failures.length)
        toast.error(`${result.created}টি তৈরি; ${result.failures.length}টি ব্যর্থ`);
      else toast.success(`${result.created}টি বেতনের খসড়া তৈরি হয়েছে`);
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const advance = useMutation({
    mutationFn: () => {
      advanceRequest.current ??= {
        employeeId: advanceEmployee,
        amount: Number(advanceAmount),
        date: new Date(`${advanceDate}T00:00:00+06:00`).toISOString(),
        paymentMethod: advanceMethod,
        requestId: crypto.randomUUID(),
      };
      return hrService.createAdvance(advanceRequest.current);
    },
    onSuccess: () => {
      advanceRequest.current = null;
      setAdvanceRejected(false);
      setAdvanceAmount("");
      refresh();
      toast.success("অগ্রিম দেওয়া হয়েছে");
    },
    onError: (error: Error) => {
      setAdvanceRejected(error instanceof PayrollValidationError);
      toast.error(error.message);
    },
  });
  const pay = useMutation({
    mutationFn: () => {
      if (!selected) throw new Error("বেতন নির্বাচন করুন");
      paymentRequest.current ??= {
        id: selected.id,
        method: paymentMethod,
        paymentDate: new Date(`${paymentDate}T00:00:00+06:00`).toISOString(),
        advanceRecovery: Number(recovery),
        requestId: crypto.randomUUID(),
      };
      return hrService.payWithSettlement(paymentRequest.current);
    },
    onSuccess: () => {
      paymentRequest.current = null;
      setPaymentRejected(false);
      setSelected(null);
      refresh();
      toast.success("বেতন পরিশোধিত হয়েছে");
    },
    onError: (error: Error) => {
      setPaymentRejected(error instanceof PayrollValidationError);
      refresh();
      toast.error(error.message);
    },
  });
  const remove = useMutation({
    mutationFn: hrService.removePayroll,
    onSuccess: refresh,
    onError: (error: Error) => toast.error(error.message),
  });

  if (runs.isPending || advances.isPending) return <p role="status">বেতনের তথ্য লোড হচ্ছে…</p>;
  if (runs.isError || advances.isError)
    return (
      <div role="alert">
        বেতনের তথ্য লোড হয়নি।{" "}
        <Button
          onClick={() => {
            void runs.refetch();
            void advances.refetch();
          }}
        >
          আবার চেষ্টা করুন
        </Button>
      </div>
    );
  let report: ReturnType<typeof monthlyPayrollReport> | undefined;
  let reportError = "";
  try {
    report = monthlyPayrollReport(runs.data, month);
  } catch (error) {
    reportError = (error as Error).message;
  }
  let preview: ReturnType<typeof planAdvanceSettlement> | undefined;
  let previewError = "";
  if (selected) {
    try {
      preview = planAdvanceSettlement(
        selected,
        advances.data,
        runs.data,
        new Date(`${paymentDate}T00:00:00+06:00`).toISOString(),
        Number(recovery),
      );
    } catch (error) {
      previewError = (error as Error).message;
    }
  }
  const methods = (value: PaymentMethod, change: (value: PaymentMethod) => void, id: string) => (
    <select
      id={id}
      disabled={
        id === "advance-method"
          ? advance.isPending || Boolean(advanceRequest.current)
          : pay.isPending || Boolean(paymentRequest.current)
      }
      className={selectClass}
      value={value}
      onChange={(e) => change(e.target.value as PaymentMethod)}
    >
      <option value="cash">নগদ</option>
      <option value="bank">ব্যাংক</option>
      <option value="mobile">মোবাইল</option>
      <option value="cheque">চেক</option>
    </select>
  );
  const employeeOptions = employees.filter(
    (employee) => employee.status === "active" || employee.id === form.employeeId,
  );
  const edit = (run: Payroll) => {
    setEditId(run.id);
    setMonth(run.month);
    setForm({
      employeeId: run.employeeId,
      basic: String(run.basic),
      bonus: String(run.bonus),
      allowance: String(run.allowance),
      deduction: String(run.deduction),
    });
  };
  const exportReport = () => {
    if (!report) return;
    const cell = (value: string | number) =>
      `"${String(value)
        .replace(/^[=+@-]/, "'$&")
        .replaceAll('"', '""')}"`;
    const csv = [
      [
        "Month",
        "Employee",
        "Status",
        "Gross",
        "Deduction",
        "Net salary",
        "Advance recovered",
        "Cash paid",
      ],
      ...report.rows.map((run) => [
        run.month,
        run.employeeName,
        run.status,
        run.basic + run.bonus + run.allowance,
        run.deduction,
        run.net,
        run.status === "paid" ? settledAmount(run) : 0,
        run.status === "paid" ? (run.cashPaid ?? run.net - settledAmount(run)) : 0,
      ]),
    ]
      .map((row) => row.map(cell).join(","))
      .join("\r\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `payroll-${month}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label htmlFor="payroll-month">বেতনের মাস</Label>
          <Input
            id="payroll-month"
            type="month"
            required
            disabled={bulk.isPending || save.isPending}
            value={month}
            onChange={(e) => {
              setMonth(e.target.value);
              setEditId(undefined);
              setForm(empty);
            }}
          />
        </div>
        <Button variant="outline" onClick={exportReport} disabled={!report}>
          মাসিক রিপোর্ট CSV
        </Button>
        <Button
          variant="outline"
          disabled={bulk.isPending || save.isPending || !report}
          onClick={() => bulk.mutate()}
        >
          {bulk.isPending ? "সবার বেতন তৈরি হচ্ছে…" : "সক্রিয় সবার বেতন তৈরি করুন"}
        </Button>
      </div>
      {bulk.data && (
        <div role="status" className="rounded-md border p-3 text-sm">
          <p>
            {bulk.data.created}টি তৈরি · {bulk.data.skipped}টি আগে তৈরি বা প্রযোজ্য নয় ·{" "}
            {bulk.data.failures.length}টি ব্যর্থ
          </p>
          {bulk.data.failures.map((failure, index) => (
            <p key={index} className="text-destructive">
              {failure.employeeName}: {failure.message}
            </p>
          ))}
        </div>
      )}
      {reportError && (
        <p role="alert" className="text-destructive">
          {reportError}
        </p>
      )}
      {report && (
        <dl className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {(
            [
              ["মোট আয়", report.totals.gross],
              ["সাধারণ কর্তন", report.totals.deduction],
              ["নিট বেতন", report.totals.net],
              ["অগ্রিম সমন্বয়", report.totals.advanceRecovered],
              ["নগদ/ব্যাংক পরিশোধ", report.totals.cashPaid],
              ["অপরিশোধিত", report.totals.unpaid],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="rounded-md border p-3">
              <dt className="text-sm text-muted-foreground">{label}</dt>
              <dd className="font-semibold">{formatCurrency(value)}</dd>
            </div>
          ))}
        </dl>
      )}
      <Card>
        <CardContent className="pt-6">
          <h3 className="mb-3 font-semibold">
            {editId ? "বেতনের খসড়া সম্পাদনা" : "মাসিক বেতন তৈরি"}
          </h3>
          <form
            className="grid items-end gap-3 md:grid-cols-3"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
          >
            <div>
              <Label htmlFor="salary-employee">কর্মী</Label>
              <select
                id="salary-employee"
                className={selectClass}
                required
                disabled={Boolean(editId)}
                value={form.employeeId}
                onChange={(e) =>
                  setForm({
                    ...form,
                    employeeId: e.target.value,
                    basic: String(
                      employees.find((employee) => employee.id === e.target.value)?.salary ?? 0,
                    ),
                  })
                }
              >
                <option value="">নির্বাচন করুন</option>
                {employeeOptions.map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.name}
                  </option>
                ))}
              </select>
            </div>
            {(
              [
                ["basic", "মূল বেতন"],
                ["bonus", "বোনাস"],
                ["allowance", "ভাতা"],
                ["deduction", "সাধারণ কর্তন"],
              ] as const
            ).map(([key, label]) => (
              <div key={key}>
                <Label htmlFor={`salary-${key}`}>{label}</Label>
                <Input
                  id={`salary-${key}`}
                  type="number"
                  min="0"
                  max="1000000000000"
                  step="0.01"
                  required
                  value={form[key]}
                  onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                />
              </div>
            ))}
            <div className="flex gap-2">
              <Button disabled={save.isPending || !month}>
                {save.isPending ? "সংরক্ষণ হচ্ছে…" : "সংরক্ষণ"}
              </Button>
              {editId && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setEditId(undefined);
                    setForm(empty);
                  }}
                >
                  বাতিল
                </Button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-6">
          <h3 className="mb-3 font-semibold">বেতনের অগ্রিম</h3>
          <p className="mb-3 text-sm text-muted-foreground">
            অগ্রিম সাধারণ কর্তন নয়। অবশিষ্ট অগ্রিম পরের মাসেও সমন্বয় করা যাবে।
          </p>
          <form
            className="grid items-end gap-3 md:grid-cols-5"
            onSubmit={(e) => {
              e.preventDefault();
              advance.mutate();
            }}
          >
            <div>
              <Label htmlFor="advance-employee">কর্মী</Label>
              <select
                id="advance-employee"
                required
                disabled={advance.isPending || Boolean(advanceRequest.current)}
                className={selectClass}
                value={advanceEmployee}
                onChange={(e) => setAdvanceEmployee(e.target.value)}
              >
                <option value="">নির্বাচন করুন</option>
                {employees
                  .filter((employee) => employee.status === "active")
                  .map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.name}
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <Label htmlFor="advance-amount">অগ্রিমের পরিমাণ</Label>
              <Input
                id="advance-amount"
                required
                disabled={advance.isPending || Boolean(advanceRequest.current)}
                type="number"
                min="0.01"
                step="0.01"
                value={advanceAmount}
                onChange={(e) => setAdvanceAmount(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="advance-date">তারিখ</Label>
              <Input
                id="advance-date"
                required
                disabled={advance.isPending || Boolean(advanceRequest.current)}
                type="date"
                max={localDate()}
                value={advanceDate}
                onChange={(e) => setAdvanceDate(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="advance-method">মাধ্যম</Label>
              {methods(
                advanceMethod,
                (value) => {
                  if (!advanceRequest.current) setAdvanceMethod(value);
                },
                "advance-method",
              )}
            </div>
            <Button disabled={advance.isPending}>
              {advance.isPending
                ? "পরিশোধ হচ্ছে…"
                : advanceRequest.current
                  ? "একই অনুরোধ আবার পাঠান"
                  : "অগ্রিম দিন"}
            </Button>
          </form>
          {advanceRejected && (
            <div role="alert" className="mt-3">
              <p>সার্ভার অনুরোধটি প্রত্যাখ্যান করেছে; কোনো অর্থ পরিশোধ হয়নি।</p>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  advanceRequest.current = null;
                  setAdvanceRejected(false);
                }}
              >
                তথ্য সংশোধন করুন
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
      {selected && (
        <Card>
          <CardContent className="space-y-3 pt-6">
            <h3 className="font-semibold">
              {selected.employeeName} · {selected.month} বেতন পরিশোধ
            </h3>
            <form
              className="grid items-end gap-3 md:grid-cols-4"
              onSubmit={(e) => {
                e.preventDefault();
                pay.mutate();
              }}
            >
              <div>
                <Label htmlFor="payment-date">পরিশোধের তারিখ</Label>
                <Input
                  id="payment-date"
                  type="date"
                  required
                  max={localDate()}
                  disabled={pay.isPending || Boolean(paymentRequest.current)}
                  value={paymentDate}
                  onChange={(e) => setPaymentDate(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="payment-method">মাধ্যম</Label>
                {methods(
                  paymentMethod,
                  (value) => {
                    if (!paymentRequest.current) setPaymentMethod(value);
                  },
                  "payment-method",
                )}
              </div>
              <div>
                <Label htmlFor="advance-recovery">অগ্রিম সমন্বয়</Label>
                <Input
                  id="advance-recovery"
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  disabled={pay.isPending || Boolean(paymentRequest.current)}
                  value={recovery}
                  onChange={(e) => setRecovery(e.target.value)}
                />
              </div>
              <div className="flex gap-2">
                <Button disabled={pay.isPending || (!preview && !paymentRequest.current)}>
                  {pay.isPending
                    ? "পরিশোধ হচ্ছে…"
                    : paymentRequest.current
                      ? "আবার পাঠান"
                      : "পরিশোধ করুন"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={pay.isPending || Boolean(paymentRequest.current)}
                  onClick={() => setSelected(null)}
                >
                  বাতিল
                </Button>
              </div>
            </form>
            {preview && (
              <p role="status">
                নিট বেতন {formatCurrency(selected.net)} · অগ্রিম সমন্বয়{" "}
                {formatCurrency(preview.advanceRecovered)} · এখন পরিশোধ{" "}
                {formatCurrency(preview.cashPaid)} · অবশিষ্ট অগ্রিম{" "}
                {formatCurrency(preview.outstanding)}
              </p>
            )}
            {previewError && (
              <p role="alert" className="text-destructive">
                {previewError}
              </p>
            )}
            {paymentRejected && (
              <div role="alert">
                <p>সার্ভার অনুরোধটি প্রত্যাখ্যান করেছে; এই অনুরোধে অর্থ পরিশোধ হয়নি।</p>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    paymentRequest.current = null;
                    setPaymentRejected(false);
                  }}
                >
                  তথ্য সংশোধন করুন
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <caption className="p-3 text-left font-semibold">{month} মাসের বেতন</caption>
          <thead>
            <tr>
              {["কর্মী", "নিট বেতন", "অগ্রিম সমন্বয়", "পরিশোধ", "অবস্থা", "কার্যক্রম"].map(
                (label) => (
                  <th scope="col" key={label} className="p-3 text-left">
                    {label}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {report?.rows.map((run) => (
              <tr key={run.id} className="border-t">
                <td className="p-3">{run.employeeName}</td>
                <td className="p-3">{formatCurrency(run.net)}</td>
                <td className="p-3">
                  {formatCurrency(run.status === "paid" ? settledAmount(run) : 0)}
                </td>
                <td className="p-3">
                  {run.status === "paid"
                    ? formatCurrency(run.cashPaid ?? run.net - settledAmount(run))
                    : "—"}
                </td>
                <td className="p-3">{run.status === "paid" ? "পরিশোধিত" : "খসড়া"}</td>
                <td className="flex flex-wrap gap-2 p-3">
                  {run.status === "draft" && (
                    <>
                      <Button
                        size="sm"
                        disabled={Boolean(paymentRequest.current)}
                        onClick={() => {
                          setSelected(run);
                          setRecovery("0");
                        }}
                      >
                        পরিশোধ
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => edit(run)}>
                        সম্পাদনা
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={remove.isPending}
                        onClick={() => {
                          if (confirm("বেতনের খসড়া মুছবেন?")) remove.mutate(run.id);
                        }}
                      >
                        মুছুন
                      </Button>
                    </>
                  )}
                  <Button size="sm" variant="outline" onClick={() => setPrint(run)}>
                    পে স্লিপ
                  </Button>
                </td>
              </tr>
            ))}
            {report?.rows.length === 0 && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-muted-foreground">
                  এই মাসে বেতন তৈরি হয়নি
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <section className="space-y-3" aria-label="অগ্রিমের ইতিহাস">
        <DateRangeFilter value={historyRange} onChange={setHistoryRange} />
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <caption className="p-3 text-left font-semibold">
              অগ্রিমের ইতিহাস · সমন্বয় ও অবশিষ্ট সর্বকালের হিসাব
            </caption>
            <thead>
              <tr>
                {["কর্মী", "তারিখ", "অগ্রিম", "সমন্বয়", "অবশিষ্ট"].map((label) => (
                  <th scope="col" className="p-3 text-left" key={label}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filterByDateRange(advances.data, historyRange, (item) => item.date).map((item) => {
                const recovered = runs.data
                  .filter((run) => run.status === "paid" && run.employeeId === item.employeeId)
                  .flatMap((run) => run.advanceSettlements ?? [])
                  .filter((settlement) => settlement.advanceId === item.id)
                  .reduce((sum, settlement) => sum + settlement.amount, 0);
                return (
                  <tr className="border-t" key={item.id}>
                    <td className="p-3">{item.employeeName}</td>
                    <td className="p-3">
                      {new Date(item.date).toLocaleDateString("bn-BD", { timeZone: "Asia/Dhaka" })}
                    </td>
                    <td className="p-3">{formatCurrency(item.amount)}</td>
                    <td className="p-3">{formatCurrency(recovered)}</td>
                    <td className="p-3">{formatCurrency(item.amount - recovered)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      <PayslipPrint
        run={print}
        open={Boolean(print)}
        onOpenChange={(open) => {
          if (!open) setPrint(null);
        }}
      />
    </div>
  );
}
