import type {
  Customer,
  Employee,
  PayrollRun,
  PurchaseOrder,
  SalesOrder,
  Supplier,
  SupplierReturn,
  Voucher,
} from "@/types";
import { parseRecordTime, type DateRange } from "@/lib/date-range";
import { customerOpeningSigned } from "@/lib/customer-balance";

export type PartyKind = "customer" | "supplier" | "employee";

export type StatementLineType =
  "opening" | "invoice" | "purchase" | "payment" | "receipt" | "salary" | "adjustment" | "return";

export type StatementLineHref =
  | { to: "/sales/$id"; params: { id: string } }
  | { to: "/purchases/$id"; params: { id: string } }
  | { to: "/suppliers/returns/$id"; params: { id: string } };

export type StatementLine = {
  id: string;
  date: string;
  particulars: string;
  reference?: string;
  description?: string;
  type: StatementLineType;
  debit: number;
  credit: number;
  balance: number;
  monthKey?: string;
  href?: StatementLineHref;
};

export type StatementMonthGroup = {
  key: string;
  label: string;
  payable: number;
  debit: number;
  credit: number;
  closing: number;
  lines: StatementLine[];
};

export type PartyStatementModel = {
  partyId: string;
  partyName: string;
  partyKind: PartyKind;
  phone: string;
  address: string;
  gstin?: string;
  openingBalance: number;
  lines: StatementLine[];
  totalDebit: number;
  totalCredit: number;
  closingBalance: number;
  periodSales: number;
  periodPurchases: number;
  periodCollections: number;
  periodPayments: number;
  periodReturns: number;
  periodAdjustments: number;
};

type RawLine = Omit<StatementLine, "balance">;

function signedDelta(kind: PartyKind, debit: number, credit: number) {
  return kind === "customer" ? debit - credit : credit - debit;
}

function payrollDate(run: PayrollRun) {
  return run.paidAt || run.createdAt || `${run.month}-01`;
}

function coveredByVouchers(vouchers: Voucher[], refType: "sales" | "purchase", refId: string) {
  return vouchers
    .filter((v) => v.refType === refType && v.refId === refId && v.type !== "journal")
    .reduce((a, v) => a + (Number(v.amount) || 0), 0);
}

function buildEmployeeRaws(payroll: PayrollRun[], vouchers: Voucher[], partyId: string): RawLine[] {
  const lines: RawLine[] = [];
  for (const run of payroll) {
    if (run.employeeId !== partyId) continue;
    const date = payrollDate(run);
    lines.push({
      id: `sal-${run.id}`,
      date,
      particulars: run.month,
      reference: run.month,
      description: "",
      type: "salary",
      debit: 0,
      credit: run.net || 0,
      monthKey: run.month,
    });
    if (run.status === "paid" && (run.net || 0) > 0) {
      lines.push({
        id: `sal-pay-${run.id}`,
        date: run.paidAt || date,
        particulars: run.month,
        reference: run.month,
        description: "",
        type: "payment",
        debit: run.net,
        credit: 0,
        monthKey: run.month,
      });
    }
  }
  for (const v of vouchers) {
    if (v.partyType !== "employee" || v.partyId !== partyId) continue;
    if (v.type === "journal") continue;
    const isPayment = v.type === "payment";
    lines.push({
      id: `vch-${v.id}`,
      date: v.date,
      particulars: v.voucherNo + (v.notes ? ` — ${v.notes}` : ""),
      reference: v.voucherNo,
      description: v.notes || "",
      type: isPayment ? "payment" : "receipt",
      debit: isPayment ? v.amount : 0,
      credit: isPayment ? 0 : v.amount,
      monthKey: monthKeyOf(v.date),
    });
  }
  return lines;
}

function buildCustomerRaws(sales: SalesOrder[], vouchers: Voucher[], partyId: string): RawLine[] {
  const lines: RawLine[] = [];
  for (const inv of sales) {
    if (inv.customerId !== partyId) continue;
    if (inv.status === "cancelled" || inv.status === "draft") continue;
    lines.push({
      id: `inv-${inv.id}`,
      date: inv.date,
      particulars: inv.orderNo,
      reference: inv.orderNo,
      description: inv.notes || "",
      type: "invoice",
      debit: inv.total || 0,
      credit: 0,
      href: { to: "/sales/$id", params: { id: inv.id } },
    });
    const leftover = (inv.paid || 0) - coveredByVouchers(vouchers, "sales", inv.id);
    if (leftover > 0.009) {
      lines.push({
        id: `inv-pay-${inv.id}`,
        date: inv.date,
        particulars: inv.orderNo,
        reference: inv.orderNo,
        description: "",
        type: "receipt",
        debit: 0,
        credit: leftover,
        href: { to: "/sales/$id", params: { id: inv.id } },
      });
    }
  }
  for (const v of vouchers) {
    if (v.partyType !== "customer" || v.partyId !== partyId) continue;
    if (v.type === "journal") {
      lines.push({
        id: `vch-${v.id}`,
        date: v.date,
        particulars: v.voucherNo + (v.notes ? ` — ${v.notes}` : ""),
        reference: v.voucherNo,
        description: v.notes || "",
        type: "adjustment",
        debit: 0,
        credit: v.amount || 0,
      });
      continue;
    }
    const isReceipt = v.type === "receipt";
    lines.push({
      id: `vch-${v.id}`,
      date: v.date,
      particulars: v.voucherNo + (v.notes ? ` — ${v.notes}` : ""),
      reference: v.voucherNo,
      description: v.notes || "",
      type: isReceipt ? "receipt" : "payment",
      debit: isReceipt ? 0 : v.amount,
      credit: isReceipt ? v.amount : 0,
    });
  }
  return lines;
}

function buildSupplierRaws(
  purchases: PurchaseOrder[],
  vouchers: Voucher[],
  partyId: string,
  supplierReturns: SupplierReturn[] = [],
): RawLine[] {
  const lines: RawLine[] = [];
  for (const po of purchases) {
    if (po.supplierId !== partyId) continue;
    if (po.status === "cancelled" || po.status === "draft") continue;
    lines.push({
      id: `po-${po.id}`,
      date: po.date,
      particulars: po.orderNo,
      reference: po.orderNo,
      description: po.notes || "",
      type: "purchase",
      debit: 0,
      credit: po.total || 0,
      href: { to: "/purchases/$id", params: { id: po.id } },
    });
    const leftover = (po.paid || 0) - coveredByVouchers(vouchers, "purchase", po.id);
    if (leftover > 0.009) {
      lines.push({
        id: `po-pay-${po.id}`,
        date: po.date,
        particulars: po.orderNo,
        reference: po.orderNo,
        description: "",
        type: "payment",
        debit: leftover,
        credit: 0,
        href: { to: "/purchases/$id", params: { id: po.id } },
      });
    }
  }
  for (const ret of supplierReturns) {
    if (ret.supplierId !== partyId) continue;
    if (ret.status === "cancelled") continue;
    lines.push({
      id: `sr-${ret.id}`,
      date: ret.date,
      particulars: ret.returnNo,
      reference: ret.returnNo,
      description: ret.notes || "",
      type: "return",
      debit: ret.total || 0,
      credit: 0,
      href: { to: "/suppliers/returns/$id", params: { id: ret.id } },
    });
  }
  for (const v of vouchers) {
    if (v.partyType !== "supplier" || v.partyId !== partyId) continue;
    if (v.type === "journal") {
      lines.push({
        id: `vch-${v.id}`,
        date: v.date,
        particulars: v.voucherNo + (v.notes ? ` — ${v.notes}` : ""),
        reference: v.voucherNo,
        description: v.notes || "",
        type: "adjustment",
        debit: v.amount || 0,
        credit: 0,
      });
      continue;
    }
    const isPayment = v.type === "payment";
    lines.push({
      id: `vch-${v.id}`,
      date: v.date,
      particulars: v.voucherNo + (v.notes ? ` — ${v.notes}` : ""),
      reference: v.voucherNo,
      description: v.notes || "",
      type: isPayment ? "payment" : "receipt",
      debit: isPayment ? v.amount : 0,
      credit: isPayment ? 0 : v.amount,
    });
  }
  return lines;
}

function sortByDate(a: RawLine, b: RawLine) {
  return (parseRecordTime(a.date) ?? 0) - (parseRecordTime(b.date) ?? 0);
}

export function monthKeyOf(value: string) {
  if (/^\d{4}-\d{2}$/.test(value)) return value;
  const t = parseRecordTime(value);
  if (t == null) return "";
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function formatMonthLabel(key: string, locale: string) {
  const [y, m] = key.split("-").map(Number);
  if (!y || !m) return key;
  const tag = locale.startsWith("bn") ? "bn-BD" : "en-US";
  const month = new Date(y, m - 1, 1).toLocaleDateString(tag, { month: "long" });
  return `${month}, ${y}`;
}

export function groupStatementByMonth(
  lines: StatementLine[],
  locale: string,
): StatementMonthGroup[] {
  const map = new Map<string, StatementLine[]>();
  for (const line of lines) {
    if (line.type === "opening") continue;
    const key = line.monthKey || monthKeyOf(line.date) || "other";
    const list = map.get(key) ?? [];
    list.push(line);
    map.set(key, list);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, monthLines]) => {
      const debit = monthLines.reduce((s, l) => s + l.debit, 0);
      const credit = monthLines.reduce((s, l) => s + l.credit, 0);
      const closing = monthLines[monthLines.length - 1]?.balance ?? 0;
      return {
        key,
        label: key === "other" ? key : formatMonthLabel(key, locale),
        payable: Math.max(0, closing),
        debit,
        credit,
        closing,
        lines: monthLines,
      };
    });
}

function periodSum(lines: StatementLine[], type: StatementLineType, side: "debit" | "credit") {
  return lines.filter((l) => l.type === type).reduce((a, l) => a + l[side], 0);
}

export function buildPartyStatement(opts: {
  kind: "customer";
  party: Customer;
  sales: SalesOrder[];
  purchases?: PurchaseOrder[];
  payroll?: PayrollRun[];
  vouchers: Voucher[];
  range: DateRange;
}): PartyStatementModel;
export function buildPartyStatement(opts: {
  kind: "supplier";
  party: Supplier;
  sales?: SalesOrder[];
  purchases: PurchaseOrder[];
  supplierReturns?: SupplierReturn[];
  payroll?: PayrollRun[];
  vouchers: Voucher[];
  range: DateRange;
}): PartyStatementModel;
export function buildPartyStatement(opts: {
  kind: "employee";
  party: Employee;
  sales?: SalesOrder[];
  purchases?: PurchaseOrder[];
  supplierReturns?: SupplierReturn[];
  payroll: PayrollRun[];
  vouchers: Voucher[];
  range: DateRange;
}): PartyStatementModel;
export function buildPartyStatement(opts: {
  kind: PartyKind;
  party: Customer | Supplier | Employee;
  sales?: SalesOrder[];
  purchases?: PurchaseOrder[];
  supplierReturns?: SupplierReturn[];
  payroll?: PayrollRun[];
  vouchers: Voucher[];
  range: DateRange;
}): PartyStatementModel {
  const { kind, party, vouchers, range } = opts;
  const raws = (
    kind === "customer"
      ? buildCustomerRaws(opts.sales ?? [], vouchers, party.id)
      : kind === "supplier"
        ? buildSupplierRaws(opts.purchases ?? [], vouchers, party.id, opts.supplierReturns ?? [])
        : buildEmployeeRaws(opts.payroll ?? [], vouchers, party.id)
  ).sort(sortByDate);

  const fromTs = range.preset !== "all" && range.from ? parseRecordTime(range.from) : null;
  const toTs = range.preset !== "all" && range.to ? parseRecordTime(`${range.to}T23:59:59`) : null;

  const openingSeed =
    kind === "customer" && "openingBalance" in party
      ? customerOpeningSigned(party as Customer)
      : "openingBalance" in party
        ? party.openingBalance || 0
        : 0;
  let opening = openingSeed;
  const period: RawLine[] = [];
  for (const line of raws) {
    const t = parseRecordTime(line.date) ?? 0;
    if (fromTs != null && t < fromTs) {
      opening += signedDelta(kind, line.debit, line.credit);
      continue;
    }
    if (toTs != null && t > toTs) continue;
    period.push(line);
  }

  const openingDate = range.from || party.createdAt;
  let running = opening;
  const openingDebit =
    kind === "customer" ? (opening >= 0 ? opening : 0) : opening < 0 ? -opening : 0;
  const openingCredit =
    kind === "customer" ? (opening < 0 ? -opening : 0) : opening >= 0 ? opening : 0;
  const lines: StatementLine[] = [
    {
      id: "opening",
      date: openingDate,
      particulars: "",
      reference: "",
      description: "",
      type: "opening",
      debit: openingDebit,
      credit: openingCredit,
      balance: opening,
    },
  ];

  for (const line of period) {
    running += signedDelta(kind, line.debit, line.credit);
    lines.push({ ...line, balance: running });
  }

  const totalDebit = lines.reduce((a, l) => a + l.debit, 0);
  const totalCredit = lines.reduce((a, l) => a + l.credit, 0);
  const activity = lines.filter((l) => l.type !== "opening");

  return {
    partyId: party.id,
    partyName: party.name,
    partyKind: kind,
    phone: party.phone,
    address:
      "address" in party
        ? party.address
        : `${(party as Employee).designation} · ${(party as Employee).department}`,
    gstin: "gstin" in party ? party.gstin : undefined,
    openingBalance: opening,
    lines,
    totalDebit,
    totalCredit,
    closingBalance: running,
    periodSales: periodSum(activity, "invoice", "debit"),
    periodPurchases: periodSum(activity, "purchase", "credit"),
    periodCollections: periodSum(activity, "receipt", "credit"),
    periodPayments:
      periodSum(activity, "payment", "debit") + periodSum(activity, "payment", "credit"),
    periodReturns: periodSum(activity, "return", "debit") + periodSum(activity, "return", "credit"),
    periodAdjustments:
      periodSum(activity, "adjustment", "debit") + periodSum(activity, "adjustment", "credit"),
  };
}
